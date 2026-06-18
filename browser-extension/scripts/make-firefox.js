#!/usr/bin/env node
// Derives the Firefox MV3 build (dist-firefox/) from the crxjs Chrome build
// (dist/). crxjs targets Chrome and emits a `background.service_worker`; Firefox
// MV3 loads the background as ES-module `scripts`, so we copy the build and
// rewrite just the manifest's background block and add the gecko settings.
//
// Run after `npm run build`. Firefox ≥128 is required for module background
// scripts (set as strict_min_version below).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'dist');
const DEST = path.join(ROOT, 'dist-firefox');

if (!fs.existsSync(SRC)) {
  console.error('missing dist/ — run "npm run build" first');
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.cpSync(SRC, DEST, { recursive: true });

const manifestPath = path.join(DEST, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Chrome service worker → Firefox module background scripts.
const sw = manifest.background && manifest.background.service_worker;
if (sw) {
  manifest.background = { scripts: [sw], type: 'module' };
}

// Firefox add-on identity. AMO requires a stable id; module background scripts
// need a recent engine.
manifest.browser_specific_settings = {
  gecko: {
    id: 'titan-llm-firewall@sharvik.dev',
    strict_min_version: '128.0',
  },
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('built dist-firefox (Firefox MV3 manifest)');
