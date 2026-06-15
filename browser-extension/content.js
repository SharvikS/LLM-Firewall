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
    },
    claude: {
      key: 'claude',
      hosts: ['claude.ai'],
      composer: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'],
      send: ['button[aria-label*="Send" i]', 'button[type="submit"]'],
    },
    gemini: {
      key: 'gemini',
      hosts: ['gemini.google.com'],
      composer: ['div.ql-editor[contenteditable="true"]', 'rich-textarea div[contenteditable="true"]', 'div[contenteditable="true"]'],
      send: ['button[aria-label*="Send" i]', 'button.send-button', 'button[mattooltip*="Send" i]'],
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
        return;
      }
      if (config.mode === 'warn') {
        const ok = await showModal(verdict, 'warn');
        if (ok === 'send') await doSend(null);
        return;
      }
      if (config.mode === 'auto_redact' && verdict.decision === 'redact') {
        await doSend(verdict.masked_text);
        return;
      }
      // block_redact (default), or any 'block' decision.
      const action = await showModal(verdict, config.mode);
      if (action === 'redact' && verdict.decision === 'redact') {
        await doSend(verdict.masked_text);
      }
      // 'cancel' / 'block' → do nothing; the user's text stays in the box to edit.
    } finally {
      busy = false;
    }
  }

  function scan(text) {
    return new Promise((resolve) => {
      api.runtime.sendMessage({ type: 'DLP_SCAN', text }, (resp) => {
        if (api.runtime.lastError || !resp) {
          resolve({ decision: 'allow', risk: 0, reason: 'scanner unavailable',
            categories: [], pii: [], secrets: [], masked_text: text, source: 'error' });
        } else {
          resolve(resp);
        }
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
