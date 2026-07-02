import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';
import { ADMIN_TOKEN, GATEWAY } from '@/lib/gateway';

// GET /api/auth/sso?code=... — SSO landing. The gateway's OIDC callback bounces
// the browser here with a one-time code; this server-side route redeems it for
// the real session JWT so the JWT never appears in browser-visible URLs.
export async function GET(req: Request) {
  // Redirect relative to the host the browser actually used — Next normalizes
  // req.url to the configured hostname (e.g. localhost), and a redirect to a
  // different host would strand the freshly set host-scoped session cookie.
  const requestURL = new URL(req.url);
  const forwardedHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (forwardedHost) requestURL.host = forwardedHost;
  const redirect = (path: string) => NextResponse.redirect(new URL(path, requestURL));

  const code = requestURL.searchParams.get('code');
  if (!code) {
    return redirect('/login?error=sso');
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
      return redirect('/login?error=sso');
    }
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, data.token, sessionCookieOptions(60 * 60 * 12));
    return redirect('/');
  } catch {
    return redirect('/login?error=sso');
  }
}
