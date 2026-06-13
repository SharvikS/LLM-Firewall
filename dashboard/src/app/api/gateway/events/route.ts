import { NextResponse } from 'next/server';
import { GATEWAY } from '@/lib/gateway';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const n = url.searchParams.get('n') ?? '50';
  try {
    const res = await fetch(`${GATEWAY}/api/events?n=${n}`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ events: [], count: 0, _offline: true });
  }
}
