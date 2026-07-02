import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

// Next.js 16 Proxy (formerly middleware). Optimistic auth gate: redirect to
// /login when no session cookie is present. This is UX only — real authorization
// is enforced server-side by the gateway, which validates the JWT on every admin
// call (the dashboard forwards it). Keep this lightweight per the Proxy contract.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/admin/') && isMutating(request.method)) {
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');
    const expected = request.nextUrl.origin;
    const actual = origin ?? originFromReferer(referer);
    if (actual !== expected) {
      return NextResponse.json({ error: 'same-origin request required' }, { status: 403 });
    }
  }

  // Public surfaces: the login page and its assets.
  if (pathname === '/login' || pathname.startsWith('/login/')) {
    return NextResponse.next();
  }

  if (!request.cookies.has(SESSION_COOKIE)) {
    const url = new URL('/login', request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Page routes need the UX auth redirect. Browser-facing admin API routes also
  // pass through proxy so cross-origin mutations are rejected before handlers
  // forward the user's cookie-backed session to the gateway.
  matcher: [
    '/api/admin/:path*',
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
};

function isMutating(method: string) {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

function originFromReferer(referer: string | null) {
  if (!referer) return '';
  try {
    return new URL(referer).origin;
  } catch {
    return '';
  }
}
