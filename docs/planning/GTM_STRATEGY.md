# TITAN — End-to-End Selling & Pitching Strategy

*Written 2026-07-02. Owner: Sharvik. Review monthly; update numbers as they become real.*

This is the complete go-to-market playbook: positioning → audience → marketing → funnel →
sales motion → pitch scripts → objection handling → metrics. It is written for the actual
product as it exists today (open-core MIT gateway, hosted activation with Stripe
Free/$9.99/$35 tiers, enterprise edition behind a build tag, browser DLP extension).

---

## 1. Positioning — the one story everything hangs on

**Category:** LLM firewall / AI gateway security. Ride the category others are creating
(Cloudflare AI Gateway, Lakera, Prompt Security got acquired) while being the *open-core,
self-hostable* option.

**One-liner (use everywhere, verbatim):**
> TITAN is a zero-trust firewall for LLM traffic. Change two lines — `base_url` and
> `api_key` — and every prompt is inspected for injection, PII, and secrets before it
> reaches the model.

**Positioning statement (internal compass):**
For teams shipping LLM features who can't see or control what their apps send to model
providers, TITAN is a drop-in reverse proxy that blocks prompt injection, masks PII
bidirectionally, and gives a full audit trail — unlike SaaS-only guardrail APIs, it's
MIT-licensed and runs inside your network, so your prompts never transit a third party.

**The three proof points to repeat until people are sick of them:**
1. **Drop-in** — 100% OpenAI-SDK compatible; two-line change; demoable in 60 seconds.
2. **Private by architecture** — self-hosted; prompts never leave your infra (the killer
   argument against Lakera/cloud guardrails; their security tool *is itself* a data leak).
3. **Complete control plane** — not a library: dashboard, RBAC, audit, quotas, policies,
   browser DLP. A product, not a middleware snippet.

**What TITAN is NOT (say this out loud — it builds trust):** not a prompt-quality/evals
tool, not an observability platform, not a model router first. It's security. One job.

---

## 2. Who buys — three concentric audiences

### A. Indie / small-team AI builders (adoption engine, $0–35/mo)
- **Who:** 1–20 person teams shipping chatbots, agents, RAG apps. Found via GitHub/HN/Reddit.
- **Pain:** "I'm one prompt injection away from my system prompt or customer data leaking,
  and I have zero logs of what my app sends OpenAI."
- **They want:** something free that works in 10 minutes. → OSS quickstart or hosted Free.
- **Role in strategy:** stars, word-of-mouth, case studies, and the funnel top. Not revenue.

### B. Seed→Series B AI startups (revenue engine, Starter/Pro $9.99–35/mo, later $99+)
- **Who:** startups whose *enterprise customers* are asking security questions on
  procurement forms ("How do you prevent prompt injection? Where does our data go?").
- **Pain:** they need a checkbox-able answer this quarter to close their own deals.
- **Trigger moment:** a security questionnaire, a SOC 2 audit, or a customer incident.
- **They want:** hosted activation today, self-host option to promise their customer.

### C. Mid-market / enterprise security teams (expansion engine, Enterprise edition)
- **Who:** CISOs/platform teams at companies rolling out internal LLM use + employee
  ChatGPT/Claude usage. The **browser DLP extension is the wedge here** — nobody else
  bundles "protect our app's LLM calls" with "protect employees pasting secrets into
  ChatGPT" in one self-hosted product.
- **Pain:** shadow AI usage, no policy enforcement, compliance exposure (GDPR/SOC 2/EU AI Act).
- **They want:** SSO, RBAC, audit export, SIEM integration, multi-tenant governance — all
  already built in the enterprise edition.

**Rule:** every piece of marketing targets exactly one of these. Never write for all three.

---

## 3. Packaging & pricing (align, don't reinvent)

| Tier | Price | Who it's for | The line that sells it |
|---|---|---|---|
| OSS self-host | Free, MIT | Audience A | "Clone it. It's yours. No feature flags, no trial." |
| Free hosted | $0, 10k req/mo | A → B bridge | "Protected in 5 minutes, no Docker." |
| Starter | $9.99/mo, 100k req | Small B | "Cheaper than one hour of incident response." |
| Pro | $35/mo, 1M req | B | "The answer to your customer's security questionnaire." |
| Enterprise | Custom (anchor $500–2k/mo) | C | "SSO, audit export, SIEM, browser DLP fleet — self-hosted." |

Notes:
- Keep Starter/Pro impulse-priced — the goal is card-on-file conversion volume, not ACV.
- Enterprise pricing is *conversation-based* for the first 5 deals; charge per-seat for
  browser DLP (per-employee) — it maps to how CISOs budget, and per-request doesn't.
- The MIT core being genuinely full-featured is the trust engine. Do not claw features back
  into paid tiers; add *organizational* capabilities (SSO, multi-tenant, compliance) to paid.

---

## 4. Marketing — the developer-led engine

### Phase 0: Pre-launch hygiene (week 1 — mostly done, finish the last 10%)
- README = landing page for developers: 60-second GIF of an injection being blocked,
  two-line code sample, architecture diagram, honest editions table. ✅ mostly exists.
- `docker compose up` / quickstart must work first try on a clean machine. Test on a friend.
- Landing page live at titan.sharvik.tech with working checkout. ✅
- 3–5 "seed" pieces of content published BEFORE launch so visitors find depth, not a ghost town.

### Phase 1: The launch ladder (weeks 2–6, in this order)
Each rung gives ammunition (stars, feedback, quotes) for the next:
1. **r/selfhosted, r/LocalLLaMA, r/devops** — "I built an open-source firewall for LLM
   traffic" posts, tailored per subreddit, honest maker voice, respond to every comment.
2. **Hacker News Show HN** — title: "Show HN: TITAN – open-source zero-trust firewall for
   LLM traffic (MIT)". Post Tue–Thu ~8-9am ET. First comment: honest architecture writeup +
   known limitations (HN rewards candor; the placeholder injection-training-set admission
   with a roadmap earns more trust than silence).
3. **Product Hunt** — 2 weeks after HN, using momentum + polished assets.
4. **Newsletters/aggregators** — TLDR Sec, tldr;dev, Console.dev, awesome-llm-security
   lists, OWASP LLM community. Submit everywhere; it compounds.

### Phase 2: Content flywheel (ongoing, 1 piece/week minimum)
Own the searches your buyers actually make. Three content tracks:
- **Fear/urgency (attracts A & B):** "We logged every prompt our apps sent OpenAI for a
  week — here's what leaked", "Anatomy of a prompt injection that exfiltrates your system
  prompt", red-team writeups using `scripts/redteam-eval.py` against popular models.
- **Comparison/SEO (captures in-market B):** "TITAN vs Lakera vs Cloudflare AI Gateway",
  "Self-hosted LLM guardrails: options in 2026", "LLM security for SOC 2: what auditors ask".
  Comparison pages convert better than anything else you will write.
- **Authority (warms up C):** OWASP LLM Top 10 mapped to TITAN controls (the coverage
  endpoint already exists — turn it into a public page), EU AI Act / GDPR angle, the
  buyer security packet (`docs/security/BUYER_SECURITY_PACKET.md`) as a gated download →
  this is your enterprise lead magnet.

### Phase 3: Community & proof
- GitHub Discussions or small Discord once there's traffic — answer fast; early users who
  get 10-minute responses become evangelists and case studies.
- Convert every happy user into an artifact: a quote, a GitHub star, a 3-paragraph case
  study ("X blocked N injection attempts in month one").
- Publish a **live public demo dashboard** (read-only, seeded data) — "see the product in
  10 seconds without installing" beats every screenshot.

---

## 5. The funnel — how a stranger becomes revenue

```
GitHub / HN / SEO / Reddit
        │
        ▼
README or landing page  ──────────────► Star (audience A parked for later)
        │
        ▼
Free: quickstart.sh OR hosted Free tier          ◄── activation email drip
        │  (aha moment: first blocked injection
        │   visible in the dashboard — optimize
        │   EVERYTHING for time-to-this-moment)
        ▼
Hits Free ceiling (10k req) or needs quotas/visibility
        │
        ▼
Starter $9.99 → Pro $35 (self-serve Stripe, zero touch)
        │
        ▼
Security questionnaire / SSO / audit-export need appears
        │
        ▼
"Talk to us" → founder-led Enterprise deal
```

**The single most important metric:** time from landing → first blocked request shown in
the dashboard. Instrument it. Get it under 10 minutes self-hosted, under 3 minutes hosted.

**In-product upgrade prompts (already partly built — the EnterpriseUpsell panel):** every
gated surface must say *what* it unlocks and *why it matters*, with one click to pricing.

**Email drip for hosted signups (write these once):**
- Day 0: your endpoint + key + the 60-second test that shows a blocked injection.
- Day 3: "here's what TITAN caught this week" (or how to send test traffic if silent).
- Day 10: case for Starter — usage stats + what happens at the ceiling.
- Trigger-based: at 80% of Free quota → upgrade email. This one makes money; the rest build trust.

---

## 6. Sales motion — self-serve + founder-led enterprise

### Self-serve (tiers ≤ Pro): remove humans entirely
Checkout → activation → key issued is already automated. Your only job: watch for failed
activations and quota-ceiling users, and email them personally. A founder email to a user
at 80% quota converts absurdly well: *"Saw you're close to the Free ceiling — anything
blocking you from Starter? Happy to extend your quota a week while you decide."*

### Founder-led enterprise (audience C): a repeatable 5-step play

**1. Sourcing (5–10 conversations/week):**
- Inbound: buyer-security-packet downloads, "talk to us" clicks, GitHub issues from
  corporate domains (check every star/issue author's org — this is free intent data).
- Outbound: companies posting "AI engineer" + "security" roles; startups that just
  announced AI features (they're getting questionnaires now); people who commented on
  your HN/Reddit threads from corporate accounts.
- Outbound message (short, no deck): *"Saw [company] shipped [AI feature]. Most teams we
  talk to get security-questionnaire pain about prompt injection and data leaving to
  model providers. We make an open-source firewall for exactly this — worth 20 minutes?
  You can also just clone it: [repo]."* — the repo link does half the selling.

**2. Discovery (first 15 min of the call). Ask, then shut up:**
- "What LLM features are live today, and what's about to ship?"
- "Who's asking you about AI security — customers, auditors, your own CISO?"
- "What happens today if someone pastes a customer record into ChatGPT?" *(browser DLP wedge)*
- "Where are you on SOC 2 / procurement questionnaires mentioning AI?"
- "What have you tried — Lakera, homegrown regex, nothing?"
- Qualify hard: no compliance/customer pressure = audience B; point them at Pro and move on.

**3. Demo (15 min, always this order — the "oh shit → oh nice" arc):**
1. Plain OpenAI call through TITAN — works, nothing changed. *(drop-in proof)*
2. Injection attempt — blocked, 403 with `goal_hijacking` reason. *(the moment)*
3. Same request with an SSN — masked before it leaves the network, masked in the response.
4. Dashboard: the audit trail of everything they just did, RBAC roles, policy editor.
5. Browser DLP: paste a fake API key into ChatGPT, watch it get caught. *(CISO jaw-drop)*
6. Close on architecture: "all of this ran on my laptop — nothing left the machine."
Script it, rehearse it, keep a seeded environment permanently ready (`home-dev.sh`).

**4. Land:** never sell the big deal first. Sell a **2-week pilot**: one app's traffic in
log-only mode → show the "here's what we caught" report → convert to annual. The report
writes the business case for you.

**5. Expand:** one app → all apps → browser DLP fleet-wide (per-seat) → compliance
reporting. Land at $500/mo, expand to $2k+/mo.

---

## 7. The pitches — scripts to use verbatim

**Elevator (anyone, 15 s):**
> Every prompt your app sends to OpenAI can be hijacked, and can carry customer data you
> never see leave. TITAN is an open-source firewall that sits between your app and the
> model — two-line change — and blocks injections, masks PII, and logs everything. Runs
> in your own network.

**Developer (audience A/B, 30 s):**
> Point your OpenAI SDK at TITAN instead of api.openai.com — that's the whole migration.
> You instantly get injection blocking, PII masking both directions, secret detection,
> rate limits, semantic caching, and a dashboard with a full audit trail. MIT-licensed,
> single Go binary in the hot path, sub-millisecond overhead. Free tier hosted if you
> don't want to run it.

**CISO (audience C, 60 s):**
> You have two AI exposures: apps your teams ship that call model APIs, and employees
> pasting things into ChatGPT. TITAN covers both from one self-hosted control plane — a
> gateway that inspects and governs every API call, and a browser extension that catches
> sensitive data before it's pasted into ChatGPT, Claude, or Gemini. Zero-trust policy
> engine, RBAC, tenant scoping, immutable audit trail, SIEM export mapped to the OWASP
> LLM Top 10. And because it's open core, your security team can read every line of the
> code they're trusting — and your prompts never transit a third-party SaaS.

**Investor (if ever needed, 45 s):**
> Every company shipping AI features is accumulating an ungoverned attack surface, and
> regulation (EU AI Act, SOC 2 AI addenda) is arriving faster than tooling. We're the
> open-core firewall for that traffic — the Nginx-then-NGINX-Plus play for LLM security.
> Developers adopt free, companies pay for governance. Prompt Security exited to SentinelOne
> within two years of founding; the category is validated and the self-hosted, open
> quadrant is empty.

---

## 8. Objection handling (memorize these)

| Objection | Response |
|---|---|
| "We'll just use OpenAI's moderation / system prompts." | Moderation checks content policy, not *your* policy — it won't stop your system prompt leaking, PII exfiltration, or log anything for your auditor. Defense lives in front of the model call, provider-agnostic. |
| "Another proxy in the hot path = latency + a SPOF." | Sub-millisecond added; single Go binary; security checks fail closed, infra (cache/ML/alerts) fails open by design, and there's upstream failover. Here's the load/SLO report. |
| "How is this different from Lakera / Prompt Security?" | Same detection goals, opposite architecture: they're SaaS — your prompts flow through *their* cloud. TITAN is self-hosted and MIT — auditable and private by construction. Plus browser DLP + full control plane in one product. |
| "Detection is never 100%. What's your F1?" | Correct — nothing is. Two layers (signatures + transformer), published red-team eval you can run yourself (`scripts/redteam-eval.py`), and even with zero ML you keep the deterministic wins: PII masking, secret detection, audit, quotas, policies. |
| "We can build regex guardrails ourselves." | Teams do — then own maintenance, streaming-response masking, audit storage, RBAC, and questionnaire answers forever. Clone TITAN instead; it's MIT. If you outgrow it, you've lost nothing. *(Judo: the free tier IS the counter.)* |
| "Is a solo-maintainer project safe to depend on?" | It's MIT — you can fork it and never talk to me again; that's the point of open core. Enterprise contracts add support SLAs. And look at the commit history — this is actively, seriously maintained. |
| "We're not ready / no budget." | Totally fine — run the free tier in log-only mode. The first month's report of what it catches usually creates the budget conversation for you. |

---

## 9. 30 / 60 / 90-day execution plan

**Days 1–30 — Launch.**
- Finish: merge release branch, clean-machine quickstart test, demo GIF in README, public
  read-only demo dashboard, 3 seed blog posts, email drip written.
- Execute the launch ladder (Reddit → Show HN → newsletters).
- Targets: 500+ GitHub stars, 100 hosted signups, 5 paying, 20 user conversations.

**Days 31–60 — Funnel.**
- Product Hunt. Comparison pages live. OWASP coverage public page. Quota-ceiling email
  automation. Personally onboard every hosted signup from a company domain.
- Targets: 1,500 stars, 25 paying self-serve, 5 enterprise discovery calls, 1 pilot.

**Days 61–90 — Revenue.**
- Convert pilot #1 → first annual enterprise deal (even at $500/mo — the logo and case
  study matter more than the number). Publish case study. Start per-seat browser-DLP
  packaging. Double down only on the channel that actually produced signups.
- Targets: first enterprise contract, $1–2k MRR total, repeatable demo→pilot→close motion
  documented from real experience.

**North-star metric stack (check weekly):** stars → hosted activations → *first-blocked-
request reached* → paid conversions → enterprise pipeline. Every action should move one.

---

## 10. Asset checklist (build once, reuse everywhere)

- [ ] 60-second demo GIF/video (injection blocked, live dashboard) — README + landing + PH
- [ ] Public read-only demo dashboard with seeded data
- [ ] Pitch deck, 8 slides max (problem → moment → product → demo → architecture/trust →
      open-core model → pricing → ask)
- [ ] One-page PDF for CISOs (the buyer security packet, designed)
- [ ] Comparison pages ×3 (Lakera, Cloudflare AI Gateway, DIY)
- [ ] Red-team eval report (run `scripts/redteam-eval.py`, publish honest numbers)
- [ ] Email drip ×4 + quota-ceiling trigger email
- [ ] Demo environment one-command script (exists: `scripts/home-dev.sh`) + seeded data
- [ ] Case study template (fill after first 3 happy users)

## Honest pre-launch gaps to close (credibility depends on it)
1. The injection detector's placeholder training set (`ml_engine/analyzer/injection_detector.py`)
   — either train on a real dataset or publish detection numbers only for what's real.
   Never market a number you can't defend on HN.
2. Merge `feature/native-desktop-installer` work to `main` so the repo front door shows
   the current product.
3. Test Stripe checkout end-to-end in live mode with a real card before any launch post.
