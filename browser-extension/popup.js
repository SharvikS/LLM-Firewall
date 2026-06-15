const api = globalThis.browser ?? globalThis.chrome;

function renderState(on) {
  const s = document.getElementById('state');
  s.textContent = on ? 'ON' : 'OFF';
  s.className = 'state ' + (on ? 'on' : 'off');
}

async function init() {
  const cfg = await globalThis.dlpGetConfig();
  document.getElementById('enabled').checked = cfg.enabled;
  renderState(cfg.enabled);

  api.runtime.sendMessage({ type: 'DLP_PING' }, (resp) => {
    const e = document.getElementById('engine');
    if (api.runtime.lastError) { e.textContent = 'engine: unknown'; return; }
    e.textContent = resp && resp.ok ? 'engine: connected ✓' : 'engine: offline (local rules)';
  });
}

document.getElementById('enabled').addEventListener('change', (e) => {
  api.storage.local.set({ enabled: e.target.checked });
  renderState(e.target.checked);
});

document.getElementById('opts').addEventListener('click', () => {
  if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
  else window.open(api.runtime.getURL('options.html'));
});

init();
