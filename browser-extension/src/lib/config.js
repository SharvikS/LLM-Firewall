// Shared config for the TITAN browser DLP extension. ESM module imported by the
// background worker, content script, popup, and options page so they all agree
// on the config shape. Stored values in storage.local override the defaults.
import { api } from './api.js';

export const DLP_DEFAULTS = {
  enabled: true,                                 // master on/off
  engineUrl: 'http://localhost:8001/scan',       // firewall ML engine /scan endpoint
  mode: 'block_redact',                          // 'block_redact' | 'auto_redact' | 'warn'
  timeoutMs: 1500,                               // engine call budget before local fallback
  strict: false,                                 // fail-CLOSED: block sends we can't verify
                                                 // (engine unreachable / scanner error)
  scanOnPaste: true,                             // scan pasted text the moment it lands
  scanFiles: true,                               // scan file/image attachments before upload
  maxFileMB: 10,                                 // skip files larger than this (perf guard)
  sites: { chatgpt: true, claude: true, gemini: true, perplexity: true },
};

// /scan-file endpoint, derived from the configured /scan URL so a single
// engineUrl setting drives both. Falls back gracefully if the URL is custom.
export function dlpScanFileUrl(engineUrl) {
  return engineUrl.replace(/\/scan$/, '/scan-file');
}

// Resolve the effective config from storage, merged over defaults.
export async function dlpGetConfig() {
  const stored = await api.storage.local.get(null);
  const cfg = Object.assign({}, DLP_DEFAULTS, stored);
  cfg.sites = Object.assign({}, DLP_DEFAULTS.sites, stored.sites || {});
  return cfg;
}

// Stable per-install identity used to attribute violations to a user/device so
// the firewall can flag repeat offenders. Generated once and persisted; it is a
// random UUID, not tied to any account, and survives across the chat sites in
// this browser profile.
export async function dlpGetInstallId() {
  const { installId } = await api.storage.local.get('installId');
  if (installId) return installId;
  const id = (globalThis.crypto && globalThis.crypto.randomUUID)
    ? globalThis.crypto.randomUUID()
    : 'inst-' + Math.abs(Date.now() ^ Math.floor(Math.random() * 1e9)).toString(36);
  await api.storage.local.set({ installId: id });
  return id;
}
