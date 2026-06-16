import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

export async function GET() {
  try {
    const res  = await adminFetch('/dlp/summary');
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ open_flags: 0, total_flags: 0, total_violations: 0, violations_24h: 0, top_risk: 0, _offline: true });
  }
}
