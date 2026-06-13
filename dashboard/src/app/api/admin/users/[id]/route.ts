import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

// DELETE /api/admin/users/:id — remove a user.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const res = await adminFetch(`/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'gateway unavailable' }, { status: 502 });
  }
}

// PUT /api/admin/users/:id — change a user's role (body: { role }).
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const res = await adminFetch(`/users/${id}/role`, { method: 'PUT', body: JSON.stringify(body) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'gateway unavailable' }, { status: 502 });
  }
}
