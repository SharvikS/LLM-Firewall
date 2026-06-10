# TITAN Gateway — Node.js SDK

A dependency-free Node.js client for the TITAN Gateway Admin API, built on the
global `fetch` (Node 18+). Ships with TypeScript types.

## Install

```bash
npm install ./sdk/node      # from the repo
# or, once published:
# npm install @titan/firewall-sdk
```

## Usage

```js
import { TitanClient, TitanError } from "@titan/firewall-sdk";

const titan = new TitanClient("http://localhost:8080", {
  adminToken: "titan-admin-dev-secret",
});

// Tenants
const tenant = await titan.createTenant("acme-corp", {
  tier: "enterprise",
  rateLimit: 600,
});

// API keys — the raw key is returned exactly once
const issued = await titan.createKey(tenant.id, "prod-key");
console.log("save this:", issued.key);

// Policies (ABAC)
await titan.createPolicy("block-high-risk", "deny", {
  condition: "risk_score > 70",
});

// Audit + metrics
const page = await titan.listAudit({ limit: 20 });
const metrics = await titan.metrics();

try {
  await titan.revokeKey("00000000-0000-0000-0000-000000000000");
} catch (err) {
  if (err instanceof TitanError) console.error(err.status, err.message);
}
```

## API

| Method | Description |
|---|---|
| `listTenants()` / `createTenant(name, opts)` | Tenant management |
| `listKeys(tenantId?)` / `createKey(tenantId, name)` / `revokeKey(id)` | API keys |
| `listPolicies()` / `createPolicy(name, effect, opts)` / `updatePolicy(id, fields)` / `deletePolicy(id)` | Policies |
| `listAudit({ limit, offset })` | Audit log query |
| `metrics()` / `events(n)` / `health()` | Read API (no auth) |

All methods reject with a `TitanError` (carrying `.status`, `.message`, `.body`)
on a non-2xx response.
