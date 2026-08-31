# Known Limitation: One Upstream Provider Per Gateway Process

## Summary

TITAN's reverse proxy is provider-transparent — it forwards OpenAI, Anthropic
(`/v1/messages`), and Google Gemini (`generateContent`) requests as-is, with
provider-correct auth injected per request (`gateway/internal/provider/provider.go`).
This makes it possible, in principle, to front any of these dialects with no
schema translation.

In practice, **a single running gateway process can have only one active
upstream provider/URL/key at a time**, and every request is routed there
regardless of which tenant or API key made it. A per-tenant settings-override
mechanism exists and is *read* on the request path, but it is not honored by
the code that actually decides where the request goes. This means, for
example, a Claude Code client and an OpenAI Codex client cannot both be
pointed at the same TITAN instance and get correctly routed to Anthropic and
OpenAI respectively — whichever upstream is configured globally wins for
every request.

This is not a concurrency limitation — concurrent requests to the same
upstream are already safe (see below). It is a routing-scope limitation: the
dimension the router keys on is "the process," not "the tenant" or "the API
key."

## Evidence

**1. `UpstreamProvider`/`UpstreamURL`/`UpstreamAPIKey` are scalar fields on one
`Settings` struct — no tenant or key dimension:**

```go
// gateway/internal/settings/settings.go:43-45
UpstreamProvider string `json:"upstream_provider"`
UpstreamURL      string `json:"upstream_url"`
UpstreamAPIKey   string `json:"upstream_api_key"`
```

**2. The `Manager` holds exactly one global snapshot, plus a map of sparse
per-tenant *patches* over it:**

```go
// gateway/internal/settings/settings.go:109-115
type Manager struct {
	st       store
	mu       sync.RWMutex
	current  Settings                   // global base
	tenants  map[string]json.RawMessage // tenantID → sparse override patch
	applyFns []ApplyFunc
}
```

`GetForTenant` (settings.go:285-308) will mechanically merge a tenant's patch
over `current`, including `upstream_provider` if a caller ever `PATCH`es it in
— the JSON merge does not distinguish that field from any other.

**3. The actual routing decision — scheme, host, path, and auth header on the
outbound request — is made in the `httputil.ReverseProxy` `Director`, and it
reads only the *global* snapshot, never the tenant-scoped one:**

```go
// gateway/internal/proxy/proxy.go:180-200
rp.Director = func(req *http.Request) {
	...
	up := defaultTarget
	key := cfg.APIKey
	prov := provider.FromHost(cfg.TargetURL)
	if p.settings != nil {
		s := p.settings.Get()               // ← global, not GetForTenant
		prov = provider.Parse(s.UpstreamProvider)
		if s.UpstreamURL != "" {
			if u, err := url.Parse(s.UpstreamURL); err == nil && u.Host != "" {
				up = u
				key = s.UpstreamAPIKey
			}
		}
	}
	req.URL.Scheme = up.Scheme
	req.URL.Host = up.Host
	...
	provider.ApplyAuth(req, prov, key)
```

**4. `ServeHTTP` *does* call `GetForTenant`, but only to compute `prov` for
audit/model-extraction bookkeeping — the comment says so explicitly, and the
resulting value is never passed to the `Director`:**

```go
// gateway/internal/proxy/proxy.go:384-392
// Effective settings for this tenant: the global document with any per-tenant
// override applied. Read once per request so a mid-request settings change
// can't produce inconsistent decisions.
set := p.settings.GetForTenant(tenantID.String())

// Active upstream provider (OpenAI/Anthropic/Google) — drives provider-aware
// model extraction and token estimation so audit and TPM accounting are
// correct regardless of which cloud LLM the firewall is fronting.
prov := provider.Parse(set.UpstreamProvider)
```

**5. Every actual forward call goes through `p.rp`, the `ReverseProxy` built
with the tenant-blind `Director` above** (proxy.go:683, 693, 699, 745 —
`p.rp.ServeHTTP(...)`). There is no second, tenant-aware `ReverseProxy`.

Net effect: a per-tenant `upstream_provider` override, if set via
`UpdateForTenant`, silently affects only audit/TPM bookkeeping for that
tenant while every request — from every tenant — still physically goes to
whatever `Settings.Get().UpstreamURL` names.

## Why this matters for IDE/CLI integrations

TITAN can genuinely front any single one of OpenAI Codex, Claude Code, or
Gemini-based tools today with a plain `base_url` swap and no code changes,
because the wire dialect is passed through untouched (see evidence above).
But those three tools speak three different dialects, and one TITAN process
can only be configured for one dialect at a time. Running all three through
one TITAN instance with full inspection therefore requires either:

- three separate TITAN deployments (different ports), one per provider
  dialect, or
- extending the router to key off something already resolved before routing
  — the authenticated API key.

## Proposed direction (not implemented here)

TITAN already has a per-API-key override mechanism for exactly this kind of
per-client policy: `APISandbox` (`gateway/internal/store/api_keys.go:36-45`),
which already carries `AllowedModels`, `AllowedPaths`, etc. and is resolved
per request from the authenticated key before the `Director` runs. Adding
`UpstreamProvider` / `UpstreamURL` / an upstream credential reference to
`APISandbox`, and having the `Director` read them from the request's already-
resolved `APIKey`/`AuthContext` (falling back to the global `Settings` when a
key has no override), would let one gateway process route a Codex key to
OpenAI, a Claude Code key to Anthropic, and a Gemini key to Google
concurrently — with no change to how concurrency itself is handled, since
`GetForTenant`/API-key lookups are already `sync.RWMutex`-protected,
per-request, allocation-free reads that Go's per-connection goroutine model
already parallelizes safely.
