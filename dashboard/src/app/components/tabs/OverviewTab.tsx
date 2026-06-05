'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldAlert, Eye, Zap, CheckCircle, RefreshCw,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer, BarChart, Bar,
} from 'recharts';

interface Metrics {
  total_requests: number; allowed_requests: number; blocked_requests: number;
  rate_limited: number; cache_hits: number; cache_misses: number;
  cache_hit_rate: number; ml_blocked: number; pii_masked: number;
  cedar_blocked: number; p99_latency_ms: number; avg_latency_ms: number;
  uptime_seconds: number; traffic_chart: { label: string; requests: number; blocked: number }[];
  _offline?: boolean;
}

interface Event {
  event_id: string; request_id: string; tenant_id: string; action: string;
  risk_score: number; latency_ms: number; timestamp: string;
  reason?: string; path?: string;
}

const ACTION_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  ML_BLOCKED:   { label: 'ML Blocked',   color: 'text-red-400',    bg: 'bg-red-400/10',    icon: <ShieldAlert size={13}/> },
  CEDAR_BLOCKED:{ label: 'Policy Block', color: 'text-orange-400', bg: 'bg-orange-400/10', icon: <ShieldAlert size={13}/> },
  RATE_LIMITED: { label: 'Rate Limited', color: 'text-yellow-400', bg: 'bg-yellow-400/10', icon: <Zap size={13}/> },
  PII_MASKED:   { label: 'PII Masked',   color: 'text-blue-400',  bg: 'bg-blue-400/10',   icon: <Eye size={13}/> },
  CACHE_HIT:    { label: 'Cache Hit',    color: 'text-purple-400',bg: 'bg-purple-400/10', icon: <CheckCircle size={13}/> },
  ALLOWED:      { label: 'Allowed',      color: 'text-green-400', bg: 'bg-green-400/10',  icon: <CheckCircle size={13}/> },
};

function kfmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function MetricCard({ title, value, sub, trend }: {
  title: string; value: string; sub: string; trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className="border border-base-border bg-base-card rounded-xl p-5 shadow-sm hover:border-base-muted/40 transition-colors">
      <div className="text-[12px] font-medium text-base-muted mb-3 uppercase tracking-widest">{title}</div>
      <div className="text-3xl font-semibold tracking-tight text-base-text">{value}</div>
      <div className="mt-2 flex items-center gap-2">
        {trend === 'up'      && <TrendingUp  size={12} className="text-green-400"/>}
        {trend === 'down'    && <TrendingDown size={12} className="text-red-400"/>}
        {trend === 'neutral' && <Minus        size={12} className="text-base-muted"/>}
        <span className="text-xs text-base-muted">{sub}</span>
      </div>
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-base-sec rounded-lg ${className}`}/>;
}

export default function OverviewTab() {
  const [metrics, setMetrics]   = useState<Metrics | null>(null);
  const [events, setEvents]     = useState<Event[]>([]);
  const [loading, setLoading]   = useState(true);
  const [lastRefresh, setLast]  = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    const [mRes, eRes] = await Promise.all([
      fetch('/api/gateway/metrics').then(r => r.json()).catch(() => null),
      fetch('/api/gateway/events?n=20').then(r => r.json()).catch(() => ({ events: [] })),
    ]);
    if (mRes) setMetrics(mRes);
    setEvents(eRes?.events ?? []);
    setLoading(false);
    setLast(new Date());
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [fetchData]);

  const chartData = metrics?.traffic_chart?.filter(p => p.requests > 0 || p.blocked > 0) ?? [];
  // Pad with demo data if gateway just started and has no history
  const chartDisplay = chartData.length > 2 ? chartData :
    Array.from({ length: 24 }, (_, i) => ({
      label: `${i}:00`,
      requests: Math.floor(Math.sin(i / 3) * 800 + 1200 + Math.random() * 400),
      blocked:  Math.floor(Math.cos(i / 4) * 60  + 80  + Math.random() * 30),
    }));

  const isDemo = chartData.length <= 2;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-base-muted mt-1">
            Live gateway telemetry.
            {metrics?._offline && <span className="ml-2 text-yellow-500 font-medium">Gateway offline</span>}
            {lastRefresh && !metrics?._offline && (
              <span className="ml-2 opacity-60">Updated {lastRefresh.toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-3 py-1.5 border border-base-border rounded-lg text-xs text-base-muted hover:text-base-text hover:bg-base-sec transition-colors">
          <RefreshCw size={12}/> Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32"/>)
        ) : (<>
          <MetricCard title="Total Requests"  value={kfmt(metrics?.total_requests ?? 0)}    sub="since startup"         trend="neutral"/>
          <MetricCard title="Threats Blocked" value={kfmt(metrics?.blocked_requests ?? 0)}  sub={`${metrics?.ml_blocked ?? 0} ML · ${metrics?.cedar_blocked ?? 0} policy`} trend="down"/>
          <MetricCard title="Cache Hit Rate"  value={`${(metrics?.cache_hit_rate ?? 0).toFixed(1)}%`} sub={`${kfmt(metrics?.cache_hits ?? 0)} hits saved`} trend="up"/>
          <MetricCard title="P99 Latency"     value={`${metrics?.p99_latency_ms ?? 0}ms`}   sub={`avg ${(metrics?.avg_latency_ms ?? 0).toFixed(0)}ms`} trend="neutral"/>
        </>)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Traffic Chart */}
        <div className="lg:col-span-2 border border-base-border bg-base-card rounded-xl p-6 shadow-sm flex flex-col h-[360px]">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-sm font-semibold">Traffic & Interceptions</h3>
              {isDemo && <span className="text-[10px] text-yellow-500/80 font-medium">Demo data — send requests to populate</span>}
            </div>
            <div className="flex items-center gap-4 text-xs text-base-muted">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-base-accent inline-block"/>Requests</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"/>Blocked</span>
            </div>
          </div>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartDisplay} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gReq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.2}/>
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gBlk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f87171" stopOpacity={0.2}/>
                    <stop offset="100%" stopColor="#f87171" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} opacity={0.4}/>
                <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} minTickGap={30}/>
                <YAxis stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => kfmt(v)}/>
                <RTooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-base-card border border-base-border p-3 rounded-lg shadow-xl text-xs">
                      <div className="text-base-muted mb-1.5">{payload[0]?.payload?.label}</div>
                      <div className="flex justify-between gap-4"><span className="text-base-text">Requests</span><span className="font-semibold">{payload[0]?.value?.toLocaleString()}</span></div>
                      <div className="flex justify-between gap-4 mt-1"><span className="text-red-400">Blocked</span><span className="font-semibold">{payload[1]?.value?.toLocaleString()}</span></div>
                    </div>
                  );
                }} cursor={{ stroke: 'var(--text-muted)', strokeWidth: 1, strokeDasharray: '4 4' }}/>
                <Area type="monotone" dataKey="requests" stroke="var(--accent)" strokeWidth={2} fill="url(#gReq)"/>
                <Area type="monotone" dataKey="blocked"  stroke="#f87171"       strokeWidth={2} fill="url(#gBlk)"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Live Threat Feed */}
        <div className="border border-base-border bg-base-card rounded-xl flex flex-col h-[360px] overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-base-border flex justify-between items-center">
            <h3 className="text-sm font-semibold">Live Threat Feed</h3>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"/>
              <span className="text-[10px] text-base-muted">Live</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            {events.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-base-muted text-sm">
                <CheckCircle size={24} className="mb-2 opacity-30"/>
                <span>No recent events</span>
              </div>
            ) : (
              <ul>
                {events.filter(e => e.action !== 'ALLOWED').slice(0, 12).map(ev => {
                  const cfg = ACTION_CONFIG[ev.action] ?? ACTION_CONFIG['ALLOWED'];
                  return (
                    <motion.li key={ev.event_id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                      className="px-4 py-3 border-b border-base-border/50 hover:bg-base-sec/50 transition-colors cursor-default"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-1.5 rounded-md ${cfg.bg} ${cfg.color} shrink-0`}>{cfg.icon}</div>
                        <div className="min-w-0">
                          <div className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</div>
                          <div className="text-[11px] text-base-muted truncate">{ev.path ?? '/'} · {ev.reason ?? ev.tenant_id}</div>
                        </div>
                        <div className="ml-auto shrink-0 text-[10px] text-base-muted">
                          {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                      </div>
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="px-4 py-2.5 border-t border-base-border text-center">
            <span className="text-[11px] text-base-muted">{events.length} events tracked this session</span>
          </div>
        </div>
      </div>

      {/* Secondary metrics row */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'PII Masked',    value: metrics.pii_masked,    color: 'text-blue-400' },
            { label: 'ML Blocked',    value: metrics.ml_blocked,    color: 'text-red-400' },
            { label: 'Rate Limited',  value: metrics.rate_limited,  color: 'text-yellow-400' },
            { label: 'Cache Misses',  value: metrics.cache_misses,  color: 'text-base-muted' },
          ].map(({ label, value, color }) => (
            <div key={label} className="border border-base-border bg-base-card rounded-xl p-4 shadow-sm">
              <div className="text-[11px] text-base-muted uppercase tracking-widest mb-2">{label}</div>
              <div className={`text-2xl font-semibold ${color}`}>{kfmt(value)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
