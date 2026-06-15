// Shared defaults for the TITAN browser DLP extension. Loaded first in every
// context (content script, background, options, popup) so all of them agree on
// the config shape. Stored values in chrome.storage.local override these.
globalThis.DLP_DEFAULTS = {
  enabled: true,                                 // master on/off
  engineUrl: 'http://localhost:8001/scan',       // firewall ML engine /scan endpoint
  mode: 'block_redact',                          // 'block_redact' | 'auto_redact' | 'warn'
  timeoutMs: 1500,                               // engine call budget before local fallback
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
