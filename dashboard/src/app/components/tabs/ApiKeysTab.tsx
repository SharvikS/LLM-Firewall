'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Copy, Trash2, Eye, EyeOff, Key, Check, RefreshCw, AlertTriangle } from 'lucide-react';

interface APIKey {
  id: string; tenant_id: string; name: string;
  key_hash: string; key_prefix: string;
  active: boolean; requests: number;
  last_used_at: string | null; created_at: string;
}

interface Tenant { id: string; name: string; tier: string; }

function kfmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function ApiKeysTab() {
  const [keys, setKeys]           = useState<APIKey[]>([]);
  const [tenants, setTenants]     = useState<Tenant[]>([]);
  const [loading, setLoading]     = useState(true);
  const [offline, setOffline]     = useState(false);
  const [showForm, setShowForm]   = useState(false);
  const [revealed, setRevealed]   = useState<Record<string, string>>({}); // id → raw key (only after generation)
  const [copied, setCopied]       = useState<string | null>(null);
  const [newKey, setNewKey]       = useState<{ raw: string; id: string } | null>(null);
  const [form, setForm]           = useState({ name: '', tenant_id: '' });
  const [saving, setSaving]       = useState(false);

  const fetchData = useCallback(async () => {
    const [kRes, tRes] = await Promise.all([
      fetch('/api/admin/keys').catch(() => null),
      fetch('/api/admin/tenants').catch(() => null),
    ]);
    if (kRes?.ok) {
      const data = await kRes.json();
      setKeys(data.keys ?? []);
      setOffline(!!data._offline);
    } else {
      setOffline(true);
    }
    if (tRes?.ok) {
      const data = await tRes.json();
      setTenants(data.tenants ?? []);
      if (!form.tenant_id && data.tenants?.length) {
        setForm(f => ({ ...f, tenant_id: data.tenants[0].id }));
      }
    }
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  const generate = async () => {
    if (!form.name.trim() || !form.tenant_id) return;
    setSaving(true);
    const res = await fetch('/api/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      const data = await res.json();
      setKeys(ks => [data.metadata, ...ks]);
      setNewKey({ raw: data.key, id: data.metadata.id });
      setForm(f => ({ ...f, name: '' }));
      setShowForm(false);
    }
    setSaving(false);
  };

  const revoke = async (id: string) => {
    const res = await fetch(`/api/admin/keys/${id}`, { method: 'DELETE' });
    if (res.ok) setKeys(ks => ks.map(k => k.id === id ? { ...k, active: false } : k));
  };

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
          <p className="text-sm text-base-muted mt-1">
            {offline
              ? <span className="text-yellow-500 font-medium">Gateway offline</span>
              : `${keys.length} keys · raw key shown once at generation`
            }
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchData} className="p-1.5 border border-base-border rounded-lg text-base-muted hover:text-base-text hover:bg-base-sec transition-colors"><RefreshCw size={13}/></button>
          <button onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-base-text text-base-main rounded-lg text-sm font-medium hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-sm">
            <Plus size={14}/> Generate Key
          </button>
        </div>
      </div>

      {/* New key banner — shown once after generation */}
      <AnimatePresence>
        {newKey && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="border border-green-400/30 bg-green-400/5 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle size={16} className="text-green-400 mt-0.5 shrink-0"/>
              <div className="flex-1">
                <div className="text-sm font-semibold text-green-400 mb-1">Save this key — it won't be shown again</div>
                <div className="flex items-center gap-3 bg-base-sec border border-base-border rounded-lg px-4 py-2.5">
                  <code className="text-sm font-mono text-base-text flex-1 break-all">{newKey.raw}</code>
                  <button onClick={() => copy(newKey.raw, 'banner')} className={`shrink-0 transition-colors ${copied === 'banner' ? 'text-green-400' : 'text-base-muted hover:text-base-text'}`}>
                    {copied === 'banner' ? <Check size={14}/> : <Copy size={14}/>}
                  </button>
                </div>
              </div>
              <button onClick={() => setNewKey(null)} className="text-base-muted hover:text-base-text text-lg leading-none">×</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generate form */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="border border-base-border bg-base-card rounded-xl p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Key size={14}/> New API Key</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-base-muted block mb-1.5">Key Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Production App"
                  className="w-full px-3 py-2 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 transition-colors"/>
              </div>
              <div>
                <label className="text-xs font-medium text-base-muted block mb-1.5">Tenant</label>
                <select value={form.tenant_id} onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}
                  className="w-full px-3 py-2 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 transition-colors">
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.tier})</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-base-muted border border-base-border rounded-lg hover:text-base-text transition-colors">Cancel</button>
              <button onClick={generate} disabled={saving || !form.name.trim()}
                className="px-4 py-2 text-sm bg-base-text text-base-main rounded-lg font-medium hover:scale-[1.02] transition-transform disabled:opacity-50">
                {saving ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keys table */}
      <div className="border border-base-border rounded-xl overflow-hidden shadow-sm">
        <div className="grid grid-cols-[1fr_160px_100px_100px_80px] text-[11px] font-semibold text-base-muted uppercase tracking-widest bg-base-sec/50 border-b border-base-border">
          {['Key', 'Tenant / Created', 'Requests', 'Status', ''].map(h => <div key={h} className="px-5 py-3">{h}</div>)}
        </div>
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="grid grid-cols-[1fr_160px_100px_100px_80px] border-b border-base-border/40 animate-pulse p-4 gap-4">
              {Array.from({ length: 5 }).map((_, j) => <div key={j} className="h-5 bg-base-sec rounded"/>)}
            </div>
          ))
        ) : keys.length === 0 ? (
          <div className="py-12 text-center text-base-muted text-sm">
            <Key size={24} className="mx-auto mb-2 opacity-30"/>
            No API keys yet. Generate one above.
          </div>
        ) : (
          <AnimatePresence>
            {keys.map(k => (
              <motion.div key={k.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className={`grid grid-cols-[1fr_160px_100px_100px_80px] border-b border-base-border/40 transition-opacity ${!k.active ? 'opacity-40' : ''}`}
              >
                <div className="px-5 py-4">
                  <div className="text-sm font-medium text-base-text mb-1">{k.name}</div>
                  <div className="flex items-center gap-2">
                    <code className="text-[11px] font-mono text-base-muted">{k.key_prefix}••••••••••••</code>
                    {revealed[k.id] ? (
                      <>
                        <code className="text-[11px] font-mono text-green-400">{revealed[k.id]}</code>
                        <button onClick={() => setRevealed(r => { const n = {...r}; delete n[k.id]; return n; })} className="text-base-muted/60 hover:text-base-muted"><EyeOff size={11}/></button>
                        <button onClick={() => copy(revealed[k.id], k.id)} className={`transition-colors ${copied === k.id ? 'text-green-400' : 'text-base-muted/60 hover:text-base-muted'}`}>
                          {copied === k.id ? <Check size={11}/> : <Copy size={11}/>}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="px-5 py-4">
                  <div className="text-xs font-mono text-base-text">{tenants.find(t => t.id === k.tenant_id)?.name ?? k.tenant_id.slice(0, 8)}</div>
                  <div className="text-[11px] text-base-muted mt-0.5">{new Date(k.created_at).toLocaleDateString()}</div>
                </div>
                <div className="px-5 py-4 text-sm text-base-text">{kfmt(k.requests)}</div>
                <div className="px-5 py-4">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${k.active ? 'bg-green-400/10 text-green-400' : 'bg-base-sec text-base-muted'}`}>
                    {k.active ? 'active' : 'revoked'}
                  </span>
                </div>
                <div className="px-5 py-4 flex items-center">
                  {k.active && (
                    <button onClick={() => revoke(k.id)} className="p-1.5 rounded-md text-base-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"><Trash2 size={12}/></button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
