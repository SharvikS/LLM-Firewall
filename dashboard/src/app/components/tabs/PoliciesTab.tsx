'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Shield, ChevronRight, ToggleLeft, ToggleRight } from 'lucide-react';

interface Policy {
  id: string; name: string; description: string; effect: 'ALLOW' | 'DENY';
  principal: string; action: string; condition: string; enabled: boolean;
}

const INITIAL: Policy[] = [
  { id: 'pol-001', name: 'Block High-Risk Requests', description: 'Deny any request where the ML engine assigns risk_score > 70.', effect: 'DENY',  principal: '*',          action: 'InvokeLLM', condition: 'risk_score > 70',   enabled: true },
  { id: 'pol-002', name: 'GDPR EU Strict Mode',      description: 'Enforce strict PII redaction for requests originating in the EU.', effect: 'ALLOW', principal: 'eu_tenants', action: 'InvokeLLM', condition: 'region == "EU"', enabled: true },
  { id: 'pol-003', name: 'Dev Tenant Rate Bypass',   description: 'Allow dev tenants to skip the rate limiter for local testing.', effect: 'ALLOW', principal: 'dev_*',      action: '*',         condition: 'env == "dev"',  enabled: false },
  { id: 'pol-004', name: 'GPT-4 Admin Only',         description: 'Restrict GPT-4o access to admin role principals only.',  effect: 'DENY',  principal: '!admin',    action: 'InvokeLLM', condition: 'model == "gpt-4o"', enabled: true },
];

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${on ? 'bg-base-accent' : 'bg-base-border'}`}>
      <span className={`pointer-events-none inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-sm transition duration-200 ${on ? 'translate-x-4' : 'translate-x-0'}`}/>
    </button>
  );
}

export default function PoliciesTab() {
  const [policies, setPolicies] = useState<Policy[]>(INITIAL);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', effect: 'DENY' as 'ALLOW' | 'DENY', principal: '*', action: 'InvokeLLM', condition: '' });

  const toggle = (id: string) => setPolicies(ps => ps.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p));
  const remove = (id: string) => setPolicies(ps => ps.filter(p => p.id !== id));
  const add = () => {
    if (!form.name.trim()) return;
    setPolicies(ps => [...ps, { ...form, id: `pol-${Date.now()}`, enabled: true }]);
    setForm({ name: '', description: '', effect: 'DENY', principal: '*', action: 'InvokeLLM', condition: '' });
    setShowForm(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Policy Engine</h1>
          <p className="text-sm text-base-muted mt-1">Cedar ABAC policies evaluated on every request.</p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-base-text text-base-main rounded-lg text-sm font-medium hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-sm">
          <Plus size={14}/> New Policy
        </button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="border border-base-border bg-base-card rounded-xl p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold">New Cedar Policy</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { label: 'Policy Name', key: 'name', placeholder: 'e.g. Block EU requests' },
                { label: 'Principal',   key: 'principal', placeholder: 'e.g. tenant_*, !admin' },
                { label: 'Action',      key: 'action', placeholder: 'e.g. InvokeLLM' },
                { label: 'Condition',   key: 'condition', placeholder: 'e.g. risk_score > 70' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="text-xs font-medium text-base-muted block mb-1.5">{label}</label>
                  <input value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full px-3 py-2 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 transition-colors"/>
                </div>
              ))}
            </div>
            <div>
              <label className="text-xs font-medium text-base-muted block mb-1.5">Description</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2}
                className="w-full px-3 py-2 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 transition-colors resize-none"/>
            </div>
            <div className="flex items-center gap-4">
              <label className="text-xs font-medium text-base-muted">Effect</label>
              {(['ALLOW', 'DENY'] as const).map(e => (
                <button key={e} onClick={() => setForm(f => ({ ...f, effect: e }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${form.effect === e ? (e === 'ALLOW' ? 'bg-green-400/15 border-green-400/40 text-green-400' : 'bg-red-400/15 border-red-400/40 text-red-400') : 'border-base-border text-base-muted'}`}
                >{e}</button>
              ))}
              <div className="flex-1 flex justify-end gap-2">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-base-muted hover:text-base-text border border-base-border rounded-lg transition-colors">Cancel</button>
                <button onClick={add} className="px-4 py-2 text-sm bg-base-text text-base-main rounded-lg font-medium hover:scale-[1.02] transition-transform">Add Policy</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-2">
        <AnimatePresence>
          {policies.map(p => (
            <motion.div key={p.id} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
              className={`border rounded-xl p-5 transition-all ${p.enabled ? 'border-base-border bg-base-card' : 'border-base-border/40 bg-base-sec/20 opacity-50'}`}
            >
              <div className="flex items-start gap-4">
                <div className={`mt-0.5 p-2 rounded-lg shrink-0 ${p.effect === 'ALLOW' ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'}`}>
                  <Shield size={14}/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-semibold text-base-text">{p.name}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${p.effect === 'ALLOW' ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'}`}>{p.effect}</span>
                    {!p.enabled && <span className="text-[10px] text-base-muted border border-base-border px-1.5 py-0.5 rounded">Disabled</span>}
                  </div>
                  <p className="text-xs text-base-muted mt-1">{p.description}</p>
                  <div className="flex flex-wrap gap-3 mt-3">
                    {[['Principal', p.principal], ['Action', p.action], ['Condition', p.condition || '—']].map(([k, v]) => (
                      <div key={k} className="bg-base-sec border border-base-border rounded-md px-2 py-1">
                        <span className="text-[10px] text-base-muted block">{k}</span>
                        <code className="text-xs font-mono text-base-text">{v}</code>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Toggle on={p.enabled} onChange={() => toggle(p.id)}/>
                  <button onClick={() => remove(p.id)} className="p-1.5 rounded-md text-base-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"><Trash2 size={13}/></button>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
