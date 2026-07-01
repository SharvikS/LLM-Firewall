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
`/api/checkout?tier=pro`.

Use one of these Stripe setups:

1. **Fastest: Payment Links.** Create two recurring Stripe Payment Links:
   `$9.99/mo` for Starter and `$35/mo` for Pro. Set:

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
