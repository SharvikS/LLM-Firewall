// dashboard/scripts/verify-gateway-runtime-config.mjs
//
// Guards a load-bearing assumption for the Home installer: dashboard/src/lib/gateway.ts's
// GATEWAY constant reads GATEWAY_URL via process.env at runtime, which only
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
  gatewaySource.includes("process.env.GATEWAY_URL"),
  'GATEWAY must read GATEWAY_URL from process.env so a runtime-written env file works',
);

// NEXT_PUBLIC_-prefixed env vars are special-cased by Next.js: per this repo's own bundled
// docs (dashboard/node_modules/next/dist/docs/01-app/02-guides/environment-variables.md,
// "Bundling Environment Variables for the Browser"), Next.js replaces ALL references to a
// NEXT_PUBLIC_-prefixed variable "in the Node.js environment" — not just client-bundled
// code — with a literal, hardcoded value at `next build` time. Because dashboard/next.config.ts
// sets `output: "standalone"` (the mode a future native installer runs via `next start`), a
// NEXT_PUBLIC_ var here would freeze the Gateway URL at build time even though gateway.ts is
// server-only, defeating the installer wizard's runtime port selection entirely.
assert(
  !gatewaySource.includes('NEXT_PUBLIC_GATEWAY_URL'),
  'gateway.ts must NOT read a NEXT_PUBLIC_-prefixed var: Next.js inlines NEXT_PUBLIC_ vars ' +
  'into a literal value at build time even in server-side Node.js code (see ' +
  '"Bundling Environment Variables for the Browser" in the Next.js docs), which would freeze ' +
  'the Gateway URL at build time under output: "standalone" and break the Home installer\'s ' +
  'runtime port selection',
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
  `these client components import '@/lib/gateway' and will bake GATEWAY_URL ` +
  `at build time, breaking runtime port selection: ${offenders.join(', ')}`,
);

console.log('verify-gateway-runtime-config: OK — GATEWAY stays server-side, runtime-configurable');
