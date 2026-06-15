// Background scanner. Content scripts can't reliably fetch the local engine
// (the chat sites' CSP blocks cross-origin connect from the page context), so
// the privileged background context makes the call. Strategy chosen by the
// operator: call the firewall ML engine /scan, and on any failure fall back to
// the bundled local detectors so the box is never left unprotected.

// Chrome MV3 runs this as a service worker (single file) — pull in deps via
// importScripts. Firefox MV3 lists them in background.scripts, so they're
// already loaded and importScripts is absent.
if (typeof importScripts === 'function' && typeof globalThis.LocalDLP === 'undefined') {
  try { importScripts('config.js', 'detectors.js'); } catch (e) { /* already loaded */ }
}

const api = globalThis.browser ?? globalThis.chrome;

async function scanViaEngine(text, cfg) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(cfg.engineUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('engine HTTP ' + res.status);
    const verdict = await res.json();
    verdict.source = 'engine';
    return verdict;
  } finally {
    clearTimeout(timer);
  }
}

async function scan(text) {
  const cfg = await globalThis.dlpGetConfig();
  try {
    return await scanViaEngine(text, cfg);
  } catch (err) {
    // Engine unreachable / slow / errored — fall back to local detection.
    const verdict = globalThis.LocalDLP.localScan(text);
    verdict.degraded = true;
    verdict.engineError = String(err && err.message ? err.message : err);
    return verdict;
  }
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'DLP_SCAN') {
    scan(msg.text).then(sendResponse).catch((err) =>
      sendResponse({ decision: 'allow', risk: 0, reason: 'scan failed: ' + err,
        categories: [], pii: [], secrets: [], masked_text: msg.text, source: 'error' }));
    return true; // async response
  }
  if (msg && msg.type === 'DLP_PING') {
    globalThis.dlpGetConfig().then(async (cfg) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
        const res = await fetch(cfg.engineUrl.replace(/\/scan$/, '/health'), { signal: ctrl.signal });
        clearTimeout(t);
        sendResponse({ ok: res.ok, status: res.status });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    });
    return true;
  }
  return false;
});
