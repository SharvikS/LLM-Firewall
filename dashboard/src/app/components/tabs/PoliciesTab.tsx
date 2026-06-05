'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Shield, RefreshCw, Check } from 'lucide-react';

interface Policy {
  id: string; name: string; description: string; effect: 'ALLOW' | 'DENY';
  principal: string; action: string; condition: string; enabled: boolean;
  created_at: string;
}

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${on ? 'bg-base-accent' : 'bg-base-border'}`}>
      <span className={`pointer-events-none inline-block h-[16px] w-[16px] transform rounded-full bg-white shadow-sm transition duration-200 ${on ? 'translate-x-4' : 'translate-x-0'}`}/>
    </button>
  );
}

export default function PoliciesTab() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading]   = useState(true);
  const [offline, setOffline]   = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState<string | null>(null);
  const [form, setForm]         = useState({
    name: '', description: '', effect: 'DENY' as 'ALLOW' | 'DENY',
    principal: '*', action: 'InvokeLLM', condition: '',
  });

  const fetchPolicies = useCallback(async () => {
    const res = await fetch('/api/admin/policies').catch(() => null);
    if (!res?.ok) { setOffline(true); setLoading(false); return; }
    const data = await res.json();
    setPolicies(data.policies ?? []);
    setOffline(!!data._offline);
    setLoading(false);
  }, []);

  useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

  const toggle = async (p: Policy) => {
    const res = await fetch(`/api/admin/policies/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...p, enabled: !p.enabled }),
    });
    if (res.ok) {
      const updated = await res.json();
      setPolicies(ps => ps.map(x => x.id === p.id ? updated : x));
      setSaved(p.id);
      setTimeout(() => setSaved(null), 1500);
    }
  };

  const remove = async (id: string) => {
    const res = await fetch(`/api/admin/policies/${id}`, { method: 'DELETE' });
    if (res.ok) setPolicies(ps => ps.filter(p => p.id !== id));
  };

  const add = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    const res = await fetch('/api/admin/policies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      const created = await res.json();
      setPolicies(ps => [created, ...ps]);
      setForm({ name: '', description: '', effect: 'DENY', principal: '*', action: 'InvokeLLM', condition: '' });
      setShowForm(false);
    }
    setSaving(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Policy Engine</h1>
          <p className="text-sm text-base-muted mt-1">
            {offline
              ? <span className="text-yellow-500 font-medium">Gateway offline — changes won't be saved</span>
              : `${policies.length} Cedar ABAC policies — changes take effect on next 30s refresh`
            }
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchPolicies} className="p-1.5 border border-base-border rounded-lg text-base-muted hover:text-base-text hover:bg-base-sec transition-colors"><RefreshCw size={13}/></button>
          <button onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-base-text text-base-main rounded-lg text-sm font-medium hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-sm">
            <Plus size={14}/> New Policy
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="border border-base-border bg-base-card rounded-xl p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold">New Cedar Policy</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {([
                ['Policy Name', 'name', 'e.g. Block EU requests'],
                ['Principal', 'principal', 'e.g. tenant_*, !admin'],
                ['Action', 'action', 'e.g. InvokeLLM'],
                ['Condition', 'condition', 'e.g. risk_score > 70'],
              ] as [string, string, string][]).map(([label, key, placeholder]) => (
                <div key={key}>
                  <label className="text-xs font-medium text-base-muted block mb-1.5">{label}</label>
                  <input value={(form as any)[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full px-3 py-2 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 transition-colors"/>
                </div>
              ))}
            </div>
            <div>
              <label className="text-xs font-medium text-base-muted block mb-1.5">Description</label>
              <textarea value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2}
                className="w-full px-3 py-2 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 resize-none transition-colors"/>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs font-medium text-base-muted">Effect</span>
              {(['ALLOW', 'DENY'] as const).map(e => (
                <button key={e} onClick={() => setForm(f => ({ ...f, effect: e }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${form.effect === e ? (e === 'ALLOW' ? 'bg-green-400/15 border-green-400/40 text-green-400' : 'bg-red-400/15 border-red-400/40 text-red-400') : 'border-base-border text-base-muted'}`}
                >{e}</button>
              ))}
              <div className="flex-1 flex justify-end gap-2">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-base-muted border border-base-border rounded-lg hover:text-base-text transition-colors">Cancel</button>
                <button onClick={add} disabled={saving}
                  className="px-4 py-2 text-sm bg-base-text text-base-main rounded-lg font-medium hover:scale-[1.02] transition-transform disabled:opacity-50">
                  {saving ? 'Saving…' : 'Add Policy'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border border-base-border rounded-xl p-5 animate-pulse">
            <div className="h-4 w-48 bg-base-sec rounded mb-2"/>
            <div className="h-3 w-72 bg-base-sec rounded"/>
          </div>
        ))
      ) : (
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
                      <span className="text-sm font-semibold">{p.name}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${p.effect === 'ALLOW' ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'}`}>{p.effect}</span>
                      {!p.enabled && <span className="text-[10px] text-base-muted border border-base-border px-1.5 py-0.5 rounded">Disabled</span>}
                      {saved === p.id && <span className="text-[10px] text-green-400 flex items-center gap-1"><Check size={10}/>Saved</span>}
                    </div>
                    {p.description && <p className="text-xs text-base-muted mt-1">{p.description}</p>}
                    <div className="flex flex-wrap gap-3 mt-3">
                      {([['Principal', p.principal], ['Action', p.action], ...(p.condition ? [['Condition', p.condition]] : [])] as [string,string][]).map(([k, v]) => (
                        <div key={k} className="bg-base-sec border border-base-border rounded-md px-2 py-1">
                          <span className="text-[10px] text-base-muted block">{k}</span>
                          <code className="text-xs font-mono text-base-text">{v}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Toggle on={p.enabled} onChange={() => toggle(p)}/>
                    <button onClick={() => remove(p.id)} className="p-1.5 rounded-md text-base-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"><Trash2 size={13}/></button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {policies.length === 0 && !loading && (
            <div className="py-16 text-center text-base-muted border border-base-border rounded-xl">
              <Shield size={24} className="mx-auto mb-2 opacity-30"/>
              <p className="text-sm">No policies yet. Add the first one above.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
