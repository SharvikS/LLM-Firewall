'use client';

import { useState, useEffect, useCallback } from 'react';
import { Download, Search, RefreshCw } from 'lucide-react';

interface AuditEvent {
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
  created_at: string;
}

const ACTION_COLOR: Record<string, string> = {
  ALLOWED: 'text-green-400', ML_BLOCKED: 'text-red-400', PII_MASKED: 'text-blue-400',
  RATE_LIMITED: 'text-yellow-400', CEDAR_BLOCKED: 'text-orange-400', CACHE_HIT: 'text-purple-400',
};

export default function AuditLogsTab() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [search, setSearch]   = useState('');
  const [filterAction, setFilter] = useState('ALL');
  const [page, setPage]       = useState(0);
  const limit = 50;

  const fetchAudit = useCallback(async () => {
    const qs = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
    const res = await fetch(`/api/admin/audit?${qs}`).catch(() => null);
    if (!res?.ok) { setOffline(true); setLoading(false); return; }
    const data = await res.json();
    setEvents(data.events ?? []);
    setTotal(data.total ?? 0);
    setOffline(!!data._offline);
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchAudit(); }, [fetchAudit]);

  const visible = events.filter(e => {
    const matchA = filterAction === 'ALL' || e.action === filterAction;
    const matchS = !search
      || (e.request_id ?? '').includes(search)
      || (e.path ?? '').includes(search)
      || (e.reason ?? '').toLowerCase().includes(search.toLowerCase());
    return matchA && matchS;
  });

  const exportCSV = () => {
    const header = 'request_id,action,risk_score,path,latency_ms,status_code,reason,created_at\n';
    const rows   = events.map(e =>
      [e.request_id, e.action, e.risk_score ?? '', e.path ?? '', e.latency_ms ?? '',
       e.status_code ?? '', (e.reason ?? '').replace(/,/g, ' '), e.created_at].join(',')
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'titan-audit.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit Logs</h1>
          <p className="text-sm text-base-muted mt-1">
            {offline
              ? <span className="text-yellow-500 font-medium">Gateway offline — showing cached data</span>
              : <>{total.toLocaleString()} total events in database</>
            }
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchAudit} className="flex items-center gap-2 px-3 py-1.5 border border-base-border rounded-lg text-xs text-base-muted hover:text-base-text hover:bg-base-sec transition-colors">
            <RefreshCw size={12}/> Refresh
          </button>
          <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 border border-base-border rounded-lg text-sm text-base-muted hover:text-base-text hover:bg-base-sec transition-colors">
            <Download size={13}/> Export CSV
          </button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-base-muted"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Request ID, path, or reason…"
            className="pl-8 pr-3 py-2 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 transition-colors w-64"/>
        </div>
        <select value={filterAction} onChange={e => setFilter(e.target.value)}
          className="px-3 py-2 bg-base-sec border border-base-border rounded-lg text-sm text-base-text outline-none focus:border-base-muted/60 transition-colors">
          {['ALL','ALLOWED','ML_BLOCKED','PII_MASKED','RATE_LIMITED','CEDAR_BLOCKED','CACHE_HIT'].map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      <div className="border border-base-border rounded-xl overflow-hidden shadow-sm">
        <div className="grid grid-cols-[120px_1fr_140px_120px_80px_90px_90px] text-[11px] font-semibold text-base-muted uppercase tracking-widest bg-base-sec/50 border-b border-base-border">
          {['Request ID','Path / Reason','Tenant','Action','Risk','Latency','Time'].map(h => (
            <div key={h} className="px-4 py-3">{h}</div>
          ))}
        </div>

        <div className="divide-y divide-base-border/40 max-h-[520px] overflow-y-auto scrollbar-hide">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[120px_1fr_140px_120px_80px_90px_90px] animate-pulse p-3 gap-4">
                {Array.from({ length: 7 }).map((_, j) => <div key={j} className="h-4 bg-base-sec rounded"/>)}
              </div>
            ))
          ) : visible.length === 0 ? (
            <div className="py-16 text-center text-base-muted">
              <p className="text-sm">{offline ? 'Gateway offline — cannot load audit logs.' : 'No audit events yet. Send requests through the gateway.'}</p>
              {!offline && <p className="text-xs mt-1 font-mono">curl -H &quot;Authorization: Bearer &lt;your-api-key&gt;&quot; &lt;gateway-url&gt;/v1/chat/completions</p>}
            </div>
          ) : visible.map(e => (
            <div key={e.id} className="grid grid-cols-[120px_1fr_140px_120px_80px_90px_90px] hover:bg-base-sec/30 transition-colors text-sm">
              <div className="px-4 py-3 font-mono text-[11px] text-base-muted truncate">{e.request_id?.slice(0, 16) ?? '—'}</div>
              <div className="px-4 py-3 min-w-0">
                <div className="text-[11px] text-base-muted truncate">{e.path ?? '/'}</div>
                {e.reason && <div className="text-[10px] text-base-muted/60 truncate">{e.reason}</div>}
              </div>
              <div className="px-4 py-3 text-[11px] font-mono text-base-muted truncate">{e.tenant_id?.slice(0, 8) ?? 'anon'}</div>
              <div className={`px-4 py-3 text-[11px] font-semibold ${ACTION_COLOR[e.action] ?? 'text-base-muted'}`}>{e.action}</div>
              <div className={`px-4 py-3 text-[11px] font-semibold ${(e.risk_score ?? 0) >= 70 ? 'text-red-400' : (e.risk_score ?? 0) >= 40 ? 'text-orange-400' : 'text-green-400'}`}>
                {e.risk_score != null ? e.risk_score.toFixed(1) : '—'}
              </div>
              <div className="px-4 py-3 text-[11px] text-base-muted">{e.latency_ms != null ? `${e.latency_ms}ms` : '—'}</div>
              <div className="px-4 py-3 text-[11px] text-base-muted">
                {new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-base-muted">
        <span>{visible.length} shown · {total} total in DB</span>
        <div className="flex gap-2">
          <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
            className="px-3 py-1.5 border border-base-border rounded-lg disabled:opacity-30 hover:bg-base-sec transition-colors">← Prev</button>
          <span className="px-3 py-1.5">Page {page + 1}</span>
          <button disabled={events.length < limit} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 border border-base-border rounded-lg disabled:opacity-30 hover:bg-base-sec transition-colors">Next →</button>
        </div>
      </div>
    </div>
  );
}
