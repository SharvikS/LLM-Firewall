// Content script: intercepts "send" on ChatGPT / Claude / Gemini, scans the
// prompt via the background scanner, and blocks or redacts before the text
// leaves the browser. Runs in an isolated world; the blocking UI lives in a
// shadow root so the host page's CSS can't break it.
//
// Site selectors are inherently fragile (these UIs change often). Each adapter
// lists several candidates and falls back to a generic "find the focused
// editor / nearest send button" strategy, so a selector drift degrades to
// best-effort rather than total failure.

(function () {
  const api = globalThis.browser ?? globalThis.chrome;

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

  let config = globalThis.DLP_DEFAULTS;
  globalThis.dlpGetConfig().then((c) => { config = c; });
  api.storage.onChanged.addListener(() => { globalThis.dlpGetConfig().then((c) => { config = c; }); });

  // Stable identity for repeat-offender flagging. installId is always present;
  // account is a best-effort human label scraped from the page chrome.
  let installId = '';
  globalThis.dlpGetInstallId().then((id) => { installId = id; });

  // Enterprise-provisioned device identity (MDM / managed extension policy).
  // Admins set `deviceName` / `deviceId` via the managed storage area; absent on
  // unmanaged installs, in which case we fall back to the derived fingerprint.
  let managed = {};
  try {
    if (api.storage.managed && api.storage.managed.get) {
      const p = api.storage.managed.get(['deviceName', 'deviceId']);
      if (p && p.then) p.then((m) => { managed = m || {}; }).catch(() => {});
    }
  } catch (_) { /* no managed policy */ }

  function deriveOS(ua, uaData) {
    if (uaData && uaData.platform) return uaData.platform; // macOS / Windows / Linux / Android
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

  // Full browser/device fingerprint. Browsers deliberately don't expose the OS
  // hostname or local IP; the real device name comes from MDM (managed) when set.
  function deviceInfo() {
    const ua = navigator.userAgent || '';
    const uaData = navigator.userAgentData;
    let scr = '';
    try { scr = `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`; } catch (_) {}
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
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
    for (const sel of (adapter.account || [])) {
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
  function firstMatch(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function getComposer() {
    const el = firstMatch(adapter.composer);
    if (el) return el;
    // Generic fallback: the active editable element.
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
  // generates the real input events React/ProseMirror/Quill listen for, so the
  // editors actually register the change (plain textContent assignment doesn't).
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
    // contenteditable: select all then replace via insertText.
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, text);
  }

  function getSendButton() {
    return firstMatch(adapter.send);
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
      await new Promise((r) => setTimeout(r, 60)); // let the editor register the change
    }
    bypass = true;
    const btn = getSendButton();
    if (btn) {
      btn.click();
    } else if (composer) {
      // Fallback: synthesize Enter on the composer.
      const ev = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      composer.dispatchEvent(new KeyboardEvent('keydown', ev));
      composer.dispatchEvent(new KeyboardEvent('keyup', ev));
    }
    setTimeout(() => { bypass = false; }, 200);
  }

  async function handleSendAttempt(e) {
    if (bypass) return;                     // a programmatic re-send we initiated
    if (!config.enabled) return;
    if (!config.sites[adapter.key]) return;
    if (busy) { e.preventDefault(); e.stopImmediatePropagation(); return; }

    const composer = getComposer();
    const text = getText(composer).trim();
    if (!text) return;                      // nothing to scan — let it send

    // Hold the send until we have a verdict.
    e.preventDefault();
    e.stopImmediatePropagation();
    busy = true;
    try {
      const verdict = await scan(text);
      if (verdict.decision === 'allow') {
        await doSend(null);
        return;                               // clean — not reported (avoids noise)
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
      // block_redact (default), or any 'block' decision.
      const choice = await showModal(verdict, config.mode);
      if (choice === 'redact' && verdict.decision === 'redact') {
        report(verdict, 'redacted');
        await doSend(verdict.masked_text);
      } else {
        // The user backed out. A hard 'block' verdict is a block; a redactable
        // one the user chose not to send is a cancel.
        report(verdict, verdict.decision === 'block' ? 'blocked' : 'cancelled');
      }
      // 'cancel' / 'block' → do nothing; the user's text stays in the box to edit.
    } finally {
      busy = false;
    }
  }

  // Fire-and-forget a DLP event to the background, which records it locally and
  // relays it to the firewall so endpoint-side blocks show up centrally. Carries
  // verdict metadata only — never the prompt text or the sensitive values.
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
          // Scanner channel itself is unreachable. Fail OPEN by default, but in
          // strict mode fail CLOSED — never let unverified text through.
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
        // Strict mode: a verdict produced by the local fallback (engine down)
        // that came back "allow" is unverified — escalate to a block so the
        // engine being offline can never become a silent bypass.
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
  // The send check is the backstop; this is the front line. We hold the paste,
  // scan the clipboard text, and only let it land (or land masked) if it's safe.
  function insertAtCursor(el, text) {
    el.focus();
    document.execCommand('insertText', false, text); // inserts at caret, fires input events
  }

  document.addEventListener('paste', (e) => {
    if (!config.enabled || !config.sites[adapter.key] || !config.scanOnPaste) return;
    if (busy) return;
    const composer = getComposer();
    if (!composer || !isComposerEvent(e.target)) return;
    const dt = e.clipboardData || globalThis.clipboardData;
    const pasted = dt ? dt.getData('text') : '';
    if (!pasted || !pasted.trim()) return;          // non-text paste (image/file) — not our path

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
          insertAtCursor(composer, verdict.masked_text);   // paste the safe version
        } else {
          // Block / cancel → the sensitive text never enters the page.
          report(verdict, verdict.decision === 'block' ? 'blocked' : 'cancelled');
        }
      } finally { busy = false; }
    }).catch(() => { busy = false; });
  }, true);

  // ── Blocking UI (shadow DOM) ──────────────────────────────────────────────
  function showModal(verdict, mode) {
    return new Promise((resolve) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
      const root = host.attachShadow({ mode: 'open' });

      const isBlock = verdict.decision === 'block';
      const canRedact = verdict.decision === 'redact' && mode === 'block_redact';
      const tags = []
        .concat((verdict.pii || []).map((p) => ['PII', p]))
        .concat((verdict.secrets || []).map((s) => ['SECRET', s]))
        .concat((verdict.categories || []).filter((c) => c === 'injection' || c === 'toxicity' || c === 'code_leak').map((c) => ['THREAT', c]));

      const title = isBlock ? '🛑 Prompt blocked' : '⚠️ Sensitive data detected';
      const sub = isBlock
        ? 'This prompt was blocked by your organization’s LLM firewall policy.'
        : 'Sensitive information was found in your message before it was sent.';

      const chips = tags.map(([kind, t]) =>
        `<span class="chip ${kind.toLowerCase()}">${kind}: ${t}</span>`).join('');

      const degraded = verdict.source === 'local'
        ? '<div class="note">Engine offline — checked with local rules.</div>' : '';

      const buttons = isBlock
        ? `<button class="btn ghost" data-act="cancel">Edit prompt</button>`
        : mode === 'warn'
          ? `<button class="btn ghost" data-act="cancel">Cancel</button>
             <button class="btn danger" data-act="send">Send anyway</button>`
          : `<button class="btn ghost" data-act="cancel">Cancel &amp; edit</button>
             ${canRedact ? '<button class="btn primary" data-act="redact">Redact &amp; send</button>' : ''}`;

      root.innerHTML = `
        <style>
          .ov{position:fixed;inset:0;background:rgba(8,10,14,.6);backdrop-filter:blur(2px);
              display:flex;align-items:center;justify-content:center;font-family:-apple-system,Segoe UI,Roboto,sans-serif;}
          .card{width:min(440px,92vw);background:#13161c;color:#e8eaed;border:1px solid #2a2f3a;
                border-radius:14px;padding:22px 22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.5);}
          h2{margin:0 0 6px;font-size:17px;}
          p.sub{margin:0 0 14px;font-size:13px;color:#9aa3b2;line-height:1.5;}
          .reason{font-size:12px;color:#c7ccd6;background:#0d1014;border:1px solid #242a33;border-radius:8px;
                  padding:8px 10px;margin-bottom:12px;word-break:break-word;}
          .chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;}
          .chip{font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid #2a2f3a;}
          .chip.pii{background:#2a1f00;border-color:#5a4500;color:#ffcf66;}
          .chip.secret{background:#2a0e10;border-color:#5a1a1f;color:#ff8a93;}
          .chip.threat{background:#1a0e2a;border-color:#3a1f5a;color:#c79aff;}
          .note{font-size:11px;color:#7e879a;margin-bottom:12px;}
          .actions{display:flex;gap:8px;justify-content:flex-end;}
          .btn{font-size:13px;padding:8px 14px;border-radius:9px;border:1px solid #2a2f3a;cursor:pointer;background:#1b1f27;color:#e8eaed;}
          .btn.primary{background:#2563eb;border-color:#2563eb;color:#fff;}
          .btn.danger{background:#7f1d1d;border-color:#7f1d1d;color:#fff;}
          .btn.ghost{background:transparent;}
          .brand{font-size:10px;color:#5b6472;text-align:right;margin-top:10px;letter-spacing:.04em;}
        </style>
        <div class="ov">
          <div class="card" role="dialog" aria-modal="true">
            <h2>${title}</h2>
            <p class="sub">${sub}</p>
            <div class="reason">${verdict.reason || 'Policy match'}</div>
            ${chips ? `<div class="chips">${chips}</div>` : ''}
            ${degraded}
            <div class="actions">${buttons}</div>
            <div class="brand">TITAN LLM FIREWALL</div>
          </div>
        </div>`;

      root.querySelectorAll('[data-act]').forEach((b) => {
        b.addEventListener('click', () => { host.remove(); resolve(b.getAttribute('data-act')); });
      });
      root.querySelector('.ov').addEventListener('click', (ev) => {
        if (ev.target.classList.contains('ov')) { host.remove(); resolve('cancel'); }
      });

      document.documentElement.appendChild(host);
    });
  }
})();
