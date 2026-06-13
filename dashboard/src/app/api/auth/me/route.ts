import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GATEWAY } from '@/lib/gateway';
import { SESSION_COOKIE } from '@/lib/session';

// GET /api/auth/me — resolve the current identity by validating the session JWT
// against the gateway. Returns {authenticated:false} when there is no/invalid session.
export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  try {
    const res = await fetch(`${GATEWAY}/admin/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }
    const data = await res.json();
    return NextResponse.json({ authenticated: true, ...data });
  } catch {
    return NextResponse.json({ authenticated: false }, { status: 502 });
  }
}
