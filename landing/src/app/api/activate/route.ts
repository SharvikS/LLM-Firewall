import { NextRequest, NextResponse } from 'next/server';

const STRIPE_API_VERSION = process.env.STRIPE_API_VERSION || '2026-02-25.clover';
const plans = {
  free: { tier: 'free', rateLimit: 60 },
  starter: { tier: 'starter', rateLimit: 120 },
  pro: { tier: 'pro', rateLimit: 300 },
} as const;

type PlanTier = keyof typeof plans;

interface ActivateBody {
  company?: string;
  email?: string;
  password?: string;
  tier?: string;
  sessionId?: string;
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function gatewayConfig() {
  const gateway = clean(process.env.TITAN_CLOUD_GATEWAY_URL).replace(/\/$/, '');
  const token = clean(process.env.TITAN_CLOUD_ADMIN_TOKEN);
  return { gateway, token };
}

function publicUrls() {
  return {
    dashboardUrl: clean(process.env.NEXT_PUBLIC_TITAN_DASHBOARD_URL) || 'https://app.titan.sharvik.tech',
    gatewayBaseUrl: clean(process.env.NEXT_PUBLIC_TITAN_GATEWAY_BASE_URL) || 'https://gateway.titan.sharvik.tech/v1',
  };
}

function activationFallback(reason: string) {
  return json(200, {
    status: 'manual',
    reason,
    message: 'Hosted activation is not configured on this deployment yet. Contact support and the workspace can be provisioned manually.',
    contactUrl: process.env.NEXT_PUBLIC_TITAN_CONTACT_URL || 'mailto:sharviksutar@gmail.com?subject=TITAN%20Gateway%20activation',
  });
}

async function verifyActivationPayment(tier: PlanTier, sessionId: string) {
  if (tier === 'free') {
    return process.env.TITAN_ALLOW_FREE_ACTIVATION === 'true' || process.env.TITAN_ALLOW_UNPAID_ACTIVATION === 'true';
  }

  if (process.env.TITAN_ALLOW_UNPAID_ACTIVATION === 'true') return true;

  const stripeKey = clean(process.env.STRIPE_SECRET_KEY);
  if (!stripeKey || !sessionId) return false;

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: {
      authorization: `Bearer ${stripeKey}`,
      'stripe-version': STRIPE_API_VERSION,
    },
    cache: 'no-store',
  });

  if (!response.ok) return false;

  const session = await response.json() as {
    status?: string;
    payment_status?: string;
    metadata?: Record<string, string | undefined>;
  };
  const planMatches = !session.metadata?.titan_plan || session.metadata.titan_plan === tier;
  const notReplayed = session.metadata?.titan_activated !== 'true';
  return session.status === 'complete'
    && (session.payment_status === 'paid' || session.payment_status === 'no_payment_required')
    && planMatches
    && notReplayed;
}

// Best-effort: stamp the checkout session so the same payment cannot be
// replayed to provision additional workspaces.
async function markSessionActivated(sessionId: string) {
  const stripeKey = clean(process.env.STRIPE_SECRET_KEY);
  if (!stripeKey || !sessionId) return;
  try {
    await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${stripeKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        'stripe-version': STRIPE_API_VERSION,
      },
      body: new URLSearchParams({ 'metadata[titan_activated]': 'true' }),
      cache: 'no-store',
    });
  } catch (error) {
    console.error('failed to mark checkout session as activated', error);
  }
}

async function adminFetch(path: string, init: RequestInit) {
  const { gateway, token } = gatewayConfig();
  const response = await fetch(`${gateway}/admin/v1${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-admin-token': token,
      ...init.headers,
    },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

export async function POST(request: NextRequest) {
  let body: ActivateBody;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'invalid JSON' });
  }

  const tier = clean(body.tier) as PlanTier;
  const company = clean(body.company).slice(0, 80);
  const email = clean(body.email).toLowerCase();
  const password = clean(body.password);
  const sessionId = clean(body.sessionId);

  if (!(tier in plans)) return json(400, { error: 'Choose a valid plan.' });
  if (company.length < 2) return json(400, { error: 'Company or workspace name is required.' });
  if (!email.includes('@') || email.length > 120) return json(400, { error: 'A valid email is required.' });
  if (password.length < 8) return json(400, { error: 'Password must be at least 8 characters.' });

  const { gateway, token } = gatewayConfig();
  if (!gateway || !token) return activationFallback('missing_gateway_config');

  const paidOrAllowed = await verifyActivationPayment(tier, sessionId);
  if (!paidOrAllowed) {
    return json(402, {
      status: 'payment_required',
      message: tier === 'free'
        ? 'Free hosted activation is not enabled on this deployment yet.'
        : 'Complete checkout before activating this paid workspace.',
    });
  }

  try {
    const plan = plans[tier];
    const tenant = await adminFetch('/tenants', {
      method: 'POST',
      body: JSON.stringify({
        name: company,
        tier: plan.tier,
        rate_limit: plan.rateLimit,
      }),
    }) as { id: string; name: string; tier: string };

    await adminFetch('/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        role: 'admin',
        tenant_ids: [tenant.id],
      }),
    });

    const key = await adminFetch('/keys', {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: tenant.id,
        name: 'Default app key',
      }),
    }) as { key: string; metadata?: { key_prefix?: string } };

    if (tier !== 'free') await markSessionActivated(sessionId);

    return json(201, {
      status: 'active',
      plan: tier,
      tenant,
      email,
      apiKey: key.key,
      keyPrefix: key.metadata?.key_prefix,
      ...publicUrls(),
    });
  } catch (error) {
    console.error(error);
    return json(502, {
      status: 'provisioning_failed',
      message: 'Activation reached the gateway but provisioning did not complete. Contact support with your checkout email.',
    });
  }
}
