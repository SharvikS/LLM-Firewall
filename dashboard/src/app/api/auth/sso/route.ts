import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';
import { ADMIN_TOKEN, GATEWAY } from '@/lib/gateway';

// GET /api/auth/sso?code=... — SSO landing. The gateway's OIDC callback bounces
// the browser here with a one-time code; this server-side route redeems it for
// the real session JWT so the JWT never appears in browser-visible URLs.
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=sso', req.url));
  }
  try {
    const res = await fetch(`${GATEWAY}/admin/v1/auth/sso/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN },
      body: JSON.stringify({ code }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (!res.ok || !data.token) {
      return NextResponse.redirect(new URL('/login?error=sso', req.url));
    }
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, data.token, sessionCookieOptions(60 * 60 * 12));
    return NextResponse.redirect(new URL('/', req.url));
  } catch {
    return NextResponse.redirect(new URL('/login?error=sso', req.url));
  }
}
