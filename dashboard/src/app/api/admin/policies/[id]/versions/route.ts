import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const res = await adminFetch(`/policies/${id}/versions`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ versions: [], count: 0, _offline: true }, { status: 502 });
  }
}
