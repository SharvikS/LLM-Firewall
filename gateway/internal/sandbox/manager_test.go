package sandbox

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestManagerExecuteRecordsASRDecision(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v2/asr/execute" {
			t.Fatalf("unexpected ASR path: %s", r.URL.Path)
		}
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode ASR request: %v", err)
		}
		args, ok := req["tool_arguments"].(map[string]any)
		if !ok || args["command"] != "echo ok" {
			t.Fatalf("missing command in ASR request: %#v", req)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"allowed": true,
			"risk_scores": {"overall_risk": 1.2},
			"sandbox_output": "ok\n",
			"sandbox_backend": "docker-hardened",
			"human_approval_required": false,
			"reason": "Executed inside sandbox."
		}`))
	}))
	defer srv.Close()

	mgr := NewManager(srv.URL, time.Second)
	initial, err := mgr.Execute(t.Context(), ExecuteRequest{
		AgentID:  "agent-1",
		ToolName: "run_bash",
		Command:  "echo ok",
	}, nil)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if initial.Status != "running" {
		t.Fatalf("initial status = %q, want running", initial.Status)
	}

	done := waitForExecution(t, mgr, initial.ID)
	if done.Status != "allowed" {
		t.Fatalf("status = %q, want allowed", done.Status)
	}
	if done.Backend != "docker-hardened" {
		t.Fatalf("backend = %q, want docker-hardened", done.Backend)
	}
	if done.RiskScores["overall_risk"] != 1.2 {
		t.Fatalf("risk score = %v, want 1.2", done.RiskScores["overall_risk"])
	}
	if done.Output != "ok\n" {
		t.Fatalf("output = %q, want ok newline", done.Output)
	}
}

func TestManagerUnconfiguredCompletesWithError(t *testing.T) {
	mgr := NewManager("", time.Second)
	initial, err := mgr.Execute(t.Context(), ExecuteRequest{ToolName: "run_bash", Command: "echo ok"}, nil)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	done := waitForExecution(t, mgr, initial.ID)
	if done.Status != "error" {
		t.Fatalf("status = %q, want error", done.Status)
	}
	if done.Error != "ASR_URL is not configured" {
		t.Fatalf("error = %q, want ASR_URL not configured", done.Error)
	}
}

func waitForExecution(t *testing.T, mgr *Manager, id string) Execution {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		for _, exec := range mgr.List() {
			if exec.ID == id && exec.Status != "running" {
				return exec
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("execution %s did not complete", id)
	return Execution{}
}
