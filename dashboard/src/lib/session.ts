// Shared constants for the dashboard session cookie. The cookie holds the
// gateway-issued session JWT; it is httpOnly so the browser JS can never read it.

export const SESSION_COOKIE = 'titan_session';

export const sessionCookieOptions = (maxAgeSeconds: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: maxAgeSeconds,
});
