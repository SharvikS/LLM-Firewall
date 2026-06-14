'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Cpu, Globe, Plus, Trash2, Loader2, Check, AlertTriangle, X,
} from 'lucide-react';
import { fetchSettings, saveSettings, type GatewaySettings } from '@/lib/settings';
import { ROLE_LABEL, type Role } from '@/lib/me';

// ─── Shared helpers ──────────────────────────────────────────────────────────

function PageHeader({ title, sub, badge, badgeColor = 'yellow' }: { title: string; sub: string; badge?: string; badgeColor?: 'yellow' | 'green' }) {
  const colors = badgeColor === 'green' ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500';
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-base-muted mt-1">
        {sub}
        {badge && <span className={`ml-2 px-1.5 py-0.5 text-[10px] rounded font-semibold ${colors}`}>{badge}</span>}
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

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button onClick={onChange} disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${on ? 'bg-base-accent' : 'bg-base-border'}`}>
      <span className={`pointer-events-none inline-block h-[16px] w-[16px] transform rounded-full bg-white shadow-sm transition duration-200 ${on ? 'translate-x-4' : 'translate-x-0'}`}/>
    </button>
  );
}

// A tiny status pill shared by the live tabs.
function LiveStatus({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' | 'offline' }) {
  if (state === 'idle') return null;
  const map = {
    saving: { icon: <Loader2 size={11} className="animate-spin"/>, text: 'Saving…', cls: 'text-base-muted' },
    saved:  { icon: <Check size={11}/>,                            text: 'Saved',   cls: 'text-green-400' },
    error:  { icon: <AlertTriangle size={11}/>,                    text: 'Save failed', cls: 'text-red-400' },
    offline:{ icon: <AlertTriangle size={11}/>,                    text: 'Gateway offline', cls: 'text-yellow-500' },
  }[state];
  return <span className={`inline-flex items-center gap-1 text-xs ${map.cls}`}>{map.icon}{map.text}</span>;
}

// Shared hook: load live settings + a debounced-ish save helper.
function useLiveSettings() {
  const [settings, setSettings] = useState<GatewaySettings | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'offline'>('idle');

  useEffect(() => {
    fetchSettings().then(s => { if (s) setSettings(s); else setState('offline'); });
  }, []);

  const apply = useCallback(async (p: Partial<GatewaySettings>) => {
    setSettings(s => (s ? { ...s, ...p } : s));
    setState('saving');
    const updated = await saveSettings(p);
    if (updated) { setSettings(updated); setState('saved'); setTimeout(() => setState('idle'), 1500); }
    else setState('error');
  }, []);

  return { settings, state, apply };
}

// ─── Edge Routing ────────────────────────────────────────────────────────────

const ROUTES = [
  { path: '/v1/chat/completions', provider: 'Groq',  model: 'llama-3.1-8b-instant', weight: 100, status: 'active' },
  { path: '/v1/embeddings',       provider: 'OpenAI', model: 'text-embedding-3-small', weight: 100, status: 'active' },
  { path: '/v1/completions',      provider: 'Groq',  model: 'llama-3.3-70b-versatile', weight: 50,  status: 'active' },
  { path: '/v1/images/generations', provider: 'OpenAI', model: 'dall-e-3', weight: 100, status: 'disabled' },
];

export function EdgeRoutingTab() {
  const { settings, state, apply } = useLiveSettings();
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Edge Routing" sub="LLM provider routing and automatic failover."/>
      <Card className="mb-6">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-sm font-semibold">Provider Failover</div>
            <div className="text-xs text-base-muted mt-1 max-w-md">When the primary upstream returns 5xx or is unreachable, replay the request to the configured backup provider. Applied live.</div>
            <div className="mt-2"><LiveStatus state={state}/></div>
          </div>
          <Toggle on={!!settings?.failover_enabled} disabled={!settings} onChange={() => apply({ failover_enabled: !settings?.failover_enabled })}/>
        </div>
      </Card>
      <Card>
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-sm font-semibold">Route Table</h3>
          <span className="text-xs text-base-muted">Configured at deploy via TARGET_URL / FALLBACK_TARGET_URL</span>
        </div>
        <div className="space-y-2">
          {ROUTES.map((r, i) => (
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

// ─── Team (live — control-plane user management with RBAC) ───────────────────

interface UserRow {
  id: string;
  email: string;
  role: Role;
  auth_provider: string;
  disabled: boolean;
  last_login?: string;
}

const ROLE_OPTIONS: Role[] = ['viewer', 'compliance', 'security', 'admin'];

export function TeamTab({ myRole }: { myRole?: Role }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'forbidden'>('loading');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', role: 'viewer' as Role });
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const isAdmin = myRole === 'admin';

  const load = useCallback(() => {
    fetch('/api/admin/users', { cache: 'no-store' })
      .then(async res => {
        if (res.status === 403) { setState('forbidden'); return; }
        const data = await res.json();
        if (data._offline) { setState('offline'); return; }
        setUsers(data.users ?? []);
        setState('ready');
      })
      .catch(() => setState('offline'));
  }, []);

  // Initial load (fetch + setState lives in the .then callback, not the effect body).
  useEffect(() => {
    fetch('/api/admin/users', { cache: 'no-store' })
      .then(async res => {
        if (res.status === 403) { setState('forbidden'); return; }
        const data = await res.json();
        if (data._offline) { setState('offline'); return; }
        setUsers(data.users ?? []);
        setState('ready');
      })
      .catch(() => setState('offline'));
  }, []);

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormErr('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) { setShowAdd(false); setForm({ email: '', password: '', role: 'viewer' }); load(); }
      else { const d = await res.json().catch(() => ({})); setFormErr(d.error ?? 'Could not create user'); }
    } catch { setFormErr('Gateway unavailable'); }
    finally { setBusy(false); }
  };

  const changeRole = async (id: string, role: Role) => {
    await fetch(`/api/admin/users/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
    });
    load();
  };

  const removeUser = async (id: string) => {
    await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Team" sub="Control-plane users and their RBAC roles. Changes take effect immediately." badge="Live" badgeColor="green"/>

      {state === 'forbidden' && (
        <Card><div className="text-sm text-base-muted">You need the <strong className="text-base-text">admin</strong> role to manage users.</div></Card>
      )}
      {state === 'offline' && (
        <Card><div className="flex items-center gap-2 text-sm text-yellow-500"><AlertTriangle size={14}/> Gateway offline — cannot load users.</div></Card>
      )}

      {(state === 'ready' || state === 'loading') && (
        <Card>
          <div className="flex justify-between items-center mb-5">
            <h3 className="text-sm font-semibold">{users.length} Member{users.length === 1 ? '' : 's'}</h3>
            {isAdmin && (
              <button onClick={() => setShowAdd(s => !s)} className="flex items-center gap-1.5 text-xs bg-base-text text-base-main px-3 py-1.5 rounded-lg hover:scale-[1.02] transition-transform font-medium">
                {showAdd ? <><X size={12}/> Cancel</> : <><Plus size={12}/> Add User</>}
              </button>
            )}
          </div>

          {showAdd && isAdmin && (
            <form onSubmit={addUser} className="mb-5 p-4 border border-base-border rounded-lg space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input required type="email" placeholder="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="px-3 py-2 bg-base-sec border border-base-border rounded-md text-sm outline-none"/>
                <input required type="password" placeholder="password (min 8)" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="px-3 py-2 bg-base-sec border border-base-border rounded-md text-sm outline-none"/>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))}
                  className="px-3 py-2 bg-base-sec border border-base-border rounded-md text-sm outline-none">
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </div>
              {formErr && <div className="text-xs text-red-400">{formErr}</div>}
              <button type="submit" disabled={busy} className="flex items-center gap-1.5 text-xs bg-base-accent/15 text-base-accent border border-base-accent/30 px-3 py-1.5 rounded-lg font-medium disabled:opacity-60">
                {busy ? <Loader2 size={12} className="animate-spin"/> : <Check size={12}/>} Create User
              </button>
            </form>
          )}

          <div className="space-y-2">
            {users.map(u => (
              <div key={u.id} className="flex items-center gap-4 px-4 py-3 border border-base-border/60 rounded-lg hover:bg-base-sec/30 transition-colors">
                <div className="w-8 h-8 rounded-full bg-base-sec border border-base-border flex items-center justify-center text-xs font-semibold text-base-text shrink-0 uppercase">{u.email[0]}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-base-text truncate">{u.email}</div>
                  <div className="text-xs text-base-muted">{u.auth_provider === 'oidc' ? 'SSO' : 'Local'}{u.last_login ? ` · last login ${new Date(u.last_login).toLocaleDateString()}` : ' · never signed in'}</div>
                </div>
                <select value={u.role} disabled={!isAdmin} onChange={e => changeRole(u.id, e.target.value as Role)}
                  className="px-2 py-1 bg-base-sec border border-base-border rounded-md text-xs text-base-text outline-none disabled:opacity-50">
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                {isAdmin && (
                  <button onClick={() => removeUser(u.id)} className="p-1.5 text-base-muted hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors"><Trash2 size={12}/></button>
                )}
              </div>
            ))}
            {state === 'loading' && <div className="py-6 text-center text-xs text-base-muted flex items-center justify-center gap-2"><Loader2 size={12} className="animate-spin"/> Loading users…</div>}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Billing (live — per-tenant metering + plan management) ──────────────────

interface Plan {
  tier: string;
  display_name: string;
  monthly_requests: number;
  price_usd_per_month: number;
}
interface Usage {
  requests: number;
  tokens: number;
  blocked: number;
  tier: string;
  monthly_limit: number;
  percent_used: number;
}
interface TenantUsage {
  tenant_id: string;
  name: string;
  tier: string;
  active: boolean;
  usage: Usage;
}

const fmt = (n: number) => n.toLocaleString();
const limitLabel = (n: number) => (n === 0 ? '∞' : fmt(n));

export function BillingTab({ myRole }: { myRole?: Role }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [rows, setRows] = useState<TenantUsage[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading');
  const isAdmin = myRole === 'admin';

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/billing/plans', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/admin/billing/usage', { cache: 'no-store' }).then(r => r.json()),
    ])
      .then(([p, u]) => {
        if (p?._offline || u?._offline) { setState('offline'); return; }
        setPlans(p.plans ?? []);
        setRows(u.tenants ?? []);
        setState('ready');
      })
      .catch(() => setState('offline'));
  }, []);

  const changePlan = async (tenantId: string, tier: string) => {
    await fetch(`/api/admin/tenants/${tenantId}/plan`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier }),
    });
    const u = await fetch('/api/admin/billing/usage', { cache: 'no-store' }).then(r => r.json());
    if (!u?._offline) setRows(u.tenants ?? []);
  };

  // Account-wide rollup across tenants for the summary cards.
  const totalReq = rows.reduce((s, r) => s + (r.usage?.requests ?? 0), 0);
  const totalBlocked = rows.reduce((s, r) => s + (r.usage?.blocked ?? 0), 0);

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Billing & Usage" sub="Per-tenant metered usage and plan entitlements. Quotas are enforced live at the gateway." badge="Live" badgeColor="green"/>

      {state === 'offline' && (
        <Card><div className="flex items-center gap-2 text-sm text-yellow-500"><AlertTriangle size={14}/> Gateway offline — cannot load usage.</div></Card>
      )}

      {state !== 'offline' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <Card>
              <div className="text-xs text-base-muted uppercase tracking-widest mb-1">Tenants</div>
              <div className="text-3xl font-semibold">{rows.length}</div>
              <div className="mt-2 text-xs text-base-muted">{rows.filter(r => r.active).length} active</div>
            </Card>
            <Card>
              <div className="text-xs text-base-muted uppercase tracking-widest mb-1">Requests this month</div>
              <div className="text-3xl font-semibold">{fmt(totalReq)}</div>
              <div className="mt-2 text-xs text-base-muted">metered across all tenants</div>
            </Card>
            <Card>
              <div className="text-xs text-base-muted uppercase tracking-widest mb-1">Blocked this month</div>
              <div className="text-3xl font-semibold">{fmt(totalBlocked)}</div>
              <div className="mt-2 text-xs text-base-muted">security blocks billed as usage</div>
            </Card>
          </div>

          <Card className="mb-6">
            <h3 className="text-sm font-semibold mb-4">Plan Catalog</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {plans.map(p => (
                <div key={p.tier} className="px-4 py-3 border border-base-border rounded-lg">
                  <div className="text-sm font-semibold">{p.display_name}</div>
                  <div className="text-xs text-base-muted mt-0.5">{limitLabel(p.monthly_requests)} req/mo</div>
                  <div className="text-lg font-semibold mt-2">${p.price_usd_per_month}<span className="text-xs text-base-muted font-normal">/mo</span></div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold mb-5">Tenant Usage (current month)</h3>
            <div className="space-y-4">
              {rows.map(r => {
                const u = r.usage;
                const pct = u.monthly_limit === 0 ? 0 : Math.min(u.percent_used, 100);
                return (
                  <div key={r.tenant_id} className="px-4 py-3 border border-base-border/60 rounded-lg">
                    <div className="flex items-center justify-between gap-4 mb-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-base-text truncate">{r.name}</div>
                        <div className="text-xs text-base-muted">{fmt(u.requests)} / {limitLabel(u.monthly_limit)} req · {fmt(u.tokens)} tokens · {fmt(u.blocked)} blocked</div>
                      </div>
                      <select value={r.tier} disabled={!isAdmin}
                        onChange={e => changePlan(r.tenant_id, e.target.value)}
                        className="px-2 py-1 bg-base-sec border border-base-border rounded-md text-xs outline-none disabled:opacity-50">
                        {plans.map(p => <option key={p.tier} value={p.tier}>{p.display_name}</option>)}
                      </select>
                    </div>
                    <div className="h-1.5 bg-base-sec rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-400' : pct > 70 ? 'bg-yellow-400' : 'bg-base-accent'}`}
                        style={{ width: `${u.monthly_limit === 0 ? 4 : pct}%` }}/>
                    </div>
                  </div>
                );
              })}
              {state === 'loading' && <div className="py-6 text-center text-xs text-base-muted flex items-center justify-center gap-2"><Loader2 size={12} className="animate-spin"/> Loading usage…</div>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Access Control (reference model) ────────────────────────────────────────

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
      <PageHeader title="Access Control" sub="Reference RBAC model. Enforcement is via API-key scoping and the admin token today; role assignment ships next." badge="Reference"/>
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

// ─── Data Privacy (live) ─────────────────────────────────────────────────────

const PII_LABELS: Record<string, string> = {
  US_SSN:        'Social Security Number',
  EMAIL_ADDRESS: 'Email Address',
  CREDIT_CARD:   'Credit Card Number',
  PHONE_NUMBER:  'Phone Number',
  PERSON:        'Person Name (NER)',
  IP_ADDRESS:    'IP Address',
  US_PASSPORT:   'US Passport Number',
  IBAN_CODE:     'IBAN Bank Code',
};

export function DataPrivacyTab() {
  const { settings, state, apply } = useLiveSettings();
  const entities = settings?.pii_entities ?? {};

  const toggleEntity = (name: string) =>
    apply({ pii_entities: { ...entities, [name]: !entities[name] } });

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Data Privacy" sub="Configure Presidio PII recognizers. Changes apply live to all new requests." badge="Live" badgeColor="green"/>
      <Card className="mb-6">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-sm font-semibold">PII Redaction</div>
            <div className="text-xs text-base-muted mt-1 max-w-md">Master switch. When off, no PII is masked regardless of the recognizers below (secrets are always masked).</div>
            <div className="mt-2"><LiveStatus state={state}/></div>
          </div>
          <Toggle on={!!settings?.pii_redaction_enabled} disabled={!settings} onChange={() => apply({ pii_redaction_enabled: !settings?.pii_redaction_enabled })}/>
        </div>
      </Card>
      <Card>
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-sm font-semibold">PII Entity Recognizers</h3>
          <span className="text-xs text-base-muted">Engine: Microsoft Presidio · Model: en_core_web_sm</span>
        </div>
        <div className={`space-y-2 ${settings && !settings.pii_redaction_enabled ? 'opacity-50' : ''}`}>
          {Object.keys(PII_LABELS).map(name => (
            <div key={name} className="flex items-center justify-between px-4 py-3 border border-base-border/60 rounded-lg hover:bg-base-sec/30 transition-colors">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-base-text">{PII_LABELS[name]}</span>
                  <code className="text-[10px] font-mono text-base-muted bg-base-sec px-1.5 py-0.5 rounded">{name}</code>
                </div>
              </div>
              <Toggle on={!!entities[name]} disabled={!settings || !settings.pii_redaction_enabled} onChange={() => toggleEntity(name)}/>
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

// ─── Sandboxes (preview) ─────────────────────────────────────────────────────

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
      <PageHeader title="Sandboxes" sub="Active Firecracker/Docker sandbox environments for agent tool execution." badge="Preview"/>
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

// ─── Vulnerabilities (live — dependency CVE scan report) ─────────────────────

interface ScanComponent { name: string; scanner: string; findings: number; }
interface ScanReport { generated_at: string; status: string; components: ScanComponent[]; }

export function VulnerabilitiesTab() {
  const [report, setReport] = useState<ScanReport | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'offline'>('loading');

  useEffect(() => {
    fetch('/api/admin/security/vulnerabilities', { cache: 'no-store' })
      .then(async r => {
        const d = await r.json();
        if (d?._offline) { setState('offline'); return; }
        if (!d?.available) { setState('none'); return; }
        setReport(d.report);
        setState('ready');
      })
      .catch(() => setState('offline'));
  }, []);

  const findingColor = (n: number) =>
    n < 0 ? 'bg-base-sec text-base-muted' : n === 0 ? 'bg-green-400/10 text-green-400' : 'bg-yellow-400/10 text-yellow-400';
  const findingLabel = (n: number) => (n < 0 ? 'not scanned' : n === 0 ? 'clean' : `${n} finding${n === 1 ? '' : 's'}`);

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Vulnerabilities" sub="Dependency CVE scan across all components (govulncheck · pip-audit · npm audit). Run via scripts/security-scan.sh or the security-scan CI workflow." badge="Live" badgeColor="green"/>

      {state === 'offline' && (
        <Card><div className="flex items-center gap-2 text-sm text-yellow-500"><AlertTriangle size={14}/> Gateway offline — cannot load scan report.</div></Card>
      )}
      {state === 'none' && (
        <Card><div className="text-sm text-base-muted">No scan report found yet. Run <code className="bg-base-sec px-1 rounded">./scripts/security-scan.sh</code> (or let CI run it) to populate this view.</div></Card>
      )}
      {state === 'ready' && report && (
        <Card>
          <div className="flex justify-between items-center mb-5">
            <h3 className="text-sm font-semibold">Latest scan</h3>
            <span className="text-xs text-base-muted">{report.generated_at}</span>
          </div>
          <div className="space-y-3">
            {report.components.map(c => (
              <div key={c.name} className="flex items-center gap-4 px-4 py-3 border border-base-border/60 rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-base-text">{c.name}</div>
                  <div className="text-xs text-base-muted mt-0.5">scanner: <code className="font-mono">{c.scanner}</code></div>
                </div>
                <Tag label={findingLabel(c.findings)} color={findingColor(c.findings)}/>
              </div>
            ))}
          </div>
          <div className="mt-5 p-4 bg-base-sec/50 rounded-lg border border-base-border/60 text-xs text-base-muted">
            CI fails the build on high+ severity. The Python findings are in heavy ML/eval dependencies (torch, transformers) installed in the dev venv — pin/upgrade or scan <code className="bg-base-sec px-1 rounded">requirements.txt</code> only to scope them out of the production image.
          </div>
        </Card>
      )}
    </div>
  );
}
