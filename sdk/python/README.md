# TITAN Gateway — Python SDK

A dependency-free Python client for the TITAN Gateway Admin API. Manage tenants,
API keys, ABAC policies, and query audit logs and metrics.

## Install

```bash
pip install ./sdk/python          # from the repo
# or, once published:
# pip install titan-firewall
```

Requires Python 3.9+. No third-party dependencies (uses the standard library).

## Usage

```python
from titan_firewall import TitanClient, TitanError

titan = TitanClient("http://localhost:8080", admin_token="titan-admin-dev-secret")

# Tenants
tenant = titan.create_tenant("acme-corp", tier="enterprise", rate_limit=600)

# API keys — the raw key is returned exactly once
issued = titan.create_key(tenant["id"], name="prod-key")
print("save this:", issued["key"])

# Policies (ABAC)
titan.create_policy(
    name="block-high-risk",
    effect="deny",
    condition="risk_score > 70",
)

# Audit + metrics
print(titan.list_audit(limit=20)["total"])
print(titan.metrics()["total_requests"])

try:
    titan.revoke_key("00000000-0000-0000-0000-000000000000")
except TitanError as e:
    print(e.status, e.message)
```

## API

| Method | Description |
|---|---|
| `list_tenants()` / `create_tenant(name, tier, rate_limit)` | Tenant management |
| `list_keys(tenant_id=None)` / `create_key(tenant_id, name)` / `revoke_key(id)` | API keys |
| `list_policies()` / `create_policy(...)` / `update_policy(id, **fields)` / `delete_policy(id)` | Policies |
| `list_audit(limit, offset)` | Audit log query |
| `metrics()` / `events(n)` / `health()` | Read API (no auth) |

All write methods raise `TitanError` (with `.status`, `.message`, `.body`) on a
non-2xx response.
