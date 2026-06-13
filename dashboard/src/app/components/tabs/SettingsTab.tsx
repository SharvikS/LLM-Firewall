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

  // Notification prefs are client-side preferences (persisted in localStorage).
  const [notif, setNotif] = useState({ critical: true, rateLimit: true, pii: false, health: true });

  useEffect(() => {
    fetchSettings().then(s => {
      if (s) setSettings(s); else setOffline(true);
      setLoading(false);
    });
    // Read client-side prefs after paint (avoids synchronous setState-in-effect).
    const id = requestAnimationFrame(() => {
      setCompact(localStorage.getItem('titan-compact') === '1');
      try {
        const n = localStorage.getItem('titan-notif');
        if (n) setNotif(JSON.parse(n));
      } catch { /* ignore */ }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const patch = useCallback((p: Partial<GatewaySettings>) => {
    setSettings(s => (s ? { ...s, ...p } : s));
    setSaveState('idle');
  }, []);

  const save = useCallback(async () => {
    if (!settings) return;
    setSaveState('saving');
    const updated = await saveSettings(settings);
    if (updated) { setSettings(updated); setSaveState('saved'); setTimeout(() => setSaveState('idle'), 2000); }
    else setSaveState('error');
  }, [settings]);

  const toggleCompact = () => setCompact(v => { const nv = !v; localStorage.setItem('titan-compact', nv ? '1' : '0'); return nv; });
  const setNotifKey = (k: keyof typeof notif) => setNotif(n => { const nn = { ...n, [k]: !n[k] }; localStorage.setItem('titan-notif', JSON.stringify(nn)); return nn; });

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
              <div className="mt-6">
                <SaveButton state={saveState} onClick={save}/>
              </div>
            </motion.div>
          )}

          {active === 'General' && (
            <motion.div key="gen" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
              <div className="mb-8">
                <h3 className="text-xl font-semibold">General</h3>
                <p className="text-sm text-base-muted mt-1">Rate limiting, caching and analyzer performance. Applied live across all gateway replicas.</p>
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
                <h3 className="text-xl font-semibold">Notifications</h3>
                <p className="text-sm text-base-muted mt-1">Alert preferences for this workspace (saved to your browser).</p>
              </div>
              {([
                { key: 'critical' as const,  label: 'Critical Block Alert', sub: 'Surface a banner when an ML_BLOCKED event has risk_score ≥ 90.' },
                { key: 'rateLimit' as const, label: 'Rate Limit Breach',    sub: 'Alert when any tenant is rate-limited more than 5 times per minute.' },
                { key: 'pii' as const,       label: 'PII Mask Report',      sub: 'Daily digest of PII entities detected and masked in prompts.' },
                { key: 'health' as const,    label: 'System Health Alerts', sub: 'Notify when the ML engine or Redis is unreachable for > 30 seconds.' },
              ]).map(({ key, label, sub }) => (
                <SettingRow key={key} label={label} sub={sub}>
                  <Toggle on={notif[key]} onChange={() => setNotifKey(key)}/>
                </SettingRow>
              ))}
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
