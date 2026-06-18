import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

export async function GET() {
  try {
    const res  = await adminFetch('/dlp/overview');
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({
      total_events: 0, blocked: 0, redacted: 0, overrides: 0, events_24h: 0,
      active_installs: 0, known_accounts: 0, open_flags: 0,
      by_site: [], by_category: [], by_kind: [], series_24h: [], recent: [], top_offenders: [],
      _offline: true,
    });
  }
}
