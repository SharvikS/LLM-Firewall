import { NextRequest, NextResponse } from 'next/server';
import { GATEWAY } from '@/lib/gateway';

async function fetchJson(path: string) {
  const res = await fetch(`${GATEWAY}${path}`, {
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

export async function GET(request: NextRequest) {
  const hours = request.nextUrl.searchParams.get('hours') ?? '24';
  try {
    const [overview, timeseries, threats] = await Promise.all([
      fetchJson(`/api/analytics/overview?hours=${hours}`),
      fetchJson(`/api/analytics/timeseries?hours=${hours}`),
      fetchJson(`/api/analytics/threats?hours=${hours}`),
    ]);
    return NextResponse.json({ live: true, overview, timeseries, threats });
  } catch {
    // ClickHouse disabled or gateway down — the tab falls back to demo data.
    return NextResponse.json({ live: false, overview: null, timeseries: null, threats: null });
  }
}
