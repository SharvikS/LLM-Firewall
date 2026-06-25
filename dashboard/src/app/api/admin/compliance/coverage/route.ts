import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

export async function GET() {
  try {
    const res = await adminFetch('/compliance/coverage');
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ controls: [], summary: {}, _offline: true }, { status: 502 });
  }
}
