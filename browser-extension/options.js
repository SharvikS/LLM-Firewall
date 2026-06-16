const api = globalThis.browser ?? globalThis.chrome;

const $ = (id) => document.getElementById(id);

async function load() {
  const cfg = await globalThis.dlpGetConfig();
  $('enabled').checked = cfg.enabled;
  $('mode').value = cfg.mode;
  $('strict').checked = !!cfg.strict;
  $('scanOnPaste').checked = cfg.scanOnPaste !== false;
  $('engineUrl').value = cfg.engineUrl;
  document.querySelectorAll('[data-site]').forEach((el) => {
    el.checked = !!cfg.sites[el.getAttribute('data-site')];
  });
}

async function save() {
  const sites = {};
  document.querySelectorAll('[data-site]').forEach((el) => {
    sites[el.getAttribute('data-site')] = el.checked;
  });
  await api.storage.local.set({
    enabled: $('enabled').checked,
    mode: $('mode').value,
    strict: $('strict').checked,
    scanOnPaste: $('scanOnPaste').checked,
    engineUrl: $('engineUrl').value.trim() || globalThis.DLP_DEFAULTS.engineUrl,
    sites,
  });
  const saved = $('saved');
  saved.style.display = 'inline';
  setTimeout(() => { saved.style.display = 'none'; }, 1500);
}

function testConnection() {
  const status = $('testStatus');
  status.textContent = 'testing…';
  status.className = 'status';
  // Save the current URL first so the background pings the right endpoint.
  api.storage.local.set({ engineUrl: $('engineUrl').value.trim() }).then(() => {
    api.runtime.sendMessage({ type: 'DLP_PING' }, (resp) => {
      if (resp && resp.ok) {
        status.textContent = 'reachable ✓';
        status.className = 'status ok';
      } else {
        status.textContent = 'unreachable — local fallback will be used';
        status.className = 'status bad';
      }
    });
  });
}

$('save').addEventListener('click', save);
$('test').addEventListener('click', testConnection);
load();
