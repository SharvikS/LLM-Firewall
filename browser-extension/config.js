// Shared defaults for the TITAN browser DLP extension. Loaded first in every
// context (content script, background, options, popup) so all of them agree on
// the config shape. Stored values in chrome.storage.local override these.
globalThis.DLP_DEFAULTS = {
  enabled: true,                                 // master on/off
  engineUrl: 'http://localhost:8001/scan',       // firewall ML engine /scan endpoint
  mode: 'block_redact',                          // 'block_redact' | 'auto_redact' | 'warn'
  timeoutMs: 1500,                               // engine call budget before local fallback
  strict: false,                                 // fail-CLOSED: block sends we can't verify
                                                 // (engine unreachable / scanner error)
  scanOnPaste: true,                             // scan pasted text the moment it lands
  sites: { chatgpt: true, claude: true, gemini: true },
};

// Resolve the effective config from storage, merged over defaults.
globalThis.dlpGetConfig = async function dlpGetConfig() {
  const api = globalThis.browser ?? globalThis.chrome;
  const stored = await api.storage.local.get(null);
  const cfg = Object.assign({}, globalThis.DLP_DEFAULTS, stored);
  cfg.sites = Object.assign({}, globalThis.DLP_DEFAULTS.sites, stored.sites || {});
  return cfg;
};

// Stable per-install identity used to attribute violations to a user/device so
// the firewall can flag repeat offenders. Generated once and persisted; it is a
// random UUID, not tied to any account, and survives across the three chat sites
// in this browser profile.
globalThis.dlpGetInstallId = async function dlpGetInstallId() {
  const api = globalThis.browser ?? globalThis.chrome;
  const { installId } = await api.storage.local.get('installId');
  if (installId) return installId;
  const id = (globalThis.crypto && globalThis.crypto.randomUUID)
    ? globalThis.crypto.randomUUID()
    : 'inst-' + Math.abs(Date.now() ^ Math.floor(Math.random() * 1e9)).toString(36);
  await api.storage.local.set({ installId: id });
  return id;
};
