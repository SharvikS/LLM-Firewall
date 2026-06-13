// Package plugins runs operator-supplied WebAssembly detection rules as an
// extra, sandboxed stage of the request pipeline.
//
// Why WASM: custom detection logic often needs to ship faster than the gateway
// release cycle and may be written by a different team. A .wasm module is a
// memory-safe, language-agnostic, sandboxed unit — it cannot touch the host
// filesystem, network, or memory, so a buggy or hostile rule can only return a
// verdict, never compromise the gateway.
//
// ABI (host <-> module), kept deliberately tiny:
//
//	buffer_ptr() i32   – pointer to a shared scratch buffer in module memory
//	buffer_cap() i32   – capacity of that buffer in bytes
//	scan(in_len i32) i32 – read prompt from buffer[:in_len], write a JSON
//	                       verdict back into buffer, return the verdict length.
//
// Verdict JSON: {"block":bool,"score":number,"reason":string}.
//
// See plugins/sample/ for a reference plugin and its build script.
package plugins

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
)

// Verdict is the result of one plugin evaluating a prompt.
type Verdict struct {
	Block  bool    `json:"block"`
	Score  float64 `json:"score"`
	Reason string  `json:"reason"`
	Plugin string  `json:"plugin"` // filled by the runtime, not the module
}

type plugin struct {
	name     string
	compiled wazero.CompiledModule
	pool     sync.Pool // *instance — pooled so concurrent requests don't serialize
}

type instance struct {
	mod     api.Module
	bufPtr  uint32
	bufCap  uint32
	scan    api.Function
	scanMu  sync.Mutex // one in-flight scan per instance (shared buffer)
}

// Runtime holds the compiled plugins and the shared wazero runtime.
type Runtime struct {
	rt      wazero.Runtime
	plugins []*plugin
	timeout time.Duration
}

// Enabled reports whether any plugin is loaded.
func (r *Runtime) Enabled() bool { return r != nil && len(r.plugins) > 0 }

// Count returns the number of loaded plugins.
func (r *Runtime) Count() int {
	if r == nil {
		return 0
	}
	return len(r.plugins)
}

// Load compiles every *.wasm file in dir. An empty dir path disables the
// system (returns a nil-safe, disabled Runtime). Individual modules that fail
// to compile or lack the required ABI are skipped with a warning — one bad
// plugin never blocks startup.
func Load(ctx context.Context, dir string, timeout time.Duration) (*Runtime, error) {
	if dir == "" {
		return &Runtime{}, nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		// Missing dir is non-fatal: plugins are an optional feature.
		logger.Get().Warn("plugins: directory unreadable — plugin stage disabled",
			"dir", dir, "error", err.Error())
		return &Runtime{}, nil
	}

	rt := wazero.NewRuntime(ctx)
	wasi_snapshot_preview1.MustInstantiate(ctx, rt)

	r := &Runtime{rt: rt, timeout: timeout}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".wasm" {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files) // deterministic load order

	for _, name := range files {
		path := filepath.Join(dir, name)
		wasm, err := os.ReadFile(path)
		if err != nil {
			logger.Get().Warn("plugins: read failed — skipped", "plugin", name, "error", err.Error())
			continue
		}
		compiled, err := rt.CompileModule(ctx, wasm)
		if err != nil {
			logger.Get().Warn("plugins: compile failed — skipped", "plugin", name, "error", err.Error())
			continue
		}
		p := &plugin{name: name, compiled: compiled}
		// Validate the ABI by instantiating once up front.
		if inst, err := r.newInstance(ctx, p); err != nil {
			logger.Get().Warn("plugins: ABI check failed — skipped", "plugin", name, "error", err.Error())
			continue
		} else {
			p.pool.Put(inst)
		}
		r.plugins = append(r.plugins, p)
		logger.Get().Info("plugins: loaded", "plugin", name)
	}
	return r, nil
}

func (r *Runtime) newInstance(ctx context.Context, p *plugin) (*instance, error) {
	// WithName("") allows multiple anonymous instances of the same module.
	mod, err := r.rt.InstantiateModule(ctx, p.compiled,
		wazero.NewModuleConfig().WithName("").WithStartFunctions("_initialize", "_start"))
	if err != nil {
		return nil, err
	}
	bufPtrFn := mod.ExportedFunction("buffer_ptr")
	bufCapFn := mod.ExportedFunction("buffer_cap")
	scanFn := mod.ExportedFunction("scan")
	if bufPtrFn == nil || bufCapFn == nil || scanFn == nil {
		mod.Close(ctx)
		return nil, fmt.Errorf("missing required exports (buffer_ptr/buffer_cap/scan)")
	}
	pr, err := bufPtrFn.Call(ctx)
	if err != nil {
		mod.Close(ctx)
		return nil, err
	}
	cr, err := bufCapFn.Call(ctx)
	if err != nil {
		mod.Close(ctx)
		return nil, err
	}
	return &instance{
		mod:    mod,
		bufPtr: uint32(pr[0]),
		bufCap: uint32(cr[0]),
		scan:   scanFn,
	}, nil
}

// Scan runs every loaded plugin against prompt and returns each verdict. It is
// fail-open: a plugin that errors or times out is skipped (logged), never
// blocking traffic on its own malfunction. Safe for concurrent use.
func (r *Runtime) Scan(ctx context.Context, prompt string) []Verdict {
	if !r.Enabled() {
		return nil
	}
	out := make([]Verdict, 0, len(r.plugins))
	for _, p := range r.plugins {
		v, ok := r.scanOne(ctx, p, prompt)
		if ok {
			out = append(out, v)
		}
	}
	return out
}

func (r *Runtime) scanOne(ctx context.Context, p *plugin, prompt string) (Verdict, bool) {
	cctx := ctx
	if r.timeout > 0 {
		var cancel context.CancelFunc
		cctx, cancel = context.WithTimeout(ctx, r.timeout)
		defer cancel()
	}

	inst, _ := p.pool.Get().(*instance)
	if inst == nil {
		var err error
		inst, err = r.newInstance(cctx, p)
		if err != nil {
			logger.Get().Warn("plugins: instantiate failed — skipped", "plugin", p.name, "error", err.Error())
			return Verdict{}, false
		}
	}
	defer p.pool.Put(inst)

	inst.scanMu.Lock()
	defer inst.scanMu.Unlock()

	data := []byte(prompt)
	if uint32(len(data)) > inst.bufCap {
		data = data[:inst.bufCap] // truncate to the plugin's buffer
	}
	if !inst.mod.Memory().Write(inst.bufPtr, data) {
		return Verdict{}, false
	}
	res, err := inst.scan.Call(cctx, uint64(len(data)))
	if err != nil || len(res) == 0 {
		logger.Get().Warn("plugins: scan failed — skipped", "plugin", p.name, "error", fmt.Sprint(err))
		return Verdict{}, false
	}
	outLen := uint32(res[0])
	raw, ok := inst.mod.Memory().Read(inst.bufPtr, outLen)
	if !ok {
		return Verdict{}, false
	}
	var v Verdict
	if err := json.Unmarshal(raw, &v); err != nil {
		logger.Get().Warn("plugins: bad verdict json — skipped", "plugin", p.name, "error", err.Error())
		return Verdict{}, false
	}
	v.Plugin = p.name
	return v, true
}

// Close releases all module resources.
func (r *Runtime) Close(ctx context.Context) {
	if r == nil || r.rt == nil {
		return
	}
	r.rt.Close(ctx) //nolint:errcheck
}
