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

func globalPermit() store.Policy {
	return globalPolicy("allow-all", "ALLOW", "*", "")
}

var anyTenant = uuid.MustParse("00000000-0000-0000-0000-000000000001")

// ── Engine.Evaluate ──────────────────────────────────────────────────────────

func TestEvaluate_DENYWinsOverALLOW(t *testing.T) {
	// Both a DENY and an ALLOW match → Cedar forbid wins over permit.
	e := newTestEngine([]store.Policy{
		globalPermit(),
		globalPolicy("block-high-risk", "DENY", "InvokeLLM", "risk_score > 70"),
	})
	ctx := map[string]interface{}{"risk_score": 90.0}
	allowed, reason := e.Evaluate(context.Background(), anyTenant, "InvokeLLM", "openai", ctx)
	if allowed {
		t.Errorf("expected DENY, got ALLOW (reason: %s)", reason)
	}
}

func TestEvaluate_PermitAllowsLowRisk(t *testing.T) {
	// DENY condition not met, PERMIT fires → ALLOW.
	e := newTestEngine([]store.Policy{
		globalPermit(),
		globalPolicy("block-high-risk", "DENY", "InvokeLLM", "risk_score > 70"),
	})
	ctx := map[string]interface{}{"risk_score": 10.0}
	allowed, _ := e.Evaluate(context.Background(), anyTenant, "InvokeLLM", "openai", ctx)
	if !allowed {
		t.Error("expected ALLOW for low risk score with permit policy, got DENY")
	}
}

func TestEvaluate_DefaultDenyWithNoPolicies(t *testing.T) {
	// Cedar default: no permit → deny (Zero-Trust posture).
	e := newTestEngine(nil)
	allowed, _ := e.Evaluate(context.Background(), anyTenant, "InvokeLLM", "openai",
		map[string]interface{}{"risk_score": 0.0})
	if allowed {
		t.Error("expected default DENY with no policies (Zero-Trust: no permit = deny)")
	}
}

func TestEvaluate_DisabledPolicyIgnored(t *testing.T) {
	// Disabled DENY must not block; active PERMIT should allow.
	deny := globalPolicy("block-all", "DENY", "*", "")
	deny.Enabled = false
	e := newTestEngine([]store.Policy{deny, globalPermit()})
	allowed, _ := e.Evaluate(context.Background(), anyTenant, "InvokeLLM", "openai",
		map[string]interface{}{"risk_score": 0.0})
	if !allowed {
		t.Error("disabled DENY policy must not block")
	}
}

func TestEvaluate_MissingModelKeyDoesNotFireGPT4Policy(t *testing.T) {
	// Regression: GPT-4 DENY must not block a request that has no "model" key
	// in context (e.g. a llama request arriving after the ML analyzer failed open).
	e := newTestEngine([]store.Policy{
		globalPermit(),
		globalPolicy("gpt4-admin-only", "DENY", "InvokeLLM", `model == "gpt-4o"`),
	})
	ctx := map[string]interface{}{"risk_score": 0.0, "region": "US"}
	allowed, reason := e.Evaluate(context.Background(), anyTenant, "InvokeLLM", "openai", ctx)
	if !allowed {
		t.Errorf("llama request blocked by GPT-4 policy — regression: %s", reason)
	}
}

func TestEvaluate_TenantScopedPolicyIgnoredForOtherTenant(t *testing.T) {
	// A DENY scoped to otherTenant must not affect anyTenant; the global PERMIT
	// should win for anyTenant.
	otherTenant := uuid.New()
	deny := globalPolicy("block-other", "DENY", "*", "")
	deny.TenantID = &otherTenant
	e := newTestEngine([]store.Policy{deny, globalPermit()})
	allowed, _ := e.Evaluate(context.Background(), anyTenant, "InvokeLLM", "openai",
		map[string]interface{}{"risk_score": 0.0})
	if !allowed {
		t.Error("policy scoped to a different tenant should not apply")
	}
}
