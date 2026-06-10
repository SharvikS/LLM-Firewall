// Type definitions for the TITAN Gateway Node.js SDK.

export interface Tenant {
  id: string;
  name: string;
  tier: string;
  rate_limit: number;
  active: boolean;
  created_at: string;
}

export interface APIKey {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  active: boolean;
  requests: number;
  last_used_at: string | null;
  created_at: string;
}

export interface IssuedKey {
  /** Raw API key — returned exactly once and unrecoverable afterwards. */
  key: string;
  metadata: APIKey;
}

export interface Policy {
  id: string;
  tenant_id: string | null;
  name: string;
  description: string;
  effect: "allow" | "deny" | "log";
  principal: string;
  action: string;
  condition: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuditEvent {
  id: string;
  request_id: string;
  tenant_id: string | null;
  api_key_id: string | null;
  action: string;
  risk_score: number | null;
  path: string | null;
  latency_ms: number | null;
  status_code: number | null;
  reason: string | null;
  region: string;
  created_at: string;
}

export interface AuditPage {
  events: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

export interface Metrics {
  total_requests: number;
  allowed_requests: number;
  blocked_requests: number;
  rate_limited: number;
  cache_hits: number;
  cache_misses: number;
  cache_hit_rate: number;
  ml_blocked: number;
  pii_masked: number;
  cedar_blocked: number;
  p99_latency_ms: number;
  avg_latency_ms: number;
  uptime_seconds: number;
  [k: string]: unknown;
}

export class TitanError extends Error {
  status: number;
  body?: unknown;
  constructor(status: number, message: string, body?: unknown);
}

export interface TitanClientOptions {
  adminToken: string;
  timeoutMs?: number;
}

export interface CreateTenantOptions {
  tier?: string;
  rateLimit?: number;
}

export interface CreatePolicyOptions {
  description?: string;
  principal?: string;
  action?: string;
  condition?: string;
  tenantId?: string | null;
}

export class TitanClient {
  constructor(baseUrl: string, options: TitanClientOptions);

  listTenants(): Promise<Tenant[]>;
  createTenant(name: string, options?: CreateTenantOptions): Promise<Tenant>;

  listKeys(tenantId?: string): Promise<APIKey[]>;
  createKey(tenantId: string, name?: string): Promise<IssuedKey>;
  revokeKey(keyId: string): Promise<{ status: string }>;

  listPolicies(): Promise<Policy[]>;
  createPolicy(name: string, effect: "allow" | "deny" | "log", options?: CreatePolicyOptions): Promise<Policy>;
  updatePolicy(policyId: string, fields: Partial<Policy>): Promise<Policy>;
  deletePolicy(policyId: string): Promise<{ status: string }>;

  listAudit(options?: { limit?: number; offset?: number }): Promise<AuditPage>;

  metrics(): Promise<Metrics>;
  events(n?: number): Promise<AuditEvent[]>;
  health(): Promise<{ status: string; service: string }>;
}

export default TitanClient;
