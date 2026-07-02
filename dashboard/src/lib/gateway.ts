// Server-side only — never import from client components.
// The ADMIN_TOKEN is not prefixed with NEXT_PUBLIC_ intentionally.

import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/session';

export const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'titan-admin-dev-secret';

export class GatewayReadAuthError extends Error {
  constructor() {
    super('gateway read authentication required');
  }
}

export async function gatewayReadHeaders(): Promise<HeadersInit> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) throw new GatewayReadAuthError();
  const auth = await fetch(`${GATEWAY}/admin/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (auth.status === 401 || auth.status === 403) throw new GatewayReadAuthError();
  if (!auth.ok) throw new Error(`gateway auth check failed: ${auth.status}`);
  return { 'X-Admin-Token': ADMIN_TOKEN };
}

// adminFetch calls the gateway admin API as the *currently logged-in user* by
// forwarding their session JWT, so the gateway enforces per-user RBAC. Missing
// sessions fail closed here because /api/admin/* routes are browser-reachable.
export async function adminFetch(path: string, init?: RequestInit) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) {
    return Response.json({ error: 'authentication required' }, { status: 401 });
  }

  const res = await fetch(`${GATEWAY}/admin/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  return res;
}

// Machine-token access is intentionally separate from adminFetch so browser-
// reachable dashboard API routes cannot accidentally escalate when no session
// cookie is present.
export async function adminMachineFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${GATEWAY}/admin/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
      'X-Admin-Token': ADMIN_TOKEN,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  return res;
}
