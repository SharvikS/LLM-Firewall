import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings, Trash2, BadgeCheck,
  AlertTriangle, HelpCircle, Wifi, WifiOff,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useConfig, useStats, useEngineStatus, useActiveSite } from '../lib/hooks.js';
import { Logo, Card, Toggle, Chip, EASE } from '../ui/primitives.jsx';

const REL = (ms) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
};

const ACTION = {
  blocked: { dot: 'var(--danger)', label: 'blocked' },
  cancelled: { dot: 'var(--danger)', label: 'cancelled' },
  redacted: { dot: 'var(--warn)', label: 'redacted' },
  auto_redacted: { dot: 'var(--warn)', label: 'auto-redacted' },
  sent_anyway: { dot: 'var(--text-dim)', label: 'sent anyway' },
};

const SITE_BANNER = {
  GENUINE: { tone: 'ok', icon: <BadgeCheck size={13} />, text: 'Genuine AI platform' },
  GENERIC_WRAPPER: { tone: 'danger', icon: <AlertTriangle size={13} />, text: 'Generic / wrapper AI site' },
  UNKNOWN_AI: { tone: 'warn', icon: <HelpCircle size={13} />, text: 'Unknown AI site' },
};

function StatTile({ value, label, color }) {
  return (
    <Card className="flex-1 px-2 py-2.5 text-center">
      <div className="text-[20px] font-bold leading-none tnum" style={{ color }}>{value}</div>
      <div className="mt-1 text-[8.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-dim)' }}>
        {label}
      </div>
    </Card>
  );
}

export default function Popup() {
  const [cfg, update, loaded] = useConfig();
  const [stats, clear] = useStats();
  const engine = useEngineStatus();
  const site = useActiveSite();

  const enabled = cfg ? cfg.enabled : true;
  const banner = site && SITE_BANNER[site.classification];

  const openOptions = () => {
    if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
    else window.open(api.runtime.getURL('src/options/index.html'));
  };

  return (
    <div className="relative w-[300px] overflow-hidden p-3.5" style={{ background: 'var(--bg-main)' }}>
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-[0.05]" />

      <header className="mb-3 flex items-center justify-between">
        <Logo subtitle="Browser DLP" />
        <button
          onClick={openOptions}
          aria-label="Settings"
          className="grid h-7 w-7 place-items-center rounded-lg transition-colors"
          style={{ color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'var(--bg-card)' }}
        >
          <Settings size={14} />
        </button>
      </header>

      {/* Active-site banner */}
      <AnimatePresence>
        {banner && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 12 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <Card className="flex items-center gap-2 px-3 py-2">
              <Chip tone={banner.tone}>{banner.icon}{banner.text}</Chip>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Master toggle */}
      <Card glow className="mb-3 flex items-center justify-between px-3.5 py-3">
        <div>
          <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Protection</div>
          <div className="text-[10.5px]" style={{ color: enabled ? 'var(--ok)' : 'var(--danger)' }}>
            {loaded ? (enabled ? 'Active — scanning prompts' : 'Paused') : '…'}
          </div>
        </div>
        <Toggle checked={enabled} onChange={(v) => update({ enabled: v })} ariaLabel="Toggle protection" />
      </Card>

      {/* Stats */}
      <div className="mb-3 flex gap-2">
        <StatTile value={stats.blocked} label="Blocked" color="var(--danger)" />
        <StatTile value={stats.redacted} label="Redacted" color="var(--warn)" />
        <StatTile value={stats.overridden} label="Override" color="var(--text-muted)" />
      </div>

      {/* Recent activity */}
      <Card className="mb-3 px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-dim)' }}>
            Recent activity
          </span>
          {stats.recent.length > 0 && (
            <button
              onClick={clear}
              className="inline-flex items-center gap-1 text-[10px] font-medium transition-colors"
              style={{ color: 'var(--text-dim)' }}
            >
              <Trash2 size={10} /> Clear
            </button>
          )}
        </div>
        <div className="scrollbar-thin max-h-[150px] overflow-y-auto">
          {stats.recent.length === 0 ? (
            <div className="py-3 text-center text-[11px]" style={{ color: 'var(--text-dim)' }}>
              No events yet — protection is watching.
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {stats.recent.slice(0, 6).map((e, i) => {
                const meta = ACTION[e.action] || ACTION.blocked;
                return (
                  <motion.div
                    key={`${e.at}-${i}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, ease: EASE }}
                    className="flex items-center gap-2 py-1.5"
                    style={{ borderTop: i ? '1px solid var(--border-soft)' : 'none' }}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.dot }} />
                    <span className="text-[11.5px] font-semibold capitalize" style={{ color: 'var(--text)' }}>
                      {e.site || '?'}
                    </span>
                    <span className="flex-1 truncate text-[11px]" style={{ color: 'var(--text-dim)' }} title={e.reason || meta.label}>
                      {meta.label} · {REL(e.at)}
                    </span>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>
      </Card>

      {/* Engine status */}
      <div className="flex items-center justify-center gap-1.5 text-[10.5px]" style={{ color: 'var(--text-dim)' }}>
        {engine === 'online' ? (
          <><span className="live-dot h-1.5 w-1.5 rounded-full" style={{ color: 'var(--ok)', background: 'var(--ok)' }} /> Engine connected</>
        ) : engine === 'offline' ? (
          <><WifiOff size={11} /> Engine offline — local rules active</>
        ) : (
          <><Wifi size={11} /> Checking engine…</>
        )}
      </div>
    </div>
  );
}
