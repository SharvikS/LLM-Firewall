import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

// POST /api/admin/upstream/test — ask the gateway whether it can reach the given
// upstream LLM URL (the reachability that matters, since the gateway calls it).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const res = await adminFetch('/upstream/test', { method: 'POST', body: JSON.stringify(body) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ reachable: false, detail: 'gateway unavailable' }, { status: 502 });
  }
}
