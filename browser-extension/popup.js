const api = globalThis.browser ?? globalThis.chrome;

function renderState(on) {
  const s = document.getElementById('state');
  s.textContent = on ? 'ON' : 'OFF';
  s.className = 'state ' + (on ? 'on' : 'off');
}

const REL = (ms) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
};

const ACTION_DOT = { blocked: 'blocked', cancelled: 'blocked', redacted: 'redacted',
  auto_redacted: 'redacted', sent_anyway: 'sent_anyway' };
const ACTION_LABEL = { blocked: 'blocked', cancelled: 'cancelled', redacted: 'redacted',
  auto_redacted: 'auto-redacted', sent_anyway: 'sent anyway' };

async function renderStats() {
  const { dlpStats } = await api.storage.local.get('dlpStats');
  const s = dlpStats || { blocked: 0, redacted: 0, overridden: 0, recent: [] };
  document.getElementById('s-blocked').textContent = s.blocked;
  document.getElementById('s-redacted').textContent = s.redacted;
  document.getElementById('s-overridden').textContent = s.overridden;

  const box = document.getElementById('events');
  if (!s.recent.length) {
    box.innerHTML = '<div class="empty">No events yet — protection is watching.</div>';
    return;
  }
  box.innerHTML = s.recent.slice(0, 6).map((e) => {
    const dot = ACTION_DOT[e.action] || 'blocked';
    const label = ACTION_LABEL[e.action] || e.action;
    const rsn = e.reason || label;
    return `<div class="ev"><span class="dot ${dot}"></span>` +
      `<span class="site">${e.site || '?'}</span>` +
      `<span class="rsn" title="${rsn}">${label} · ${REL(e.at)}</span></div>`;
  }).join('');
}

function getSiteClassification(hostname) {
  const AI_SITE_WHITELIST = ['chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'];
  const AI_SITE_BLACKLIST = ['fake-ai-site.com'];
  if (AI_SITE_WHITELIST.some(site => hostname.endsWith(site))) return 'GENUINE';
  if (AI_SITE_BLACKLIST.some(site => hostname.endsWith(site))) return 'GENERIC_WRAPPER';
  if (hostname.includes('ai') || hostname.includes('chat')) return 'UNKNOWN_AI';
  return 'NOT_AI';
}

async function renderSiteStatus() {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs[0] || !tabs[0].url) return;
  
  try {
    const url = new URL(tabs[0].url);
    if (!url.hostname) return;
    const classification = getSiteClassification(url.hostname);
    
    const banner = document.getElementById('site-status');
    banner.style.display = 'block';
    
    if (classification === 'GENUINE') {
      banner.style.backgroundColor = '#166534';
      banner.style.color = '#4ade80';
      banner.style.border = '1px solid #14532d';
      banner.textContent = '✓ Genuine AI Platform';
    } else if (classification === 'GENERIC_WRAPPER') {
      banner.style.backgroundColor = '#7f1d1d';
      banner.style.color = '#f87171';
      banner.style.border = '1px solid #7f1d1d';
      banner.textContent = '⚠️ Generic/Wrapper AI Site';
    } else if (classification === 'UNKNOWN_AI') {
      banner.style.backgroundColor = '#78350f';
      banner.style.color = '#fbbf24';
      banner.style.border = '1px solid #78350f';
      banner.textContent = '? Unknown AI Site';
    } else {
      banner.style.display = 'none';
    }
  } catch (e) {
    // invalid URL or permission denied
  }
}

async function init() {
  const cfg = await globalThis.dlpGetConfig();
  document.getElementById('enabled').checked = cfg.enabled;
  renderState(cfg.enabled);
  renderStats();
  renderSiteStatus();

  api.runtime.sendMessage({ type: 'DLP_PING' }, (resp) => {
    const e = document.getElementById('engine');
    if (api.runtime.lastError) { e.textContent = 'engine: unknown'; return; }
    e.textContent = resp && resp.ok ? 'engine: connected ✓' : 'engine: offline (local rules)';
  });
}

// Live-refresh the activity view when a new event lands while the popup is open.
api.storage.onChanged.addListener((changes) => {
  if (changes.dlpStats) renderStats();
});

document.getElementById('clear').addEventListener('click', () => {
  api.storage.local.set({ dlpStats: { blocked: 0, redacted: 0, overridden: 0, recent: [] } });
});

document.getElementById('enabled').addEventListener('change', (e) => {
  api.storage.local.set({ enabled: e.target.checked });
  renderState(e.target.checked);
});

document.getElementById('opts').addEventListener('click', () => {
  if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
  else window.open(api.runtime.getURL('options.html'));
});

init();
