import Image from 'next/image';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  ArrowRight,
  Bot,
  Check,
  CircleGauge,
  Database,
  ExternalLink,
  Eye,
  FileCheck2,
  GitFork,
  LockKeyhole,
  ScanSearch,
  Shield,
  ShieldCheck,
  Terminal,
  Waypoints,
} from 'lucide-react';

const GITHUB_URL = 'https://github.com/SharvikS/LLM-Firewall';
const DOCS_URL = `${GITHUB_URL}/tree/main/docs`;
const CONTRIBUTING_URL = `${GITHUB_URL}/blob/main/CONTRIBUTING.md`;
const ISSUES_URL = `${GITHUB_URL}/issues`;
const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
const DASHBOARD_URL = `${GITHUB_URL}#dashboard`;
const checkoutHref = (tier: 'free' | 'starter' | 'pro') => (
  tier === 'free' ? '/start?tier=free' : `/api/checkout?tier=${tier}`
);

type IconItem = {
  icon: LucideIcon;
  title: string;
  description: string;
};

const benefits: IconItem[] = [
  {
    icon: ShieldCheck,
    title: 'Block adversarial prompts',
    description: 'Detect prompt injection and jailbreak attempts before they reach an upstream model.',
  },
  {
    icon: LockKeyhole,
    title: 'Keep sensitive data private',
    description: 'Mask PII, credentials, secrets, and source-code leaks in requests and responses.',
  },
  {
    icon: CircleGauge,
    title: 'Control usage & spend',
    description: 'Put authentication, policy, rate limits, quotas, and routing in one enforceable layer.',
  },
  {
    icon: FileCheck2,
    title: 'Prove what happened',
    description: 'Record security decisions and metadata for investigation, audit, and compliance workflows.',
  },
];

const capabilities: IconItem[] = [
  {
    icon: ScanSearch,
    title: 'Prompt-injection defense',
    description: 'Fast signatures and ML analysis catch direct, indirect, and obfuscated attacks.',
  },
  {
    icon: LockKeyhole,
    title: 'Bidirectional PII masking',
    description: 'Microsoft Presidio detects sensitive entities before provider calls and on the way back.',
  },
  {
    icon: Activity,
    title: 'Streaming output scanning',
    description: 'Inspect SSE responses inline so sensitive tokens are masked before they escape.',
  },
  {
    icon: Shield,
    title: 'Default-deny policy',
    description: 'Cedar policy, operator guardrails, and API-key sandboxes enforce least privilege.',
  },
  {
    icon: Database,
    title: 'Exact + semantic cache',
    description: 'Safe SHA-256 and vector cache hits reduce repeated provider cost and latency.',
  },
  {
    icon: Eye,
    title: 'Browser DLP',
    description: 'Protect prompts, paste events, files, and images across popular AI web interfaces.',
  },
];

const controlPlaneItems: IconItem[] = [
  {
    icon: Activity,
    title: 'Live threat telemetry',
    description: 'Follow blocked, masked, and allowed requests from a single event stream.',
  },
  {
    icon: ShieldCheck,
    title: 'Policy governance',
    description: 'Test, publish, and version security policy without redeploying every application.',
  },
  {
    icon: Eye,
    title: 'Browser DLP',
    description: 'Bring employee AI web usage into the same controls and investigation workflow.',
  },
  {
    icon: FileCheck2,
    title: 'Audit & compliance',
    description: 'Search evidence, export audit data, and connect downstream security tooling.',
  },
];

const plans = [
  {
    name: 'Free',
    price: '$0',
    suffix: '/month',
    description: 'MIT core for individuals and teams running TITAN themselves.',
    cta: 'Start free',
    href: checkoutHref('free'),
    featured: false,
    features: [
      '10k inspected requests / month',
      'Zero-trust proxy and failover',
      'Injection, PII, secret, and output scanning',
      'Core dashboard, SDKs, and Browser DLP',
    ],
  },
  {
    name: 'Starter',
    price: '$9.99',
    suffix: '/month',
    description: 'A guided hosted path for builders validating real traffic.',
    cta: 'Choose Starter',
    href: checkoutHref('starter'),
    featured: true,
    features: [
      '100k inspected requests / month',
      'Everything in Free',
      'Guided setup and deploy checklist',
      'Plan quotas and usage visibility',
    ],
  },
  {
    name: 'Pro',
    price: '$35',
    suffix: '/month',
    description: 'Organization controls for governed, higher-volume AI usage.',
    cta: 'Choose Pro',
    href: checkoutHref('pro'),
    featured: false,
    features: [
      '1M inspected requests / month',
      'Everything in Starter',
      'Multi-tenant metering, RBAC, and audit export',
      'SOC alerts and groundedness checks',
    ],
  },
];

function GithubMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.32.47-2.39 1.24-3.23-.12-.31-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

function Brand() {
  return (
    <span className="brand-lockup">
      <span className="brand-mark" aria-hidden="true">
        <Shield size={27} strokeWidth={1.7} />
        <span>T</span>
      </span>
      <span className="brand-name">TITAN</span>
    </span>
  );
}

function ArrowIcon() {
  return <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />;
}

function Nav() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a href="#top" aria-label="TITAN home"><Brand /></a>
        <nav className="desktop-nav" aria-label="Primary navigation">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#open-source">Open source</a>
          <a href="#editions">Editions</a>
          <a href={DOCS_URL} target="_blank" rel="noreferrer">Docs</a>
        </nav>
        <div className="nav-actions">
          <a className="button button-ghost nav-star" href={GITHUB_URL} target="_blank" rel="noreferrer">
            <GithubMark size={16} />
            <span>Star on GitHub</span>
          </a>
          <a className="button button-accent" href={CONTRIBUTING_URL} target="_blank" rel="noreferrer">
            <GitFork size={15} />
            <span>Contribute</span>
          </a>
        </div>
      </div>
    </header>
  );
}

function CodeWindow() {
  return (
    <div className="code-window">
      <div className="code-window-bar">
        <span className="code-window-title"><Terminal size={13} /> OpenAI SDK</span>
        <span className="code-window-status">two-line integration</span>
      </div>
      <pre aria-label="OpenAI SDK configured to use TITAN"><code><span className="code-muted">from</span> openai <span className="code-muted">import</span> OpenAI{'\n\n'}client = OpenAI({'\n'}  base_url=<span className="code-accent">&quot;http://localhost:8080/v1&quot;</span>,{'\n'}  api_key=<span className="code-accent">&quot;titan_••••••••&quot;</span>,{'\n'})</code></pre>
      <div className="code-window-foot">
        <span><span className="status-dot" /> Request inspection active</span>
        <span>provider unchanged</span>
      </div>
    </div>
  );
}

function DashboardFrame({ hero = false }: { hero?: boolean }) {
  return (
    <div className={`titanium-frame ${hero ? 'titanium-frame-hero' : ''}`}>
      <div className="frame-topline">
        <span><span className="status-dot" /> TITAN product tour</span>
        <span>policy · audit · DLP</span>
      </div>
      <div className="dashboard-image-wrap">
        <Image
          src="/product/screenshot_overview.png"
          alt="TITAN dashboard showing live LLM security telemetry and events"
          width={1600}
          height={1000}
          priority={hero}
          loading={hero ? 'eager' : 'lazy'}
          fetchPriority={hero ? 'high' : 'auto'}
          sizes={hero ? '(max-width: 1024px) 100vw, 58vw' : '(max-width: 1024px) 100vw, 68vw'}
          className="dashboard-image"
        />
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section id="top" className="hero-section">
      <div className="hero-grid-bg" aria-hidden="true" />
      <div className="page-shell hero-layout">
        <div className="hero-copy">
          <h1>Secure every LLM request before it becomes a risk.</h1>
          <p>
            TITAN is an OpenAI-compatible gateway that detects prompt injection,
            masks PII and secrets, scans outputs, enforces policy, and records an
            audit trail — without rewriting your app.
          </p>
          <div className="hero-actions">
            <a className="button button-accent button-large" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <GithubMark /> Star on GitHub <ArrowIcon />
            </a>
            <a className="button button-ghost button-large" href="#how-it-works">
              See how TITAN works <ArrowIcon />
            </a>
          </div>
          <CodeWindow />
        </div>
        <div className="hero-product">
          <DashboardFrame hero />
        </div>
      </div>
      <ProviderRail />
    </section>
  );
}

function ProviderRail() {
  return (
    <div className="page-shell provider-rail" aria-label="Supported model providers">
      <div>
        <strong>Works with your stack.</strong>
        <span>Keep the providers and SDKs you already use.</span>
      </div>
      {['OpenAI', 'Anthropic', 'Groq', 'Gemini', 'Ollama', 'vLLM'].map((provider) => (
        <span className="provider-name" key={provider}>{provider}</span>
      ))}
    </div>
  );
}

function BenefitRail() {
  return (
    <section className="benefit-section">
      <div className="page-shell benefit-grid">
        {benefits.map((benefit) => {
          const Icon = benefit.icon;
          return (
            <article key={benefit.title}>
              <Icon size={27} strokeWidth={1.55} />
              <div>
                <h2>{benefit.title}</h2>
                <p>{benefit.description}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SecurityFlow() {
  const stages = [
    { number: '01', title: 'Inspect prompts', description: 'Injection · PII · secrets', icon: ScanSearch },
    { number: '02', title: 'Enforce policy', description: 'Auth · quotas · Cedar', icon: ShieldCheck },
    { number: '03', title: 'Scan responses', description: 'Streaming PII · secrets', icon: Activity },
    { number: '04', title: 'Audit everything', description: 'Events · evidence · SIEM', icon: FileCheck2 },
  ];

  return (
    <section id="how-it-works" className="section-pad flow-section">
      <div className="page-shell">
        <div className="section-heading centered-heading">
          <h2>One gateway. Protection in both directions.</h2>
          <p>Every prompt is inspected before it leaves your boundary. Every response is scanned before it reaches your application.</p>
        </div>
        <div className="flow-map">
          <div className="flow-endpoint">
            <Bot size={30} />
            <strong>Apps & Browser DLP</strong>
            <span>prompts in · responses out</span>
          </div>
          <div className="flow-line flow-line-left" aria-hidden="true"><span /></div>
          <div className="flow-core">
            <span className="flow-core-mark"><Shield size={33} /><b>T</b></span>
            <strong>TITAN</strong>
            <span>Gateway</span>
          </div>
          <div className="flow-line flow-line-right" aria-hidden="true"><span /></div>
          <div className="flow-endpoint">
            <Waypoints size={30} />
            <strong>Upstream LLMs</strong>
            <span>hosted · local · private</span>
          </div>
          <div className="flow-stages">
            {stages.map((stage) => {
              const Icon = stage.icon;
              return (
                <article key={stage.number}>
                  <div className="flow-stage-head">
                    <span>{stage.number}</span>
                    <Icon size={20} strokeWidth={1.6} />
                  </div>
                  <h3>{stage.title}</h3>
                  <p>{stage.description}</p>
                </article>
              );
            })}
          </div>
          <div className="flow-legend">
            <span><i className="legend-line legend-allowed" /> allowed or masked traffic</span>
            <span><i className="legend-line legend-blocked" /> blocked at the boundary</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureEngine() {
  return (
    <section id="features" className="section-pad feature-section">
      <div className="page-shell feature-layout">
        <div className="feature-intro">
          <h2>The complete security engine, in the open.</h2>
          <p>Everything one developer or team needs to inspect and govern its own LLM traffic ships in the MIT-licensed core.</p>
          <a className="text-link" href={`${GITHUB_URL}/blob/main/EDITIONS.md`} target="_blank" rel="noreferrer">
            Compare Community and Enterprise <ArrowIcon />
          </a>
        </div>
        <div className="feature-list">
          {capabilities.map((capability, index) => {
            const Icon = capability.icon;
            return (
              <article key={capability.title}>
                <span className="feature-number">{String(index + 1).padStart(2, '0')}</span>
                <Icon size={24} strokeWidth={1.5} />
                <div>
                  <h3>{capability.title}</h3>
                  <p>{capability.description}</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ProductProof() {
  return (
    <section className="section-pad product-section">
      <div className="page-shell">
        <div className="product-copy-grid">
          <div className="section-heading">
            <h2>Operate AI security from one command center.</h2>
            <p>See threats, tune policy, investigate events, and export evidence from one control plane.</p>
          </div>
          <div className="product-actions">
            <a className="button button-accent" href={DASHBOARD_URL} target="_blank" rel="noreferrer">
              Explore the dashboard <ArrowIcon />
            </a>
            <a className="button button-ghost" href={DOCS_URL} target="_blank" rel="noreferrer">
              Read the docs <ExternalLink size={15} />
            </a>
          </div>
        </div>
        <div className="product-proof-grid">
          <DashboardFrame />
          <div className="control-plane-list">
            {controlPlaneItems.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title}>
                  <Icon size={23} strokeWidth={1.5} />
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function OpenSource() {
  const steps = [
    ['01', 'Pick an issue', 'Choose a scoped improvement that matches your interests.'],
    ['02', 'Build with the community', 'Open a draft PR early and share your approach.'],
    ['03', 'Ship the pull request', 'Add focused tests and help make TITAN stronger.'],
  ];

  return (
    <section id="open-source" className="open-source-section">
      <div className="open-source-grid-bg" aria-hidden="true" />
      <div className="page-shell open-source-layout">
        <div className="community-copy">
          <div className="metal-t-mark" aria-hidden="true">T</div>
          <h2>Security should be inspectable.</h2>
          <p>TITAN’s MIT-licensed core gives teams a firewall they can audit, extend, and run on their own infrastructure.</p>
          <div className="community-actions">
            <a className="button button-accent button-large" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <GithubMark /> Star on GitHub <ArrowIcon />
            </a>
            <a className="button button-ghost button-large" href={CONTRIBUTING_URL} target="_blank" rel="noreferrer">
              <GitFork size={18} /> Contribute to TITAN
            </a>
          </div>
        </div>
        <div className="community-path">
          <div className="quickstart-block">
            <div className="quickstart-title"><Terminal size={14} /> Quickstart</div>
            <pre><code><span>git clone https://github.com/SharvikS/LLM-Firewall.git</span>{'\n'}cd LLM-Firewall{'\n'}<b>./scripts/quickstart.sh</b></code></pre>
          </div>
          <div className="contribution-steps">
            {steps.map(([number, title, description]) => (
              <article key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
          <a className="text-link" href={ISSUES_URL} target="_blank" rel="noreferrer">
            Browse open issues <ArrowIcon />
          </a>
        </div>
      </div>
    </section>
  );
}

function Editions() {
  return (
    <section id="editions" className="section-pad editions-section">
      <div className="page-shell">
        <div className="section-heading editions-heading">
          <h2>Start with the MIT core. Scale when your organization needs it.</h2>
          <p>Run TITAN yourself for free, or choose a hosted plan when you want guided setup and organization-scale controls.</p>
        </div>
        <div className="pricing-grid">
          {plans.map((plan) => (
            <article className={`pricing-card ${plan.featured ? 'pricing-card-featured' : ''}`} key={plan.name}>
              <div>
                <h3>{plan.name}</h3>
                <div className="price"><strong>{plan.price}</strong><span>{plan.suffix}</span></div>
                <p>{plan.description}</p>
              </div>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}><Check size={16} /> <span>{feature}</span></li>
                ))}
              </ul>
              <a className={`button ${plan.featured ? 'button-accent' : 'button-outline-accent'}`} href={plan.href}>
                {plan.cta} <ArrowIcon />
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="final-cta-section">
      <div className="page-shell final-cta-grid">
        <h2>Put a security boundary around your AI.</h2>
        <div>
          <p>Change two lines, keep your provider, and make every request enforceable.</p>
          <div>
            <a className="button button-accent button-large" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <GithubMark /> Star on GitHub
            </a>
            <a className="button button-ghost button-large" href={CONTRIBUTING_URL} target="_blank" rel="noreferrer">
              <GitFork size={18} /> Contribute
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="page-shell footer-grid">
        <div>
          <Brand />
          <span className="footer-tagline">Zero-Trust LLM Firewall</span>
        </div>
        <nav aria-label="Footer navigation">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          <a href={DOCS_URL} target="_blank" rel="noreferrer">Documentation</a>
          <a href={CONTRIBUTING_URL} target="_blank" rel="noreferrer">Contributing</a>
          <a href={LICENSE_URL} target="_blank" rel="noreferrer">MIT License</a>
        </nav>
        <span>© {new Date().getFullYear()} Sharvik Sutar</span>
      </div>
    </footer>
  );
}

export default function Page() {
  return (
    <main>
      <Nav />
      <Hero />
      <BenefitRail />
      <SecurityFlow />
      <FeatureEngine />
      <ProductProof />
      <OpenSource />
      <Editions />
      <FinalCTA />
      <Footer />
    </main>
  );
}
