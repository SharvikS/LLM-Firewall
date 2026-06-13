import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

// GET — current runtime settings document from the gateway control plane.
export async function GET() {
  try {
    const res = await adminFetch('/settings');
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ _offline: true }, { status: 502 });
  }
}

// PUT — merge a partial settings patch and apply it live.
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const res = await adminFetch('/settings', { method: 'PUT', body: JSON.stringify(body) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'gateway unavailable' }, { status: 502 });
  }
}
