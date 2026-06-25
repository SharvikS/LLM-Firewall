import { NextRequest, NextResponse } from 'next/server';
import { GATEWAY, GatewayReadAuthError, gatewayReadHeaders } from '@/lib/gateway';

async function fetchJson(path: string, headers: HeadersInit) {
  const res = await fetch(`${GATEWAY}${path}`, {
    headers,
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

export async function GET(request: NextRequest) {
  const hours = request.nextUrl.searchParams.get('hours') ?? '24';
  try {
    const headers = await gatewayReadHeaders();
    const [overview, timeseries, threats] = await Promise.all([
      fetchJson(`/api/analytics/overview?hours=${hours}`, headers),
      fetchJson(`/api/analytics/timeseries?hours=${hours}`, headers),
      fetchJson(`/api/analytics/threats?hours=${hours}`, headers),
    ]);
    return NextResponse.json({ live: true, overview, timeseries, threats });
  } catch (error) {
    if (error instanceof GatewayReadAuthError) {
      return NextResponse.json({ error: 'authentication required' }, { status: 401 });
    }
    // ClickHouse disabled or gateway down — the tab falls back to demo data.
    return NextResponse.json({ live: false, overview: null, timeseries: null, threats: null });
  }
}
