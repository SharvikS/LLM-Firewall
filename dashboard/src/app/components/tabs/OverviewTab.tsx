'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldAlert, Eye, Zap, CheckCircle, RefreshCw,
  TrendingUp, TrendingDown, Minus, Activity,
  Shield, Lock, Clock,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer,
} from 'recharts';

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Constants ───────────────────────────────────────────────────────────────

const ACTION_CONFIG: Record<string, { label: string; color: string; dot: string; icon: React.ReactNode }> = {
  ML_BLOCKED:    { label: 'ML Blocked',    color: '#f87171', dot: '#f87171', icon: <ShieldAlert size={12}/> },
  CEDAR_BLOCKED: { label: 'Policy Block',  color: '#fb923c', dot: '#fb923c', icon: <Lock size={12}/> },
  RATE_LIMITED:  { label: 'Rate Limited',  color: '#facc15', dot: '#facc15', icon: <Zap size={12}/> },
  PII_MASKED:    { label: 'PII Masked',    color: '#60a5fa', dot: '#60a5fa', icon: <Eye size={12}/> },
  CACHE_HIT:     { label: 'Cache Hit',     color: '#a78bfa', dot: '#a78bfa', icon: <CheckCircle size={12}/> },
  ALLOWED:       { label: 'Allowed',       color: '#4ade80', dot: '#4ade80', icon: <CheckCircle size={12}/> },
};

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useCounter(target: number, duration = 700) {
  const [val, setVal] = useState(0);
  const prevRef = useRef(0);
  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = target;
    if (from === target) return;
    let raf: number;
    const start = Date.now();
    const tick = () => {
      const t = Math.min((Date.now() - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(from + (target - from) * ease));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function kfmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`skeleton rounded-xl ${className}`}/>;
}

// ─── Metric Card ─────────────────────────────────────────────────────────────

function MetricCard({ title, value, rawValue, sub, trend, accentColor }: {
  title: string; value: string; rawValue?: number; sub: string;
  trend?: 'up' | 'down' | 'neutral'; accentColor?: string;
}) {
  const animated = useCounter(rawValue ?? 0);
  const displayValue = rawValue !== undefined ? kfmt(animated) : value;
  const color = accentColor ?? 'var(--accent)';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-xl border p-4 group transition-all duration-200 cursor-default"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border-color)',
      }}
      whileHover={{ borderColor: `color-mix(in srgb, ${color} 30%, var(--border-color))` }}
    >
      {/* Gradient top line */}
      <div className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent 10%, ${color}60 50%, transparent 90%)` }}/>
      {/* Ambient bg glow */}
      <div className="absolute -top-8 -right-8 w-20 h-20 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-2xl"
        style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }}/>

      <div className="relative z-10">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] mb-2" style={{ color: 'var(--text-muted)' }}>
          {title}
        </div>
        <div className="text-[24px] font-bold tracking-tight leading-none mb-2 tnum" style={{ color: 'var(--text-main)' }}>
          {displayValue}
        </div>
        <div className="flex items-center gap-1.5">
          {trend === 'up'      && <TrendingUp  size={11} style={{ color: '#4ade80' }}/>}
          {trend === 'down'    && <TrendingDown size={11} style={{ color: '#f87171' }}/>}
          {trend === 'neutral' && <Minus        size={11} style={{ color: 'var(--text-muted)' }}/>}
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{sub}</span>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Custom Chart Tooltip ─────────────────────────────────────────────────────

function ChartTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null;
  const label = payload[0]?.payload?.label ?? '';
  const requests = payload[0]?.value ?? 0;
  const blocked  = payload[1]?.value ?? 0;
  const blockPct = requests > 0 ? ((blocked / requests) * 100).toFixed(1) : '0.0';
  return (
    <div className="rounded-xl shadow-2xl overflow-hidden text-xs"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', minWidth: 160 }}>
      <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider"
        style={{ background: 'var(--bg-sec)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
        {label}
      </div>
      <div className="px-3 py-2.5 space-y-1.5">
        <div className="flex justify-between items-center gap-6">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }}/>
            <span style={{ color: 'var(--text-muted)' }}>Requests</span>
          </div>
          <span className="font-semibold tabular-nums">{requests.toLocaleString()}</span>
        </div>
        <div className="flex justify-between items-center gap-6">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-400"/>
            <span style={{ color: 'var(--text-muted)' }}>Blocked</span>
          </div>
          <span className="font-semibold tabular-nums text-red-400">{blocked.toLocaleString()}</span>
        </div>
        <div className="pt-1.5 border-t flex justify-between" style={{ borderColor: 'var(--border-color)' }}>
          <span style={{ color: 'var(--text-muted)' }}>Block rate</span>
          <span className="font-semibold">{blockPct}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── Secondary Stat ───────────────────────────────────────────────────────────

function SecondaryStat({ label, value, color }: { label: string; value: number; color: string }) {
  const animated = useCounter(value);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}50` }}/>
        <span className="text-[11px] font-medium truncate" style={{ color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <span className="text-base font-bold tracking-tight tnum shrink-0" style={{ color }}>
        {kfmt(animated)}
      </span>
    </div>
  );
}

// ─── Threat Feed Item ─────────────────────────────────────────────────────────

function ThreatItem({ ev, index }: { ev: Event; index: number }) {
  const cfg = ACTION_CONFIG[ev.action] ?? ACTION_CONFIG['ALLOWED'];
  const time = new Date(ev.timestamp).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return (
    <motion.li
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
      className="relative px-4 py-3 transition-colors cursor-default group"
      style={{ borderBottom: '1px solid var(--border-color)' }}
    >
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
        style={{ background: 'var(--bg-sec)' }}/>
      <div className="relative flex items-center gap-3">
        {/* Color dot */}
        <div className="w-1.5 h-1.5 rounded-full shrink-0 live-dot"
          style={{ color: cfg.dot, background: cfg.dot, boxShadow: `0 0 6px ${cfg.dot}60` }}/>
        {/* Icon */}
        <div className="p-1.5 rounded-md shrink-0"
          style={{ background: `color-mix(in srgb, ${cfg.color} 10%, transparent)`, color: cfg.color }}>
          {cfg.icon}
        </div>
        {/* Text */}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold leading-tight" style={{ color: cfg.color }}>
            {cfg.label}
          </div>
          <div className="text-[10px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {ev.path ?? '/'} {ev.reason ? `· ${ev.reason}` : ''}
          </div>
        </div>
        {/* Time */}
        <div className="shrink-0 text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {time}
        </div>
      </div>
    </motion.li>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function OverviewTab() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [events, setEvents]   = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLast] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setTimeout(() => setRefreshing(false), 400);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [fetchData]);

  // Chart data
  const chartData = metrics?.traffic_chart?.filter(p => p.requests > 0 || p.blocked > 0) ?? [];
  const chartDisplay = chartData.length > 2 ? chartData :
    Array.from({ length: 24 }, (_, i) => ({
      label: `${i.toString().padStart(2, '0')}:00`,
      requests: Math.floor(Math.sin(i / 3) * 800 + 1200),
      blocked:  Math.floor(Math.cos(i / 4) * 60  + 80),
    }));
  const isDemo = chartData.length <= 2;

  const totalReq    = metrics?.total_requests    ?? 0;
  const blocked     = metrics?.blocked_requests  ?? 0;
  const hitRate     = metrics?.cache_hit_rate    ?? 0;
  const p99         = metrics?.p99_latency_ms    ?? 0;
  const avgLat      = metrics?.avg_latency_ms    ?? 0;
  const hits        = metrics?.cache_hits        ?? 0;
  const mlBlocked   = metrics?.ml_blocked        ?? 0;
  const cedarBlocked= metrics?.cedar_blocked     ?? 0;
  const piiMasked   = metrics?.pii_masked        ?? 0;
  const rateLimited = metrics?.rate_limited      ?? 0;
  const cacheMisses = metrics?.cache_misses      ?? 0;

  const threatEvents = events.filter(e => e.action !== 'ALLOWED').slice(0, 12);

  return (
    <div className="max-w-[1480px] mx-auto space-y-4">
      {/* Page header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Overview</h1>
          <p className="text-[13px] mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            Live gateway telemetry
            {metrics?._offline && (
              <span className="inline-flex items-center gap-1 text-yellow-500 font-medium text-xs px-2 py-0.5 rounded-md"
                style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)' }}>
                <Zap size={10}/> Gateway offline
              </span>
            )}
            {lastRefresh && !metrics?._offline && (
              <span className="text-[11px] opacity-50 tnum">· {lastRefresh.toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <button onClick={handleRefresh}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all hover:bg-white/[0.06]"
          style={{ border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''}/>
          Refresh
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[96px]"/>)
        ) : (
          <>
            <MetricCard title="Total Requests"  rawValue={totalReq}   value={kfmt(totalReq)}
              sub="since startup" trend="neutral" accentColor="var(--accent)"/>
            <MetricCard title="Threats Blocked" rawValue={blocked}    value={kfmt(blocked)}
              sub={`${mlBlocked} ML · ${cedarBlocked} policy`} trend="down" accentColor="#f87171"/>
            <MetricCard title="Cache Hit Rate"  value={`${hitRate.toFixed(1)}%`}
              sub={`${kfmt(hits)} hits saved`} trend="up" accentColor="#a78bfa"/>
            <MetricCard title="P99 Latency"     value={`${p99}ms`}
              sub={`avg ${avgLat.toFixed(0)}ms`} trend="neutral" accentColor="#60a5fa"/>
          </>
        )}
      </div>

      {/* Chart + Threat feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Traffic chart */}
        <div className="lg:col-span-2 relative overflow-hidden rounded-xl border flex flex-col h-[340px] xl:h-[400px] 2xl:h-[450px]"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
          {/* Top gradient line */}
          <div className="absolute top-0 left-0 right-0 h-px"
            style={{ background: 'linear-gradient(90deg, transparent 10%, var(--accent) 50%, transparent 90%)', opacity: 0.4 }}/>

          <div className="px-6 pt-5 pb-4 flex justify-between items-start shrink-0">
            <div>
              <h3 className="text-sm font-semibold">Traffic & Interceptions</h3>
              {isDemo && (
                <span className="text-[10px] font-medium" style={{ color: 'rgba(234,179,8,0.8)' }}>
                  Demo data — send requests to populate
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }}/>
                Requests
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-400"/>
                Blocked
              </span>
            </div>
          </div>

          <div className="flex-1 px-3 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartDisplay} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gReq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="var(--accent)" stopOpacity={0.25}/>
                    <stop offset="70%"  stopColor="var(--accent)" stopOpacity={0.05}/>
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gBlk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#f87171" stopOpacity={0.3}/>
                    <stop offset="70%"  stopColor="#f87171" stopOpacity={0.05}/>
                    <stop offset="100%" stopColor="#f87171" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} opacity={0.5}/>
                <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} minTickGap={32}/>
                <YAxis stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} tickFormatter={kfmt}/>
                <RTooltip content={<ChartTooltip/>}
                  cursor={{ stroke: 'var(--text-muted)', strokeWidth: 1, strokeDasharray: '4 3', opacity: 0.4 }}/>
                <Area type="monotone" dataKey="requests" stroke="var(--accent)" strokeWidth={1.5} fill="url(#gReq)" dot={false}/>
                <Area type="monotone" dataKey="blocked"  stroke="#f87171"       strokeWidth={1.5} fill="url(#gBlk)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Live threat feed */}
        <div className="relative overflow-hidden rounded-xl border flex flex-col h-[340px] xl:h-[400px] 2xl:h-[450px]"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
          <div className="absolute top-0 left-0 right-0 h-px"
            style={{ background: 'linear-gradient(90deg, transparent 10%, #f87171 50%, transparent 90%)', opacity: 0.4 }}/>
          {/* Header */}
          <div className="px-5 py-4 shrink-0 flex justify-between items-center"
            style={{ borderBottom: '1px solid var(--border-color)' }}>
            <h3 className="text-sm font-semibold">Live Threats</h3>
            <div className="flex items-center gap-1.5">
              <span className="live-dot w-1.5 h-1.5 rounded-full text-green-400" style={{ color: '#4ade80', background: '#4ade80' }}/>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Live</span>
            </div>
          </div>

          {/* Feed */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {threatEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: 'var(--text-muted)' }}>
                <Shield size={28} className="opacity-20"/>
                <span className="text-xs">No threats detected</span>
              </div>
            ) : (
              <ul>
                {threatEvents.map((ev, i) => <ThreatItem key={ev.event_id} ev={ev} index={i}/>)}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 shrink-0 text-center"
            style={{ borderTop: '1px solid var(--border-color)' }}>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {events.length} events this session
            </span>
          </div>
        </div>
      </div>

      {/* Secondary stats — single compact strip */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 rounded-xl border overflow-hidden divide-y md:divide-y-0 md:divide-x divide-base-border"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
          <SecondaryStat label="PII Masked"   value={piiMasked}   color="#60a5fa"/>
          <SecondaryStat label="ML Blocked"   value={mlBlocked}   color="#f87171"/>
          <SecondaryStat label="Rate Limited" value={rateLimited} color="#facc15"/>
          <SecondaryStat label="Cache Misses" value={cacheMisses} color="var(--text-muted)"/>
        </div>
      )}
    </div>
  );
}
