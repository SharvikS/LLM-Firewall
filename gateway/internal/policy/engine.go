// Package policy evaluates Cedar-style ABAC rules loaded from the database.
// Policies are cached in memory and refreshed every 30 seconds so the
// evaluation path never hits the DB.
package policy

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

// Engine evaluates ABAC policies against request context data.
// It replaces the old CedarEngine stub and is backed by the database.
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

// Evaluate checks the loaded policies for a match.
// Returns (allowed, reason).
// Decision logic:
//  1. DENY rules win over ALLOW rules (deny-biased).
//  2. A policy matches if principal/action/condition all match.
//  3. No matching ALLOW policy → DENY (default-deny; Zero-Trust posture).
func (e *Engine) Evaluate(
	_ context.Context,
	tenantID uuid.UUID,
	action, resource string,
	ctx map[string]interface{},
) (bool, string) {
	e.mu.RLock()
	policies := e.cache
	e.mu.RUnlock()

	log := logger.Get()
	var hasAllow bool
	for _, p := range policies {
		if !p.Enabled {
			continue
		}
		// Scope: global (TenantID==nil) or matches the request tenant
		if p.TenantID != nil && *p.TenantID != tenantID {
			continue
		}
		if !matchesField(p.Action, action) {
			continue
		}
		if !evaluateCondition(p.Condition, ctx) {
			continue
		}
		// DENY wins immediately; ALLOW is noted but deferred so a later DENY wins.
		if p.Effect == "DENY" {
			log.Warn("policy DENY",
				slog.String("policy", p.Name),
				slog.String("tenant", tenantID.String()),
			)
			return false, "Denied by policy: " + p.Name
		}
		if p.Effect == "ALLOW" {
			hasAllow = true
		}
	}

	if hasAllow {
		log.Info("policy ALLOW", slog.String("tenant", tenantID.String()))
		return true, "allowed"
	}

	log.Warn("policy DEFAULT DENY — no matching allow policy",
		slog.String("tenant", tenantID.String()),
		slog.String("action", action),
	)
	return false, "Default deny: no matching allow policy"
}

// matchesField returns true if pattern is "*" or equals value (case-insensitive prefix).
func matchesField(pattern, value string) bool {
	return pattern == "*" || strings.EqualFold(pattern, value)
}

// evaluateCondition parses and evaluates the simple condition DSL:
//   risk_score > N   (float comparison)
//   region == "X"    (string equality)
//   empty condition  → always true
func evaluateCondition(condition string, ctx map[string]interface{}) bool {
	if condition == "" {
		return true
	}
	// risk_score > N
	if strings.HasPrefix(condition, "risk_score >") {
		var threshold float64
		if _, err := parseFloat(condition, "risk_score >", &threshold); err == nil {
			if rs, ok := ctx["risk_score"].(float64); ok {
				return rs > threshold
			}
		}
	}
	// region == "X"
	if strings.HasPrefix(condition, "region ==") {
		target := strings.Trim(strings.TrimPrefix(condition, `region ==`), ` "`)
		if r, ok := ctx["region"].(string); ok {
			return strings.EqualFold(r, target)
		}
	}
	// model == "X"
	if strings.HasPrefix(condition, "model ==") {
		target := strings.Trim(strings.TrimPrefix(condition, `model ==`), ` "`)
		if m, ok := ctx["model"].(string); ok {
			return strings.EqualFold(m, target)
		}
		return false // model not in context → condition doesn't match
	}
	// Unknown condition → false (safe default: don't block on unrecognised syntax)
	return false
}

func parseFloat(s, prefix string, out *float64) (string, error) {
	tail := strings.TrimSpace(strings.TrimPrefix(s, prefix))
	_, err := fmt.Sscanf(tail, "%f", out)
	return tail, err
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
