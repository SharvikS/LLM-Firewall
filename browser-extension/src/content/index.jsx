// Content script: intercepts "send" on ChatGPT / Claude / Gemini / Perplexity,
// scans the prompt via the background scanner, and blocks or redacts before the
// text leaves the browser. Runs in an isolated world; the blocking UI is a React
// component rendered into a shadow root so the host page's CSS can't break it.
//
// Site selectors are inherently fragile (these UIs change often). Each adapter
// lists several candidates and falls back to a generic "find the focused
// editor / nearest send button" strategy, and the background merges a
// centrally-managed selector map over them — so a selector drift degrades to
// best-effort rather than total failure.
import { createRoot } from 'react-dom/client';
import { api } from '../lib/api.js';
import { DLP_DEFAULTS, dlpGetConfig, dlpGetInstallId } from '../lib/config.js';
import Modal from './Modal.jsx';
import css from './content.css?inline';

(function () {
  // ── Site adapters ─────────────────────────────────────────────────────────
  const ADAPTERS = {
    chatgpt: {
      key: 'chatgpt',
      hosts: ['chatgpt.com', 'chat.openai.com'],
      composer: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea'],
      send: ['button[data-testid="send-button"]', 'button[aria-label*="Send" i]', 'button[type="submit"]'],
      account: ['[data-testid="profile-button"]', 'nav img[alt]'],
    },
    claude: {
      key: 'claude',
      hosts: ['claude.ai'],
      composer: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'],
      send: ['button[aria-label*="Send" i]', 'button[type="submit"]'],
      account: ['button[data-testid="user-menu-button"]', 'button[aria-label*="account" i]'],
    },
    gemini: {
      key: 'gemini',
      hosts: ['gemini.google.com'],
      composer: ['div.ql-editor[contenteditable="true"]', 'rich-textarea div[contenteditable="true"]', 'div[contenteditable="true"]'],
      send: ['button[aria-label*="Send" i]', 'button.send-button', 'button[mattooltip*="Send" i]'],
      account: ['a[aria-label*="Google Account" i]', 'a[aria-label*="@"]'],
    },
    perplexity: {
      key: 'perplexity',
      hosts: ['perplexity.ai'],
      composer: ['textarea[placeholder*="Ask" i]', 'div[contenteditable="true"][role="textbox"]', 'textarea', 'div[contenteditable="true"]'],
      send: ['button[aria-label*="Submit" i]', 'button[aria-label*="Send" i]', 'button[data-testid*="submit" i]', 'button[type="submit"]'],
      account: ['button[aria-label*="account" i]', 'img[alt*="@"]'],
    },
  };

  function resolveAdapter() {
    const host = location.hostname;
    for (const a of Object.values(ADAPTERS)) {
      if (a.hosts.some((h) => host === h || host.endsWith('.' + h))) return a;
    }
    return null;
  }

  const adapter = resolveAdapter();
  if (!adapter) return;

  // Effective selectors. Start from the adapter's bundled defaults; the engine's
  // /selectors map (fetched + cached by the background) is merged OVER these so
  // ops can fix DOM drift centrally. Remote candidates take priority, bundled
  // ones stay as a fallback, so a stale/absent engine never breaks the adapter.
  const selectors = {
    composer: adapter.composer.slice(),
    send: adapter.send.slice(),
    account: (adapter.account || []).slice(),
  };
  function mergeRemoteSelectors(map) {
    const remote = map && map.selectors && map.selectors[adapter.key];
    if (!remote) return;
    for (const field of ['composer', 'send', 'account']) {
      const list = remote[field];
      if (!Array.isArray(list) || !list.length) continue;
      selectors[field] = [...new Set([...list, ...selectors[field]])];
    }
  }
  try {
    api.runtime.sendMessage({ type: 'DLP_SELECTORS' }, (map) => {
      if (api.runtime.lastError || !map) return;
      mergeRemoteSelectors(map);
    });
  } catch (_) { /* background unavailable — bundled selectors stand */ }

  let config = DLP_DEFAULTS;
  dlpGetConfig().then((c) => { config = c; });
  api.storage.onChanged.addListener(() => { dlpGetConfig().then((c) => { config = c; }); });

  // Stable identity for repeat-offender flagging. installId is always present;
  // account is a best-effort human label scraped from the page chrome.
  let installId = '';
  dlpGetInstallId().then((id) => { installId = id; });

  // Enterprise-provisioned device identity (MDM / managed extension policy).
  let managed = {};
  try {
    if (api.storage.managed && api.storage.managed.get) {
      const p = api.storage.managed.get(['deviceName', 'deviceId']);
      if (p && p.then) p.then((m) => { managed = m || {}; }).catch(() => {});
    }
  } catch (_) { /* no managed policy */ }

  function deriveOS(ua, uaData) {
    if (uaData && uaData.platform) return uaData.platform;
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return '';
  }
  function deriveBrowser(ua) {
    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\/|Opera/.test(ua)) return 'Opera';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    return '';
  }

  function deviceInfo() {
    const ua = navigator.userAgent || '';
    const uaData = navigator.userAgentData;
    let scr = '';
    try { scr = `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`; } catch (_) { /* unavailable */ }
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { /* unavailable */ }
    return {
      name: managed.deviceName || '',
      id: managed.deviceId || '',
      user_agent: ua,
      platform: navigator.platform || (uaData && uaData.platform) || '',
      os: deriveOS(ua, uaData),
      browser: deriveBrowser(ua),
      mobile: !!(uaData && uaData.mobile),
      timezone: tz,
      languages: (navigator.languages || [navigator.language]).filter(Boolean).join(','),
      screen: scr,
      cores: navigator.hardwareConcurrency || 0,
      memory: navigator.deviceMemory || 0,
    };
  }

  function detectAccount() {
    const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
    for (const sel of (selectors.account || [])) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const hay = [el.getAttribute('aria-label'), el.getAttribute('alt'),
        el.getAttribute('title'), el.textContent].filter(Boolean).join(' ');
      const m = hay.match(EMAIL_RE);
      if (m) return m[0];
    }
    return '';
  }

  // ── Composer helpers ──────────────────────────────────────────────────────
  function firstMatch(sels) {
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function getComposer() {
    const el = firstMatch(selectors.composer);
    if (el) return el;
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || a.isContentEditable)) return a;
    return null;
  }

  function getText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA') return el.value;
    return el.innerText;
  }

  // Set composer text in a framework-friendly way. execCommand('insertText')
  // generates the real input events React/ProseMirror/Quill listen for.
  function setText(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, text);
  }

  function getSendButton() {
    return firstMatch(selectors.send);
  }

  // ── Interception ──────────────────────────────────────────────────────────
  let bypass = false;     // when true, our listeners let the event through
  let busy = false;       // a scan/modal is in flight

  function isComposerEvent(target) {
    const composer = getComposer();
    if (!composer) return false;
    return composer === target || composer.contains(target) ||
      (target.closest && target.closest('form') && composer.closest('form') === target.closest('form'));
  }

  async function doSend(masked) {
    const composer = getComposer();
    if (masked != null && composer) {
      setText(composer, masked);
      await new Promise((r) => setTimeout(r, 60));
    }
    bypass = true;
    const btn = getSendButton();
    if (btn) {
      btn.click();
    } else if (composer) {
      const ev = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      composer.dispatchEvent(new KeyboardEvent('keydown', ev));
      composer.dispatchEvent(new KeyboardEvent('keyup', ev));
    }
    setTimeout(() => { bypass = false; }, 200);
  }

  async function handleSendAttempt(e) {
    if (bypass) return;
    if (!config.enabled) return;
    if (!config.sites[adapter.key]) return;
    if (busy) { e.preventDefault(); e.stopImmediatePropagation(); return; }

    const composer = getComposer();
    const text = getText(composer).trim();
    if (!text) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    busy = true;
    try {
      const verdict = await scan(text);
      if (verdict.decision === 'allow') {
        await doSend(null);
        return;
      }
      if (config.mode === 'warn') {
        const ok = await showModal(verdict, 'warn');
        if (ok === 'send') { report(verdict, 'sent_anyway'); await doSend(null); }
        else report(verdict, 'cancelled');
        return;
      }
      if (config.mode === 'auto_redact' && verdict.decision === 'redact') {
        report(verdict, 'auto_redacted');
        await doSend(verdict.masked_text);
        return;
      }
      const choice = await showModal(verdict, config.mode);
      if (choice === 'redact' && verdict.decision === 'redact') {
        report(verdict, 'redacted');
        await doSend(verdict.masked_text);
      } else {
        report(verdict, verdict.decision === 'block' ? 'blocked' : 'cancelled');
      }
    } finally {
      busy = false;
    }
  }

  // Fire-and-forget a DLP event to the background. Carries verdict metadata
  // only — never the prompt text or the sensitive values.
  function report(verdict, action) {
    try {
      api.runtime.sendMessage({
        type: 'DLP_REPORT',
        event: {
          site: adapter.key,
          host: location.hostname,
          decision: verdict.decision,
          action,
          risk: verdict.risk || 0,
          reason: verdict.reason || '',
          categories: verdict.categories || [],
          pii: verdict.pii || [],
          secrets: verdict.secrets || [],
          source: verdict.source || 'engine',
          subject: installId,
          account: detectAccount(),
          device: deviceInfo(),
        },
      });
    } catch (_) { /* best-effort; reporting must never break the send flow */ }
  }

  function scan(text) {
    return new Promise((resolve) => {
      api.runtime.sendMessage({ type: 'DLP_SCAN', text }, (resp) => {
        if (api.runtime.lastError || !resp) {
          if (config.strict) {
            resolve({ decision: 'block', risk: 50,
              reason: 'Scanner unavailable — blocked by strict policy',
              categories: ['unverified'], pii: [], secrets: [], masked_text: text, source: 'error' });
          } else {
            resolve({ decision: 'allow', risk: 0, reason: 'scanner unavailable',
              categories: [], pii: [], secrets: [], masked_text: text, source: 'error' });
          }
          return;
        }
        if (config.strict && resp.degraded && resp.decision === 'allow') {
          resolve({ decision: 'block', risk: 40,
            reason: 'Engine offline — strict policy blocks unverified sends',
            categories: ['unverified'], pii: [], secrets: [], masked_text: text, source: 'local' });
          return;
        }
        resolve(resp);
      });
    });
  }

  // Capture-phase listeners so we run before the site's own handlers.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (!isComposerEvent(e.target)) return;
    handleSendAttempt(e);
  }, true);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('button');
    if (!btn) return;
    const sendBtn = getSendButton();
    if (!sendBtn || (btn !== sendBtn && !sendBtn.contains(btn) && !btn.contains(sendBtn))) return;
    handleSendAttempt(e);
  }, true);

  // ── Paste interception — catch pasted secrets before they even land ────────
  function insertAtCursor(el, text) {
    el.focus();
    document.execCommand('insertText', false, text);
  }

  document.addEventListener('paste', (e) => {
    if (!config.enabled || !config.sites[adapter.key] || !config.scanOnPaste) return;
    if (busy) return;
    const composer = getComposer();
    if (!composer || !isComposerEvent(e.target)) return;
    const dt = e.clipboardData || globalThis.clipboardData;
    const pasted = dt ? dt.getData('text') : '';
    if (!pasted || !pasted.trim()) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    busy = true;
    scan(pasted).then(async (verdict) => {
      try {
        if (verdict.decision === 'allow') { insertAtCursor(composer, pasted); return; }
        if (config.mode === 'warn') {
          const ok = await showModal(verdict, 'warn');
          if (ok === 'send') { report(verdict, 'sent_anyway'); insertAtCursor(composer, pasted); }
          else report(verdict, 'cancelled');
          return;
        }
        if (config.mode === 'auto_redact' && verdict.decision === 'redact') {
          report(verdict, 'auto_redacted');
          insertAtCursor(composer, verdict.masked_text);
          return;
        }
        const choice = await showModal(verdict, config.mode);
        if (choice === 'redact' && verdict.decision === 'redact') {
          report(verdict, 'redacted');
          insertAtCursor(composer, verdict.masked_text);
        } else {
          report(verdict, verdict.decision === 'block' ? 'blocked' : 'cancelled');
        }
      } finally { busy = false; }
    }).catch(() => { busy = false; });
  }, true);

  // ── Blocking UI (React in a shadow root) ───────────────────────────────────
  // Mount the React modal into an isolated shadow tree with the Tailwind-built
  // stylesheet injected, and resolve with the user's choice once they act.
  function showModal(verdict, mode) {
    return new Promise((resolve) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
      const root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = css;
      root.appendChild(style);
      const mount = document.createElement('div');
      root.appendChild(mount);
      document.documentElement.appendChild(host);

      const reactRoot = createRoot(mount);
      const done = (action) => {
        try { reactRoot.unmount(); } catch (_) { /* already gone */ }
        host.remove();
        resolve(action);
      };
      reactRoot.render(<Modal verdict={verdict} mode={mode} onChoose={done} />);
    });
  }
})();
