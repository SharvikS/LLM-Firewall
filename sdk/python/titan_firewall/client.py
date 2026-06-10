"""TITAN Gateway Admin API client — standard-library only (urllib)."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional


class TitanError(Exception):
    """Raised when the gateway returns a non-2xx response."""

    def __init__(self, status: int, message: str, body: Any = None):
        super().__init__(f"[{status}] {message}")
        self.status = status
        self.message = message
        self.body = body


class TitanClient:
    """
    Client for the TITAN Gateway Admin API (`/admin/v1/*`).

    Args:
        base_url: Gateway origin, e.g. "http://localhost:8080".
        admin_token: Master admin secret (sent as the X-Admin-Token header).
        timeout: Per-request timeout in seconds.
    """

    def __init__(self, base_url: str, admin_token: str, timeout: float = 10.0):
        self._base = base_url.rstrip("/")
        self._token = admin_token
        self._timeout = timeout

    # ── HTTP plumbing ────────────────────────────────────────────────────────

    def _request(self, method: str, path: str, *, params: Optional[dict] = None,
                 body: Optional[dict] = None, auth: bool = True) -> Any:
        url = f"{self._base}{path}"
        if params:
            clean = {k: v for k, v in params.items() if v is not None}
            if clean:
                url += "?" + urllib.parse.urlencode(clean)

        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if auth:
            req.add_header("X-Admin-Token", self._token)

        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            try:
                parsed = json.loads(raw) if raw else {}
                msg = parsed.get("error", exc.reason)
            except json.JSONDecodeError:
                parsed, msg = raw.decode(errors="replace"), exc.reason
            raise TitanError(exc.code, msg, parsed) from None
        except urllib.error.URLError as exc:
            raise TitanError(0, f"connection failed: {exc.reason}") from None

    # ── Tenants ──────────────────────────────────────────────────────────────

    def list_tenants(self) -> list[dict]:
        return self._request("GET", "/admin/v1/tenants").get("tenants", [])

    def create_tenant(self, name: str, tier: str = "standard",
                      rate_limit: int = 60) -> dict:
        return self._request("POST", "/admin/v1/tenants",
                             body={"name": name, "tier": tier, "rate_limit": rate_limit})

    # ── API Keys ─────────────────────────────────────────────────────────────

    def list_keys(self, tenant_id: Optional[str] = None) -> list[dict]:
        return self._request("GET", "/admin/v1/keys",
                             params={"tenant_id": tenant_id}).get("keys", [])

    def create_key(self, tenant_id: str, name: str = "") -> dict:
        """Issue a key. The returned dict's `key` field is shown only once."""
        return self._request("POST", "/admin/v1/keys",
                             body={"tenant_id": tenant_id, "name": name})

    def revoke_key(self, key_id: str) -> dict:
        return self._request("DELETE", f"/admin/v1/keys/{key_id}")

    # ── Policies ─────────────────────────────────────────────────────────────

    def list_policies(self) -> list[dict]:
        return self._request("GET", "/admin/v1/policies").get("policies", [])

    def create_policy(self, name: str, effect: str, *, description: str = "",
                      principal: str = "*", action: str = "*", condition: str = "",
                      tenant_id: Optional[str] = None) -> dict:
        return self._request("POST", "/admin/v1/policies", body={
            "name": name, "effect": effect, "description": description,
            "principal": principal, "action": action, "condition": condition,
            "tenant_id": tenant_id,
        })

    def update_policy(self, policy_id: str, **fields: Any) -> dict:
        return self._request("PUT", f"/admin/v1/policies/{policy_id}", body=fields)

    def delete_policy(self, policy_id: str) -> dict:
        return self._request("DELETE", f"/admin/v1/policies/{policy_id}")

    # ── Audit ────────────────────────────────────────────────────────────────

    def list_audit(self, limit: int = 50, offset: int = 0) -> dict:
        return self._request("GET", "/admin/v1/audit",
                             params={"limit": limit, "offset": offset})

    # ── Read API (no auth) ───────────────────────────────────────────────────

    def metrics(self) -> dict:
        return self._request("GET", "/api/metrics", auth=False)

    def events(self, n: int = 50) -> list[dict]:
        return self._request("GET", "/api/events", params={"n": n},
                             auth=False).get("events", [])

    def health(self) -> dict:
        return self._request("GET", "/health", auth=False)
