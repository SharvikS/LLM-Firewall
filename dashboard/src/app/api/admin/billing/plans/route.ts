import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

// GET /api/admin/billing/plans — the static plan catalog.
export async function GET() {
  try {
    const res = await adminFetch('/billing/plans');
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ plans: [], _offline: true });
  }
}
