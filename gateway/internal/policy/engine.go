// Package policy evaluates ABAC rules using the AWS Cedar policy language SDK.
// Policies are stored in the database as structured fields; Cedar text is
// auto-generated at evaluation time (or loaded from the cedar_text column when
// pre-computed). The cache is refreshed every 30 seconds.
package policy

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	cedar "github.com/cedar-policy/cedar-go"
	"github.com/cedar-policy/cedar-go/types"
	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

// Engine evaluates Cedar ABAC policies against request context data.
// It caches the full policy set in memory and refreshes every 30 seconds.
type Engine struct {
	st      *store.Store
	mu      sync.RWMutex
	cache   []store.Policy
	refresh time.Duration
}

// NewEngine creates a policy engine, loads the initial policy set, and starts
// a background refresh goroutine.
func NewEngine(st *store.Store) *Engine {
	e := &Engine{st: st, refresh: 30 * time.Second}
	if err := e.reload(context.Background()); err != nil {
		logger.Get().Warn("policy: initial load failed — all requests will be DENIED until policies load",
			slog.String("error", err.Error()))
	}
	go e.refreshLoop()
	return e
}

// Evaluate checks Cedar policies for the given tenant/action/resource/context.
// Decision contract (preserved from the custom DSL evaluator):
//  1. DENY (forbid) rules win over ALLOW (permit).
//  2. No matching permit → DENY (default-deny; Zero-Trust posture).
//  3. Tenant scoping: only policies whose tenant matches OR global policies apply.
func (e *Engine) Evaluate(
	_ context.Context,
	tenantID uuid.UUID,
	action, resource string,
	reqCtx map[string]interface{},
) (bool, string) {
	e.mu.RLock()
	all := e.cache
	e.mu.RUnlock()

	log := logger.Get()

	// Scope: keep global (nil TenantID) + this tenant's policies only.
	scoped := make([]store.Policy, 0, len(all))
	for _, p := range all {
		if !p.Enabled {
			continue
		}
		if p.TenantID != nil && *p.TenantID != tenantID {
			continue
		}
		scoped = append(scoped, p)
	}

	if len(scoped) == 0 {
		log.Warn("policy DEFAULT DENY — no policies in scope",
			slog.String("tenant", tenantID.String()),
			slog.String("action", action),
		)
		return false, "Default deny: no policies in scope"
	}

	// Build a Cedar PolicySet from scoped policies.
	ps, err := buildPolicySet(scoped)
	if err != nil {
		log.Error("policy: Cedar compile error — denying (fail-closed)",
			slog.String("error", err.Error()),
			slog.String("tenant", tenantID.String()),
		)
		return false, "policy compile error: " + err.Error()
	}

	// Build Cedar Request.
	req := types.Request{
		Principal: types.NewEntityUID(types.EntityType("Tenant"), types.String(tenantID.String())),
		Action:    types.NewEntityUID(types.EntityType("Action"), types.String(action)),
		Resource:  types.NewEntityUID(types.EntityType("Resource"), types.String(resource)),
		Context:   buildContext(reqCtx),
	}

	decision, diag := ps.IsAuthorized(types.EntityMap{}, req)

	if decision == cedar.Allow {
		log.Info("policy ALLOW",
			slog.String("tenant", tenantID.String()),
			slog.String("action", action),
		)
		return true, "allowed"
	}

	// Collect policy names that fired a forbid.
	var reasons []string
	for _, r := range diag.Reasons {
		reasons = append(reasons, string(r.PolicyID))
	}
	if len(reasons) > 0 {
		msg := "Denied by policy: " + strings.Join(reasons, ", ")
		log.Warn("policy DENY", slog.String("tenant", tenantID.String()), slog.String("reason", msg))
		return false, msg
	}

	log.Warn("policy DEFAULT DENY — no matching permit",
		slog.String("tenant", tenantID.String()),
		slog.String("action", action),
	)
	return false, "Default deny: no matching allow policy"
}

// buildPolicySet compiles scoped policies into a Cedar PolicySet.
// Uses cedar_text from the DB when available; falls back to auto-generation.
func buildPolicySet(policies []store.Policy) (*cedar.PolicySet, error) {
	var buf strings.Builder
	for i, p := range policies {
		var text string
		if p.CedarText != nil && *p.CedarText != "" {
			text = *p.CedarText
		} else {
			text = toCedarText(p)
		}
		// Annotate with the policy DB ID so Diagnostic.Reasons maps back to names.
		fmt.Fprintf(&buf, "@id(%q)\n%s", p.ID.String(), text)
		if i < len(policies)-1 {
			buf.WriteString("\n\n")
		}
	}
	return cedar.NewPolicySetFromBytes("titan", []byte(buf.String()))
}

// toCedarText auto-generates a Cedar policy statement from structured fields.
//
// Mapping:
//
//	effect   ALLOW → permit, DENY → forbid
//	principal "*"  → unbounded principal clause
//	action   "*"  → unbounded action clause
//	condition     → when { <condition> } block
func toCedarText(p store.Policy) string {
	effect := "permit"
	if p.Effect == "DENY" {
		effect = "forbid"
	}

	principalClause := "principal"
	if p.Principal != "" && p.Principal != "*" {
		principalClause = fmt.Sprintf(`principal == Tenant::"%s"`, p.Principal)
	}

	actionClause := "action"
	if p.Action != "" && p.Action != "*" {
		actionClause = fmt.Sprintf(`action == Action::"%s"`, p.Action)
	}

	when := ""
	if translated := translateCondition(p.Condition); translated != "" {
		when = fmt.Sprintf("\nwhen {\n  %s\n}", translated)
	}

	return fmt.Sprintf("%s (\n  %s,\n  %s,\n  resource\n)%s;", effect, principalClause, actionClause, when)
}

// translateCondition converts the simple DSL condition into Cedar syntax.
// Supported: "risk_score > N", "region == \"X\"", "model == \"X\""
func translateCondition(cond string) string {
	cond = strings.TrimSpace(cond)
	if cond == "" {
		return ""
	}
	// risk_score > N  →  context.risk_score > N  (Long comparison)
	if strings.HasPrefix(cond, "risk_score >") {
		tail := strings.TrimSpace(strings.TrimPrefix(cond, "risk_score >"))
		var f float64
		if _, err := fmt.Sscanf(tail, "%f", &f); err == nil {
			return fmt.Sprintf("context.risk_score > %d", int64(f))
		}
	}
	// region == "X"  →  context.region == "X"
	if strings.HasPrefix(cond, "region ==") {
		tail := strings.TrimSpace(strings.TrimPrefix(cond, "region =="))
		return "context.region == " + tail
	}
	// model == "X"  →  context.model == "X"
	if strings.HasPrefix(cond, "model ==") {
		tail := strings.TrimSpace(strings.TrimPrefix(cond, "model =="))
		return "context.model == " + tail
	}
	return "" // unknown condition syntax → no when clause (safe: doesn't gate permit)
}

// buildContext converts the proxy request map into a Cedar Record.
// float64 values (risk_score) are truncated to Long; strings are Cedar String.
func buildContext(ctx map[string]interface{}) types.Record {
	m := types.RecordMap{}
	for k, v := range ctx {
		key := types.String(k)
		switch val := v.(type) {
		case float64:
			m[key] = types.Long(int64(val))
		case string:
			m[key] = types.String(val)
		case int64:
			m[key] = types.Long(val)
		case int:
			m[key] = types.Long(int64(val))
		case bool:
			m[key] = types.Boolean(val)
		}
	}
	return types.NewRecord(m)
}

func (e *Engine) reload(ctx context.Context) error {
	policies, err := e.st.ListPolicies(ctx, nil)
	if err != nil {
		return err
	}
	e.mu.Lock()
	e.cache = policies
	e.mu.Unlock()
	logger.Get().Info("policy: cache refreshed", slog.Int("count", len(policies)))
	return nil
}

func (e *Engine) refreshLoop() {
	t := time.NewTicker(e.refresh)
	defer t.Stop()
	for range t.C {
		if err := e.reload(context.Background()); err != nil {
			logger.Get().Warn("policy: refresh failed", slog.String("error", err.Error()))
		}
	}
}
