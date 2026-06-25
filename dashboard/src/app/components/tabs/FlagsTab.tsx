'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Flag, ShieldAlert, CheckCircle, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';

interface DLPFlag {
  id: string; subject: string; account: string; violation_count: number;
  max_risk: number; last_site: string; last_reason: string; status: string;
  first_flagged: string; last_violation: string; acknowledged_by?: string;
  last_ip?: string; last_device?: string;
}
interface DLPViolation {
  id: string; site: string; action: string; risk: number;
  categories: string; reason: string; source: string; created_at: string;
  client_ip?: string; device_label?: string; device_name?: string;
  user_agent?: string; timezone?: string; screen?: string; languages?: string;
}
interface Summary {
  open_flags: number; total_flags: number; total_violations: number;
  violations_24h: number; top_risk: number;
}

const ACTION_LABEL: Record<string, string> = {
  BROWSER_DLP_BLOCK: 'Blocked', BROWSER_DLP_REDACT: 'Redacted', BROWSER_DLP_OVERRIDE: 'Override',
};
const riskColor = (s: number) => s >= 70 ? 'text-red-400' : s >= 40 ? 'text-orange-400' : 'text-yellow-400';
const rel = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.round(s/60)}m ago`;
  if (s < 86400) return `${Math.round(s/3600)}h ago`; return `${Math.round(s/86400)}d ago`;
};

export default function FlagsTab() {
  const [flags, setFlags] = useState<DLPFlag[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<'open' | 'acknowledged' | ''>('open');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [violations, setViolations] = useState<Record<string, DLPViolation[]>>({});

  const load = useCallback(async () => {
    const [f, s] = await Promise.all([
      fetch(`/api/admin/dlp/flags?status=${filter}`).then(r => r.json()).catch(() => ({ flags: [] })),
      fetch('/api/admin/dlp/summary').then(r => r.json()).catch(() => null),
    ]);
    setFlags(f.flags ?? []);
    setSummary(s);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    queueMicrotask(() => { void load(); });
    const id = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const toggle = async (subject: string) => {
    if (expanded === subject) { setExpanded(null); return; }
    setExpanded(subject);
    if (!violations[subject]) {
      const data = await fetch(`/api/admin/dlp/violations?subject=${encodeURIComponent(subject)}`)
        .then(r => r.json()).catch(() => ({ violations: [] }));
      setViolations(v => ({ ...v, [subject]: data.violations ?? [] }));
    }
  };

  const ack = async (id: string) => {
    await fetch(`/api/admin/dlp/flags/${id}/ack`, { method: 'POST' }).catch(() => null);
    void load();
  };

  const stat = (label: string, value: number | string, tone = 'text-base-text') => (
    <div className="border border-base-border rounded-xl px-4 py-3 bg-base-sec/40">
      <div className={`text-2xl font-semibold ${tone}`}>{value}</div>
      <div className="text-[11px] text-base-muted uppercase tracking-widest mt-1">{label}</div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Flag size={20} className="text-red-400"/> DLP Flags
        </h1>
        <p className="text-sm text-base-muted mt-1">
          Repeat offenders who tried to push sensitive data into ChatGPT / Claude / Gemini. Flagged automatically past the violation threshold. Refreshes every 5s.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {stat('Open Flags', summary?.open_flags ?? 0, (summary?.open_flags ?? 0) > 0 ? 'text-red-400' : 'text-green-400')}
        {stat('Total Flags', summary?.total_flags ?? 0)}
        {stat('Violations', summary?.total_violations ?? 0)}
        {stat('Last 24h', summary?.violations_24h ?? 0, (summary?.violations_24h ?? 0) > 0 ? 'text-orange-400' : 'text-base-text')}
        {stat('Top Risk', (summary?.top_risk ?? 0).toFixed(0), riskColor(summary?.top_risk ?? 0))}
      </div>

      {/* Filter */}
      <div className="flex gap-1.5">
        {([['open', 'Open'], ['acknowledged', 'Acknowledged'], ['', 'All']] as const).map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              filter === v ? 'bg-base-text text-base-main border-base-text' : 'bg-base-sec border-base-border text-base-muted hover:text-base-text'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Flags list */}
      <div className="border border-base-border rounded-xl overflow-hidden shadow-sm">
        <div className="grid grid-cols-[1fr_90px_90px_110px_140px] text-[11px] font-semibold text-base-muted uppercase tracking-widest bg-base-sec/50 border-b border-base-border">
          {['Subject / Account', 'Violations', 'Max Risk', 'Last Seen', 'Action'].map(h => <div key={h} className="px-4 py-3">{h}</div>)}
        </div>

        {loading ? (
          <div className="py-16 text-center text-base-muted text-sm">Loading…</div>
        ) : flags.length === 0 ? (
          <div className="py-16 text-center text-base-muted">
            <CheckCircle size={28} className="mx-auto mb-3 opacity-30"/>
            <p className="text-sm">No {filter || ''} flags. {filter === 'open' && 'No repeat offenders right now.'}</p>
          </div>
        ) : flags.map((f, idx) => (
          <div key={f.id} className="border-b border-base-border/30">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.02 }}
              className="grid grid-cols-[1fr_90px_90px_110px_140px] items-center hover:bg-base-sec/30 transition-colors text-sm cursor-pointer"
              onClick={() => toggle(f.subject)}>
              <div className="px-4 py-3 min-w-0 flex items-center gap-2">
                {expanded === f.subject ? <ChevronDown size={14} className="text-base-muted shrink-0"/> : <ChevronRight size={14} className="text-base-muted shrink-0"/>}
                <ShieldAlert size={14} className="text-red-400 shrink-0"/>
                <div className="min-w-0">
                  <div className="text-base-text truncate">{f.account || <span className="text-base-muted italic">unknown account</span>}</div>
                  <div className="text-[11px] text-base-muted font-mono truncate">{f.subject}</div>
                  {(f.last_device || f.last_ip) && (
                    <div className="text-[10px] text-base-muted/80 truncate mt-0.5">
                      {f.last_device}{f.last_device && f.last_ip ? ' · ' : ''}{f.last_ip && <span className="font-mono">{f.last_ip}</span>}
                    </div>
                  )}
                </div>
              </div>
              <div className="px-4 py-3"><span className="text-red-400 font-semibold">{f.violation_count}</span></div>
              <div className={`px-4 py-3 font-semibold ${riskColor(f.max_risk)}`}>{f.max_risk.toFixed(0)}</div>
              <div className="px-4 py-3 text-[11px] text-base-muted">{rel(f.last_violation)}</div>
              <div className="px-4 py-3">
                {f.status === 'open' ? (
                  <button onClick={(e) => { e.stopPropagation(); ack(f.id); }}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-base-text text-base-main font-medium hover:opacity-90">
                    Acknowledge
                  </button>
                ) : (
                  <span className="text-[11px] text-green-400 flex items-center gap-1"><CheckCircle size={12}/> ack&apos;d</span>
                )}
              </div>
            </motion.div>

            {expanded === f.subject && (
              <div className="bg-base-main/40 px-6 py-3 border-t border-base-border/30">
                <div className="text-[11px] text-base-muted uppercase tracking-widest mb-2">Recent violations</div>
                {(violations[f.subject] ?? []).length === 0 ? (
                  <div className="text-xs text-base-muted py-2">Loading history…</div>
                ) : (
                  <div className="space-y-2">
                    {(violations[f.subject] ?? []).map(v => (
                      <div key={v.id} className="border-l-2 border-base-border pl-2.5">
                        <div className="flex items-center gap-3 text-xs">
                          <AlertTriangle size={12} className={riskColor(v.risk)}/>
                          <span className="text-base-text capitalize w-16">{v.site}</span>
                          <span className="text-base-muted w-20">{ACTION_LABEL[v.action] ?? v.action}</span>
                          <span className={`${riskColor(v.risk)} w-10`}>{v.risk.toFixed(0)}</span>
                          <span className="text-base-muted truncate flex-1">{v.reason}</span>
                          <span className="text-base-muted/60 whitespace-nowrap">{rel(v.created_at)}</span>
                        </div>
                        {(v.client_ip || v.device_name || v.device_label) && (
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-base-muted/80 mt-1 pl-[24px]">
                            {v.client_ip && <span>🌐 <span className="font-mono text-base-muted">{v.client_ip}</span></span>}
                            {(v.device_name || v.device_label) && <span>💻 {v.device_name || v.device_label}</span>}
                            {v.timezone && <span>🕓 {v.timezone}</span>}
                            {v.screen && <span>🖥 {v.screen}</span>}
                            {v.languages && <span>🗣 {v.languages}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
