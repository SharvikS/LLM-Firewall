'use client';

import React from 'react';
import { motion, type Variants } from 'framer-motion';
import {
  Shield, ShieldCheck, Lock, Eye, Zap, Database, Activity, Terminal,
  ArrowRight, Check, Cpu, FileText, Network, AlertTriangle,
  KeyRound, Gauge, Boxes, Star, ScanLine, Webhook,
} from 'lucide-react';

const GITHUB_URL = 'https://github.com/SharvikS/LLM-Firewall';

// lucide dropped its brand marks (trademark), so the GitHub logo is inlined.
function Github({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58
        0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76
        -1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1
        .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.32.47-2.39 1.24-3.23
        -.12-.31-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55
        3.3-1.23 3.3-1.23.66 1.66.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.62-2.81
        5.64-5.49 5.94.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.22.7.83.58A12.01
        12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

// ── Motion helpers ────────────────────────────────────────────────────────────

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } },
};

function Reveal({ children, className, delay = 0 }: {
  children: React.ReactNode; className?: string; delay?: number;
}) {
  return (
    <motion.div
      className={className}
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-80px' }}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

// ── Small UI atoms ─────────────────────────────────────────────────────────────

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-base-border bg-white/[0.02] px-3 py-1 text-[12px] text-base-muted">
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-base-muted">
      <span className="h-px w-6 bg-base-border" />
      {children}
    </div>
  );
}

// ── Nav ────────────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-base-border/60 bg-base-main/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <a href="#top" className="flex items-center gap-2">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">TITAN</span>
        </a>
        <nav className="hidden items-center gap-7 text-[13px] text-base-muted md:flex">
          <a href="#features" className="transition-colors hover:text-base-text">Features</a>
          <a href="#pipeline" className="transition-colors hover:text-base-text">How it works</a>
          <a href="#pricing" className="transition-colors hover:text-base-text">Editions</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="transition-colors hover:text-base-text">Docs</a>
        </nav>
        <div className="flex items-center gap-2.5">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-lg btn-ghost px-3 py-1.5 text-[13px] sm:inline-flex">
            <Github size={15} /> Star
          </a>
          <a href="#pricing"
            className="inline-flex items-center gap-1.5 rounded-lg btn-primary px-3.5 py-1.5 text-[13px] font-medium">
            Get started <ArrowRight size={14} />
          </a>
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-base-border bg-white/[0.03]">
      <Shield size={15} className="text-base-text" />
    </span>
  );
}

// ── Hero ───────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-36 pb-24">
      {/* backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid mask-radial" />
        <div className="absolute left-1/2 top-10 h-[420px] w-[680px] -translate-x-1/2 glow opacity-70" />
      </div>

      <div className="mx-auto max-w-6xl px-5 text-center">
        <motion.div variants={fadeUp} initial="hidden" animate="show">
          <Pill>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            Open-core · MIT licensed · Self-hostable
          </Pill>
        </motion.div>

        <motion.h1
          variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.06 }}
          className="mx-auto mt-7 max-w-4xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl"
        >
          <span className="text-gradient">The zero-trust firewall</span>
          <br />
          for your LLM traffic
        </motion.h1>

        <motion.p
          variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.12 }}
          className="mx-auto mt-6 max-w-2xl text-pretty text-[16px] leading-relaxed text-base-muted sm:text-[17px]"
        >
          A drop-in reverse proxy for OpenAI, Anthropic, Groq and local models.
          It intercepts, inspects, and governs every request &mdash; blocking prompt
          injections, masking PII, and scanning responses &mdash; before they ever reach the model.
        </motion.p>

        <motion.div
          variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.18 }}
          className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <a href={GITHUB_URL} target="_blank" rel="noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl btn-primary px-5 py-3 text-[14px] font-medium sm:w-auto">
            <Github size={17} /> Star on GitHub
          </a>
          <a href="#pipeline"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl btn-ghost px-5 py-3 text-[14px] font-medium sm:w-auto">
            See how it works <ArrowRight size={15} />
          </a>
        </motion.div>

        {/* terminal */}
        <motion.div
          variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.26 }}
          className="mx-auto mt-14 max-w-2xl"
        >
          <Terminal_ />
        </motion.div>
      </div>
    </section>
  );
}

function Terminal_() {
  return (
    <div className="card card-glow overflow-hidden text-left">
      <div className="flex items-center gap-2 border-b border-base-border px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#2A2A2A]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#2A2A2A]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#2A2A2A]" />
        <span className="ml-2 flex items-center gap-1.5 font-mono text-[11px] text-base-muted">
          <Terminal size={12} /> drop-in &mdash; change two lines
        </span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-relaxed">
<span className="text-base-muted"># point your existing OpenAI client at TITAN</span>{'\n'}
<span className="text-base-text">client = OpenAI(</span>{'\n'}
{'  '}<span className="text-base-text">base_url=</span><span className="text-emerald-300">&quot;https://gateway.yourco.dev/v1&quot;</span><span className="text-base-text">,</span>{'\n'}
{'  '}<span className="text-base-text">api_key=</span><span className="text-emerald-300">&quot;titan_•••••&quot;</span><span className="text-base-text">,</span>{'\n'}
<span className="text-base-text">)</span>{'\n'}
{'\n'}
<span className="text-base-muted"># every call is now firewalled — no other code changes</span>
      </pre>
    </div>
  );
}

// ── Provider marquee ─────────────────────────────────────────────────────────────

function Providers() {
  const items = ['OpenAI', 'Anthropic', 'Groq', 'Ollama', 'vLLM', 'LM Studio', 'Azure OpenAI', 'Mistral'];
  const row = [...items, ...items];
  return (
    <section className="border-y border-base-border/60 py-10">
      <p className="mb-6 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-base-muted">
        Works with any OpenAI-compatible upstream
      </p>
      <div className="marquee-mask">
        <div className="marquee-track gap-12 px-6">
          {row.map((name, i) => (
            <span key={i} className="whitespace-nowrap text-[18px] font-medium text-base-muted/70">
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Stats ────────────────────────────────────────────────────────────────────────

function Stats() {
  const stats = [
    { v: '<1ms', l: 'hot-path overhead' },
    { v: '89.9%', l: 'injection-detection F1' },
    { v: '11', l: 'PII entity types masked' },
    { v: '8', l: 'inspection stages / request' },
  ];
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-base-border bg-base-border md:grid-cols-4">
        {stats.map((s, i) => (
          <Reveal key={s.l} delay={i * 0.06} className="bg-base-main">
            <div className="px-6 py-8 text-center">
              <div className="text-3xl font-semibold tracking-tight sm:text-4xl">{s.v}</div>
              <div className="mt-2 text-[12.5px] text-base-muted">{s.l}</div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ── Threats ──────────────────────────────────────────────────────────────────────

function Threats() {
  const threats = [
    { icon: <AlertTriangle size={18} />, t: 'Prompt injection', d: 'Crafted inputs hijack your model into ignoring instructions, leaking system prompts, or running unintended tool calls.' },
    { icon: <Eye size={18} />, t: 'PII & secret leaks', d: 'Customer data, credentials, and API keys get silently shipped to third-party model providers.' },
    { icon: <Gauge size={18} />, t: 'Runaway cost', d: 'Unbounded token usage and abusive traffic turn a feature into an open-ended bill with no ceiling.' },
    { icon: <ScanLine size={18} />, t: 'Zero visibility', d: 'You have no record of what your apps actually send to the model — or what comes back.' },
  ];
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <Reveal>
        <SectionLabel>The problem</SectionLabel>
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          LLMs opened an invisible threat surface
        </h2>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-base-muted">
          The moment your app talks to a model, four risks appear at once &mdash; and none of
          them are visible in your existing stack.
        </p>
      </Reveal>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {threats.map((x, i) => (
          <Reveal key={x.t} delay={i * 0.05}>
            <div className="card card-hover h-full p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-base-border text-base-text">
                {x.icon}
              </div>
              <h3 className="mt-4 text-[15px] font-medium">{x.t}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-base-muted">{x.d}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ── Pipeline ─────────────────────────────────────────────────────────────────────

function Pipeline() {
  const stages = [
    { n: '01', icon: <KeyRound size={15} />, t: 'Authenticate', d: 'Tenant-scoped keys, revocable at runtime' },
    { n: '02', icon: <Gauge size={15} />, t: 'Rate limit & quota', d: 'Per-tenant RPM / TPM + monthly plan ceilings' },
    { n: '03', icon: <Database size={15} />, t: 'Cache', d: 'Exact SHA-256 + semantic vector lookups' },
    { n: '04', icon: <Cpu size={15} />, t: 'ML analysis', d: 'Injection, toxicity & PII scan via gRPC' },
    { n: '05', icon: <FileText size={15} />, t: 'Policy engine', d: 'Default-deny ABAC: allow / deny / log' },
    { n: '06', icon: <Network size={15} />, t: 'Proxy & failover', d: 'Primary → fallback with masked replay' },
    { n: '07', icon: <ScanLine size={15} />, t: 'Output scan', d: 'Mask PII / secrets the model emits, inline on streams' },
    { n: '08', icon: <Activity size={15} />, t: 'Audit', d: 'Async event stream — zero added latency' },
  ];
  return (
    <section id="pipeline" className="relative border-y border-base-border/60 py-20">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-dots opacity-40 mask-radial" />
      <div className="mx-auto max-w-6xl px-5">
        <Reveal className="text-center">
          <SectionLabel>
            <span className="mx-auto flex items-center gap-2">How it works</span>
          </SectionLabel>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Eight stages. One request. Sub-millisecond.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed text-base-muted">
            Every call passes a multi-stage inspection pipeline before it reaches the model,
            and every response is scanned on the way back &mdash; all in a single Go binary.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stages.map((s, i) => (
            <Reveal key={s.n} delay={(i % 4) * 0.05}>
              <div className="card card-hover flex h-full flex-col p-5">
                <div className="flex items-center justify-between">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-base-border text-base-text">
                    {s.icon}
                  </span>
                  <span className="font-mono text-[11px] text-base-muted">{s.n}</span>
                </div>
                <h3 className="mt-4 text-[14px] font-medium">{s.t}</h3>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-base-muted">{s.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Features ─────────────────────────────────────────────────────────────────────

function Features() {
  const features = [
    { icon: <ShieldCheck size={18} />, t: 'Prompt-injection defense', d: 'Two layers: instant regex signatures plus a DeBERTa transformer, all inside a 150ms budget with fail-open safety.' },
    { icon: <Lock size={18} />, t: 'Bidirectional PII masking', d: 'Microsoft Presidio detects 11 entity types per message — scrubbed before they leave your network, masked again on the way back.' },
    { icon: <ScanLine size={18} />, t: 'Response-side output scanning', d: 'Masks PII and secrets the model emits, inline on SSE streams without buffering — no partial leak ever escapes.' },
    { icon: <Database size={18} />, t: 'Exact + semantic cache', d: 'SHA-256 exact hits plus MiniLM vector similarity in Qdrant — identical and near-identical prompts skip the upstream entirely.' },
    { icon: <FileText size={18} />, t: 'No-code guardrails & policy', d: 'Operator-defined regex deny rules and a default-deny ABAC policy engine, both editable live from the dashboard.' },
    { icon: <Zap size={18} />, t: 'Drop-in & blazing fast', d: '100% OpenAI-SDK compatible — change only base_url and key. Goroutines + Redis pipelines keep overhead under a millisecond.' },
  ];
  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-20">
      <Reveal>
        <SectionLabel>Capabilities</SectionLabel>
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          A complete security engine, free and open source
        </h2>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-base-muted">
          Everything one team needs to protect its own LLM traffic ships in the MIT core.
          No feature flags, no trial — clone it and run.
        </p>
      </Reveal>
      <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {features.map((f, i) => (
          <Reveal key={f.t} delay={(i % 3) * 0.05}>
            <div className="card card-hover h-full p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-base-border bg-white/[0.02] text-base-text">
                {f.icon}
              </div>
              <h3 className="mt-5 text-[15.5px] font-medium">{f.t}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-base-muted">{f.d}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ── Pricing / Editions ───────────────────────────────────────────────────────────

function Pricing() {
  const tiers = [
    {
      name: 'Community',
      price: 'Free',
      sub: 'MIT · self-hosted forever',
      cta: 'Clone on GitHub',
      href: GITHUB_URL,
      highlight: false,
      features: [
        'Full zero-trust proxy & failover',
        'Injection, toxicity, PII & secret detection',
        'Response-side output scanning',
        'Exact + semantic caching',
        'No-code guardrails & policy engine',
        'Browser DLP (text) + SDKs + dashboard',
      ],
    },
    {
      name: 'Pro',
      price: '$499',
      sub: 'per month',
      cta: 'Start with Pro',
      href: 'mailto:sharviksutar@gmail.com?subject=TITAN%20Pro',
      highlight: true,
      features: [
        'Everything in Community',
        'Multi-tenant isolation & metering',
        'Plan quotas & usage billing',
        'OIDC SSO + 4-tier RBAC',
        'Real-time SOC alerting',
        'Hallucination / groundedness scoring',
      ],
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      sub: 'for regulated & at-scale teams',
      cta: 'Contact sales',
      href: 'mailto:sharviksutar@gmail.com?subject=TITAN%20Enterprise',
      highlight: false,
      features: [
        'Everything in Pro',
        'Compliance & audit export',
        'WASM custom-rule plugins',
        'mTLS, backup / DR, Helm & Terraform',
        'Unlimited tenants & volume',
        'Priority support & SLA',
      ],
    },
  ];
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-5 py-20">
      <Reveal className="text-center">
        <SectionLabel><span className="mx-auto">Editions</span></SectionLabel>
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Open-core, fairly priced</h2>
        <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed text-base-muted">
          The security engine is free and MIT. Paid tiers add what an organization needs at
          scale &mdash; identity, governance, compliance, and a SOC.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        {tiers.map((t, i) => (
          <Reveal key={t.name} delay={i * 0.07}>
            <div className={`card relative flex h-full flex-col p-7 ${t.highlight ? 'border-white/25' : ''} ${t.highlight ? 'card-glow' : ''}`}>
              {t.highlight && (
                <span className="absolute right-5 top-6 rounded-full border border-base-border bg-white/[0.04] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-base-muted">
                  Popular
                </span>
              )}
              <h3 className="text-[15px] font-medium">{t.name}</h3>
              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tracking-tight">{t.price}</span>
              </div>
              <p className="mt-1 text-[12.5px] text-base-muted">{t.sub}</p>

              <ul className="mt-6 space-y-3">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[13.5px] text-base-muted">
                    <Check size={15} className="mt-0.5 shrink-0 text-base-text" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <a href={t.href} target={t.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer"
                className={`mt-7 inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-[13.5px] font-medium ${
                  t.highlight ? 'btn-primary' : 'btn-ghost'
                }`}>
                {t.cta} <ArrowRight size={14} />
              </a>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ── Final CTA ────────────────────────────────────────────────────────────────────

function FinalCTA() {
  return (
    <section className="relative overflow-hidden border-t border-base-border/60 py-24">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid mask-radial opacity-70" />
        <div className="absolute left-1/2 top-1/2 h-[300px] w-[560px] -translate-x-1/2 -translate-y-1/2 glow opacity-60" />
      </div>
      <Reveal className="mx-auto max-w-3xl px-5 text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-base-border bg-white/[0.03]">
          <Boxes size={22} />
        </div>
        <h2 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Ship AI features without shipping the risk
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[15.5px] leading-relaxed text-base-muted">
          Stand up the full stack with one command, point your client at it, and every LLM
          call is inspected, governed, and logged.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl btn-primary px-5 py-3 text-[14px] font-medium sm:w-auto">
            <Github size={17} /> Get started free
          </a>
          <a href="mailto:sharviksutar@gmail.com?subject=TITAN%20Enterprise"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl btn-ghost px-5 py-3 text-[14px] font-medium sm:w-auto">
            <Webhook size={16} /> Talk to us
          </a>
        </div>
        <p className="mt-6 font-mono text-[12px] text-base-muted">docker-compose up -d &nbsp;·&nbsp; 8-service cluster in one command</p>
      </Reveal>
    </section>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-base-border/60">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="text-[14px] font-semibold">TITAN</span>
          <span className="ml-2 text-[12.5px] text-base-muted">Zero-Trust LLM Firewall</span>
        </div>
        <div className="flex items-center gap-6 text-[13px] text-base-muted">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 transition-colors hover:text-base-text">
            <Github size={15} /> GitHub
          </a>
          <a href="#features" className="transition-colors hover:text-base-text">Features</a>
          <a href="#pricing" className="transition-colors hover:text-base-text">Editions</a>
          <span className="flex items-center gap-1.5"><Star size={13} /> MIT</span>
        </div>
      </div>
      <div className="border-t border-base-border/40 py-5 text-center text-[12px] text-base-muted">
        © {new Date().getFullYear()} Sharvik Sutar · Built with precision at{' '}
        <a href="https://sharvik.tech" target="_blank" rel="noreferrer" className="text-base-text underline-offset-4 hover:underline">
          sharvik.tech
        </a>
      </div>
    </footer>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────────

export default function Page() {
  return (
    <main className="relative">
      <Nav />
      <Hero />
      <Providers />
      <Stats />
      <Threats />
      <Pipeline />
      <Features />
      <Pricing />
      <FinalCTA />
      <Footer />
    </main>
  );
}
