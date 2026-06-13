import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GATEWAY } from '@/lib/gateway';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';

// POST /api/auth/login — forward credentials to the gateway, and on success
// store the issued JWT in an httpOnly session cookie.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const res = await fetch(`${GATEWAY}/admin/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (!res.ok || !data.token) {
      return NextResponse.json({ error: data.error ?? 'login failed' }, { status: res.status || 401 });
    }
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, data.token, sessionCookieOptions(60 * 60 * 12));
    return NextResponse.json({ user: data.user });
  } catch {
    return NextResponse.json({ error: 'gateway unavailable' }, { status: 502 });
  }
}
