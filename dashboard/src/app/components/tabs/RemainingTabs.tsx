'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Network, Users, CreditCard, Fingerprint, Eye, Cpu,
  ShieldAlert, Globe, Plus, Trash2, Activity,
} from 'lucide-react';

// ─── Shared helpers ──────────────────────────────────────────────────────────

function PageHeader({ title, sub, badge }: { title: string; sub: string; badge?: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-base-muted mt-1">
        {sub}
        {badge && <span className="ml-2 px-1.5 py-0.5 bg-yellow-500/10 text-yellow-500 text-[10px] rounded font-semibold">{badge}</span>}
      </p>
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`border border-base-border bg-base-card rounded-xl p-6 shadow-sm ${className}`}>{children}</div>;
}

function Tag({ label, color }: { label: string; color: string }) {
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${color}`}>{label}</span>;
}

// ─── Edge Routing ────────────────────────────────────────────────────────────

const ROUTES = [
  { path: '/v1/chat/completions', provider: 'Groq',  model: 'llama-3.1-8b-instant', weight: 100, status: 'active' },
  { path: '/v1/embeddings',       provider: 'OpenAI', model: 'text-embedding-3-small', weight: 100, status: 'active' },
  { path: '/v1/completions',      provider: 'Groq',  model: 'llama-3.3-70b-versatile', weight: 50,  status: 'active' },
  { path: '/v1/images/generations', provider: 'OpenAI', model: 'dall-e-3', weight: 100, status: 'disabled' },
];

export function EdgeRoutingTab() {
  const [routes, setRoutes] = useState(ROUTES);
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Edge Routing" sub="LLM provider routes and load balancing configuration." badge="Demo data"/>
      <Card>
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-sm font-semibold">Route Table</h3>
          <button className="flex items-center gap-1.5 text-xs text-base-muted border border-base-border px-3 py-1.5 rounded-lg hover:text-base-text hover:bg-base-sec transition-colors">
            <Plus size={12}/> Add Route
          </button>
        </div>
        <div className="space-y-2">
          {routes.map((r, i) => (
            <div key={i} className={`flex items-center gap-4 px-4 py-3 border border-base-border rounded-lg text-sm transition-opacity ${r.status === 'disabled' ? 'opacity-40' : ''}`}>
              <Globe size={14} className="text-base-muted shrink-0"/>
              <code className="text-[12px] font-mono text-base-text flex-1">{r.path}</code>
              <span className="text-xs text-base-muted">{r.provider}</span>
              <code className="text-[11px] font-mono text-base-muted hidden md:block">{r.model}</code>
              <div className="flex items-center gap-2 ml-auto">
                <div className="h-1 w-16 bg-base-sec rounded-full overflow-hidden">
                  <div className="h-full bg-base-accent rounded-full" style={{ width: `${r.weight}%` }}/>
                </div>
                <span className="text-xs text-base-muted w-8 text-right">{r.weight}%</span>
                <Tag label={r.status} color={r.status === 'active' ? 'bg-green-400/10 text-green-400' : 'bg-base-sec text-base-muted'}/>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Team ────────────────────────────────────────────────────────────────────

const TEAM = [
  { name: 'Sharvik Sutar', email: 'aryantuntune42@gmail.com', role: 'Enterprise Admin',  avatar: 'S', joined: '2025-11-01', lastActive: '2026-06-05' },
  { name: 'Priya Sharma',  email: 'priya@acme.corp',          role: 'Security Engineer', avatar: 'P', joined: '2026-01-15', lastActive: '2026-06-04' },
  { name: 'Kai Nakamura',  email: 'kai@acme.corp',            role: 'Platform Engineer', avatar: 'K', joined: '2026-02-01', lastActive: '2026-06-03' },
  { name: 'Aisha Okonkwo', email: 'aisha@acme.corp',          role: 'Compliance Officer',avatar: 'A', joined: '2026-03-10', lastActive: '2026-05-28' },
];

const ROLES = ['Enterprise Admin','Security Engineer','Platform Engineer','Compliance Officer','Viewer'];

export function TeamTab() {
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Team" sub="Manage team members and their access roles." badge="Demo data"/>
      <Card>
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-sm font-semibold">{TEAM.length} Members</h3>
          <button className="flex items-center gap-1.5 text-xs bg-base-text text-base-main px-3 py-1.5 rounded-lg hover:scale-[1.02] transition-transform font-medium">
            <Plus size={12}/> Invite Member
          </button>
        </div>
        <div className="space-y-2">
          {TEAM.map(m => (
            <div key={m.email} className="flex items-center gap-4 px-4 py-3 border border-base-border/60 rounded-lg hover:bg-base-sec/30 transition-colors">
              <div className="w-8 h-8 rounded-full bg-base-sec border border-base-border flex items-center justify-center text-xs font-semibold text-base-text shrink-0">{m.avatar}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-base-text">{m.name}</div>
                <div className="text-xs text-base-muted">{m.email}</div>
              </div>
              <div className="hidden md:block text-xs text-base-muted">Last active {m.lastActive}</div>
              <select defaultValue={m.role} className="px-2 py-1 bg-base-sec border border-base-border rounded-md text-xs text-base-text outline-none">
                {ROLES.map(r => <option key={r}>{r}</option>)}
              </select>
              <button className="p-1.5 text-base-muted hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors"><Trash2 size={12}/></button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Billing ─────────────────────────────────────────────────────────────────

export function BillingTab() {
  const USAGE = [
    { label: 'Gateway Requests', used: 1_842_901, limit: 5_000_000, unit: 'req' },
    { label: 'ML Analyzer Calls', used: 1_842_901, limit: 5_000_000, unit: 'calls' },
    { label: 'Cache Storage',    used: 128,        limit: 1024,      unit: 'MB' },
    { label: 'Kafka Events',     used: 9_214_505,  limit: 50_000_000, unit: 'events' },
  ];
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Billing & Usage" sub="Current plan and resource consumption." badge="Demo data"/>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <Card>
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="text-xs text-base-muted uppercase tracking-widest mb-1">Current Plan</div>
              <div className="text-xl font-semibold">Enterprise</div>
            </div>
            <Tag label="Active" color="bg-green-400/10 text-green-400"/>
          </div>
          <div className="text-3xl font-semibold text-base-text">$499<span className="text-base-muted text-base font-normal">/mo</span></div>
          <div className="mt-4 text-xs text-base-muted">Next billing: 2026-07-01</div>
        </Card>
        <Card>
          <div className="text-xs text-base-muted uppercase tracking-widest mb-4">Current Month Spend</div>
          <div className="text-3xl font-semibold">$311.20</div>
          <div className="mt-2 text-xs text-base-muted">62.4% of monthly budget used</div>
          <div className="mt-3 h-1.5 bg-base-sec rounded-full overflow-hidden">
            <div className="h-full bg-base-accent rounded-full" style={{ width: '62.4%' }}/>
          </div>
        </Card>
      </div>
      <Card>
        <h3 className="text-sm font-semibold mb-5">Resource Usage</h3>
        <div className="space-y-5">
          {USAGE.map(({ label, used, limit, unit }) => {
            const pct = (used / limit) * 100;
            return (
              <div key={label}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-base-muted">{label}</span>
                  <span className="text-base-text font-medium">{used.toLocaleString()} / {limit.toLocaleString()} {unit}</span>
                </div>
                <div className="h-1.5 bg-base-sec rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${pct > 80 ? 'bg-red-400' : pct > 60 ? 'bg-yellow-400' : 'bg-base-accent'}`} style={{ width: `${pct}%` }}/>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ─── Access Control ──────────────────────────────────────────────────────────

const PERMISSIONS = [
  { resource: 'Gateway API',      admin: true,  engineer: true,  compliance: false, viewer: false },
  { resource: 'Policy Engine',    admin: true,  engineer: true,  compliance: false, viewer: true },
  { resource: 'Audit Logs',       admin: true,  engineer: false, compliance: true,  viewer: true },
  { resource: 'API Keys',         admin: true,  engineer: false, compliance: false, viewer: false },
  { resource: 'Team Management',  admin: true,  engineer: false, compliance: false, viewer: false },
  { resource: 'Billing',          admin: true,  engineer: false, compliance: false, viewer: false },
  { resource: 'ML Engine Config', admin: true,  engineer: true,  compliance: false, viewer: false },
];

export function AccessControlTab() {
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Access Control" sub="Role-based permission matrix for all system resources." badge="Demo data"/>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-base-border">
                <th className="text-left text-xs font-semibold text-base-muted uppercase tracking-widest py-3 pr-4">Resource</th>
                {['Admin','Engineer','Compliance','Viewer'].map(r => (
                  <th key={r} className="text-center text-xs font-semibold text-base-muted uppercase tracking-widest py-3 px-3">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-base-border/40">
              {PERMISSIONS.map(p => (
                <tr key={p.resource} className="hover:bg-base-sec/30 transition-colors">
                  <td className="py-3 pr-4 text-base-text font-medium">{p.resource}</td>
                  {[p.admin, p.engineer, p.compliance, p.viewer].map((has, i) => (
                    <td key={i} className="py-3 px-3 text-center">
                      <span className={`inline-block w-4 h-4 rounded-full ${has ? 'bg-green-400/20 text-green-400' : 'bg-base-sec text-base-muted/30'}`}>
                        {has ? '✓' : '×'}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Data Privacy ────────────────────────────────────────────────────────────

const PII_ENTITIES = [
  { name: 'US_SSN',          label: 'Social Security Number', enabled: true,  threshold: 0.85 },
  { name: 'EMAIL_ADDRESS',   label: 'Email Address',          enabled: true,  threshold: 0.90 },
  { name: 'CREDIT_CARD',     label: 'Credit Card Number',     enabled: true,  threshold: 0.95 },
  { name: 'PHONE_NUMBER',    label: 'Phone Number',           enabled: true,  threshold: 0.75 },
  { name: 'PERSON',          label: 'Person Name (NER)',       enabled: true,  threshold: 0.70 },
  { name: 'IP_ADDRESS',      label: 'IP Address',             enabled: true,  threshold: 0.95 },
  { name: 'US_PASSPORT',     label: 'US Passport Number',     enabled: false, threshold: 0.90 },
  { name: 'IBAN_CODE',       label: 'IBAN Bank Code',         enabled: true,  threshold: 0.85 },
];

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${on ? 'bg-base-accent' : 'bg-base-border'}`}>
      <span className={`pointer-events-none inline-block h-[16px] w-[16px] transform rounded-full bg-white shadow-sm transition duration-200 ${on ? 'translate-x-4' : 'translate-x-0'}`}/>
    </button>
  );
}

export function DataPrivacyTab() {
  const [entities, setEntities] = useState(PII_ENTITIES);
  const toggle = (name: string) => setEntities(es => es.map(e => e.name === name ? { ...e, enabled: !e.enabled } : e));
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Data Privacy" sub="Configure Presidio PII entity detection. Changes apply to all new requests."/>
      <Card>
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-sm font-semibold">PII Entity Recognizers</h3>
          <span className="text-xs text-base-muted">Engine: Microsoft Presidio · Model: en_core_web_sm</span>
        </div>
        <div className="space-y-2">
          {entities.map(e => (
            <div key={e.name} className="flex items-center justify-between px-4 py-3 border border-base-border/60 rounded-lg hover:bg-base-sec/30 transition-colors">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-base-text">{e.label}</span>
                  <code className="text-[10px] font-mono text-base-muted bg-base-sec px-1.5 py-0.5 rounded">{e.name}</code>
                </div>
                <div className="text-xs text-base-muted mt-0.5">Confidence threshold: {(e.threshold * 100).toFixed(0)}%</div>
              </div>
              <Toggle on={e.enabled} onChange={() => toggle(e.name)}/>
            </div>
          ))}
        </div>
        <div className="mt-5 p-4 bg-base-sec/50 rounded-lg border border-base-border/60 text-xs text-base-muted">
          <strong className="text-base-text">Note:</strong> Upgrade to <code className="bg-base-sec px-1 rounded">en_core_web_lg</code> for higher recall on PERSON and LOCATION entities (requires ~700MB additional image size).
        </div>
      </Card>
    </div>
  );
}

// ─── Sandboxes ───────────────────────────────────────────────────────────────

const SANDBOXES = [
  { id: 'sb-001', agent: 'DevOps-Agent-3',  tool: 'run_bash', status: 'running', cpu: '12%', mem: '48MB', started: '2m ago', riskScore: 4.2 },
  { id: 'sb-002', agent: 'SupportBot-7',    tool: 'read_file', status: 'running', cpu: '3%',  mem: '22MB', started: '8m ago', riskScore: 1.8 },
  { id: 'sb-003', agent: 'DataAgent-Prod',  tool: 'write_file',status: 'paused',  cpu: '0%',  mem: '36MB', started: '15m ago',riskScore: 5.1 },
  { id: 'sb-004', agent: 'Scraper-Legacy',  tool: 'send_email',status: 'running', cpu: '7%',  mem: '31MB', started: '1h ago', riskScore: 3.4 },
];

export function SandboxesTab() {
  const [sandboxes, setSandboxes] = useState(SANDBOXES);
  const kill = (id: string) => setSandboxes(ss => ss.filter(s => s.id !== id));
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Sandboxes" sub="Active Firecracker/Docker sandbox environments for agent tool execution." badge="Demo data"/>
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Active',  value: sandboxes.filter(s => s.status === 'running').length, color: 'text-green-400' },
          { label: 'Paused',  value: sandboxes.filter(s => s.status === 'paused').length,  color: 'text-yellow-400' },
          { label: 'Avg Risk',value: (sandboxes.reduce((a, b) => a + b.riskScore, 0) / sandboxes.length).toFixed(1), color: 'text-base-text' },
        ].map(({ label, value, color }) => (
          <Card key={label} className="text-center">
            <div className="text-xs text-base-muted uppercase tracking-widest mb-1">{label}</div>
            <div className={`text-2xl font-semibold ${color}`}>{value}</div>
          </Card>
        ))}
      </div>
      <Card>
        <div className="space-y-3">
          {sandboxes.map(s => (
            <div key={s.id} className="flex items-center gap-4 px-4 py-3 border border-base-border/60 rounded-lg">
              <div className={`w-2 h-2 rounded-full shrink-0 ${s.status === 'running' ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`}/>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-base-text">{s.agent}</div>
                <div className="text-xs text-base-muted"><code className="font-mono">{s.tool}</code> · started {s.started}</div>
              </div>
              <div className="hidden md:flex gap-4 text-xs text-base-muted">
                <span>CPU {s.cpu}</span>
                <span>MEM {s.mem}</span>
                <span className={`font-semibold ${s.riskScore >= 5 ? 'text-orange-400' : 'text-green-400'}`}>Risk {s.riskScore}</span>
              </div>
              <button onClick={() => kill(s.id)} className="px-3 py-1 text-xs text-red-400 border border-red-400/30 bg-red-400/5 rounded-md hover:bg-red-400/10 transition-colors font-medium">Kill</button>
            </div>
          ))}
          {sandboxes.length === 0 && (
            <div className="py-10 text-center text-base-muted">
              <Cpu size={24} className="mx-auto mb-2 opacity-30"/>
              <p className="text-sm">No active sandboxes.</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Vulnerabilities ─────────────────────────────────────────────────────────

const VULNS = [
  { id: 'CVE-2024-6387', name: 'RegreSSHion (sshd)', severity: 'Critical', cvss: 9.8, component: 'openssh', status: 'Patched', discovered: '2024-07-01' },
  { id: 'CVE-2024-3094', name: 'XZ Utils Backdoor',  severity: 'Critical', cvss: 10.0,component: 'xz-utils',status: 'N/A',    discovered: '2024-03-29' },
  { id: 'CVE-2025-1234', name: 'gRPC TLS bypass',    severity: 'High',     cvss: 7.5, component: 'grpc-go', status: 'Open',    discovered: '2025-04-12' },
  { id: 'CVE-2024-9999', name: 'Redis ACL bypass',   severity: 'Medium',   cvss: 5.3, component: 'redis',   status: 'Open',    discovered: '2024-11-20' },
  { id: 'CVE-2025-0042', name: 'Kafka auth bypass',  severity: 'Medium',   cvss: 6.1, component: 'kafka',   status: 'Patched', discovered: '2025-01-08' },
];

const SEV_COLOR: Record<string, string> = { Critical: 'text-red-400 bg-red-400/10', High: 'text-orange-400 bg-orange-400/10', Medium: 'text-yellow-400 bg-yellow-400/10' };

export function VulnerabilitiesTab() {
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Vulnerabilities" sub="CVE tracking for all runtime components." badge="Demo data"/>
      <Card>
        <div className="space-y-3">
          {VULNS.map(v => (
            <div key={v.id} className="flex items-center gap-4 px-4 py-3 border border-base-border/60 rounded-lg">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-xs font-mono text-base-muted">{v.id}</code>
                  <span className="text-sm font-medium text-base-text">{v.name}</span>
                  <Tag label={v.severity} color={SEV_COLOR[v.severity] ?? 'text-base-muted bg-base-sec'}/>
                </div>
                <div className="text-xs text-base-muted mt-0.5"><code className="font-mono">{v.component}</code> · Discovered {v.discovered}</div>
              </div>
              <div className="text-sm font-semibold text-base-text hidden md:block">CVSS {v.cvss}</div>
              <Tag label={v.status} color={v.status === 'Patched' ? 'bg-green-400/10 text-green-400' : v.status === 'N/A' ? 'bg-base-sec text-base-muted' : 'bg-red-400/10 text-red-400'}/>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
