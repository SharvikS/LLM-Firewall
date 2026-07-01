// dashboard/scripts/verify-gateway-runtime-config.mjs
//
// Guards a load-bearing assumption for the Home installer: dashboard/src/lib/gateway.ts's
// GATEWAY constant reads NEXT_PUBLIC_GATEWAY_URL via process.env at runtime, which only
// works because every importer is a server-side route handler. If a client component
// ('use client') ever imports GATEWAY, Next.js inlines the build-time value into the
// browser bundle and the Home installer's "auto-pick a free Gateway port" wizard step
// silently breaks. See docs/superpowers/specs/2026-07-01-native-desktop-installer-design.md,
// Gap Resolution #1.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const gatewaySource = readFileSync(join(root, 'src/lib/gateway.ts'), 'utf8');
assert(
  gatewaySource.includes("process.env.NEXT_PUBLIC_GATEWAY_URL"),
  'GATEWAY must read NEXT_PUBLIC_GATEWAY_URL from process.env so a runtime-written env file works',
);

// Walk src/app looking for any file that imports '@/lib/gateway' (directly or via a
// re-export) AND declares 'use client' — that combination is what breaks runtime
// configurability.
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(join(root, 'src'));
const offenders = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const importsGateway = /from ['"]@\/lib\/gateway['"]/.test(src);
  const isClientComponent = /^\s*['"]use client['"]/.test(src);
  if (importsGateway && isClientComponent) offenders.push(file);
}

assert.equal(
  offenders.length,
  0,
  `these client components import '@/lib/gateway' and will bake NEXT_PUBLIC_GATEWAY_URL ` +
  `at build time, breaking runtime port selection: ${offenders.join(', ')}`,
);

console.log('verify-gateway-runtime-config: OK — GATEWAY stays server-side, runtime-configurable');
