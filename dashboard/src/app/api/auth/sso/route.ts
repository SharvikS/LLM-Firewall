import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';

// GET /api/auth/sso?token=... — SSO landing. The gateway's OIDC callback bounces
// the browser here with a freshly-minted session JWT; we store it as an httpOnly
// cookie and redirect into the app.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  if (!token) {
    return NextResponse.redirect(new URL('/login?error=sso', req.url));
  }
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions(60 * 60 * 12));
  return NextResponse.redirect(new URL('/', req.url));
}
