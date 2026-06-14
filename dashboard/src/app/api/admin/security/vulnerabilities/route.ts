import { NextResponse } from 'next/server';
import { adminFetch } from '@/lib/gateway';

// GET /api/admin/security/vulnerabilities — latest CVE-scan report.
export async function GET() {
  try {
    const res = await adminFetch('/security/vulnerabilities');
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ available: false, _offline: true });
  }
}
