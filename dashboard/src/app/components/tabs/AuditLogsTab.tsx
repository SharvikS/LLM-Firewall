'use client';

import { useState } from 'react';
import { Download, Search, Filter } from 'lucide-react';

const SAMPLE_LOGS = Array.from({ length: 40 }, (_, i) => {
  const actions = ['ALLOWED','ML_BLOCKED','PII_MASKED','RATE_LIMITED','CEDAR_BLOCKED','CACHE_HIT'];
  const tenants  = ['acme_prod','acme_stg','dev_sharvik','ci_legacy'];
  const paths    = ['/v1/chat/completions','/v1/embeddings','/v1/completions'];
  const action   = actions[Math.floor(Math.random() * actions.length)];
  const riskScore = action === 'ML_BLOCKED' ? 75 + Math.random() * 25 : Math.random() * 40;
  const ts = new Date(Date.now() - i * 90_000 - Math.random() * 60_000);
  return {
    id: `req-${(0xFFFFFF - i * 17).toString(16).toUpperCase()}`,
    tenant: tenants[Math.floor(Math.random() * tenants.length)],
    action, riskScore, path: paths[Math.floor(Math.random() * paths.length)],
    latencyMs: Math.floor(Math.random() * 300 + 20),
    ts: ts.toISOString(),
  };
});

const ACTION_COLOR: Record<string, string> = {
  ALLOWED: 'text-green-400', ML_BLOCKED: 'text-red-400', PII_MASKED: 'text-blue-400',
  RATE_LIMITED: 'text-yellow-400', CEDAR_BLOCKED: 'text-orange-400', CACHE_HIT: 'text-purple-400',
};

export default function AuditLogsTab() {
  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState('ALL');

  const visible = SAMPLE_LOGS.filter(l => {
    const matchA = filterAction === 'ALL' || l.action === filterAction;
    const matchS = !search || l.id.toLowerCase().includes(search.toLowerCase()) || l.tenant.includes(search);
    return matchA && matchS;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit Logs</h1>
          <p className="text-sm text-base-muted mt-1">
            Immutable request audit trail written to Kafka.
            <span className="ml-2 px-1.5 py-0.5 bg-yellow-500/10 text-yellow-500 text-[10px] rounded font-semibold">Demo data</span>
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 border border-base-border rounded-lg text-sm text-base-muted hover:text-base-text hover:bg-base-sec transition-colors">
          <Download size={13}/> Export CSV
        </button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-base-muted"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Request ID or tenant…"
            className="pl-8 pr-3 py-2 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 transition-colors w-56"/>
        </div>
        <select value={filterAction} onChange={e => setFilterAction(e.target.value)}
          className="px-3 py-2 bg-base-sec border border-base-border rounded-lg text-sm text-base-text outline-none focus:border-base-muted/60 transition-colors">
          {['ALL','ALLOWED','ML_BLOCKED','PII_MASKED','RATE_LIMITED','CEDAR_BLOCKED','CACHE_HIT'].map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      <div className="border border-base-border rounded-xl overflow-hidden shadow-sm">
        <div className="grid grid-cols-[120px_1fr_140px_100px_80px_90px_90px] text-[11px] font-semibold text-base-muted uppercase tracking-widest bg-base-sec/50 border-b border-base-border">
          {['Request ID','Path','Tenant','Action','Risk','Latency','Time'].map(h => <div key={h} className="px-4 py-3">{h}</div>)}
        </div>
        <div className="divide-y divide-base-border/40 max-h-[480px] overflow-y-auto scrollbar-hide">
          {visible.map(l => (
            <div key={l.id} className="grid grid-cols-[120px_1fr_140px_100px_80px_90px_90px] hover:bg-base-sec/30 transition-colors text-sm">
              <div className="px-4 py-3 font-mono text-[11px] text-base-muted">{l.id}</div>
              <div className="px-4 py-3 text-[11px] text-base-muted truncate">{l.path}</div>
              <div className="px-4 py-3 text-[11px] font-mono text-base-text">{l.tenant}</div>
              <div className={`px-4 py-3 text-[11px] font-semibold ${ACTION_COLOR[l.action] ?? 'text-base-muted'}`}>{l.action}</div>
              <div className={`px-4 py-3 text-[11px] font-semibold ${l.riskScore >= 70 ? 'text-red-400' : l.riskScore >= 40 ? 'text-orange-400' : 'text-green-400'}`}>{l.riskScore.toFixed(1)}</div>
              <div className="px-4 py-3 text-[11px] text-base-muted">{l.latencyMs}ms</div>
              <div className="px-4 py-3 text-[11px] text-base-muted">{new Date(l.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-base-muted text-right">{visible.length} records</p>
    </div>
  );
}
