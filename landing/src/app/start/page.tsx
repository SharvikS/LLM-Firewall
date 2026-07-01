'use client';

import React, { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Check, Copy, Loader2, ShieldCheck, Terminal } from 'lucide-react';

type Tier = 'free' | 'starter' | 'pro';

interface ActivationResult {
  status: 'active' | 'manual' | 'payment_required' | 'provisioning_failed';
  message?: string;
  plan?: Tier;
  email?: string;
  apiKey?: string;
  dashboardUrl?: string;
  gatewayBaseUrl?: string;
  contactUrl?: string;
}

const tierLabels: Record<Tier, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
};

function initialTier(raw: string | null): Tier {
  return raw === 'starter' || raw === 'pro' ? raw : 'free';
}

function StartForm() {
  const params = useSearchParams();
  const [tier, setTier] = useState<Tier>(() => initialTier(params.get('tier')));
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'submitting'>('idle');
  const [result, setResult] = useState<ActivationResult | null>(null);
  const [error, setError] = useState('');
  const sessionId = params.get('session_id') || '';

  const sdkSnippet = useMemo(() => {
    if (!result?.apiKey || !result.gatewayBaseUrl) return '';
    return `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${result.gatewayBaseUrl}",\n    api_key="${result.apiKey}",\n)`;
  }, [result]);

  const activate = async (event: React.FormEvent) => {
    event.preventDefault();
    setState('submitting');
    setError('');
    setResult(null);

    try {
      const response = await fetch('/api/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier, company, email, password, sessionId }),
      });
      const data = await response.json();
      if (!response.ok && data.status !== 'manual') {
        setError(data.message || data.error || 'Activation failed.');
      }
      setResult(data);
    } catch {
      setError('Activation service is unavailable.');
    } finally {
      setState('idle');
    }
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
  };

  return (
    <main className="min-h-screen bg-base-main px-5 py-8 text-base-text sm:py-12">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-base-border bg-white/[0.03]">
            <ShieldCheck size={16} />
          </span>
          TITAN
        </Link>
        <Link href="/#pricing" className="text-[13px] text-base-muted transition-colors hover:text-base-text">
          Pricing
        </Link>
      </div>

      <section className="mx-auto grid max-w-5xl gap-8 py-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-base-border bg-white/[0.02] px-3 py-1 text-[12px] text-base-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Hosted activation
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
            Create a workspace and start sending traffic
          </h1>
          <p className="mt-5 max-w-xl text-[15.5px] leading-relaxed text-base-muted">
            No repo clone, no Docker, no env-file editing. A configured TITAN Cloud deployment
            provisions the dashboard login and firewall API key from this page.
          </p>
          <div className="mt-8 grid gap-3 text-[13.5px] text-base-muted">
            {['Dashboard login', 'Hosted gateway endpoint', 'App API key shown once'].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <Check size={15} className="text-base-text" />
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-base-border bg-base-card p-6">
          <form onSubmit={activate} className="grid gap-5">
            <div>
              <label className="mb-2 block text-[12px] font-medium uppercase tracking-widest text-base-muted">Plan</label>
              <div className="grid grid-cols-3 gap-2">
                {(['free', 'starter', 'pro'] as Tier[]).map((option) => (
                  <button
                    type="button"
                    key={option}
                    onClick={() => setTier(option)}
                    className={`rounded-lg border px-3 py-2 text-[13px] transition-colors ${
                      tier === option
                        ? 'border-white/35 bg-white text-black'
                        : 'border-base-border bg-transparent text-base-muted hover:text-base-text'
                    }`}
                  >
                    {tierLabels[option]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="company" className="mb-2 block text-[12px] font-medium uppercase tracking-widest text-base-muted">Workspace</label>
              <input
                id="company"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder="Acme AI"
                className="w-full rounded-lg border border-base-border bg-base-main px-4 py-3 text-[14px] outline-none transition-colors placeholder:text-base-muted/50 focus:border-white/30"
                required
              />
            </div>

            <div>
              <label htmlFor="email" className="mb-2 block text-[12px] font-medium uppercase tracking-widest text-base-muted">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-lg border border-base-border bg-base-main px-4 py-3 text-[14px] outline-none transition-colors placeholder:text-base-muted/50 focus:border-white/30"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-[12px] font-medium uppercase tracking-widest text-base-muted">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                placeholder="8+ characters"
                className="w-full rounded-lg border border-base-border bg-base-main px-4 py-3 text-[14px] outline-none transition-colors placeholder:text-base-muted/50 focus:border-white/30"
                required
              />
            </div>

            {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">{error}</div>}

            <button
              type="submit"
              disabled={state === 'submitting'}
              className="inline-flex items-center justify-center gap-2 rounded-xl btn-primary px-5 py-3 text-[14px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state === 'submitting' ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              Activate workspace
            </button>
          </form>

          {result?.status === 'active' && result.apiKey && result.dashboardUrl && result.gatewayBaseUrl && (
            <div className="mt-6 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-5">
              <div className="text-[14px] font-semibold text-emerald-100">Workspace active</div>
              <div className="mt-4 grid gap-3 text-[13px] text-base-muted">
                <a href={result.dashboardUrl} className="inline-flex items-center gap-2 text-base-text hover:underline">
                  Open dashboard <ArrowRight size={14} />
                </a>
                <div className="rounded-lg border border-base-border bg-base-main p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="font-mono text-[11px] uppercase tracking-wider">Gateway base URL</span>
                    <button type="button" onClick={() => copy(result.gatewayBaseUrl || '')} className="text-base-text">
                      <Copy size={14} />
                    </button>
                  </div>
                  <code className="break-all text-base-text">{result.gatewayBaseUrl}</code>
                </div>
                <div className="rounded-lg border border-base-border bg-base-main p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="font-mono text-[11px] uppercase tracking-wider">API key</span>
                    <button type="button" onClick={() => copy(result.apiKey || '')} className="text-base-text">
                      <Copy size={14} />
                    </button>
                  </div>
                  <code className="break-all text-base-text">{result.apiKey}</code>
                </div>
                <pre className="overflow-x-auto rounded-lg border border-base-border bg-base-main p-3 font-mono text-[12px] leading-relaxed text-base-text">
                  {sdkSnippet}
                </pre>
              </div>
            </div>
          )}

          {result?.status === 'manual' && (
            <div className="mt-6 rounded-xl border border-yellow-500/25 bg-yellow-500/10 p-5">
              <div className="text-[14px] font-semibold text-yellow-100">Activation is in manual mode</div>
              <p className="mt-2 text-[13px] leading-relaxed text-base-muted">{result.message}</p>
              {result.contactUrl && (
                <a href={result.contactUrl} className="mt-4 inline-flex items-center gap-2 rounded-lg btn-ghost px-4 py-2 text-[13px]">
                  Contact support <ArrowRight size={14} />
                </a>
              )}
            </div>
          )}

          {result?.status === 'payment_required' && (
            <div className="mt-6 rounded-xl border border-yellow-500/25 bg-yellow-500/10 p-5">
              <div className="text-[14px] font-semibold text-yellow-100">Checkout required</div>
              <p className="mt-2 text-[13px] leading-relaxed text-base-muted">{result.message}</p>
              <Link href={`/api/checkout?tier=${tier}`} className="mt-4 inline-flex items-center gap-2 rounded-lg btn-primary px-4 py-2 text-[13px]">
                Go to checkout <ArrowRight size={14} />
              </Link>
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-5xl border-t border-base-border py-6 text-[12px] text-base-muted">
        <Terminal size={13} className="mr-1 inline" />
        Self-hosting is still available from GitHub for teams that need full infrastructure control.
      </div>
    </main>
  );
}

export default function StartPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-base-main text-base-text" />}>
      <StartForm />
    </Suspense>
  );
}
