import { NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:8080';

export async function GET() {
  try {
    const res = await fetch(`${GATEWAY}/api/metrics`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    // Return zeros so the dashboard renders gracefully when gateway is down.
    return NextResponse.json({
      total_requests: 0, allowed_requests: 0, blocked_requests: 0,
      rate_limited: 0, cache_hits: 0, cache_misses: 0, cache_hit_rate: 0,
      ml_blocked: 0, pii_masked: 0, cedar_blocked: 0,
      p99_latency_ms: 0, avg_latency_ms: 0, uptime_seconds: 0,
      traffic_chart: [], _offline: true,
    });
  }
}
