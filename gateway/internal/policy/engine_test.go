package policy

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

// newTestEngine builds an Engine with pre-loaded policies and NO background
// refresh goroutine (a nil store would panic on every tick).
func newTestEngine(policies []store.Policy) *Engine {
	return &Engine{
		cache:   policies,
		refresh: 30 * time.Second,
		// st deliberately nil — Evaluate only reads e.cache under RLock.
	}
}

// policy helpers
func globalPolicy(name, effect, action, condition string) store.Policy {
	return store.Policy{
		ID:        uuid.New(),
		TenantID:  nil, // global
		Name:      name,
		Effect:    effect,
		Action:    action,
		Condition: condition,
		Enabled:   true,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
}

var anyTenant = uuid.MustParse("00000000-0000-0000-0000-000000000001")

// ── evaluateCondition ────────────────────────────────────────────────────────

func TestEvaluateCondition(t *testing.T) {
	tests := []struct {
		name      string
		condition string
		ctx       map[string]interface{}
		want      bool
	}{
		// Bug regression: missing context key must return false, not true.
		// The old default of `return true` caused GPT-4 DENY to fire on llama requests.
		{
			name:      "model_key_absent_returns_false",
			condition: `model == "gpt-4o"`,
			ctx:       map[string]interface{}{"risk_score": 5.0}, // no "model" key
			want:      false,
		},
		{
			name:      "model_matches",
			condition: `model == "gpt-4o"`,
			ctx:       map[string]interface{}{"model": "gpt-4o"},
			want:      true,
		},
		{
			name:      "model_mismatch",
			condition: `model == "gpt-4o"`,
			ctx:       map[string]interface{}{"model": "llama-3.1-8b-instant"},
			want:      false,
		},
		{
			name:      "risk_score_above_threshold",
			condition: "risk_score > 70",
			ctx:       map[string]interface{}{"risk_score": 85.0},
			want:      true,
		},
		{
			name:      "risk_score_below_threshold",
			condition: "risk_score > 70",
			ctx:       map[string]interface{}{"risk_score": 10.0},
			want:      false,
		},
		{
			name:      "risk_score_key_absent_returns_false",
			condition: "risk_score > 70",
			ctx:       map[string]interface{}{"region": "US"},
			want:      false,
		},
		{
			name:      "region_matches",
			condition: `region == "EU"`,
			ctx:       map[string]interface{}{"region": "EU"},
			want:      true,
		},
		{
			name:      "region_mismatch",
			condition: `region == "EU"`,
			ctx:       map[string]interface{}{"region": "US"},
			want:      false,
		},
		{
			name:      "empty_condition_always_true",
			condition: "",
			ctx:       map[string]interface{}{},
			want:      true,
		},
		{
			name:      "unknown_condition_returns_false",
			condition: "some_future_field == 42",
			ctx:       map[string]interface{}{"some_future_field": 42},
			want:      false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := evaluateCondition(tc.condition, tc.ctx)
			if got != tc.want {
				t.Errorf("evaluateCondition(%q, %v) = %v; want %v",
					tc.condition, tc.ctx, got, tc.want)
			}
		})
	}
}

// ── Engine.Evaluate ──────────────────────────────────────────────────────────

func TestEvaluate_DENYWinsOverALLOW(t *testing.T) {
	// A DENY and an ALLOW both match → DENY must win.
	e := newTestEngine([]store.Policy{
		globalPolicy("allow-all", "ALLOW", "*", ""),
		globalPolicy("block-high-risk", "DENY", "InvokeLLM", "risk_score > 70"),
	})
	ctx := map[string]interface{}{"risk_score": 90.0}
	allowed, reason := e.Evaluate(context.Background(), anyTenant, "InvokeLLM", "openai", ctx)
	if allowed {
		t.Errorf("expected DENY, got ALLOW (reason: %s)", reason)
	}
}

func TestEvaluate_AllowWhenNoDENY(t *testing.T) {
	e := newTestEngine([]store.Policy{
		globalPolicy("block-high-risk", "DENY", "InvokeLLM", "risk_score > 70"),
	})
	ctx := map[string]interface{}{"risk_score": 10.0} // below threshold
	allowed, _ := e.Evaluate(context.Background(), anyTenant, "InvokeLLM", "openai", ctx)
	if !allowed {
		t.Error("expected ALLOW for low risk score, got DENY")
	}
}

func TestEvaluate_DefaultAllowWithNoPolicies(t *testing.T) {
	e := newTestEngine(nil)
	allowed, _ := e.Evaluate(context.Background(), anyTenant, "InvokeLLM", "openai",
		map[string]interface{}{"risk_score": 0.0})
	if !allowed {
		t.Error("no policies should default to ALLOW")
	}
}

func TestEvaluate_DisabledPolicyIgnored(t *testing.T) {
	p := globalPolicy("block-all", "DENY", "*", "")
	p.Enabled = false
	e := newTestEngine([]store.Policy{p})
	allowed, _ := e.Evaluate(context.Background(), anyTenant, "InvokeLLM", "openai",
		map[string]interface{}{"risk_score": 0.0})
	if !allowed {
		t.Error("disabled DENY policy must not block")
	}
}

func TestEvaluate_MissingModelKeyDoesNotFireGPT4Policy(t *testing.T) {
	// Regression: the GPT-4 Admin Only policy used to block llama requests
	// because evaluateCondition defaulted to true when "model" was absent.
	e := newTestEngine([]store.Policy{
		globalPolicy("gpt4-admin-only", "DENY", "InvokeLLM", `model == "gpt-4o"`),
	})
	// Context has no "model" key — as happens with fail-open ML engine.
	ctx := map[string]interface{}{"risk_score": 0.0, "region": "US"}
	allowed, reason := e.Evaluate(context.Background(), anyTenant, "InvokeLLM", "openai", ctx)
	if !allowed {
		t.Errorf("llama request blocked by GPT-4 policy — regression: %s", reason)
	}
}

func TestEvaluate_TenantScopedPolicyIgnoredForOtherTenant(t *testing.T) {
	otherTenant := uuid.New()
	p := globalPolicy("block-other", "DENY", "*", "")
	p.TenantID = &otherTenant
	e := newTestEngine([]store.Policy{p})

	// anyTenant should NOT be affected by a policy scoped to otherTenant.
	allowed, _ := e.Evaluate(context.Background(), anyTenant, "InvokeLLM", "openai",
		map[string]interface{}{"risk_score": 0.0})
	if !allowed {
		t.Error("policy scoped to a different tenant should not apply")
	}
}
