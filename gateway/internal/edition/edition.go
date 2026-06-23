// Package edition is the single source of truth for which TITAN edition is
// running and which commercial features are entitled.
//
// TITAN ships open-core: the MIT core (this repository) is fully functional on
// its own, while a set of org-scale features — usage metering/quotas, real-time
// SOC alerting, WASM custom-rule plugins, OIDC SSO, compliance/audit export, and
// hallucination/groundedness scoring — are commercially licensed (see
// EDITIONS.md and LICENSE-ENTERPRISE.md).
//
// Two layers of enforcement keep that line honest:
//
//  1. Build tag — the commercial *logic* only compiles under `-tags enterprise`
//     (see BuiltEnterprise). A default `go build` produces a binary that does
//     not contain it at all; the community stubs are no-ops.
//  2. Runtime gate — even an enterprise build only activates a feature when a
//     valid edition + license key is configured (see Resolve).
//
// Has() therefore returns true only when BOTH the binary was built with the
// enterprise tag AND a license was supplied at runtime — so neither layer alone
// can switch a paid feature on.
package edition

import "strings"

// Edition is the active product tier.
type Edition string

const (
	Community  Edition = "community"
	Enterprise Edition = "enterprise"
)

// Feature is a commercially-gated capability.
type Feature string

const (
	Billing      Feature = "billing"      // per-tenant usage metering + plan quotas
	Alerts       Feature = "alerts"       // real-time SOC alerting webhooks
	Plugins      Feature = "plugins"      // WASM custom-rule detector stage
	SSO          Feature = "sso"          // OIDC single sign-on
	Compliance   Feature = "compliance"   // compliance / audit export
	Groundedness Feature = "groundedness" // hallucination / groundedness scoring
)

// allFeatures is the canonical list surfaced to the dashboard.
var allFeatures = []Feature{Billing, Alerts, Plugins, SSO, Compliance, Groundedness}

// current is resolved once at startup by Resolve and read everywhere via Has.
var current = Community

// Resolve sets the active edition from the operator-supplied edition string and
// license key. Enterprise is granted only when the binary was built with the
// enterprise tag (BuiltEnterprise), the edition is "enterprise", and a non-empty
// license key is present. Anything else resolves to Community. Returns the
// resolved edition so the caller can log it.
func Resolve(ed, licenseKey string) Edition {
	if BuiltEnterprise &&
		strings.EqualFold(strings.TrimSpace(ed), string(Enterprise)) &&
		strings.TrimSpace(licenseKey) != "" {
		current = Enterprise
	} else {
		current = Community
	}
	return current
}

// Current returns the resolved edition.
func Current() Edition { return current }

// IsEnterprise reports whether the active edition is Enterprise.
func IsEnterprise() bool { return current == Enterprise }

// Has reports whether feature f is entitled under the active edition. Today all
// commercial features unlock together with the Enterprise edition; the per-
// Feature signature leaves room for finer-grained plans later without touching
// call sites.
func Has(f Feature) bool { return current == Enterprise }

// Entitled returns the list of features active under the current edition, for
// surfacing to the dashboard.
func Entitled() []Feature {
	if current != Enterprise {
		return []Feature{}
	}
	out := make([]Feature, len(allFeatures))
	copy(out, allFeatures)
	return out
}
