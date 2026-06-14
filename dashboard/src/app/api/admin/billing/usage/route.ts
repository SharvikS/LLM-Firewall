import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

// GET /api/admin/billing/usage[?tenant=<uuid>] — current-month usage per tenant.
export async function GET(req: Request) {
  try {
    const t = new URL(req.url).searchParams.get('tenant');
    const res = await adminFetch(`/billing/usage${t ? `?tenant=${encodeURIComponent(t)}` : ''}`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ tenants: [], count: 0, _offline: true });
  }
}
