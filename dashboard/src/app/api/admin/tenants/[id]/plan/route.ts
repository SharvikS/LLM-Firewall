import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

// PUT /api/admin/tenants/:id/plan — change a tenant's plan tier (admin only).
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const res = await adminFetch(`/tenants/${id}/plan`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'gateway unavailable' }, { status: 502 });
  }
}
