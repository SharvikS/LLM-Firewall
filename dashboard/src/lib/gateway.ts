// Server-side only — never import from client components.
// The ADMIN_TOKEN is not prefixed with NEXT_PUBLIC_ intentionally.

export const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:8080';
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'titan-admin-dev-secret';

export async function adminFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${GATEWAY}/admin/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': ADMIN_TOKEN,
      ...init?.headers,
    },
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(5000),
  });
  return res;
}
