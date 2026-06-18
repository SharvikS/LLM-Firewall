// React glue around the WebExtension storage/messaging APIs.
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { dlpGetConfig } from './config.js';

// Load the effective config and persist patches back to storage.local. Returns
// [cfg, update, loaded]; cfg is null until the first load resolves.
export function useConfig() {
  const [cfg, setCfg] = useState(null);
  useEffect(() => { dlpGetConfig().then(setCfg); }, []);
  const update = useCallback((patch) => {
    setCfg((c) => ({ ...c, ...patch }));
    return api.storage.local.set(patch);
  }, []);
  return [cfg, update, cfg !== null];
}

// Live activity tally for the popup; re-renders when the background writes a new
// event into storage while the popup is open.
export function useStats() {
  const empty = { blocked: 0, redacted: 0, overridden: 0, recent: [] };
  const [stats, setStats] = useState(empty);
  useEffect(() => {
    let alive = true;
    api.storage.local.get('dlpStats').then(({ dlpStats }) => {
      if (alive) setStats(dlpStats || empty);
    });
    const onChange = (changes) => {
      if (changes.dlpStats) setStats(changes.dlpStats.newValue || empty);
    };
    api.storage.onChanged.addListener(onChange);
    return () => { alive = false; api.storage.onChanged.removeListener(onChange); };
  }, []);
  const clear = useCallback(() => api.storage.local.set({ dlpStats: empty }), []);
  return [stats, clear];
}

// Ping the engine through the background worker. Returns 'checking' | 'online'
// | 'offline'.
export function useEngineStatus() {
  const [status, setStatus] = useState('checking');
  useEffect(() => {
    try {
      api.runtime.sendMessage({ type: 'DLP_PING' }, (resp) => {
        if (api.runtime.lastError) { setStatus('offline'); return; }
        setStatus(resp && resp.ok ? 'online' : 'offline');
      });
    } catch (_) { setStatus('offline'); }
  }, []);
  return status;
}

// Classify the active tab's host the same way the background badge does.
const WHITELIST = ['chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'];
const BLACKLIST = ['fake-ai-site.com'];
function classify(host) {
  if (WHITELIST.some((s) => host.endsWith(s))) return 'GENUINE';
  if (BLACKLIST.some((s) => host.endsWith(s))) return 'GENERIC_WRAPPER';
  if (host.includes('ai') || host.includes('chat')) return 'UNKNOWN_AI';
  return 'NOT_AI';
}

export function useActiveSite() {
  const [site, setSite] = useState(null); // { host, classification } | null
  useEffect(() => {
    api.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const url = tabs && tabs[0] && tabs[0].url;
      if (!url) return;
      try {
        const host = new URL(url).hostname;
        if (host) setSite({ host, classification: classify(host) });
      } catch (_) { /* invalid/internal URL */ }
    });
  }, []);
  return site;
}
