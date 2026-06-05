'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, Eye, Zap, CheckCircle, Filter, Search } from 'lucide-react';

interface Event {
  event_id: string; request_id: string; tenant_id: string; action: string;
  risk_score: number; latency_ms: number; timestamp: string;
  reason?: string; path?: string;
}

const ACTION_META: Record<string, { label: string; color: string; bg: string }> = {
  ML_BLOCKED:    { label: 'ML Blocked',   color: 'text-red-400',    bg: 'bg-red-400/10' },
  CEDAR_BLOCKED: { label: 'Policy Block', color: 'text-orange-400', bg: 'bg-orange-400/10' },
  RATE_LIMITED:  { label: 'Rate Limited', color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  PII_MASKED:    { label: 'PII Masked',   color: 'text-blue-400',  bg: 'bg-blue-400/10' },
  CACHE_HIT:     { label: 'Cache Hit',    color: 'text-purple-400',bg: 'bg-purple-400/10' },
  ALLOWED:       { label: 'Allowed',      color: 'text-green-400', bg: 'bg-green-400/10' },
};

const RISK_COLOR = (score: number) => {
  if (score >= 70) return 'text-red-400';
  if (score >= 40) return 'text-orange-400';
  if (score >= 20) return 'text-yellow-400';
  return 'text-green-400';
};

export default function EventsTab() {
  const [events, setEvents] = useState<Event[]>([]);
  const [filter, setFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    const res = await fetch('/api/gateway/events?n=200').catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setEvents(data.events ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEvents();
    const id = setInterval(fetchEvents, 5000);
    return () => clearInterval(id);
  }, [fetchEvents]);

  const filters = ['ALL', 'ML_BLOCKED', 'PII_MASKED', 'RATE_LIMITED', 'CEDAR_BLOCKED', 'CACHE_HIT', 'ALLOWED'];

  const visible = events.filter(e => {
    const matchFilter = filter === 'ALL' || e.action === filter;
    const matchSearch = !search || e.request_id.includes(search) || (e.path ?? '').includes(search) || (e.reason ?? '').toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Events & Logs</h1>
        <p className="text-sm text-base-muted mt-1">Real-time request events from the gateway. Refreshes every 5s.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-base-muted"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search path, request ID…"
            className="w-full pl-8 pr-3 py-2 bg-base-sec border border-base-border rounded-lg text-sm text-base-text placeholder-base-muted outline-none focus:border-base-muted/60 transition-colors"/>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map(f => {
            const meta = ACTION_META[f];
            const active = filter === f;
            return (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  active
                    ? 'bg-base-text text-base-main border-base-text shadow-sm'
                    : 'bg-base-sec border-base-border text-base-muted hover:text-base-text'
                }`}
              >
                {meta?.label ?? 'All'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="border border-base-border rounded-xl overflow-hidden shadow-sm">
        <div className="grid grid-cols-[auto_1fr_120px_100px_80px_100px] gap-0 text-[11px] font-semibold text-base-muted uppercase tracking-widest bg-base-sec/50 border-b border-base-border">
          {['Action', 'Request ID / Path', 'Tenant', 'Risk', 'Latency', 'Time'].map(h => (
            <div key={h} className="px-4 py-3">{h}</div>
          ))}
        </div>

        {loading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="grid grid-cols-[auto_1fr_120px_100px_80px_100px] border-b border-base-border/50 animate-pulse">
              <div className="px-4 py-3"><div className="h-5 w-24 bg-base-sec rounded"/></div>
              <div className="px-4 py-3"><div className="h-4 w-48 bg-base-sec rounded"/></div>
              <div className="px-4 py-3"><div className="h-4 w-20 bg-base-sec rounded"/></div>
              <div className="px-4 py-3"><div className="h-4 w-12 bg-base-sec rounded"/></div>
              <div className="px-4 py-3"><div className="h-4 w-12 bg-base-sec rounded"/></div>
              <div className="px-4 py-3"><div className="h-4 w-16 bg-base-sec rounded"/></div>
            </div>
          ))
        ) : visible.length === 0 ? (
          <div className="py-16 text-center text-base-muted">
            <CheckCircle size={28} className="mx-auto mb-3 opacity-30"/>
            <p className="text-sm">No events match your filters.</p>
            {events.length === 0 && <p className="text-xs mt-1">Send requests through the gateway at <code className="bg-base-sec px-1 rounded">localhost:8080</code></p>}
          </div>
        ) : visible.map((ev, idx) => {
          const meta = ACTION_META[ev.action] ?? ACTION_META['ALLOWED'];
          return (
            <motion.div key={ev.event_id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.02 }}
              className="grid grid-cols-[auto_1fr_120px_100px_80px_100px] border-b border-base-border/30 hover:bg-base-sec/30 transition-colors text-sm"
            >
              <div className="px-4 py-3 flex items-center">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${meta.bg} ${meta.color}`}>{meta.label}</span>
              </div>
              <div className="px-4 py-3 min-w-0">
                <div className="text-[11px] font-mono text-base-text truncate">{ev.request_id.slice(0, 28)}</div>
                <div className="text-[11px] text-base-muted truncate">{ev.path ?? '/'}{ev.reason ? ` · ${ev.reason}` : ''}</div>
              </div>
              <div className="px-4 py-3 text-xs text-base-muted font-mono truncate">{ev.tenant_id}</div>
              <div className={`px-4 py-3 text-xs font-semibold ${RISK_COLOR(ev.risk_score)}`}>{ev.risk_score.toFixed(1)}</div>
              <div className="px-4 py-3 text-xs text-base-muted">{ev.latency_ms > 0 ? `${ev.latency_ms}ms` : '—'}</div>
              <div className="px-4 py-3 text-[11px] text-base-muted">
                {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            </motion.div>
          );
        })}
      </div>
      <p className="text-xs text-base-muted text-right">{visible.length} of {events.length} events</p>
    </div>
  );
}
