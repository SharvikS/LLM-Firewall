# TITAN — Landing Page

The public marketing site for TITAN, the zero-trust LLM firewall. A standalone
Next.js 16 app that mirrors the dashboard's design system (Geist + Tailwind 4,
monochrome dark theme, framer-motion) so the brand reads as one product.

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
```

## Build

```bash
npm run build && npm run start
```

## Payments

The pricing buttons are wired to `/api/checkout?tier=starter` and
`/api/checkout?tier=pro`. Successful Checkout Sessions redirect to `/start`,
where the buyer activates a hosted workspace.

Use one of these Stripe setups:

1. **Fastest: Payment Links.** Create two recurring Stripe Payment Links:
   `$9.99/mo` for Starter and `$35/mo` for Pro. Configure each link to redirect
   back to `/start?tier=<plan>` after payment. Set:

   ```bash
   NEXT_PUBLIC_TITAN_STARTER_PAYMENT_URL=https://buy.stripe.com/...
   NEXT_PUBLIC_TITAN_PRO_PAYMENT_URL=https://buy.stripe.com/...
   ```

2. **Checkout Sessions.** Create two recurring Stripe Prices and set:

   ```bash
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_STARTER_PRICE_ID=price_...
   STRIPE_PRO_PRICE_ID=price_...
   NEXT_PUBLIC_SITE_URL=https://titan.sharvik.tech
   ```

If neither payment setup is configured, paid buttons show a support fallback
instead of breaking.

## Hosted Activation

`/start` is the normal SaaS-style path. It collects workspace name, email, and
password, then `/api/activate` provisions:

- a tenant on the configured TITAN gateway
- an admin dashboard user scoped to that tenant
- a default app API key shown once
- the dashboard URL and gateway base URL

Set these server-only variables in Vercel:

```bash
TITAN_CLOUD_GATEWAY_URL=https://gateway.titan.sharvik.tech
TITAN_CLOUD_ADMIN_TOKEN=...
NEXT_PUBLIC_TITAN_DASHBOARD_URL=https://app.titan.sharvik.tech
NEXT_PUBLIC_TITAN_GATEWAY_BASE_URL=https://gateway.titan.sharvik.tech/v1
```

Paid activation verifies the Stripe Checkout Session by default. Free hosted
signup is disabled unless `TITAN_ALLOW_FREE_ACTIVATION=true`. For internal demos
only, `TITAN_ALLOW_UNPAID_ACTIVATION=true` bypasses Stripe checks.

## Deploy (Vercel)

Set the project root to `landing/` and deploy. Copy `landing/.env.example` into
Vercel environment variables, fill the Stripe values above, and point
`titan.sharvik.tech` at the project.

Publish checklist:

- `npm run lint`
- `npm run build`
- Starter checkout opens Stripe at `$9.99/mo`
- Pro checkout opens Stripe at `$35/mo`
- Free CTA opens the GitHub repo
- `/success` renders after checkout

## Editing

Everything lives in `src/app/page.tsx` (one client component, section by section)
and `src/app/globals.css` (theme tokens + visual motifs). The pricing tiers are
kept in sync with [`../EDITIONS.md`](../EDITIONS.md) and the gateway billing
catalog.
