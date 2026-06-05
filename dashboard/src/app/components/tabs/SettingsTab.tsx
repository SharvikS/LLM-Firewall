'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, Check } from 'lucide-react';

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${on ? 'bg-base-accent' : 'bg-base-border'}`}>
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

export default function SettingsTab({ theme, onThemeChange }: Props) {
  const [active, setActive] = useState('Appearance');
  const [saved, setSaved] = useState(false);
  const [compact, setCompact] = useState(false);
  const [security, setSecurity] = useState({ pii: true, sandbox: true, hitl: false, auditAll: true });
  const [general, setGeneral] = useState({ gatewayURL: 'http://localhost:8080', rateLimit: '60', cacheTTL: '3600', analyzerTimeout: '150' });

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

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
                <Toggle on={compact} onChange={() => setCompact(v => !v)}/>
              </SettingRow>
            </motion.div>
          )}

          {active === 'Security Defaults' && (
            <motion.div key="sec" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
              <div className="mb-8">
                <h3 className="text-xl font-semibold">Security Defaults</h3>
                <p className="text-sm text-base-muted mt-1">Global baseline policies applied before Cedar evaluation.</p>
              </div>
              <SettingRow label="SOC2 PII Redaction" sub="Automatically redact SSNs, emails, credit cards and phone numbers from all prompts using the Presidio ML engine.">
                <Toggle on={security.pii} onChange={() => setSecurity(s => ({ ...s, pii: !s.pii }))}/>
              </SettingRow>
              <SettingRow label="Aggressive Sandbox Termination" sub="Kill Firecracker microVMs immediately on unexpected outbound network connections.">
                <Toggle on={security.sandbox} onChange={() => setSecurity(s => ({ ...s, sandbox: !s.sandbox }))}/>
              </SettingRow>
              <SettingRow label="Human-in-the-Loop Fallback" sub="Suspend medium-risk tool calls (risk 50–70) and await manual admin approval via Slack.">
                <Toggle on={security.hitl} onChange={() => setSecurity(s => ({ ...s, hitl: !s.hitl }))}/>
              </SettingRow>
              <SettingRow label="Audit All Requests" sub="Write every request event to the Kafka audit_logs topic regardless of outcome.">
                <Toggle on={security.auditAll} onChange={() => setSecurity(s => ({ ...s, auditAll: !s.auditAll }))}/>
              </SettingRow>
              <div className="mt-6">
                <button onClick={save} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${saved ? 'bg-green-400/15 text-green-400 border border-green-400/30' : 'bg-base-text text-base-main hover:scale-[1.02]'}`}>
                  {saved ? <><Check size={14}/>Saved</> : <><Save size={14}/>Save Changes</>}
                </button>
              </div>
            </motion.div>
          )}

          {active === 'General' && (
            <motion.div key="gen" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
              <div className="mb-8">
                <h3 className="text-xl font-semibold">General</h3>
                <p className="text-sm text-base-muted mt-1">Gateway connection and performance settings.</p>
              </div>
              <div className="space-y-5">
                {[
                  { label: 'Gateway URL',        key: 'gatewayURL',        placeholder: 'http://localhost:8080', hint: 'The Go gateway endpoint the dashboard polls for metrics.' },
                  { label: 'Rate Limit (RPM)',   key: 'rateLimit',         placeholder: '60',   hint: 'Maximum requests per minute per tenant.' },
                  { label: 'Cache TTL (seconds)',key: 'cacheTTL',          placeholder: '3600', hint: 'How long exact-match responses are cached in Redis.' },
                  { label: 'Analyzer Timeout (ms)', key: 'analyzerTimeout', placeholder: '150', hint: 'gRPC timeout for the Python ML engine. Fail-open if exceeded.' },
                ].map(({ label, key, placeholder, hint }) => (
                  <div key={key}>
                    <label className="text-xs font-semibold text-base-muted uppercase tracking-widest block mb-1.5">{label}</label>
                    <input value={(general as any)[key]} onChange={e => setGeneral(g => ({ ...g, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className="w-full max-w-md px-3 py-2.5 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 transition-colors font-mono"/>
                    <p className="text-xs text-base-muted mt-1.5">{hint}</p>
                  </div>
                ))}
              </div>
              <div className="mt-8">
                <button onClick={save} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${saved ? 'bg-green-400/15 text-green-400 border border-green-400/30' : 'bg-base-text text-base-main hover:scale-[1.02]'}`}>
                  {saved ? <><Check size={14}/>Saved</> : <><Save size={14}/>Save Changes</>}
                </button>
              </div>
            </motion.div>
          )}

          {active === 'Notifications' && (
            <motion.div key="notif" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
              <div className="mb-8">
                <h3 className="text-xl font-semibold">Notifications</h3>
                <p className="text-sm text-base-muted mt-1">Alert routing for critical security events.</p>
              </div>
              {[
                { label: 'Critical Block Alert', sub: 'Notify via Slack when an ML_BLOCKED event has risk_score ≥ 90.', on: true },
                { label: 'Rate Limit Breach',    sub: 'Alert when any tenant is rate-limited more than 5 times per minute.', on: true },
                { label: 'PII Mask Report',      sub: 'Daily digest of PII entities detected and masked in prompts.', on: false },
                { label: 'System Health Alerts', sub: 'Notify when the ML engine or Redis is unreachable for > 30 seconds.', on: true },
              ].map(({ label, sub, on: defaultOn }) => {
                const [on, setOn] = useState(defaultOn);
                return <SettingRow key={label} label={label} sub={sub}><Toggle on={on} onChange={() => setOn(v => !v)}/></SettingRow>;
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
