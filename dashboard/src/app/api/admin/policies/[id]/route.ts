import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

export async function PUT(req: Request, ctx: RouteContext<'/api/admin/policies/[id]'>) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const res = await adminFetch(`/policies/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'gateway unavailable' }, { status: 502 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<'/api/admin/policies/[id]'>) {
  try {
    const { id } = await ctx.params;
    const res = await adminFetch(`/policies/${id}`, { method: 'DELETE' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'gateway unavailable' }, { status: 502 });
  }
}
