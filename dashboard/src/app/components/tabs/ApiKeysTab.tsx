'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Copy, Trash2, Eye, EyeOff, Key, Check } from 'lucide-react';

interface ApiKey {
  id: string; name: string; key: string; tenant: string;
  created: string; lastUsed: string; requests: number; status: 'active' | 'revoked';
}

function mask(key: string) { return key.slice(0, 8) + '••••••••••••' + key.slice(-4); }

const INITIAL: ApiKey[] = [
  { id: 'key-1', name: 'Production App',  key: 'titan_prod_xK9mN2pQrLvTsYwJhBd4', tenant: 'acme_prod',  created: '2026-01-15', lastUsed: '2026-06-05', requests: 142890, status: 'active' },
  { id: 'key-2', name: 'Staging Server',  key: 'titan_stg_aF3hG7kRnVwXcZqMjPeU', tenant: 'acme_stg',   created: '2026-02-01', lastUsed: '2026-06-04', requests: 28441,  status: 'active' },
  { id: 'key-3', name: 'Local Dev',       key: 'titan_dev_bL5tW8sCuDyEiOlApQnR', tenant: 'dev_sharvik', created: '2026-05-20', lastUsed: '2026-06-05', requests: 891,    status: 'active' },
  { id: 'key-4', name: 'Old CI Bot',      key: 'titan_ci_zX1vN4mKjHpFgYrBoWsQ',  tenant: 'ci_legacy',   created: '2025-11-01', lastUsed: '2026-03-12', requests: 5022,   status: 'revoked' },
];

function kfmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>(INITIAL);
  const [showForm, setShowForm] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [copied, setCopied]     = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', tenant: '' });

  const toggleReveal = (id: string) => setRevealed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const revoke = (id: string) => setKeys(ks => ks.map(k => k.id === id ? { ...k, status: 'revoked' as const } : k));

  const copy = (key: string, id: string) => {
    navigator.clipboard.writeText(key).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const generate = () => {
    if (!form.name.trim()) return;
    const rand = Array.from({ length: 20 }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]).join('');
    const newKey: ApiKey = {
      id: `key-${Date.now()}`, name: form.name, key: `titan_new_${rand}`,
      tenant: form.tenant || 'default', created: new Date().toISOString().slice(0, 10),
      lastUsed: '—', requests: 0, status: 'active',
    };
    setKeys(ks => [newKey, ...ks]);
    setRevealed(s => new Set([...s, newKey.id]));
    setForm({ name: '', tenant: '' });
    setShowForm(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
          <p className="text-sm text-base-muted mt-1">Manage tenant API keys for gateway authentication.</p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-base-text text-base-main rounded-lg text-sm font-medium hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-sm">
          <Plus size={14}/> Generate Key
        </button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="border border-base-border bg-base-card rounded-xl p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Key size={14}/> New API Key</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-base-muted block mb-1.5">Key Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Production App"
                  className="w-full px-3 py-2 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 transition-colors"/>
              </div>
              <div>
                <label className="text-xs font-medium text-base-muted block mb-1.5">Tenant ID</label>
                <input value={form.tenant} onChange={e => setForm(f => ({ ...f, tenant: e.target.value }))} placeholder="e.g. acme_prod"
                  className="w-full px-3 py-2 bg-base-sec border border-base-border rounded-lg text-sm outline-none focus:border-base-muted/60 transition-colors"/>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-base-muted border border-base-border rounded-lg hover:text-base-text transition-colors">Cancel</button>
              <button onClick={generate} className="px-4 py-2 text-sm bg-base-text text-base-main rounded-lg font-medium hover:scale-[1.02] transition-transform">Generate</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="border border-base-border rounded-xl overflow-hidden shadow-sm">
        <div className="grid grid-cols-[1fr_200px_100px_100px_80px] text-[11px] font-semibold text-base-muted uppercase tracking-widest bg-base-sec/50 border-b border-base-border">
          {['Key', 'Tenant / Created', 'Requests', 'Status', ''].map(h => (
            <div key={h} className="px-5 py-3">{h}</div>
          ))}
        </div>
        <AnimatePresence>
          {keys.map(k => (
            <motion.div key={k.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className={`grid grid-cols-[1fr_200px_100px_100px_80px] border-b border-base-border/40 transition-opacity ${k.status === 'revoked' ? 'opacity-40' : ''}`}
            >
              <div className="px-5 py-4">
                <div className="text-sm font-medium text-base-text mb-1">{k.name}</div>
                <div className="flex items-center gap-2">
                  <code className="text-[11px] font-mono text-base-muted">{revealed.has(k.id) ? k.key : mask(k.key)}</code>
                  <button onClick={() => toggleReveal(k.id)} className="text-base-muted/60 hover:text-base-muted transition-colors">
                    {revealed.has(k.id) ? <EyeOff size={11}/> : <Eye size={11}/>}
                  </button>
                  <button onClick={() => copy(k.key, k.id)} className={`transition-colors ${copied === k.id ? 'text-green-400' : 'text-base-muted/60 hover:text-base-muted'}`}>
                    {copied === k.id ? <Check size={11}/> : <Copy size={11}/>}
                  </button>
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="text-sm font-mono text-base-text">{k.tenant}</div>
                <div className="text-[11px] text-base-muted mt-0.5">Created {k.created}</div>
              </div>
              <div className="px-5 py-4 text-sm text-base-text">{kfmt(k.requests)}</div>
              <div className="px-5 py-4">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${k.status === 'active' ? 'bg-green-400/10 text-green-400' : 'bg-base-sec text-base-muted'}`}>
                  {k.status}
                </span>
              </div>
              <div className="px-5 py-4 flex items-center">
                {k.status === 'active' && (
                  <button onClick={() => revoke(k.id)} className="p-1.5 rounded-md text-base-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"><Trash2 size={12}/></button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
