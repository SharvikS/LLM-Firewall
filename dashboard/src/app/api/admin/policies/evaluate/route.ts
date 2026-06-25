import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const res = await adminFetch('/policies/evaluate', { method: 'POST', body: JSON.stringify(body) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'gateway unavailable' }, { status: 502 });
  }
}
