'use client';

import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Globe, ShieldCheck, Ban, Eye, AlertTriangle, MonitorSmartphone,
  Flag, Wifi, WifiOff, CircleDot, FileText, Image as ImageIcon, MessageSquare,
} from 'lucide-react';
import { fetchSettings, saveSettings, type GatewaySettings } from '@/lib/settings';

const KIND_META: Record<string, { label: string; icon: ReactNode }> = {
  text:  { label: 'Prompt', icon: <MessageSquare size={11} /> },
  file:  { label: 'File',   icon: <FileText size={11} /> },
  image: { label: 'Image',  icon: <ImageIcon size={11} /> },
};

interface CountBucket { key: string; count: number }
interface TimeBucket { hour: string; count: number }
interface Violation {
  id: string; subject: string; account: string; site: string; action: string;
  risk: number; categories: string; reason: string; source: string; created_at: string;
  client_ip?: string; device_label?: string; device_name?: string; timezone?: string;
  kind?: string; filename?: string;
}
interface Offender { subject: string; account: string; count: number; max_risk: number }
interface Overview {
  total_events: number; blocked: number; redacted: number; overrides: number;
  events_24h: number; active_installs: number; known_accounts: number; open_flags: number;
  by_site: CountBucket[]; by_category: CountBucket[]; by_kind?: CountBucket[]; series_24h: TimeBucket[];
  recent: Violation[]; top_offenders: Offender[]; _offline?: boolean;
}
  
const SITE_LABEL: Record<string, string> = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', perplexity: 'Perplexity' };
const CAT_LABEL: Record<string, string> = {
  pii: 'PII', secret: 'Secrets', injection: 'Prompt Injection',
  toxicity: 'Toxicity', code_leak: 'Source Code', unverified: 'Unverified',
};
const ACTION_META: Record<string, { label: string; cls: string }> = {
  BROWSER_DLP_BLOCK:    { label: 'Blocked',  cls: 'text-red-400' },
  BROWSER_DLP_REDACT:   { label: 'Redacted', cls: 'text-yellow-400' },
  BROWSER_DLP_OVERRIDE: { label: 'Override', cls: 'text-orange-400' },
};
const riskColor = (s: number) => s >= 70 ? 'text-red-400' : s >= 40 ? 'text-orange-400' : 'text-yellow-400';
const rel = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.round(s/60)}m ago`;
  if (s < 86400) return `${Math.round(s/3600)}h ago`; return `${Math.round(s/86400)}d ago`;
};

function Stat({ icon, label, value, tone = 'text-base-text' }: {
  icon: ReactNode; label: string; value: number | string; tone?: string;
}) {
  return (
    <div className="border border-base-border rounded-xl px-4 py-3 bg-base-sec/40">
      <div className="flex items-center gap-2 text-base-muted mb-1">{icon}<span className="text-[11px] uppercase tracking-widest">{label}</span></div>
      <div className={`text-2xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

export default function BrowserDLPTab() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [settings, setSettings] = useState<GatewaySettings | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const load = useCallback(async () => {
    const d = await fetch('/api/admin/dlp/overview').then(r => r.json()).catch(() => null);
    if (d) { setOv(d); setLive(!d._offline); }
    else setLive(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => { void load(); });
    const id = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    fetchSettings().then(setSettings);
  }, []);

  const patchFleet = async (patch: Partial<GatewaySettings>) => {
    setSettings(s => s ? { ...s, ...patch } : s);
    setSaveState('saving');
    const updated = await saveSettings(patch);
    if (updated) {
      setSettings(updated);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } else {
      setSaveState('error');
    }
  };

  const o = ov;
  const maxSeries = Math.max(1, ...(o?.series_24h ?? []).map(b => b.count));
  const siteTotal = Math.max(1, (o?.by_site ?? []).reduce((a, b) => a + b.count, 0));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Globe size={20} className="text-blue-400"/> Browser DLP
          </h1>
          <p className="text-sm text-base-muted mt-1">
            Endpoint-side monitoring of the TITAN extension across ChatGPT, Claude &amp; Gemini. Everything blocked, redacted, or overridden in the browser — live. Refreshes every 4s.
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
          live ? 'text-green-400 border-green-400/30 bg-green-400/10' : 'text-base-muted border-base-border bg-base-sec'}`}>
          {live ? <Wifi size={12}/> : <WifiOff size={12}/>}{live ? 'Connected' : 'Gateway offline'}
        </span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat icon={<ShieldCheck size={13}/>} label="Events" value={o?.total_events ?? 0}/>
        <Stat icon={<Ban size={13}/>} label="Blocked" value={o?.blocked ?? 0} tone="text-red-400"/>
        <Stat icon={<Eye size={13}/>} label="Redacted" value={o?.redacted ?? 0} tone="text-yellow-400"/>
        <Stat icon={<AlertTriangle size={13}/>} label="Overrides" value={o?.overrides ?? 0} tone="text-orange-400"/>
        <Stat icon={<MonitorSmartphone size={13}/>} label="Installs" value={o?.active_installs ?? 0} tone="text-blue-400"/>
        <Stat icon={<Flag size={13}/>} label="Open Flags" value={o?.open_flags ?? 0} tone={(o?.open_flags ?? 0) > 0 ? 'text-red-400' : 'text-green-400'}/>
      </div>

      <div className="border border-base-border rounded-xl p-4 bg-base-sec/30">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-base-muted">Fleet policy baseline</div>
            <p className="text-xs text-base-muted mt-1">Managed defaults for browser-extension deployments. Save once, then distribute through MDM or extension policy packaging.</p>
          </div>
          <span className={`text-xs ${saveState === 'saved' ? 'text-green-400' : saveState === 'error' ? 'text-red-400' : 'text-base-muted'}`}>
            {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Save failed' : ''}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-xs text-base-muted">
            Mode
            <select value={settings?.browser_dlp_mode ?? 'block_redact'} disabled={!settings}
              onChange={e => patchFleet({ browser_dlp_mode: e.target.value as GatewaySettings['browser_dlp_mode'] })}
              className="mt-1 w-full px-3 py-2 bg-base-main border border-base-border rounded-lg text-sm text-base-text outline-none">
              <option value="block_redact">Block + redact</option>
              <option value="auto_redact">Auto-redact</option>
              <option value="warn">Warn only</option>
            </select>
          </label>
          <label className="text-xs text-base-muted">
            Max file MB
            <input type="number" min={1} max={100} value={settings?.browser_dlp_max_file_mb ?? 10} disabled={!settings}
              onChange={e => patchFleet({ browser_dlp_max_file_mb: Number(e.target.value) })}
              className="mt-1 w-full px-3 py-2 bg-base-main border border-base-border rounded-lg text-sm text-base-text outline-none"/>
          </label>
          {[
            ['browser_dlp_enabled', 'Enabled'],
            ['browser_dlp_strict', 'Strict fail-closed'],
            ['browser_dlp_scan_paste', 'Scan paste'],
            ['browser_dlp_scan_files', 'Scan files'],
          ].map(([key, label]) => (
            <button key={key} disabled={!settings}
              onClick={() => patchFleet({ [key]: !settings?.[key as keyof GatewaySettings] } as Partial<GatewaySettings>)}
              className={`px-3 py-2 rounded-lg border text-sm text-left ${settings?.[key as keyof GatewaySettings] ? 'border-green-400/30 bg-green-400/10 text-green-400' : 'border-base-border bg-base-main text-base-muted'} disabled:opacity-50`}>
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(SITE_LABEL).map(([key, label]) => (
            <button key={key} disabled={!settings}
              onClick={() => patchFleet({ browser_dlp_sites: { ...(settings?.browser_dlp_sites ?? {}), [key]: !(settings?.browser_dlp_sites ?? {})[key] } })}
              className={`px-3 py-1.5 rounded-lg border text-xs ${settings?.browser_dlp_sites?.[key] ? 'border-blue-400/30 bg-blue-400/10 text-blue-400' : 'border-base-border text-base-muted'} disabled:opacity-50`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 24h activity */}
        <div className="lg:col-span-2 border border-base-border rounded-xl p-4 bg-base-sec/30">
          <div className="text-[11px] uppercase tracking-widest text-base-muted mb-3">Activity — last 24h ({o?.events_24h ?? 0})</div>
          <div className="flex items-end gap-1 h-28">
            {(o?.series_24h ?? []).length === 0 ? (
              <div className="text-xs text-base-muted self-center mx-auto">No activity in the last 24h.</div>
            ) : (o?.series_24h ?? []).map((b, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end group" title={`${b.count} at ${new Date(b.hour).toLocaleTimeString([], { hour: '2-digit' })}`}>
                <div className="w-full rounded-t bg-blue-400/70 group-hover:bg-blue-400 transition-colors"
                  style={{ height: `${(b.count / maxSeries) * 100}%`, minHeight: b.count > 0 ? '3px' : '0' }}/>
              </div>
            ))}
          </div>
        </div>

        {/* By site */}
        <div className="border border-base-border rounded-xl p-4 bg-base-sec/30">
          <div className="text-[11px] uppercase tracking-widest text-base-muted mb-3">By site</div>
          {(o?.by_site ?? []).length === 0 ? <div className="text-xs text-base-muted">No data yet.</div> :
            <div className="space-y-2.5">
              {(o?.by_site ?? []).map(s => (
                <div key={s.key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-base-text">{SITE_LABEL[s.key] ?? s.key}</span>
                    <span className="text-base-muted">{s.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-base-border overflow-hidden">
                    <div className="h-full bg-blue-400 rounded-full" style={{ width: `${(s.count / siteTotal) * 100}%` }}/>
                  </div>
                </div>
              ))}
            </div>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Categories */}
        <div className="lg:col-span-2 border border-base-border rounded-xl p-4 bg-base-sec/30">
          <div className="text-[11px] uppercase tracking-widest text-base-muted mb-3">What was caught</div>
          {(o?.by_category ?? []).length === 0 ? <div className="text-xs text-base-muted">Nothing caught yet.</div> :
            <div className="flex flex-wrap gap-2">
              {(o?.by_category ?? []).map(c => (
                <span key={c.key} className="text-xs px-3 py-1.5 rounded-lg border border-base-border bg-base-main/40 text-base-text">
                  {CAT_LABEL[c.key] ?? c.key} <span className="text-base-muted ml-1 font-semibold">{c.count}</span>
                </span>
              ))}
            </div>}
        </div>

        {/* By type (prompt / file / image) */}
        <div className="border border-base-border rounded-xl p-4 bg-base-sec/30">
          <div className="text-[11px] uppercase tracking-widest text-base-muted mb-3">By type</div>
          {(o?.by_kind ?? []).length === 0 ? <div className="text-xs text-base-muted">No data yet.</div> :
            <div className="space-y-2">
              {(o?.by_kind ?? []).map(k => {
                const m = KIND_META[k.key] ?? { label: k.key, icon: <FileText size={11} /> };
                return (
                  <div key={k.key} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-base-text">{m.icon}{m.label}</span>
                    <span className="text-base-muted font-semibold">{k.count}</span>
                  </div>
                );
              })}
            </div>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Live feed */}
        <div className="lg:col-span-2 border border-base-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-base-border flex items-center gap-2 bg-base-sec/40">
            <CircleDot size={13} className={live ? 'text-green-400 animate-pulse' : 'text-base-muted'}/>
            <span className="text-[11px] uppercase tracking-widest text-base-muted">Live browser events</span>
          </div>
          {loading ? <div className="py-12 text-center text-sm text-base-muted">Loading…</div> :
            (o?.recent ?? []).length === 0 ? (
              <div className="py-12 text-center text-base-muted">
                <Globe size={26} className="mx-auto mb-2 opacity-30"/>
                <p className="text-sm">No browser events yet.</p>
                <p className="text-xs mt-1">Load the extension and type a secret into ChatGPT/Claude/Gemini.</p>
              </div>
            ) : (
              <div className="divide-y divide-base-border/30 max-h-[420px] overflow-auto">
                {(o?.recent ?? []).map((v, idx) => {
                  const m = ACTION_META[v.action] ?? { label: v.action, cls: 'text-base-muted' };
                  return (
                    <motion.div key={v.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.015 }}
                      className="px-4 py-2 hover:bg-base-sec/30">
                      <div className="flex items-center gap-3 text-sm">
                        <span className={`text-[11px] font-semibold w-16 ${m.cls}`}>{m.label}</span>
                        <span className="text-base-text capitalize w-16">{SITE_LABEL[v.site] ?? v.site}</span>
                        {v.kind && v.kind !== 'text' && (
                          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-base-border bg-base-main/40 text-blue-400 whitespace-nowrap">
                            {(KIND_META[v.kind] ?? KIND_META.file).icon}{(KIND_META[v.kind] ?? { label: v.kind }).label}
                          </span>
                        )}
                        <span className={`text-xs font-semibold w-8 ${riskColor(v.risk)}`}>{v.risk.toFixed(0)}</span>
                        <span className="text-xs text-base-muted truncate flex-1">{v.account || v.subject.slice(0, 14)} · {v.filename ? `${v.filename} · ` : ''}{v.reason}</span>
                        <span className="text-[11px] text-base-muted/70 whitespace-nowrap">{rel(v.created_at)}</span>
                      </div>
                      {(v.client_ip || v.device_name || v.device_label) && (
                        <div className="flex flex-wrap gap-x-3 text-[10px] text-base-muted/70 mt-0.5 pl-[64px]">
                          {v.client_ip && <span className="font-mono">🌐 {v.client_ip}</span>}
                          {(v.device_name || v.device_label) && <span>💻 {v.device_name || v.device_label}</span>}
                          {v.timezone && <span>🕓 {v.timezone}</span>}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
        </div>

        {/* Top offenders */}
        <div className="border border-base-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-base-border bg-base-sec/40">
            <span className="text-[11px] uppercase tracking-widest text-base-muted">Top offenders</span>
          </div>
          {(o?.top_offenders ?? []).length === 0 ? (
            <div className="py-10 text-center text-xs text-base-muted">No offenders yet.</div>
          ) : (
            <div className="divide-y divide-base-border/30">
              {(o?.top_offenders ?? []).map(t => (
                <div key={t.subject} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="text-base-text truncate text-[13px]">{t.account || <span className="italic text-base-muted">unknown</span>}</div>
                    <div className="text-[10px] text-base-muted font-mono truncate">{t.subject}</div>
                  </div>
                  <span className={`text-xs font-semibold ${riskColor(t.max_risk)}`}>{t.max_risk.toFixed(0)}</span>
                  <span className="text-sm font-semibold text-red-400 w-6 text-right">{t.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
