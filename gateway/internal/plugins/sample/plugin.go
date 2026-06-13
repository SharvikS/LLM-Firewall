//go:build ignore

// Sample TITAN detection plugin, compiled to WebAssembly.
//
// Build (produces a reactor module whose exports persist after init):
//
//	GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared \
//	    -o ../../../plugins/confidential_terms.wasm plugin.go
//
// or just run ./build.sh in this directory.
//
// This rule blocks prompts that mention internal project codenames — the kind
// of organization-specific policy that does not belong in the core engine.
// Replace the term list (or the whole logic) to ship your own rule; the host
// only relies on the buffer_ptr / buffer_cap / scan ABI below.
package main

import "unsafe"

// Shared scratch buffer: the host writes the prompt here, scan() writes its
// JSON verdict back here. A package-level array has a stable address in the
// wasm linear memory, so no allocator is needed.
var buffer [16384]byte

//go:wasmexport buffer_ptr
func bufferPtr() int32 { return int32(uintptr(unsafe.Pointer(&buffer[0]))) }

//go:wasmexport buffer_cap
func bufferCap() int32 { return int32(len(buffer)) }

// blockedTerms are case-insensitive substrings that trigger a block.
var blockedTerms = []string{
	"project zeus",
	"launchcode",
	"helios initiative",
	"codename raven",
}

//go:wasmexport scan
func scan(inLen int32) int32 {
	prompt := string(buffer[:inLen])
	for _, term := range blockedTerms {
		if containsFold(prompt, term) {
			return write(`{"block":true,"score":90,"reason":"custom rule: confidential project codename mentioned"}`)
		}
	}
	return write(`{"block":false,"score":0,"reason":""}`)
}

func write(s string) int32 {
	copy(buffer[:], s)
	return int32(len(s))
}

func containsFold(s, sub string) bool {
	if len(sub) == 0 {
		return true
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		if eqFold(s[i:i+len(sub)], sub) {
			return true
		}
	}
	return false
}

func eqFold(a, b string) bool {
	for i := 0; i < len(a); i++ {
		ca, cb := lower(a[i]), lower(b[i])
		if ca != cb {
			return false
		}
	}
	return true
}

func lower(c byte) byte {
	if 'A' <= c && c <= 'Z' {
		return c + 32
	}
	return c
}

func main() {}
