'use client';

import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';

const HOUR_DATA = Array.from({ length: 24 }, (_, h) => ({
  hour: `${h.toString().padStart(2, '0')}:00`,
  requests: Math.floor(Math.sin((h - 6) / 4) * 1200 + 2000 + Math.random() * 600),
  blocked:  Math.floor(Math.cos((h - 3) / 4) * 80  + 120  + Math.random() * 40),
  cached:   Math.floor(Math.sin((h - 4) / 3) * 400 + 800  + Math.random() * 200),
}));

const THREAT_PIE = [
  { name: 'Prompt Injection', value: 43, color: '#f87171' },
  { name: 'PII Leakage',      value: 28, color: '#60a5fa' },
  { name: 'Jailbreak Attempt',value: 19, color: '#fb923c' },
  { name: 'Rate Limit',       value: 10, color: '#facc15' },
];

const LATENCY_DATA = Array.from({ length: 30 }, (_, i) => ({
  min: `T-${30 - i}`,
  p50: 8  + Math.random() * 6,
  p95: 18 + Math.random() * 12,
  p99: 30 + Math.random() * 25,
}));

const MODEL_USAGE = [
  { model: 'llama-3.1-8b',  tokens: 4_200_000, cost: 2.1 },
  { model: 'llama-3.3-70b', tokens: 1_800_000, cost: 8.4 },
  { model: 'gpt-4o-mini',   tokens: 980_000,   cost: 3.9 },
  { model: 'claude-haiku',  tokens: 620_000,   cost: 1.2 },
];

const PALETTE = ['var(--accent)', '#60a5fa', '#34d399', '#fb923c'];

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {sub && <p className="text-[11px] text-base-muted mt-0.5">{sub}</p>}
    </div>
  );
}

export default function AnalyticsTab() {
  const [range, setRange] = useState('24h');
  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-base-muted mt-1">
            Traffic patterns, threat breakdown, and latency distribution.
            <span className="ml-2 px-1.5 py-0.5 bg-yellow-500/10 text-yellow-500 text-[10px] rounded font-semibold">Demo data</span>
          </p>
        </div>
        <div className="flex gap-1 bg-base-sec p-0.5 rounded-lg border border-base-border">
          {['24h', '7d', '30d'].map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${r === range ? 'bg-base-card text-base-text shadow-sm border border-base-border' : 'text-base-muted hover:text-base-text'}`}
            >{r}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hourly Traffic */}
        <div className="border border-base-border bg-base-card rounded-xl p-6 shadow-sm">
          <SectionHeader title="Hourly Request Volume" sub="Requests, blocked, and cached per hour"/>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={HOUR_DATA} margin={{ left: -20, bottom: 0 }} barSize={6} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} opacity={0.4}/>
                <XAxis dataKey="hour" stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} minTickGap={20}/>
                <YAxis stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`}/>
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 11 }} cursor={{ fill: 'var(--bg-sec)', opacity: 0.5 }}/>
                <Bar dataKey="requests" fill="var(--accent)" opacity={0.8} radius={[2, 2, 0, 0]}/>
                <Bar dataKey="blocked"  fill="#f87171"       opacity={0.8} radius={[2, 2, 0, 0]}/>
                <Bar dataKey="cached"   fill="#a78bfa"       opacity={0.8} radius={[2, 2, 0, 0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Threat Breakdown */}
        <div className="border border-base-border bg-base-card rounded-xl p-6 shadow-sm">
          <SectionHeader title="Threat Category Breakdown" sub="Distribution of blocked request types"/>
          <div className="flex items-center justify-between">
            <div className="h-48 w-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={THREAT_PIE} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value" paddingAngle={3}>
                    {THREAT_PIE.map((entry, i) => <Cell key={i} fill={entry.color}/>)}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 11 }}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 ml-4 space-y-2">
              {THREAT_PIE.map(({ name, value, color }) => (
                <div key={name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }}/>
                    <span className="text-base-muted truncate max-w-[120px]">{name}</span>
                  </div>
                  <span className="font-semibold text-base-text ml-2">{value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Latency Percentiles */}
        <div className="border border-base-border bg-base-card rounded-xl p-6 shadow-sm">
          <SectionHeader title="Latency Percentiles" sub="P50 / P95 / P99 over the last 30 minutes"/>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={LATENCY_DATA} margin={{ left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} opacity={0.4}/>
                <XAxis dataKey="min" stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} minTickGap={20}/>
                <YAxis stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `${v}ms`}/>
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 11 }}/>
                <Line dataKey="p50" stroke="#34d399" strokeWidth={2} dot={false}/>
                <Line dataKey="p95" stroke="#fb923c" strokeWidth={2} dot={false}/>
                <Line dataKey="p99" stroke="#f87171" strokeWidth={2} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 mt-3 text-xs">
            {[['P50','#34d399'],['P95','#fb923c'],['P99','#f87171']].map(([label, c]) => (
              <div key={label} className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded-full inline-block" style={{ background: c }}/><span className="text-base-muted">{label}</span></div>
            ))}
          </div>
        </div>

        {/* Model Usage */}
        <div className="border border-base-border bg-base-card rounded-xl p-6 shadow-sm">
          <SectionHeader title="Model Usage" sub="Token consumption and cost by provider"/>
          <div className="space-y-4 mt-2">
            {MODEL_USAGE.map(({ model, tokens, cost }, i) => {
              const pct = (tokens / MODEL_USAGE[0].tokens) * 100;
              return (
                <div key={model}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-mono text-base-text">{model}</span>
                    <span className="text-base-muted">{(tokens / 1_000_000).toFixed(1)}M tokens · <span className="text-base-text">${cost.toFixed(2)}</span></span>
                  </div>
                  <div className="h-1.5 bg-base-sec rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: PALETTE[i] }}/>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
