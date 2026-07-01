import { NextRequest, NextResponse } from 'next/server';

const GITHUB_URL = 'https://github.com/SharvikS/LLM-Firewall';
const DEFAULT_CONTACT_URL = 'mailto:sharviksutar@gmail.com?subject=TITAN%20Gateway%20checkout';
const STRIPE_API_VERSION = process.env.STRIPE_API_VERSION || '2026-02-25.clover';

const paidPlans = {
  starter: {
    label: 'Starter',
    paymentLinkEnv: 'NEXT_PUBLIC_TITAN_STARTER_PAYMENT_URL',
    priceEnv: 'STRIPE_STARTER_PRICE_ID',
  },
  pro: {
    label: 'Pro',
    paymentLinkEnv: 'NEXT_PUBLIC_TITAN_PRO_PAYMENT_URL',
    priceEnv: 'STRIPE_PRO_PRICE_ID',
  },
} as const;

type PaidPlan = keyof typeof paidPlans;

function isHttpUrl(value: string | undefined): value is string {
  return Boolean(value && /^https?:\/\//i.test(value));
}

function originFor(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!configured) return request.nextUrl.origin;
  if (/^https?:\/\//i.test(configured)) return configured.replace(/\/$/, '');
  return `https://${configured.replace(/\/$/, '')}`;
}

function htmlEscape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function contactResponse(reason: string) {
  const contactUrl = process.env.NEXT_PUBLIC_TITAN_CONTACT_URL || DEFAULT_CONTACT_URL;
  if (isHttpUrl(contactUrl)) {
    const url = new URL(contactUrl);
    url.searchParams.set('checkout', reason);
    return NextResponse.redirect(url, 303);
  }

  const safeUrl = htmlEscape(contactUrl);
  return new NextResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TITAN checkout</title>
    <style>
      body { margin: 0; background: #0a0a0a; color: #ededed; font-family: Arial, sans-serif; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 32px; }
      section { max-width: 520px; border: 1px solid #1e1e1e; border-radius: 12px; padding: 28px; background: #0d0d0d; }
      a { color: #0a0a0a; background: #fafafa; display: inline-flex; padding: 11px 16px; border-radius: 10px; text-decoration: none; font-weight: 600; }
      p { color: #9a9a9a; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>Checkout needs one final setting</h1>
        <p>The payment button is wired, but Stripe is not configured on this deployment yet. Contact support and the plan can be activated manually.</p>
        <a href="${safeUrl}">Contact support</a>
      </section>
    </main>
  </body>
</html>`,
    {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    },
  );
}

async function createStripeCheckoutSession(request: NextRequest, tier: PaidPlan, priceId: string) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return contactResponse('missing_stripe_secret');

  const origin = originFor(request);
  const body = new URLSearchParams({
    mode: 'subscription',
    success_url: process.env.STRIPE_SUCCESS_URL || `${origin}/start?tier=${tier}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: process.env.STRIPE_CANCEL_URL || `${origin}/#pricing`,
    allow_promotion_codes: 'true',
    billing_address_collection: 'auto',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'metadata[titan_plan]': tier,
    'subscription_data[metadata][titan_plan]': tier,
  });

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      'stripe-version': STRIPE_API_VERSION,
    },
    body,
    cache: 'no-store',
  });

  if (!response.ok) {
    console.error(`Stripe checkout session failed for ${tier}: ${await response.text()}`);
    return contactResponse('stripe_checkout_failed');
  }

  const session = await response.json() as { url?: string };
  if (!isHttpUrl(session.url)) return contactResponse('stripe_checkout_missing_url');
  return NextResponse.redirect(session.url, 303);
}

export async function GET(request: NextRequest) {
  const tier = request.nextUrl.searchParams.get('tier');

  if (tier === 'free') {
    return NextResponse.redirect(process.env.NEXT_PUBLIC_TITAN_FREE_URL || GITHUB_URL, 303);
  }

  if (tier !== 'starter' && tier !== 'pro') {
    return NextResponse.redirect(new URL('/#pricing', request.nextUrl.origin), 303);
  }

  const plan = paidPlans[tier];
  const paymentLink = process.env[plan.paymentLinkEnv];
  if (isHttpUrl(paymentLink)) return NextResponse.redirect(paymentLink, 303);

  const priceId = process.env[plan.priceEnv];
  if (!priceId) return contactResponse(`missing_${plan.label.toLowerCase()}_price`);

  return createStripeCheckoutSession(request, tier, priceId);
}
