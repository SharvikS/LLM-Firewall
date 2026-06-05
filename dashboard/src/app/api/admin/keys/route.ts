import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const res = await adminFetch(`/keys${qs ? `?${qs}` : ''}`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ keys: [], count: 0, _offline: true });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const res = await adminFetch('/keys', { method: 'POST', body: JSON.stringify(body) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'gateway unavailable' }, { status: 502 });
  }
}
