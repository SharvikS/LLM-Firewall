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

## Deploy (Vercel)

Set the project root to `landing/` and deploy. No environment variables required
— the page is fully static. Point the `titan.sharvik.tech` domain at it.

## Editing

Everything lives in `src/app/page.tsx` (one client component, section by section)
and `src/app/globals.css` (theme tokens + visual motifs). The pricing tiers are
kept in sync with [`../EDITIONS.md`](../EDITIONS.md).
