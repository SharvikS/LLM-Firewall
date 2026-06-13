// Client-safe helpers for the runtime settings plane. These call the dashboard's
// own /api/admin/settings route (which injects the admin token server-side), so
// no secret is ever exposed to the browser.

export interface GatewaySettings {
  rate_limit_rpm: number;
  rate_limit_tpm: number;
  cache_ttl_sec: number;
  analyzer_timeout_ms: number;
  output_scan_enabled: boolean;
  failover_enabled: boolean;
  audit_all_requests: boolean;
  pii_redaction_enabled: boolean;
  toxicity_enabled: boolean;
  toxicity_block_threshold: number;
  code_leak_block: boolean;
  pii_entities: Record<string, boolean>;
  _offline?: boolean;
}

export async function fetchSettings(): Promise<GatewaySettings | null> {
  try {
    const res = await fetch('/api/admin/settings', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?._offline) return null;
    return data as GatewaySettings;
  } catch {
    return null;
  }
}

export async function saveSettings(
  patch: Partial<GatewaySettings>,
): Promise<GatewaySettings | null> {
  try {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    return (await res.json()) as GatewaySettings;
  } catch {
    return null;
  }
}
