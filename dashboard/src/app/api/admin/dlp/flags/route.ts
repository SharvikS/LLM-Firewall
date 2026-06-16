import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const qs  = url.searchParams.toString();
    const res = await adminFetch(`/dlp/flags${qs ? `?${qs}` : ''}`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ flags: [], count: 0, _offline: true });
  }
}
