import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const gatewaySource = readFileSync(join(root, 'src/lib/gateway.ts'), 'utf8');

const start = gatewaySource.indexOf('export async function adminFetch');
const end = gatewaySource.indexOf('export async function adminMachineFetch');
assert(start >= 0, 'adminFetch must exist');
assert(end > start, 'adminMachineFetch must be declared after adminFetch');

const adminFetchBody = gatewaySource.slice(start, end);
assert(
  adminFetchBody.includes("Response.json({ error: 'authentication required' }, { status: 401 })"),
  'adminFetch must return 401 when there is no dashboard session cookie',
);
assert(
  adminFetchBody.includes('Authorization: `Bearer ${token}`'),
  'adminFetch must forward only the current dashboard session JWT',
);
assert(
  !adminFetchBody.includes("'X-Admin-Token'"),
  'adminFetch must not fall back to the machine admin token',
);

assert(
  gatewaySource.includes('export async function adminMachineFetch'),
  'machine-token access must remain explicit and separate from browser-facing adminFetch',
);
