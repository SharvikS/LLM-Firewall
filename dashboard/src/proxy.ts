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
    // Compare hosts, not nextUrl.origin — Next normalizes nextUrl to the
    // configured hostname (e.g. localhost) even when the browser is on
    // 127.0.0.1, which would 403 every legitimate mutation.
    const expectedHost =
      request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
    const origin = request.headers.get('origin');
    const actual = origin ?? (request.headers.get('referer') ?? '');
    if (!expectedHost || hostFromURL(actual) !== expectedHost) {
      return NextResponse.json({ error: 'same-origin request required' }, { status: 403 });
    }
  }

  // Public surfaces: the login page and its assets.
  if (pathname === '/login' || pathname.startsWith('/login/')) {
    return NextResponse.next();
  }

  if (!request.cookies.has(SESSION_COOKIE)) {
    // API callers get a machine-readable 401; page loads get the login page.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'authentication required' }, { status: 401 });
    }
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

function hostFromURL(value: string) {
  if (!value) return '';
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}
