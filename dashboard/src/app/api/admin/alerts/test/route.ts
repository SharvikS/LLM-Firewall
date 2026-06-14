import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

// POST /api/admin/alerts/test — send a synthetic alert to the SOC webhook so the
// operator can confirm the integration before relying on it.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const res = await adminFetch('/alerts/test', { method: 'POST', body: JSON.stringify(body) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ delivered: false, detail: 'gateway unavailable' }, { status: 502 });
  }
}
