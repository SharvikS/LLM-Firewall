import { NextResponse } from 'next/server';
import { GATEWAY } from '@/lib/gateway';

// GET /api/auth/sso/start — kick off the SSO flow by sending the browser to the
// gateway's OIDC login. In production NEXT_PUBLIC_GATEWAY_URL must be a
// browser-reachable gateway URL for the redirect chain to complete.
export async function GET() {
  return NextResponse.redirect(`${GATEWAY}/admin/v1/auth/oidc/login`);
}
