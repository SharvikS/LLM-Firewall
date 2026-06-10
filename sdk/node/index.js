// TITAN Gateway — Node.js SDK
// A dependency-free client for the TITAN Gateway Admin API, using the global
// fetch (Node 18+). ESM.

export class TitanError extends Error {
  /** @param {number} status @param {string} message @param {any} [body] */
  constructor(status, message, body) {
    super(`[${status}] ${message}`);
    this.name = "TitanError";
    this.status = status;
    this.body = body;
  }
}

export class TitanClient {
  /**
   * @param {string} baseUrl  Gateway origin, e.g. "http://localhost:8080"
   * @param {object} opts
   * @param {string} opts.adminToken  Master admin secret (X-Admin-Token header)
   * @param {number} [opts.timeoutMs] Per-request timeout (default 10000)
   */
  constructor(baseUrl, { adminToken, timeoutMs = 10000 } = {}) {
    if (!adminToken) throw new Error("TitanClient: adminToken is required");
    this._base = baseUrl.replace(/\/+$/, "");
    this._token = adminToken;
    this._timeoutMs = timeoutMs;
  }

  /** @private */
  async _request(method, path, { params, body, auth = true } = {}) {
    let url = `${this._base}${path}`;
    if (params) {
      const clean = Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null),
      );
      const qs = new URLSearchParams(clean).toString();
      if (qs) url += `?${qs}`;
    }

    const headers = { "Content-Type": "application/json" };
    if (auth) headers["X-Admin-Token"] = this._token;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this._timeoutMs);
    let resp;
    try {
      resp = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new TitanError(0, `connection failed: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await resp.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!resp.ok) {
      const msg = (data && data.error) || resp.statusText;
      throw new TitanError(resp.status, msg, data);
    }
    return data;
  }

  // ── Tenants ───────────────────────────────────────────────────────────────
  async listTenants() {
    return (await this._request("GET", "/admin/v1/tenants")).tenants ?? [];
  }
  async createTenant(name, { tier = "standard", rateLimit = 60 } = {}) {
    return this._request("POST", "/admin/v1/tenants", {
      body: { name, tier, rate_limit: rateLimit },
    });
  }

  // ── API Keys ──────────────────────────────────────────────────────────────
  async listKeys(tenantId) {
    return (
      await this._request("GET", "/admin/v1/keys", { params: { tenant_id: tenantId } })
    ).keys ?? [];
  }
  /** Issue a key. The returned object's `key` field is shown only once. */
  async createKey(tenantId, name = "") {
    return this._request("POST", "/admin/v1/keys", {
      body: { tenant_id: tenantId, name },
    });
  }
  async revokeKey(keyId) {
    return this._request("DELETE", `/admin/v1/keys/${keyId}`);
  }

  // ── Policies ──────────────────────────────────────────────────────────────
  async listPolicies() {
    return (await this._request("GET", "/admin/v1/policies")).policies ?? [];
  }
  async createPolicy(name, effect, opts = {}) {
    return this._request("POST", "/admin/v1/policies", {
      body: {
        name,
        effect,
        description: opts.description ?? "",
        principal: opts.principal ?? "*",
        action: opts.action ?? "*",
        condition: opts.condition ?? "",
        tenant_id: opts.tenantId ?? null,
      },
    });
  }
  async updatePolicy(policyId, fields) {
    return this._request("PUT", `/admin/v1/policies/${policyId}`, { body: fields });
  }
  async deletePolicy(policyId) {
    return this._request("DELETE", `/admin/v1/policies/${policyId}`);
  }

  // ── Audit ─────────────────────────────────────────────────────────────────
  async listAudit({ limit = 50, offset = 0 } = {}) {
    return this._request("GET", "/admin/v1/audit", { params: { limit, offset } });
  }

  // ── Read API (no auth) ────────────────────────────────────────────────────
  async metrics() {
    return this._request("GET", "/api/metrics", { auth: false });
  }
  async events(n = 50) {
    return (await this._request("GET", "/api/events", { params: { n }, auth: false }))
      .events ?? [];
  }
  async health() {
    return this._request("GET", "/health", { auth: false });
  }
}

export default TitanClient;
