import { expect, test } from '@playwright/test';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';

const gatewayPort = Number(process.env.PLAYWRIGHT_GATEWAY_PORT ?? 18080);
const dashboardPort = Number(process.env.PLAYWRIGHT_DASHBOARD_PORT ?? 3100);
const dashboardOrigin = `http://localhost:${dashboardPort}`;
const ADMIN_TOKEN = 'playwright-admin-token';

type Call = {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: unknown;
};

let server: http.Server;
let calls: Call[] = [];

const sessions: Record<string, { email: string; role: 'viewer' | 'security' | 'admin' }> = {
  'viewer-token': { email: 'viewer@titan.local', role: 'viewer' },
  'security-token': { email: 'security@titan.local', role: 'security' },
  'admin-token': { email: 'admin@titan.local', role: 'admin' },
};

test.beforeAll(async () => {
  server = http.createServer(handleGatewayRequest);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(gatewayPort, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
});

test.beforeEach(async ({ request }) => {
  await request.post('/api/auth/logout').catch(() => undefined);
  calls = [];
});

test('login sets an httpOnly dashboard session and /api/auth/me resolves the user', async ({ request }) => {
  const login = await request.post('/api/auth/login', {
    data: { email: 'admin@titan.local', password: 'admin@123' },
  });

  expect(login.status()).toBe(200);
  expect(login.headers()['set-cookie']).toContain('titan_session=admin-token');
  expect(login.headers()['set-cookie']).toContain('HttpOnly');
  expect(await login.json()).toEqual({ user: { email: 'admin@titan.local', role: 'admin' } });

  const me = await request.get('/api/auth/me');
  expect(me.status()).toBe(200);
  expect(await me.json()).toEqual(expect.objectContaining({
    authenticated: true,
    email: 'admin@titan.local',
    role: 'admin',
  }));

  expect(lastCall('/admin/v1/auth/me')?.headers.authorization).toBe('Bearer admin-token');
});

test('SSO landing redeems one-time code server-side and never accepts token query handoff', async ({ request }) => {
  const legacy = await request.get('/api/auth/sso?token=jwt-in-url', { maxRedirects: 0 });
  expect(legacy.status()).toBe(307);
  expect(legacy.headers()['location']).toContain('/login?error=sso');
  expect(calls.find(call => call.path === '/admin/v1/auth/sso/exchange')).toBeUndefined();

  const response = await request.get('/api/auth/sso?code=playwright-sso-code', { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()['location']).toBe(`${dashboardOrigin}/`);
  expect(response.headers()['set-cookie']).toContain('titan_session=sso-session-token');
  expect(response.headers()['set-cookie']).toContain('HttpOnly');

  const exchange = lastCall('/admin/v1/auth/sso/exchange');
  expect(exchange?.method).toBe('POST');
  expect(exchange?.headers['x-admin-token']).toBe(ADMIN_TOKEN);
  expect(exchange?.body).toEqual({ code: 'playwright-sso-code' });
});

test('dashboard admin proxy fails closed without a session cookie', async ({ playwright }) => {
  const anonymous = await playwright.request.newContext({
    baseURL: `http://127.0.0.1:${dashboardPort}`,
    extraHTTPHeaders: { Cookie: 'titan_session=' },
  });
  const keys = await anonymous.get('/api/admin/keys');
  expect(keys.status()).toBe(401);
  expect(await keys.json()).toEqual({ error: 'authentication required' });
  await anonymous.dispose();

  expect(calls.find(call => call.path === '/admin/v1/keys')).toBeUndefined();
});

test('RBAC is propagated for API key reads and admin-only key creation', async ({ request }) => {
  const viewerRead = await request.get('/api/admin/keys', {
    headers: cookie('viewer-token'),
  });
  expect(viewerRead.status()).toBe(200);
  expect(await viewerRead.json()).toEqual(expect.objectContaining({ count: 1 }));

  const readCall = lastCall('/admin/v1/keys');
  expect(readCall?.headers.authorization).toBe('Bearer viewer-token');
  expect(readCall?.headers['x-admin-token']).toBeUndefined();

  const viewerCreate = await request.post('/api/admin/keys', {
    headers: sameOriginCookie('viewer-token'),
    data: { tenant_id: 'tenant-1', name: 'blocked key' },
  });
  expect(viewerCreate.status()).toBe(403);
  expect(await viewerCreate.json()).toEqual({ error: 'insufficient role: this action requires admin' });

  const adminCreate = await request.post('/api/admin/keys', {
    headers: sameOriginCookie('admin-token'),
    data: { tenant_id: 'tenant-1', name: 'production app' },
  });
  expect(adminCreate.status()).toBe(201);
  expect(await adminCreate.json()).toEqual(expect.objectContaining({
    key: 'titan_playwright_raw_key',
    metadata: expect.objectContaining({ id: 'key-1', name: 'production app' }),
  }));
});

test('API key sandbox restrictions are forwarded to the gateway sandbox endpoint', async ({ request }) => {
  const sandbox = {
    enabled: true,
    allowed_models: ['gpt-4o-mini'],
    blocked_models: ['gpt-4o'],
    allowed_paths: ['/v1/chat/completions'],
    max_requests_per_minute: 30,
    max_tokens_per_minute: 2000,
    require_pii_redaction: true,
    require_output_scan: true,
  };

  const response = await request.put('/api/admin/keys/key-1', {
    headers: sameOriginCookie('admin-token'),
    data: sandbox,
  });

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual(expect.objectContaining({
    id: 'key-1',
    sandbox: expect.objectContaining(sandbox),
  }));

  const call = lastCall('/admin/v1/keys/key-1/sandbox');
  expect(call?.method).toBe('PUT');
  expect(call?.headers.authorization).toBe('Bearer admin-token');
  expect(call?.headers['x-admin-token']).toBeUndefined();
  expect(call?.body).toEqual(sandbox);
});

test('cross-origin admin mutations are rejected before reaching the gateway', async ({ request }) => {
  const response = await request.post('/api/admin/keys', {
    headers: {
      ...cookie('admin-token'),
      Origin: 'http://evil.local',
    },
    data: { tenant_id: 'tenant-1', name: 'csrf attempt' },
  });

  expect(response.status()).toBe(403);
  expect(await response.json()).toEqual({ error: 'same-origin request required' });
  expect(calls.find(call => call.path === '/admin/v1/keys' && call.method === 'POST')).toBeUndefined();
});

test('sandbox execution APIs require security role and accept security sessions', async ({ request }) => {
  const viewer = await request.post('/api/admin/sandboxes', {
    headers: sameOriginCookie('viewer-token'),
    data: { backend: 'simulated', command: 'echo blocked' },
  });
  expect(viewer.status()).toBe(403);
  expect(await viewer.json()).toEqual({ error: 'insufficient role: this action requires security' });

  const security = await request.post('/api/admin/sandboxes', {
    headers: sameOriginCookie('security-token'),
    data: { backend: 'simulated', command: 'echo titan-sandbox-ok' },
  });
  expect(security.status()).toBe(202);
  expect(await security.json()).toEqual(expect.objectContaining({
    configured: true,
    execution: expect.objectContaining({ id: 'sandbox-1', status: 'allowed' }),
  }));
});

test('gateway read proxy validates session before forwarding machine token', async ({ request }) => {
  const unauthenticated = await request.get('/api/gateway/metrics');
  expect(unauthenticated.status()).toBe(401);
  expect(calls.find(call => call.path === '/api/metrics')).toBeUndefined();

  const metrics = await request.get('/api/gateway/metrics', {
    headers: cookie('viewer-token'),
  });
  expect(metrics.status()).toBe(200);
  expect(await metrics.json()).toEqual(expect.objectContaining({
    total_requests: 42,
    blocked_requests: 3,
  }));

  const authCheck = calls.find(call => call.path === '/admin/v1/auth/me');
  expect(authCheck?.headers.authorization).toBe('Bearer viewer-token');

  const metricsCall = lastCall('/api/metrics');
  expect(metricsCall?.headers['x-admin-token']).toBe(ADMIN_TOKEN);
});

function cookie(token: string) {
  return { Cookie: `titan_session=${token}` };
}

function sameOriginCookie(token: string) {
  return { ...cookie(token), Origin: dashboardOrigin };
}

function lastCall(path: string) {
  return calls.filter(call => call.path === path).at(-1);
}

async function handleGatewayRequest(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  const parsedBody = parseBody(body);
  const path = req.url?.split('?')[0] ?? '/';
  calls.push({
    method: req.method ?? 'GET',
    path,
    headers: req.headers,
    body: parsedBody,
  });

  const role = roleFromRequest(req);

  if (req.method === 'POST' && path === '/admin/v1/auth/login') {
    const email = String((parsedBody as { email?: unknown }).email ?? '');
    const password = String((parsedBody as { password?: unknown }).password ?? '');
    if (email === 'admin@titan.local' && password === 'admin@123') {
      return json(res, 200, { token: 'admin-token', user: { email, role: 'admin' } });
    }
    return json(res, 401, { error: 'invalid credentials' });
  }

  if (req.method === 'GET' && path === '/admin/v1/auth/me') {
    const session = sessionFromRequest(req);
    if (!session) return json(res, 401, { error: 'authentication required' });
    return json(res, 200, {
      email: session.email,
      role: session.role,
      machine: false,
      edition: 'community',
      features: {},
    });
  }

  if (req.method === 'POST' && path === '/admin/v1/auth/sso/exchange') {
    if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return json(res, 401, { error: 'machine authentication required' });
    if ((parsedBody as { code?: unknown }).code !== 'playwright-sso-code') {
      return json(res, 401, { error: 'invalid or expired SSO code' });
    }
    return json(res, 200, {
      token: 'sso-session-token',
      user: { email: 'sso@titan.local', role: 'viewer' },
    });
  }

  if (req.method === 'GET' && path === '/admin/v1/keys') {
    if (!role) return json(res, 401, { error: 'authentication required' });
    return json(res, 200, { keys: [{ id: 'key-1', name: 'existing key', sandbox: { enabled: false } }], count: 1 });
  }

  if (req.method === 'POST' && path === '/admin/v1/keys') {
    if (!atLeast(role, 'admin')) return json(res, 403, { error: 'insufficient role: this action requires admin' });
    return json(res, 201, {
      key: 'titan_playwright_raw_key',
      metadata: { id: 'key-1', tenant_id: 'tenant-1', name: (parsedBody as { name?: string }).name, sandbox: { enabled: false } },
    });
  }

  if (req.method === 'PUT' && path === '/admin/v1/keys/key-1/sandbox') {
    if (!atLeast(role, 'admin')) return json(res, 403, { error: 'insufficient role: this action requires admin' });
    return json(res, 200, { id: 'key-1', tenant_id: 'tenant-1', name: 'production app', sandbox: parsedBody });
  }

  if (req.method === 'POST' && path === '/admin/v1/sandboxes/execute') {
    if (!atLeast(role, 'security')) return json(res, 403, { error: 'insufficient role: this action requires security' });
    return json(res, 202, {
      configured: true,
      execution: { id: 'sandbox-1', backend: 'simulated', command: (parsedBody as { command?: string }).command, status: 'allowed' },
    });
  }

  if (req.method === 'GET' && path === '/api/metrics') {
    if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return json(res, 401, { error: 'admin token required' });
    return json(res, 200, { total_requests: 42, allowed_requests: 39, blocked_requests: 3 });
  }

  return json(res, 404, { error: `unhandled mock route ${req.method} ${path}` });
}

function sessionFromRequest(req: IncomingMessage) {
  const authorization = String(req.headers.authorization ?? '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
  return sessions[token];
}

function roleFromRequest(req: IncomingMessage) {
  if (req.headers['x-admin-token'] === ADMIN_TOKEN) return 'admin';
  return sessionFromRequest(req)?.role;
}

function atLeast(role: string | undefined, required: 'viewer' | 'security' | 'admin') {
  const rank = { viewer: 1, security: 3, admin: 4 };
  return !!role && rank[role as keyof typeof rank] >= rank[required];
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseBody(body: string) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}
