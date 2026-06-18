import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck, ShieldAlert, Eye, Bell, Lock, Clipboard,
  Server, CheckCircle2, XCircle, Loader2, MessageSquare,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { DLP_DEFAULTS } from '../lib/config.js';
import { useConfig } from '../lib/hooks.js';
import { Logo, Card, Toggle, Button, Segmented, Chip, EASE } from '../ui/primitives.jsx';

const MODES = [
  { value: 'block_redact', label: 'Block + Redact', icon: <ShieldAlert size={13} /> },
  { value: 'auto_redact', label: 'Auto-redact', icon: <Eye size={13} /> },
  { value: 'warn', label: 'Warn only', icon: <Bell size={13} /> },
];

const SITES = [
  { key: 'chatgpt', name: 'ChatGPT', host: 'chatgpt.com' },
  { key: 'claude', name: 'Claude', host: 'claude.ai' },
  { key: 'gemini', name: 'Gemini', host: 'gemini.google.com' },
  { key: 'perplexity', name: 'Perplexity', host: 'perplexity.ai' },
];

function Row({ icon, title, hint, children }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5">
      <div className="flex gap-3">
        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg"
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          {icon}
        </div>
        <div>
          <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{title}</div>
          {hint && <div className="mt-0.5 text-[11.5px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>{hint}</div>}
        </div>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

const Divider = () => <div style={{ borderTop: '1px solid var(--border-soft)' }} />;

export default function Options() {
  const [cfg, update, loaded] = useConfig();
  const [urlDraft, setUrlDraft] = useState(null);
  const [test, setTest] = useState('idle'); // idle | testing | ok | bad
  const [saved, setSaved] = useState(false);

  if (!loaded) {
    return <div className="grid min-h-screen place-items-center" style={{ color: 'var(--text-dim)' }}>
      <Loader2 className="animate-spin" />
    </div>;
  }

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1400); };
  const set = (patch) => { update(patch); flash(); };
  const url = urlDraft ?? cfg.engineUrl;

  const saveUrl = () => {
    const v = (url || '').trim() || DLP_DEFAULTS.engineUrl;
    update({ engineUrl: v });
    setUrlDraft(v);
    flash();
  };

  const testConnection = () => {
    setTest('testing');
    api.storage.local.set({ engineUrl: (url || '').trim() || DLP_DEFAULTS.engineUrl }).then(() => {
      api.runtime.sendMessage({ type: 'DLP_PING' }, (resp) => {
        setTest(resp && resp.ok ? 'ok' : 'bad');
      });
    });
  };

  return (
    <div className="relative min-h-screen" style={{ background: 'var(--bg-main)' }}>
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-[0.05]" />

      <div className="relative mx-auto max-w-[620px] px-6 py-10">
        <motion.header
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}
          className="mb-7 flex items-center justify-between"
        >
          <Logo size="lg" subtitle="Settings" />
          <AnimatePresence>
            {saved && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <Chip tone="ok"><CheckCircle2 size={12} /> Saved</Chip>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.header>

        <p className="mb-6 text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Scans prompts in ChatGPT, Claude, Gemini, and Perplexity and stops sensitive data before it leaves your browser.
        </p>

        {/* Protection master */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
          <Card glow className="mb-4">
            <Row icon={<ShieldCheck size={15} />} title="Protection enabled"
              hint="Master switch for prompt scanning across all sites.">
              <Toggle checked={cfg.enabled} onChange={(v) => set({ enabled: v })} ariaLabel="Protection enabled" />
            </Row>
          </Card>
        </motion.div>

        {/* Enforcement mode */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05, ease: EASE }}>
          <Card className="mb-4 p-4">
            <div className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
              When sensitive data is found
            </div>
            <Segmented value={cfg.mode} onChange={(v) => set({ mode: v })} options={MODES} />
            <div className="mt-2.5 text-[11.5px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
              {cfg.mode === 'block_redact' && 'Safest — blocks the send and offers a one-click redact.'}
              {cfg.mode === 'auto_redact' && 'Silently masks the sensitive spans and sends.'}
              {cfg.mode === 'warn' && 'Shows a warning but lets you send anyway.'}
            </div>
          </Card>
        </motion.div>

        {/* Hardening */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1, ease: EASE }}>
          <Card className="mb-4">
            <Row icon={<Lock size={15} />} title="Strict mode (fail-closed)"
              hint="When the engine is unreachable, block the send instead of falling back to local rules.">
              <Toggle checked={!!cfg.strict} onChange={(v) => set({ strict: v })} ariaLabel="Strict mode" />
            </Row>
            <Divider />
            <Row icon={<Clipboard size={15} />} title="Scan pasted text immediately"
              hint="Catch secrets the moment they are pasted, before you hit send.">
              <Toggle checked={cfg.scanOnPaste !== false} onChange={(v) => set({ scanOnPaste: v })} ariaLabel="Scan on paste" />
            </Row>
          </Card>
        </motion.div>

        {/* Engine endpoint */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15, ease: EASE }}>
          <Card className="mb-4 p-4">
            <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
              <Server size={15} style={{ color: 'var(--text-muted)' }} /> Firewall ML engine
            </div>
            <div className="mb-3 text-[11.5px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
              Real PII / secret / injection detection. If unreachable, the extension falls back to built-in local rules.
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => { setUrlDraft(e.target.value); setTest('idle'); }}
                onBlur={saveUrl}
                placeholder="http://localhost:8001/scan"
                spellCheck={false}
                className="flex-1 rounded-lg px-3 py-2 text-[12px] outline-none transition-colors"
                style={{ background: 'var(--bg-main)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'ui-monospace, monospace' }}
              />
              <Button variant="subtle" onClick={testConnection}>
                {test === 'testing' ? <Loader2 size={13} className="animate-spin" /> : 'Test'}
              </Button>
            </div>
            <AnimatePresence>
              {test !== 'idle' && test !== 'testing' && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2.5">
                  {test === 'ok'
                    ? <Chip tone="ok"><CheckCircle2 size={12} /> Reachable</Chip>
                    : <Chip tone="danger"><XCircle size={12} /> Unreachable — local fallback will be used</Chip>}
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </motion.div>

        {/* Protected sites */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2, ease: EASE }}>
          <Card className="mb-4 p-4">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
              <MessageSquare size={15} style={{ color: 'var(--text-muted)' }} /> Protected sites
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {SITES.map((s) => {
                const on = !!cfg.sites[s.key];
                return (
                  <div key={s.key}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors"
                    style={{ background: 'var(--bg-main)', border: '1px solid var(--border)' }}>
                    <div>
                      <div className="text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>{s.name}</div>
                      <div className="text-[10.5px]" style={{ color: 'var(--text-dim)' }}>{s.host}</div>
                    </div>
                    <Toggle checked={on} onChange={(v) => set({ sites: { ...cfg.sites, [s.key]: v } })} ariaLabel={s.name} />
                  </div>
                );
              })}
            </div>
          </Card>
        </motion.div>

        <div className="mt-6 text-center text-[10.5px] tracking-[0.05em]" style={{ color: 'var(--text-dim)' }}>
          TITAN LLM FIREWALL · endpoint DLP
        </div>
      </div>
    </div>
  );
}
