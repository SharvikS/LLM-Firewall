'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area,
} from 'recharts';

// ─── Static demo data ─────────────────────────────────────────────────────────

const HOUR_DATA = Array.from({ length: 24 }, (_, h) => ({
  hour: `${h.toString().padStart(2, '0')}:00`,
  requests: Math.floor(Math.sin((h - 6) / 4) * 1200 + 2000),
  blocked:  Math.floor(Math.cos((h - 3) / 4) * 80  + 120),
  cached:   Math.floor(Math.sin((h - 4) / 3) * 400 + 800),
}));

const THREAT_PIE = [
  { name: 'Prompt Injection', value: 43, color: '#f87171' },
  { name: 'PII Leakage',      value: 28, color: '#60a5fa' },
  { name: 'Jailbreak',        value: 19, color: '#fb923c' },
  { name: 'Rate Limit',       value: 10, color: '#facc15' },
];

const LATENCY_DATA = Array.from({ length: 30 }, (_, i) => ({
  min: `T-${30 - i}`,
  p50: 8  + Math.sin(i * 0.4) * 5,
  p95: 18 + Math.sin(i * 0.3) * 9,
  p99: 30 + Math.sin(i * 0.2) * 18,
}));

const MODEL_USAGE = [
  { model: 'llama-3.1-8b',  tokens: 4_200_000, cost: 2.1,  color: 'var(--accent)' },
  { model: 'llama-3.3-70b', tokens: 1_800_000, cost: 8.4,  color: '#60a5fa' },
  { model: 'gpt-4o-mini',   tokens:   980_000, cost: 3.9,  color: '#34d399' },
  { model: 'claude-haiku',  tokens:   620_000, cost: 1.2,  color: '#fb923c' },
];

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl shadow-2xl overflow-hidden text-xs"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', minWidth: 148 }}>
      {label && (
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: 'var(--bg-sec)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
          {label}
        </div>
      )}
      <div className="px-3 py-2.5 space-y-1.5">
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex justify-between items-center gap-5">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: entry.stroke ?? entry.fill ?? entry.color }}/>
              <span style={{ color: 'var(--text-muted)' }}>{entry.name ?? entry.dataKey}</span>
            </div>
            <span className="font-semibold tabular-nums" style={{ color: 'var(--text-main)' }}>
              {typeof entry.value === 'number' && entry.value > 100
                ? entry.value.toLocaleString()
                : typeof entry.value === 'number'
                  ? `${entry.value.toFixed(1)}ms`
                  : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────

function AnalyticsCard({ title, sub, accentColor, children }: {
  title: string; sub?: string; accentColor?: string; children: React.ReactNode;
}) {
  const color = accentColor ?? 'var(--accent)';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-xl border p-6"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      {/* Gradient top line */}
      <div className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent 10%, ${color}55 50%, transparent 90%)` }}/>
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        {sub && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
      </div>
      {children}
    </motion.div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function AnalyticsTab() {
  const [range, setRange] = useState('24h');

  const maxTokens = MODEL_USAGE[0].tokens;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Analytics</h1>
          <p className="text-sm mt-1 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            Traffic patterns, threat breakdown, and latency distribution
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
              style={{ background: 'rgba(234,179,8,0.1)', color: 'rgba(234,179,8,0.9)', border: '1px solid rgba(234,179,8,0.2)' }}>
              Demo data
            </span>
          </p>
        </div>
        {/* Range tabs */}
        <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: 'var(--bg-sec)', border: '1px solid var(--border-color)' }}>
          {['24h', '7d', '30d'].map(r => (
            <button key={r} onClick={() => setRange(r)}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
              style={r === range
                ? { background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-color)' }
                : { color: 'var(--text-muted)' }}>
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Hourly Traffic */}
        <AnalyticsCard title="Hourly Request Volume" sub="Requests, blocked, and cached per hour" accentColor="var(--accent)">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={HOUR_DATA} margin={{ left: -18, bottom: 0 }} barSize={5} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} opacity={0.5}/>
                <XAxis dataKey="hour" stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} minTickGap={24}/>
                <YAxis stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`}/>
                <Tooltip content={<ChartTip/>} cursor={{ fill: 'var(--bg-sec)', opacity: 0.6 }}/>
                <Bar dataKey="requests" name="Requests" fill="var(--accent)" opacity={0.85} radius={[2,2,0,0]}/>
                <Bar dataKey="blocked"  name="Blocked"  fill="#f87171"       opacity={0.85} radius={[2,2,0,0]}/>
                <Bar dataKey="cached"   name="Cached"   fill="#a78bfa"       opacity={0.85} radius={[2,2,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 mt-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {[['Requests','var(--accent)'],['Blocked','#f87171'],['Cached','#a78bfa']].map(([l,c]) => (
              <div key={l} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: c }}/>
                {l}
              </div>
            ))}
          </div>
        </AnalyticsCard>

        {/* Threat Breakdown */}
        <AnalyticsCard title="Threat Category Breakdown" sub="Distribution of blocked request types" accentColor="#f87171">
          <div className="flex items-center gap-2">
            <div className="h-48 w-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={THREAT_PIE} cx="50%" cy="50%" innerRadius={42} outerRadius={68}
                    dataKey="value" paddingAngle={4} strokeWidth={0}>
                    {THREAT_PIE.map((entry, i) => <Cell key={i} fill={entry.color} opacity={0.9}/>)}
                  </Pie>
                  <Tooltip content={<ChartTip/>}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-2.5">
              {THREAT_PIE.map(({ name, value, color }) => (
                <div key={name}>
                  <div className="flex items-center justify-between mb-1 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }}/>
                      <span style={{ color: 'var(--text-muted)' }}>{name}</span>
                    </div>
                    <span className="font-bold tabular-nums" style={{ color: 'var(--text-main)' }}>{value}%</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-sec)' }}>
                    <motion.div className="h-full rounded-full"
                      initial={{ width: 0 }} animate={{ width: `${value}%` }}
                      transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                      style={{ background: color, opacity: 0.7 }}/>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </AnalyticsCard>

        {/* Latency Percentiles */}
        <AnalyticsCard title="Latency Percentiles" sub="P50 / P95 / P99 over the last 30 minutes" accentColor="#34d399">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={LATENCY_DATA} margin={{ left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} opacity={0.5}/>
                <XAxis dataKey="min" stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} minTickGap={24}/>
                <YAxis stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `${v}ms`}/>
                <Tooltip content={<ChartTip/>} cursor={{ stroke: 'var(--text-muted)', strokeWidth: 1, strokeDasharray: '4 3', opacity: 0.4 }}/>
                <Line dataKey="p50" name="P50" stroke="#34d399" strokeWidth={1.5} dot={false}/>
                <Line dataKey="p95" name="P95" stroke="#fb923c" strokeWidth={1.5} dot={false}/>
                <Line dataKey="p99" name="P99" stroke="#f87171" strokeWidth={1.5} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 mt-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {[['P50','#34d399'],['P95','#fb923c'],['P99','#f87171']].map(([label, c]) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 rounded-full inline-block" style={{ background: c }}/>
                {label}
              </div>
            ))}
          </div>
        </AnalyticsCard>

        {/* Model Usage */}
        <AnalyticsCard title="Model Usage" sub="Token consumption and estimated cost by model" accentColor="#60a5fa">
          <div className="space-y-5 mt-1">
            {MODEL_USAGE.map(({ model, tokens, cost, color }, i) => {
              const pct = (tokens / maxTokens) * 100;
              return (
                <div key={model}>
                  <div className="flex justify-between items-center mb-2 text-xs">
                    <span className="font-mono font-medium" style={{ color: 'var(--text-main)' }}>{model}</span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {(tokens / 1_000_000).toFixed(1)}M tokens
                      &nbsp;·&nbsp;
                      <span className="font-semibold" style={{ color: 'var(--text-main)' }}>${cost.toFixed(2)}</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-sec)' }}>
                    <motion.div className="h-full rounded-full"
                      initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.9, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                      style={{ background: color, opacity: 0.8 }}/>
                  </div>
                </div>
              );
            })}
          </div>
        </AnalyticsCard>
      </div>
    </div>
  );
}
