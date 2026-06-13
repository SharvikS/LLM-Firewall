// Server-side only — never import from client components.
// The ADMIN_TOKEN is not prefixed with NEXT_PUBLIC_ intentionally.

import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/session';

export const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:8080';
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'titan-admin-dev-secret';

// adminFetch calls the gateway admin API as the *currently logged-in user* by
// forwarding their session JWT, so the gateway enforces per-user RBAC. It falls
// back to the machine master token only when there is no session (server-to-
// server / bootstrap), which is itself a server-side secret.
export async function adminFetch(path: string, init?: RequestInit) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const authHeaders: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : { 'X-Admin-Token': ADMIN_TOKEN };

  const res = await fetch(`${GATEWAY}/admin/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...init?.headers,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  return res;
}
