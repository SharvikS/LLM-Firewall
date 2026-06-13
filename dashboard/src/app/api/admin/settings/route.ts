import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

// Forward an optional ?tenant=<uuid> so the gateway resolves global vs per-tenant.
function qs(req: Request): string {
  const t = new URL(req.url).searchParams.get('tenant');
  return t ? `?tenant=${encodeURIComponent(t)}` : '';
}

export async function GET(req: Request) {
  try {
    const res = await adminFetch(`/settings${qs(req)}`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ _offline: true }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const res = await adminFetch(`/settings${qs(req)}`, { method: 'PUT', body: JSON.stringify(body) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'gateway unavailable' }, { status: 502 });
  }
}

// DELETE ?tenant=<uuid> — revert a tenant to the global defaults.
export async function DELETE(req: Request) {
  try {
    const res = await adminFetch(`/settings${qs(req)}`, { method: 'DELETE' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'gateway unavailable' }, { status: 502 });
  }
}
