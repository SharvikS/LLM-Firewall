#!/usr/bin/env node
// Zips the built dist/ (Chrome) and dist-firefox/ directories into
// chrome-extension.zip and firefox-extension.zip at the extension root, ready to
// upload to the Chrome Web Store / AMO. Uses the system `zip` (present on macOS,
// Linux, and the CI Ubuntu runners) — no extra npm dep needed.
//
// Run `npm run build && npm run build:firefox` first (or `npm run package`).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const TARGETS = [
  { dir: 'dist', zip: 'chrome-extension.zip' },
  { dir: 'dist-firefox', zip: 'firefox-extension.zip' },
];

for (const { dir, zip } of TARGETS) {
  const srcDir = path.join(ROOT, dir);
  if (!fs.existsSync(srcDir)) {
    console.error(`missing ${dir} — run "npm run build" (and "npm run build:firefox") first`);
    process.exit(1);
  }
  const zipPath = path.join(ROOT, zip);
  fs.rmSync(zipPath, { force: true });
  // -r recurse, -q quiet, -X strip extra attrs for reproducible zips. Zip from
  // inside the build dir so the archive has manifest.json at its root.
  execFileSync('zip', ['-r', '-q', '-X', zipPath, '.'], { cwd: srcDir, stdio: 'inherit' });
  console.log(`wrote ${zip}`);
}
