// Background scanner (MV3 service worker, ES module). Content scripts can't
// reliably fetch the local engine (the chat sites' CSP blocks cross-origin
// connect from the page context), so the privileged background context makes the
// call: hit the firewall ML engine /scan, and on any failure fall back to the
// bundled local detectors so the box is never left unprotected.
import { api } from './lib/api.js';
import { dlpGetConfig } from './lib/config.js';
import { localScan } from './lib/detectors.js';

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
  const cfg = await dlpGetConfig();
  try {
    return await scanViaEngine(text, cfg);
  } catch (err) {
    // Engine unreachable / slow / errored — fall back to local detection.
    const verdict = localScan(text);
    verdict.degraded = true;
    verdict.engineError = String(err && err.message ? err.message : err);
    return verdict;
  }
}

// Relay a browser-DLP event to the firewall and tally it locally. The relay
// hits the engine /report (same host as /scan), which forwards it to the
// gateway's unified live feed / audit log / SOC alerting. Local stats power the
// popup's activity view and survive even when the engine is offline.
async function report(event) {
  await bumpStats(event);
  const cfg = await dlpGetConfig();
  const reportUrl = cfg.engineUrl.replace(/\/scan$/, '/report');
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    await fetch(reportUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch (_) {
    // Engine offline — the local tally already captured it; nothing else to do.
  }
}

// Maintain a small rolling activity summary in storage for the popup.
async function bumpStats(event) {
  const { dlpStats } = await api.storage.local.get('dlpStats');
  const stats = dlpStats || { blocked: 0, redacted: 0, overridden: 0, recent: [] };
  const a = event.action;
  if (a === 'blocked' || a === 'cancelled') stats.blocked += 1;
  else if (a === 'redacted' || a === 'auto_redacted') stats.redacted += 1;
  else if (a === 'sent_anyway') stats.overridden += 1;
  stats.recent.unshift({
    site: event.site, action: a, decision: event.decision,
    reason: event.reason, at: Date.now(),
  });
  stats.recent = stats.recent.slice(0, 20);
  await api.storage.local.set({ dlpStats: stats });
}

// ── Dynamic UI selectors ────────────────────────────────────────────────────
// The chat web UIs rename/restructure their DOM often, which silently breaks the
// content script's hardcoded composer/send selectors. To fix drift without
// re-publishing the extension, we fetch a selector map from the engine's
// GET /selectors, cache it in storage, and hand it to content scripts on demand.
// content.js merges it OVER its bundled fallbacks, so a stale/absent engine just
// degrades to the shipped selectors — never to total failure.
const SELECTORS_TTL_MS = 6 * 60 * 60 * 1000; // refresh at most every 6h
const SELECTORS_ALARM = 'dlp-selectors-refresh';

function selectorsUrl(engineUrl) {
  return engineUrl.replace(/\/scan$/, '/selectors');
}

// Fetch the latest selector map and cache it. Returns the fetched map, or null
// on failure (callers keep using whatever is already cached).
async function refreshSelectors() {
  const cfg = await dlpGetConfig();
  const url = selectorsUrl(cfg.engineUrl);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('selectors HTTP ' + res.status);
    const data = await res.json();
    if (!data || typeof data !== 'object' || !data.selectors) {
      throw new Error('selectors payload missing "selectors"');
    }
    await api.storage.local.set({ dlpSelectors: data, dlpSelectorsAt: Date.now() });
    return data;
  } catch (_) {
    return null; // keep prior cache; content.js falls back to bundled selectors
  }
}

// Return the cached selector map, refreshing it first if missing or stale.
async function getSelectors() {
  const { dlpSelectors, dlpSelectorsAt } = await api.storage.local.get(['dlpSelectors', 'dlpSelectorsAt']);
  const fresh = dlpSelectorsAt && (Date.now() - dlpSelectorsAt) < SELECTORS_TTL_MS;
  if (dlpSelectors && fresh) return dlpSelectors;
  const fetched = await refreshSelectors();
  return fetched || dlpSelectors || null; // fall back to stale cache, then null
}

// Periodic background refresh so content scripts see updated selectors even on
// long-lived tabs. Alarms survive the MV3 service worker being suspended.
try {
  if (api.alarms) {
    api.alarms.create(SELECTORS_ALARM, { periodInMinutes: 360 });
    api.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === SELECTORS_ALARM) refreshSelectors();
    });
  }
} catch (_) { /* alarms unavailable — on-demand refresh still works */ }

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'DLP_SELECTORS') {
    getSelectors().then((sel) => sendResponse(sel)).catch(() => sendResponse(null));
    return true; // async response
  }
  if (msg && msg.type === 'DLP_REPORT' && msg.event) {
    report(msg.event).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true; // async response
  }
  if (msg && msg.type === 'DLP_SCAN') {
    scan(msg.text).then(sendResponse).catch((err) =>
      sendResponse({ decision: 'allow', risk: 0, reason: 'scan failed: ' + err,
        categories: [], pii: [], secrets: [], masked_text: msg.text, source: 'error' }));
    return true; // async response
  }
  if (msg && msg.type === 'DLP_PING') {
    dlpGetConfig().then(async (cfg) => {
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

// ── AI site detection & badge classification ────────────────────────────────
const AI_SITE_WHITELIST = [
  'chatgpt.com', 'chat.openai.com',
  'claude.ai',
  'gemini.google.com',
  'perplexity.ai',
];

const AI_SITE_BLACKLIST = [
  'fake-ai-site.com',
];

function getSiteClassification(hostname) {
  if (AI_SITE_WHITELIST.some((site) => hostname.endsWith(site))) {
    return 'GENUINE';
  } else if (AI_SITE_BLACKLIST.some((site) => hostname.endsWith(site))) {
    return 'GENERIC_WRAPPER';
  } else if (hostname.includes('ai') || hostname.includes('chat')) {
    return 'UNKNOWN_AI';
  }
  return 'NOT_AI';
}

function updateBadgeForTab(tabId, url) {
  if (!url || !url.startsWith('http')) {
    api.action.setBadgeText({ text: '', tabId });
    return;
  }
  try {
    const hostname = new URL(url).hostname;
    const classification = getSiteClassification(hostname);

    if (classification === 'GENUINE') {
      api.action.setBadgeText({ text: '✓', tabId });
      api.action.setBadgeBackgroundColor({ color: '#4ade80', tabId });
    } else if (classification === 'GENERIC_WRAPPER') {
      api.action.setBadgeText({ text: '!', tabId });
      api.action.setBadgeBackgroundColor({ color: '#f87171', tabId });
    } else if (classification === 'UNKNOWN_AI') {
      api.action.setBadgeText({ text: '?', tabId });
      api.action.setBadgeBackgroundColor({ color: '#fbbf24', tabId });
    } else {
      api.action.setBadgeText({ text: '', tabId });
    }
  } catch (_) {
    api.action.setBadgeText({ text: '', tabId });
  }
}

api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateBadgeForTab(tabId, tab.url);
  }
});

api.tabs.onActivated.addListener((activeInfo) => {
  api.tabs.get(activeInfo.tabId, (tab) => {
    if (tab && tab.url) {
      updateBadgeForTab(activeInfo.tabId, tab.url);
    }
  });
});
