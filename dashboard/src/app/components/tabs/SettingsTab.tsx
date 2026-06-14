'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, Check, Loader2, AlertTriangle } from 'lucide-react';
import { fetchSettings, saveSettings, type GatewaySettings } from '@/lib/settings';

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button onClick={onChange} disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${on ? 'bg-base-accent' : 'bg-base-border'}`}>
      <span className={`pointer-events-none inline-block h-[16px] w-[16px] transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${on ? 'translate-x-4' : 'translate-x-0'}`}/>
    </button>
  );
}

function SettingRow({ label, sub, children }: { label: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start py-5 border-b border-base-border last:border-0">
      <div className="pr-8">
        <div className="text-sm font-medium text-base-text">{label}</div>
        <div className="text-xs text-base-muted mt-0.5 leading-relaxed max-w-md">{sub}</div>
      </div>
      <div className="shrink-0 mt-0.5">{children}</div>
    </div>
  );
}

const THEMES = [
  { key: 'theme-dark',     name: 'Dark',     preview: ['#0A0A0A', '#EDEDED', '#FFFFFF'] },
  { key: 'theme-light',    name: 'Light',    preview: ['#FAFAFA', '#09090B', '#18181B'] },
  { key: 'theme-midnight', name: 'Midnight', preview: ['#020617', '#F8FAFC', '#3B82F6'] },
  { key: 'theme-cobalt',   name: 'Cobalt',   preview: ['#001220', '#E0F2FE', '#0284C7'] },
];

interface Props {
  theme: string;
  onThemeChange: (t: string) => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function SaveButton({ state, onClick }: { state: SaveState; onClick: () => void }) {
  const label =
    state === 'saving' ? <><Loader2 size={14} className="animate-spin"/>Saving…</> :
    state === 'saved'  ? <><Check size={14}/>Saved</> :
    state === 'error'  ? <><AlertTriangle size={14}/>Failed — retry</> :
    <><Save size={14}/>Save Changes</>;
  const cls =
    state === 'saved' ? 'bg-green-400/15 text-green-400 border border-green-400/30' :
    state === 'error' ? 'bg-red-400/15 text-red-400 border border-red-400/30' :
    'bg-base-text text-base-main hover:scale-[1.02]';
  return (
    <button onClick={onClick} disabled={state === 'saving'}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-70 ${cls}`}>
      {label}
    </button>
  );
}

export default function SettingsTab({ theme, onThemeChange }: Props) {
  const [active, setActive] = useState('Appearance');
  const [compact, setCompact] = useState(false);

  const [settings, setSettings] = useState<GatewaySettings | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // Settings scope: '' = global default, or a tenant UUID for a per-tenant override.
  const [scope, setScope] = useState('');
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);

  // The upstream API key is write-only: only sent when the user actually edits
  // it, so an unrelated settings save never clears it — and switching to a
  // keyless local model explicitly clears it (never leaks the old key upstream).
  const [keyTouched, setKeyTouched] = useState(false);

  // Upstream connection-test result (does the gateway reach the configured LLM?).
  const [conn, setConn] = useState<{ state: 'idle' | 'testing' | 'done'; reachable?: boolean; detail?: string; models?: string[] }>({ state: 'idle' });

  // Alerting (SOC webhook): the webhook URL is write-only like the upstream key.
  const [webhookTouched, setWebhookTouched] = useState(false);
  const [alertTest, setAlertTest] = useState<{ state: 'idle' | 'sending' | 'done'; ok?: boolean; detail?: string }>({ state: 'idle' });

  useEffect(() => {
    fetchSettings().then(s => {
      if (s) setSettings(s); else setOffline(true);
      setLoading(false);
    });
    // Tenant list for the per-tenant scope selector.
    fetch('/api/admin/tenants', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setTenants((d.tenants ?? []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }))))
      .catch(() => {});
    // Read client-side prefs after paint (avoids synchronous setState-in-effect).
    const id = requestAnimationFrame(() => {
      setCompact(localStorage.getItem('titan-compact') === '1');
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // Reload settings when the scope (global vs a tenant) changes.
  const changeScope = useCallback((next: string) => {
    setScope(next);
    setLoading(true);
    setSaveState('idle');
    fetchSettings(next || undefined).then(s => {
      if (s) { setSettings(s); setOffline(false); } else setOffline(true);
      setLoading(false);
    });
  }, []);

  const patch = useCallback((p: Partial<GatewaySettings>) => {
    setSettings(s => (s ? { ...s, ...p } : s));
    setSaveState('idle');
  }, []);

  const save = useCallback(async () => {
    if (!settings) return;
    setSaveState('saving');
    // Omit the write-only key unless the user edited it, so saving other fields
    // never clears the stored upstream key.
    const payload: Partial<GatewaySettings> = { ...settings };
    if (!keyTouched) delete payload.upstream_api_key;
    if (!webhookTouched) delete payload.alert_webhook_url;
    const updated = await saveSettings(payload, scope || undefined);
    if (updated) { setSettings(updated); setKeyTouched(false); setWebhookTouched(false); setSaveState('saved'); setTimeout(() => setSaveState('idle'), 2000); }
    else setSaveState('error');
  }, [settings, scope, keyTouched, webhookTouched]);

  const sendTestAlert = useCallback(async () => {
    setAlertTest({ state: 'sending' });
    try {
      const res = await fetch('/api/admin/alerts/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookTouched ? settings?.alert_webhook_url : '' }),
      });
      const d = await res.json();
      setAlertTest({ state: 'done', ok: d.delivered, detail: d.detail });
    } catch { setAlertTest({ state: 'done', ok: false, detail: 'request failed' }); }
  }, [settings, webhookTouched]);

  const testUpstream = useCallback(async () => {
    if (!settings?.upstream_url) return;
    setConn({ state: 'testing' });
    try {
      const res = await fetch('/api/admin/upstream/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Only include the key if the user just typed one (else the gateway has it).
        body: JSON.stringify({ url: settings.upstream_url, key: keyTouched ? settings.upstream_api_key : '' }),
      });
      const d = await res.json();
      setConn({ state: 'done', reachable: d.reachable, detail: d.detail, models: d.models });
    } catch {
      setConn({ state: 'done', reachable: false, detail: 'request failed' });
    }
  }, [settings, keyTouched]);

  const toggleCompact = () => setCompact(v => { const nv = !v; localStorage.setItem('titan-compact', nv ? '1' : '0'); return nv; });

  const sections = ['Appearance', 'Security Defaults', 'General', 'Notifications'];

  return (
    <div className="max-w-5xl mx-auto flex flex-col md:flex-row gap-12">
      {/* Left nav */}
      <div className="w-44 shrink-0">
        <h2 className="text-lg font-semibold tracking-tight mb-5">Settings</h2>
        <div className="space-y-0.5">
          {sections.map(s => (
            <button key={s} onClick={() => setActive(s)}
              className={`relative w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${active === s ? 'text-base-text font-medium' : 'text-base-muted hover:text-base-text'}`}
            >
              {active === s && <motion.div layoutId="settNav" className="absolute left-0 top-0 bottom-0 w-0.5 bg-base-accent rounded-r-full" transition={{ type: 'spring', stiffness: 300, damping: 30 }}/>}
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {offline && active !== 'Appearance' && active !== 'Notifications' && (
          <div className="mb-6 flex items-center gap-2 px-4 py-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 text-xs">
            <AlertTriangle size={14}/> Gateway unreachable — live settings can&apos;t be loaded or saved right now.
          </div>
        )}
        {active === 'General' && (
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-base-muted">Apply to</label>
            <select value={scope} onChange={e => changeScope(e.target.value)}
              className="px-3 py-1.5 bg-base-sec border border-base-border rounded-lg text-sm outline-none">
              <option value="">Global default (all tenants)</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {scope
              ? <span className="text-xs text-base-muted">Per-tenant override — layers over the global defaults for this tenant only.</span>
              : <span className="text-xs text-base-muted">Baseline applied to every tenant without an override.</span>}
          </div>
        )}
        <AnimatePresence mode="wait">
          {active === 'Appearance' && (
            <motion.div key="app" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
              <div className="mb-8">
                <h3 className="text-xl font-semibold">Appearance</h3>
                <p className="text-sm text-base-muted mt-1">Customize the look of your workspace.</p>
              </div>
              <div className="mb-6">
                <label className="text-xs font-semibold text-base-muted uppercase tracking-widest block mb-3">Interface Theme</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {THEMES.map(t => (
                    <div key={t.key} onClick={() => onThemeChange(t.key)}
                      className={`relative rounded-xl cursor-pointer border transition-all overflow-hidden h-20 flex flex-col justify-between p-3 ${theme === t.key ? 'border-base-accent shadow-[0_0_0_1px_var(--accent)]' : 'border-base-border hover:border-base-muted/50'}`}
                      style={{ background: t.preview[0] }}
                    >
                      <div className="flex gap-1">
                        {t.preview.map((c, i) => <span key={i} className="w-3 h-3 rounded-full border border-white/10" style={{ background: c }}/>)}
                      </div>
                      <span className="text-xs font-medium" style={{ color: t.preview[1] }}>{t.name}</span>
                      {theme === t.key && <div className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ background: t.preview[2] }}/>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="h-px bg-base-border my-6"/>
              <SettingRow label="Compact Density" sub="Reduce padding in tables and lists to show more data at once.">
                <Toggle on={compact} onChange={toggleCompact}/>
              </SettingRow>
            </motion.div>
          )}

          {active === 'Security Defaults' && (
            <motion.div key="sec" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
              <div className="mb-8">
                <h3 className="text-xl font-semibold">Security Defaults</h3>
                <p className="text-sm text-base-muted mt-1">Global governance gates applied to every request. Changes apply live — no restart.</p>
              </div>
              <SettingRow label="PII Redaction" sub="Detect and mask SSNs, emails, credit cards, names and more with the Presidio ML engine before prompts reach the provider.">
                <Toggle on={!!settings?.pii_redaction_enabled} disabled={!settings} onChange={() => patch({ pii_redaction_enabled: !settings?.pii_redaction_enabled })}/>
              </SettingRow>
              <SettingRow label="Toxicity Filtering" sub="Block hate, harassment, threats and self-harm content using the toxicity classifier.">
                <Toggle on={!!settings?.toxicity_enabled} disabled={!settings} onChange={() => patch({ toxicity_enabled: !settings?.toxicity_enabled })}/>
              </SettingRow>
              <SettingRow label="Output Response Scanning" sub="Scan the model's reply and mask any PII or secrets it emits before returning it to the client.">
                <Toggle on={!!settings?.output_scan_enabled} disabled={!settings} onChange={() => patch({ output_scan_enabled: !settings?.output_scan_enabled })}/>
              </SettingRow>
              <SettingRow label="Block Source-Code Pastes" sub="Reject large source-code pastes outright instead of just flagging them (prevents code exfiltration).">
                <Toggle on={!!settings?.code_leak_block} disabled={!settings} onChange={() => patch({ code_leak_block: !settings?.code_leak_block })}/>
              </SettingRow>
              <SettingRow label="Audit All Requests" sub="Write every request — including clean ALLOWs — to the durable audit log. When off, only blocks and masks are persisted.">
                <Toggle on={!!settings?.audit_all_requests} disabled={!settings} onChange={() => patch({ audit_all_requests: !settings?.audit_all_requests })}/>
              </SettingRow>

              {/* Custom guardrails — no-code deny rules applied before the ML gate */}
              <div className="mt-8 pt-6 border-t border-base-border">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-semibold">Custom Guardrails</h4>
                  <button type="button" disabled={!settings}
                    onClick={() => patch({ guardrails: [...(settings?.guardrails ?? []), { name: '', pattern: '', enabled: true }] })}
                    className="text-xs border border-base-border px-2.5 py-1 rounded-md hover:bg-base-sec transition-colors disabled:opacity-50">+ Add rule</button>
                </div>
                <p className="text-xs text-base-muted mb-3">Operator-defined deny rules (case-insensitive regex) matched against each prompt before the ML gate. A match blocks with 403 — e.g. <code className="bg-base-sec px-1 rounded">Project\s+Titan</code> to stop a codename leaking.</p>
                <div className="space-y-2">
                  {(settings?.guardrails ?? []).map((g, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={g.name} placeholder="rule name" disabled={!settings}
                        onChange={e => patch({ guardrails: (settings!.guardrails ?? []).map((x, j) => j === i ? { ...x, name: e.target.value } : x) })}
                        className="w-40 px-2 py-1.5 bg-base-sec border border-base-border rounded-md text-xs outline-none"/>
                      <input value={g.pattern} placeholder="regex pattern" disabled={!settings}
                        onChange={e => patch({ guardrails: (settings!.guardrails ?? []).map((x, j) => j === i ? { ...x, pattern: e.target.value } : x) })}
                        className="flex-1 px-2 py-1.5 bg-base-sec border border-base-border rounded-md text-xs font-mono outline-none"/>
                      <Toggle on={g.enabled} disabled={!settings} onChange={() => patch({ guardrails: (settings!.guardrails ?? []).map((x, j) => j === i ? { ...x, enabled: !x.enabled } : x) })}/>
                      <button type="button" aria-label="remove" disabled={!settings}
                        onClick={() => patch({ guardrails: (settings!.guardrails ?? []).filter((_, j) => j !== i) })}
                        className="p-1.5 text-base-muted hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors text-xs">✕</button>
                    </div>
                  ))}
                  {(settings?.guardrails ?? []).length === 0 && <p className="text-xs text-base-muted italic">No custom rules. The ML detectors still apply.</p>}
                </div>
              </div>

              <div className="mt-6">
                <SaveButton state={saveState} onClick={save}/>
              </div>
            </motion.div>
          )}

          {active === 'General' && (
            <motion.div key="gen" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
              <div className="mb-8">
                <h3 className="text-xl font-semibold">General</h3>
                <p className="text-sm text-base-muted mt-1">Upstream LLM, rate limiting, caching and analyzer performance. Applied live across all gateway replicas.</p>
              </div>

              {/* Upstream LLM — switch between API providers and local models live */}
              <div className="mb-8 p-4 border border-base-border rounded-lg">
                <div className="text-sm font-semibold mb-1">Upstream LLM</div>
                <p className="text-xs text-base-muted mb-3">Point the gateway at a hosted API or a local model (OpenAI-compatible). Switches live — no restart.</p>
                <div className="flex flex-wrap gap-2 mb-4">
                  {([
                    { name: 'Groq',       url: 'https://api.groq.com/openai',          local: false },
                    { name: 'OpenAI',     url: 'https://api.openai.com',               local: false },
                    { name: 'Ollama',     url: 'http://host.docker.internal:11434',    local: true },
                    { name: 'LM Studio',  url: 'http://host.docker.internal:1234',     local: true },
                    { name: 'vLLM',       url: 'http://host.docker.internal:8000',     local: true },
                  ]).map(p => (
                    <button key={p.name} type="button" disabled={!settings}
                      onClick={() => {
                        // Local models are keyless — clear the key so it's never
                        // sent upstream. API presets leave the key for you to enter.
                        if (p.local) { patch({ upstream_url: p.url, upstream_api_key: '' }); setKeyTouched(true); }
                        else patch({ upstream_url: p.url });
                      }}
                      className="px-2.5 py-1 text-xs rounded-md border border-base-border hover:bg-base-sec transition-colors disabled:opacity-50">
                      {p.name}{p.local ? ' (local)' : ''}
                    </button>
                  ))}
                </div>
                <label className="text-xs font-semibold text-base-muted uppercase tracking-widest block mb-1.5">Upstream URL</label>
                <input type="text" value={settings ? (settings.upstream_url ?? '') : ''} disabled={!settings}
                  onChange={e => patch({ upstream_url: e.target.value })}
                  placeholder="https://api.groq.com/openai  or  http://host.docker.internal:11434"
                  className="w-full max-w-xl px-3 py-2.5 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 transition-colors font-mono disabled:opacity-50"/>
                <p className="text-xs text-base-muted mt-1.5">OpenAI-compatible base URL. For local models from Docker use <code className="bg-base-sec px-1 rounded">host.docker.internal</code>.</p>

                <label className="text-xs font-semibold text-base-muted uppercase tracking-widest block mb-1.5 mt-4">Upstream API Key</label>
                <input type="password" value={settings ? (settings.upstream_api_key ?? '') : ''} disabled={!settings}
                  onChange={e => { patch({ upstream_api_key: e.target.value }); setKeyTouched(true); }}
                  placeholder="leave blank to keep current · not needed for local models"
                  className="w-full max-w-xl px-3 py-2.5 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 transition-colors font-mono disabled:opacity-50"/>
                <p className="text-xs text-base-muted mt-1.5">Write-only — never displayed. Required for hosted APIs; leave blank for keyless local servers.</p>
                <div className="mt-4 flex items-center gap-3 flex-wrap">
                  <SaveButton state={saveState} onClick={save}/>
                  <button type="button" disabled={!settings || conn.state === 'testing'} onClick={testUpstream}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-base-border hover:bg-base-sec transition-colors disabled:opacity-60">
                    {conn.state === 'testing' ? <><Loader2 size={14} className="animate-spin"/>Testing…</> : 'Test connection'}
                  </button>
                  {conn.state === 'done' && (
                    conn.reachable
                      ? <span className="inline-flex items-center gap-1.5 text-xs text-green-400"><Check size={13}/>Reachable{conn.models && conn.models.length > 0 ? ` · ${conn.models.length} model(s)` : ''}</span>
                      : <span className="inline-flex items-center gap-1.5 text-xs text-red-400"><AlertTriangle size={13}/>{conn.detail || 'unreachable'}</span>
                  )}
                </div>
                {conn.state === 'done' && conn.reachable && conn.models && conn.models.length > 0 && (
                  <p className="text-xs text-base-muted mt-2">Models: <code className="bg-base-sec px-1 rounded">{conn.models.slice(0, 6).join(', ')}</code> — use one of these as the <code className="bg-base-sec px-1 rounded">model</code> in requests.</p>
                )}
              </div>

              <div className="space-y-5">
                {([
                  { label: 'Rate Limit (RPM)',       key: 'rate_limit_rpm',      hint: 'Maximum requests per minute per tenant. 0 disables the limit.' },
                  { label: 'Token Limit (TPM)',      key: 'rate_limit_tpm',      hint: 'Maximum tokens per minute per tenant. 0 disables token-based limiting.' },
                  { label: 'Cache TTL (seconds)',    key: 'cache_ttl_sec',       hint: 'How long exact-match responses are cached in Redis.' },
                  { label: 'Analyzer Timeout (ms)',  key: 'analyzer_timeout_ms', hint: 'Inline gRPC deadline for the ML engine. Requests fail-open if exceeded (10–10000).' },
                ] as { label: string; key: keyof GatewaySettings; hint: string }[]).map(({ label, key, hint }) => (
                  <div key={key}>
                    <label className="text-xs font-semibold text-base-muted uppercase tracking-widest block mb-1.5">{label}</label>
                    <input type="number" min={0}
                      value={settings ? String(settings[key] ?? '') : ''}
                      disabled={!settings}
                      onChange={e => patch({ [key]: Number(e.target.value) } as Partial<GatewaySettings>)}
                      className="w-full max-w-md px-3 py-2.5 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 transition-colors font-mono disabled:opacity-50"/>
                    <p className="text-xs text-base-muted mt-1.5">{hint}</p>
                  </div>
                ))}
              </div>
              <div className="mt-8">
                <SaveButton state={saveState} onClick={save}/>
              </div>
            </motion.div>
          )}

          {active === 'Notifications' && (
            <motion.div key="notif" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
              <div className="mb-8">
                <h3 className="text-xl font-semibold">Alerting &amp; SIEM</h3>
                <p className="text-sm text-base-muted mt-1">Stream security events to your SOC in real time. Works with Slack/Teams incoming webhooks, PagerDuty, Splunk HEC, or any HTTP collector. Applied live.</p>
              </div>
              <SettingRow label="Enable real-time alerts" sub="POST high-risk blocks and quota breaches to your webhook as they happen (coalesced to avoid alert storms).">
                <Toggle on={!!settings?.alerts_enabled} disabled={!settings} onChange={() => patch({ alerts_enabled: !settings?.alerts_enabled })}/>
              </SettingRow>
              <div className="mt-5">
                <label className="text-xs font-semibold text-base-muted uppercase tracking-widest block mb-1.5">Webhook URL</label>
                <input type="password" value={settings ? (settings.alert_webhook_url ?? '') : ''} disabled={!settings}
                  onChange={e => { patch({ alert_webhook_url: e.target.value }); setWebhookTouched(true); }}
                  placeholder="https://hooks.slack.com/services/…  (leave blank to keep current)"
                  className="w-full max-w-xl px-3 py-2.5 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 transition-colors font-mono disabled:opacity-50"/>
                <p className="text-xs text-base-muted mt-1.5">Write-only — never displayed. Slack/Teams render the message; SIEMs receive structured JSON (action, tenant, risk, request_id, timestamp).</p>
              </div>
              <div className="mt-5 max-w-xs">
                <label className="text-xs font-semibold text-base-muted uppercase tracking-widest block mb-1.5">Minimum risk to alert (0–100)</label>
                <input type="number" min={0} max={100} value={settings ? String(settings.alert_min_risk ?? 90) : ''} disabled={!settings}
                  onChange={e => patch({ alert_min_risk: Number(e.target.value) })}
                  className="w-full px-3 py-2.5 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 transition-colors font-mono disabled:opacity-50"/>
                <p className="text-xs text-base-muted mt-1.5">Blocked requests at/above this risk alert; quota breaches always alert.</p>
              </div>
              <div className="mt-6 flex items-center gap-3 flex-wrap">
                <SaveButton state={saveState} onClick={save}/>
                <button type="button" disabled={!settings || alertTest.state === 'sending'} onClick={sendTestAlert}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-base-border hover:bg-base-sec transition-colors disabled:opacity-60">
                  {alertTest.state === 'sending' ? <><Loader2 size={14} className="animate-spin"/>Sending…</> : 'Send test alert'}
                </button>
                {alertTest.state === 'done' && (
                  alertTest.ok
                    ? <span className="inline-flex items-center gap-1.5 text-xs text-green-400"><Check size={13}/>Delivered</span>
                    : <span className="inline-flex items-center gap-1.5 text-xs text-red-400"><AlertTriangle size={13}/>{alertTest.detail || 'failed'}</span>
                )}
              </div>
              <p className="mt-3 text-xs text-base-muted">Tip: save the webhook first, then send a test (or paste a fresh URL above and test it before saving).</p>
            </motion.div>
          )}
        </AnimatePresence>
        {loading && active !== 'Appearance' && active !== 'Notifications' && (
          <div className="mt-4 text-xs text-base-muted flex items-center gap-2"><Loader2 size={12} className="animate-spin"/> Loading live settings…</div>
        )}
      </div>
    </div>
  );
}
