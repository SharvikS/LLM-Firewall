# Per-API-Key Upstream Routing

## Summary

TITAN's reverse proxy is provider-transparent — it forwards OpenAI, Anthropic
(`/v1/messages`), and Google Gemini (`generateContent`) requests as-is, with
provider-correct auth injected per request (`gateway/internal/provider/provider.go`).
This makes it possible, in principle, to front any of these dialects with no
schema translation.

Until now, a single running gateway process could only have one active
upstream provider/URL/key at a time, applied to every request regardless of
which tenant or API key made it — see [Evidence](#evidence) below. A
tenant-level settings override existed and was read on the request path, but
was not honored by the code that actually decided where the request went.

This is fixed: **a firewall API key's sandbox can now pin it to its own
upstream provider, URL, and credential**, independent of the gateway-wide
default. One TITAN process can therefore front several provider dialects
concurrently — e.g. a key handed to an OpenAI-speaking client (Codex) routed
to OpenAI, and a key handed to an Anthropic-speaking client (Claude Code)
routed to Anthropic, at the same time, on the same port.

This was never a concurrency limitation — concurrent requests to the same
upstream were already safe. It was a routing-scope limitation: the dimension
the router keyed on was "the process," not "the caller."

## Evidence (the original limitation)

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

**3. Before this change, the actual routing decision — scheme, host, path,
and auth header on the outbound request — was made in the
`httputil.ReverseProxy` `Director`, and it read only the *global* snapshot,
never the tenant-scoped one:**

```go
// gateway/internal/proxy/proxy.go, before this change
rp.Director = func(req *http.Request) {
	...
	if p.settings != nil {
		s := p.settings.Get()               // ← global, not GetForTenant
		prov = provider.Parse(s.UpstreamProvider)
		...
	}
	req.URL.Scheme = up.Scheme
	req.URL.Host = up.Host
	...
	provider.ApplyAuth(req, prov, key)
```

**4. `ServeHTTP` *did* call `GetForTenant`, but only to compute `prov` for
audit/model-extraction bookkeeping — the comment said so explicitly, and the
resulting value was never passed to the `Director`:**

```go
// gateway/internal/proxy/proxy.go:384-392 (comment predates this change)
// Effective settings for this tenant: the global document with any per-tenant
// override applied. Read once per request so a mid-request settings change
// can't produce inconsistent decisions.
set := p.settings.GetForTenant(tenantID.String())

// Active upstream provider (OpenAI/Anthropic/Google) — drives provider-aware
// model extraction and token estimation so audit and TPM accounting are
// correct regardless of which cloud LLM the firewall is fronting.
prov := provider.Parse(set.UpstreamProvider)
```

**5. Every actual forward call went through `p.rp`, the `ReverseProxy` built
with the tenant-blind `Director` above** (proxy.go:683, 693, 699, 745 —
`p.rp.ServeHTTP(...)`). There was no second, tenant-aware `ReverseProxy`.

Net effect: a per-tenant `upstream_provider` override, if set via
`UpdateForTenant`, silently affected only audit/TPM bookkeeping for that
tenant while every request — from every tenant — still physically went to
whatever `Settings.Get().UpstreamURL` named.

## Why this mattered for IDE/CLI integrations

TITAN can front any single one of OpenAI Codex, Claude Code, or
Gemini-based tools with a plain `base_url` swap and no code changes, because
the wire dialect is passed through untouched. But those three tools speak
three different dialects, and one TITAN process could only be configured for
one dialect at a time. Running all three through one TITAN instance with full
inspection previously required separate TITAN deployments (different ports),
one per provider dialect.

## The fix

TITAN already has a per-API-key override mechanism for exactly this kind of
per-client policy: `APISandbox` (`gateway/internal/store/api_keys.go`), which
already carries `AllowedModels`, `AllowedPaths`, etc. and is resolved per
request from the authenticated key before the `Director` runs (via
`mw.GetAuthContext(req.Context()).Sandbox`).

`APISandbox` now also carries `UpstreamProvider`, `UpstreamURL`, and
`UpstreamAPIKey`. When a key's sandbox has `UpstreamURL` set, the `Director`
routes that key's requests there instead of the gateway-wide default —
resolved by the new, pure `applySandboxUpstream` function
(`gateway/internal/proxy/proxy.go`), which takes the already-computed
gateway-default `(url, key, provider)` and the request's sandbox, and returns
either the sandbox's override or the inputs unchanged:

```go
func applySandboxUpstream(up *url.URL, key string, prov provider.Type, sandbox store.APISandbox) (*url.URL, string, provider.Type)
```

Being pure and reading only its arguments, it needs no locking of its own —
correctness for concurrent requests carrying different keys' sandboxes falls
out of each request already having its own `*http.Request`/context, and of
`applySandboxUpstream` allocating nothing shared. `settings.Manager` reads
(`Get`/`GetForTenant`) were already `sync.RWMutex`-protected, per-request
copies, so no new concurrency primitive was needed.

No new admin API endpoint was needed either: `PUT /admin/v1/keys/{id}/sandbox`
already accepts a full `APISandbox` JSON body and persists it as-is (JSONB
column, no migration). `UpstreamAPIKey` is redacted in both
`GET /admin/v1/keys` and the sandbox-update response, mirroring how
`Settings.UpstreamAPIKey` is already redacted from `GET /admin/v1/settings`.

Example: create three keys, then give two of them a routing override —

```bash
curl -s -X PUT "$GW/admin/v1/keys/$CODEX_KEY_ID/sandbox" \
  -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled":false,"upstream_provider":"openai","upstream_url":"https://api.openai.com/v1","upstream_api_key":"sk-..."}'

curl -s -X PUT "$GW/admin/v1/keys/$CLAUDE_CODE_KEY_ID/sandbox" \
  -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled":false,"upstream_provider":"anthropic","upstream_url":"https://api.anthropic.com","upstream_api_key":"sk-ant-..."}'
```

The third key (e.g. for a Gemini-based client) is left with no override and
keeps using whatever the gateway-wide "Edge Routing" setting names.

## Not in scope here

- Dashboard UI for setting a key's upstream override (the Admin API accepts
  it today; the "API Keys" tab doesn't yet expose the three new fields).
- Rate limiting / quota accounting across a key's overridden upstream — those
  paths are unaffected by this change and already key off the authenticated
  API key, not the upstream.
