import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

// Next.js 16 Proxy (formerly middleware). Optimistic auth gate: redirect to
// /login when no session cookie is present. This is UX only — real authorization
// is enforced server-side by the gateway, which validates the JWT on every admin
// call (the dashboard forwards it). Keep this lightweight per the Proxy contract.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
  // Run on page routes only — exclude API (self-guarded), Next internals, and
  // static assets so CSS/JS/images are never gated.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
