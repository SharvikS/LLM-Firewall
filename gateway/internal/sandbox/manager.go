package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const maxExecutions = 200

type ExecuteRequest struct {
	AgentID    string         `json:"agent_id"`
	ToolName   string         `json:"tool_name"`
	Command    string         `json:"command,omitempty"`
	Arguments  map[string]any `json:"arguments,omitempty"`
	TimeoutSec int            `json:"timeout_sec,omitempty"`
}

type Execution struct {
	ID                    string             `json:"id"`
	AgentID               string             `json:"agent_id"`
	ToolName              string             `json:"tool_name"`
	Command               string             `json:"command,omitempty"`
	Status                string             `json:"status"`
	Backend               string             `json:"backend,omitempty"`
	Allowed               bool               `json:"allowed"`
	HumanApprovalRequired bool               `json:"human_approval_required"`
	RiskScores            map[string]float64 `json:"risk_scores,omitempty"`
	Output                string             `json:"output,omitempty"`
	Reason                string             `json:"reason,omitempty"`
	Error                 string             `json:"error,omitempty"`
	StartedAt             time.Time          `json:"started_at"`
	CompletedAt           *time.Time         `json:"completed_at,omitempty"`
	ElapsedMs             int64              `json:"elapsed_ms"`
}

type CompletionFunc func(Execution)

type Manager struct {
	asrURL        string
	timeout       time.Duration
	client        *http.Client
	mu            sync.Mutex
	executions    map[string]*Execution
	order         []string
	cancellations map[string]context.CancelFunc
}

func NewManager(asrURL string, timeout time.Duration) *Manager {
	asrURL = strings.TrimRight(strings.TrimSpace(asrURL), "/")
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &Manager{
		asrURL:        asrURL,
		timeout:       timeout,
		client:        &http.Client{},
		executions:    make(map[string]*Execution),
		cancellations: make(map[string]context.CancelFunc),
	}
}

func (m *Manager) Configured() bool {
	return m != nil && m.asrURL != ""
}

func (m *Manager) List() []Execution {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Execution, 0, len(m.executions))
	for _, id := range m.order {
		if e := m.executions[id]; e != nil {
			out = append(out, *e)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].StartedAt.After(out[j].StartedAt)
	})
	return out
}

func (m *Manager) Execute(parent context.Context, req ExecuteRequest, onComplete CompletionFunc) (Execution, error) {
	if m == nil {
		return Execution{}, errors.New("sandbox manager unavailable")
	}
	req.AgentID = strings.TrimSpace(req.AgentID)
	req.ToolName = strings.TrimSpace(req.ToolName)
	req.Command = strings.TrimSpace(req.Command)
	if req.AgentID == "" {
		req.AgentID = "dashboard"
	}
	if req.ToolName == "" {
		return Execution{}, errors.New("tool_name is required")
	}
	id := uuid.NewString()
	exec := &Execution{
		ID:        id,
		AgentID:   req.AgentID,
		ToolName:  req.ToolName,
		Command:   req.Command,
		Status:    "running",
		StartedAt: time.Now().UTC(),
	}
	ctx, cancel := context.WithCancel(context.Background())

	m.mu.Lock()
	m.executions[id] = exec
	m.order = append([]string{id}, m.order...)
	if len(m.order) > maxExecutions {
		drop := m.order[maxExecutions:]
		m.order = m.order[:maxExecutions]
		for _, old := range drop {
			delete(m.executions, old)
			delete(m.cancellations, old)
		}
	}
	m.cancellations[id] = cancel
	m.mu.Unlock()

	go m.run(ctx, id, req, onComplete)
	_ = parent
	return *exec, nil
}

func (m *Manager) Cancel(id string) (Execution, bool) {
	if m == nil {
		return Execution{}, false
	}
	m.mu.Lock()
	cancel := m.cancellations[id]
	exec := m.executions[id]
	m.mu.Unlock()
	if cancel == nil || exec == nil {
		if exec != nil {
			return *exec, true
		}
		return Execution{}, false
	}
	cancel()
	return *exec, true
}

func (m *Manager) run(ctx context.Context, id string, req ExecuteRequest, onComplete CompletionFunc) {
	start := time.Now()
	result := m.callASR(ctx, req)
	now := time.Now().UTC()
	result.ID = id
	result.AgentID = req.AgentID
	result.ToolName = req.ToolName
	result.Command = req.Command
	result.StartedAt = m.startedAt(id)
	result.CompletedAt = &now
	result.ElapsedMs = time.Since(start).Milliseconds()

	m.mu.Lock()
	if exec := m.executions[id]; exec != nil {
		*exec = result
	}
	delete(m.cancellations, id)
	m.mu.Unlock()

	if onComplete != nil {
		onComplete(result)
	}
}

func (m *Manager) startedAt(id string) time.Time {
	m.mu.Lock()
	defer m.mu.Unlock()
	if exec := m.executions[id]; exec != nil {
		return exec.StartedAt
	}
	return time.Now().UTC()
}

func (m *Manager) callASR(ctx context.Context, req ExecuteRequest) Execution {
	if !m.Configured() {
		return Execution{
			Status:  "error",
			Allowed: false,
			Error:   "ASR_URL is not configured",
			Reason:  "Set ASR_URL to the Agent Security Runtime base URL to enable sandbox execution.",
		}
	}
	timeout := m.timeout
	if req.TimeoutSec > 0 {
		timeout = time.Duration(req.TimeoutSec) * time.Second
	}
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	args := map[string]any{}
	for k, v := range req.Arguments {
		args[k] = v
	}
	if req.Command != "" {
		args["command"] = req.Command
	}
	body := map[string]any{
		"agent_id":       req.AgentID,
		"tool_name":      req.ToolName,
		"tool_arguments": args,
		"agent_context": map[string]any{
			"execution_loop_count":   0,
			"previous_tool_failures": 0,
		},
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return Execution{Status: "error", Error: err.Error(), Reason: "could not encode ASR request"}
	}

	httpReq, err := http.NewRequestWithContext(callCtx, http.MethodPost, m.asrURL+"/api/v2/asr/execute", bytes.NewReader(raw))
	if err != nil {
		return Execution{Status: "error", Error: err.Error(), Reason: "invalid ASR URL"}
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := m.client.Do(httpReq)
	if err != nil {
		status := "error"
		reason := "ASR request failed"
		if errors.Is(callCtx.Err(), context.Canceled) {
			status = "cancelled"
			reason = "Execution cancelled by operator."
		} else if errors.Is(callCtx.Err(), context.DeadlineExceeded) {
			reason = fmt.Sprintf("ASR request exceeded %s timeout.", timeout)
		}
		return Execution{Status: status, Error: err.Error(), Reason: reason}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Execution{
			Status: "error",
			Error:  fmt.Sprintf("ASR returned HTTP %d", resp.StatusCode),
			Reason: "ASR rejected the execution request.",
		}
	}

	var out struct {
		Allowed               bool               `json:"allowed"`
		RiskScores            map[string]float64 `json:"risk_scores"`
		SandboxOutput         string             `json:"sandbox_output"`
		SandboxBackend        string             `json:"sandbox_backend"`
		HumanApprovalRequired bool               `json:"human_approval_required"`
		Reason                string             `json:"reason"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return Execution{Status: "error", Error: err.Error(), Reason: "could not decode ASR response"}
	}

	status := "allowed"
	if out.HumanApprovalRequired {
		status = "approval_required"
	} else if !out.Allowed {
		status = "blocked"
	}
	return Execution{
		Status:                status,
		Backend:               firstNonEmpty(out.SandboxBackend, inferBackend(out.SandboxOutput, out.Reason)),
		Allowed:               out.Allowed,
		HumanApprovalRequired: out.HumanApprovalRequired,
		RiskScores:            out.RiskScores,
		Output:                out.SandboxOutput,
		Reason:                out.Reason,
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func inferBackend(output, reason string) string {
	s := strings.ToLower(output + " " + reason)
	switch {
	case strings.Contains(s, "firecracker"):
		return "firecracker-microvm"
	case strings.Contains(s, "docker"):
		return "docker-hardened"
	case strings.Contains(s, "simulated"):
		return "simulated"
	default:
		return ""
	}
}
