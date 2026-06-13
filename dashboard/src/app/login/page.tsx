'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Shield, Loader2, AlertTriangle, LogIn } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(d => setSsoEnabled(!!d.oidc_enabled))
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.replace('/');
        router.refresh();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Login failed');
      }
    } catch {
      setError('Could not reach the control plane');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4"
      style={{ background: 'var(--bg-main)', color: 'var(--text-main)' }}>
      <div className="pointer-events-none fixed top-0 left-1/3 w-[50%] h-[40%] rounded-full opacity-[0.03] blur-[140px]" style={{ background: 'var(--accent)' }}/>
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="w-full max-w-sm rounded-2xl p-8"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }}>
        <div className="flex items-center gap-2.5 mb-7">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 55%, transparent) 100%)' }}>
            <Shield className="w-4 h-4" style={{ color: 'var(--bg-main)' }}/>
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight leading-none">TITAN</div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Control Plane</div>
          </div>
        </div>

        <h1 className="text-lg font-semibold mb-1">Sign in</h1>
        <p className="text-xs mb-6" style={{ color: 'var(--text-muted)' }}>Authenticate to access the gateway control plane.</p>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-widest block mb-1.5" style={{ color: 'var(--text-muted)' }}>Email</label>
            <input type="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)}
              placeholder="admin@titan.local"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors"
              style={{ background: 'var(--bg-sec)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}/>
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-widest block mb-1.5" style={{ color: 'var(--text-muted)' }}>Password</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors"
              style={{ background: 'var(--bg-sec)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}/>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}>
              <AlertTriangle size={13}/> {error}
            </div>
          )}

          <button type="submit" disabled={busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-70 hover:scale-[1.01]"
            style={{ background: 'var(--text-main)', color: 'var(--bg-main)' }}>
            {busy ? <Loader2 size={15} className="animate-spin"/> : <LogIn size={15}/>}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {ssoEnabled && (
          <>
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px" style={{ background: 'var(--border-color)' }}/>
              <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>or</span>
              <div className="flex-1 h-px" style={{ background: 'var(--border-color)' }}/>
            </div>
            <a href="/api/auth/sso/start"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{ background: 'var(--bg-sec)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
              Sign in with SSO
            </a>
          </>
        )}
      </motion.div>
    </div>
  );
}
