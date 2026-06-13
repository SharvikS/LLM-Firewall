import { NextResponse } from 'next/server';
import { GATEWAY } from '@/lib/gateway';

// GET /api/auth/status — public; tells the login page whether SSO is available.
export async function GET() {
  try {
    const res = await fetch(`${GATEWAY}/admin/v1/auth/status`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ oidc_enabled: false, _offline: true });
  }
}
