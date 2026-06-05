import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

export async function DELETE(_req: Request, ctx: RouteContext<'/api/admin/keys/[id]'>) {
  try {
    const { id } = await ctx.params;
    const res = await adminFetch(`/keys/${id}`, { method: 'DELETE' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'gateway unavailable' }, { status: 502 });
  }
}
