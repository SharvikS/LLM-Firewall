// The blocking modal shown when a send/paste trips the DLP policy. Rendered into
// a shadow root by index.jsx so the host page's CSS can't touch it. Pure
// presentational component: it reports the user's choice via onChoose and the
// mount harness handles the promise + teardown.
import { motion } from 'framer-motion';
import { ShieldX, AlertTriangle, WifiOff } from 'lucide-react';

const EASE = [0.16, 1, 0.3, 1];

const CHIP_TONE = {
  PII: { color: 'var(--warn)', bg: 'rgba(251,191,36,0.12)', bd: 'rgba(251,191,36,0.35)' },
  SECRET: { color: 'var(--danger)', bg: 'rgba(248,113,113,0.12)', bd: 'rgba(248,113,113,0.35)' },
  THREAT: { color: '#c79aff', bg: 'rgba(124,31,162,0.18)', bd: 'rgba(124,31,162,0.5)' },
};

function ActionButton({ tone, onClick, children }) {
  const styles = {
    primary: { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' },
    danger: { background: 'var(--danger)', color: '#1a0b0b', border: '1px solid var(--danger)' },
    ghost: { background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)' },
  };
  return (
    <motion.button
      type="button"
      whileHover={{ y: -1, filter: 'brightness(1.08)' }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.12 }}
      onClick={onClick}
      className="rounded-lg px-4 py-2 text-[13px] font-semibold cursor-pointer"
      style={styles[tone]}
    >
      {children}
    </motion.button>
  );
}

export default function Modal({ verdict, mode, onChoose }) {
  const isBlock = verdict.decision === 'block';
  const canRedact = verdict.decision === 'redact' && mode === 'block_redact';
  const degraded = verdict.source === 'local';

  const tags = []
    .concat((verdict.pii || []).map((p) => ['PII', p]))
    .concat((verdict.secrets || []).map((s) => ['SECRET', s]))
    .concat((verdict.categories || [])
      .filter((c) => c === 'injection' || c === 'toxicity' || c === 'code_leak')
      .map((c) => ['THREAT', c]));

  const isAttachment = verdict.kind === 'file' || verdict.kind === 'image';
  const what = verdict.kind === 'image' ? 'image' : 'file';
  const title = isAttachment
    ? `Attachment blocked`
    : (isBlock ? 'Prompt blocked' : 'Sensitive data detected');
  const sub = isAttachment
    ? `Sensitive data was found in ${verdict.filename ? `“${verdict.filename}”` : `this ${what}`} — it was not uploaded.`
    : isBlock
      ? "This prompt was blocked by your organization's LLM firewall policy."
      : 'Sensitive information was found in your message before it was sent.';

  return (
    <div
      className="fixed inset-0 grid place-items-center"
      style={{ background: 'rgba(8,10,14,0.62)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onChoose('cancel'); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.32, ease: EASE }}
        role="dialog"
        aria-modal="true"
        className="glass card-glow w-[440px] max-w-[92vw] rounded-2xl p-6"
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="mb-3 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl"
            style={{
              background: isBlock ? 'rgba(248,113,113,0.14)' : 'rgba(251,191,36,0.14)',
              border: `1px solid ${isBlock ? 'rgba(248,113,113,0.4)' : 'rgba(251,191,36,0.4)'}`,
              color: isBlock ? 'var(--danger)' : 'var(--warn)',
            }}>
            {isBlock ? <ShieldX size={20} /> : <AlertTriangle size={20} />}
          </div>
          <div>
            <h2 className="text-[16px] font-bold" style={{ color: 'var(--text)' }}>{title}</h2>
            <p className="mt-0.5 text-[12px] leading-snug" style={{ color: 'var(--text-muted)' }}>{sub}</p>
          </div>
        </div>

        <div className="mb-3 rounded-lg px-3 py-2 text-[12px] break-words"
          style={{ background: 'var(--bg-main)', border: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}>
          {verdict.reason || 'Policy match'}
        </div>

        {tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {tags.map(([kind, t], i) => {
              const tone = CHIP_TONE[kind];
              return (
                <span key={`${kind}-${t}-${i}`}
                  className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                  style={{ color: tone.color, background: tone.bg, border: `1px solid ${tone.bd}` }}>
                  {kind}: {t}
                </span>
              );
            })}
          </div>
        )}

        {degraded && (
          <div className="mb-3 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>
            <WifiOff size={12} /> Engine offline — checked with local rules.
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {isBlock ? (
            <ActionButton tone="ghost" onClick={() => onChoose('cancel')}>
              {isAttachment ? 'Remove attachment' : 'Edit prompt'}
            </ActionButton>
          ) : mode === 'warn' ? (
            <>
              <ActionButton tone="ghost" onClick={() => onChoose('cancel')}>Cancel</ActionButton>
              <ActionButton tone="danger" onClick={() => onChoose('send')}>Send anyway</ActionButton>
            </>
          ) : (
            <>
              <ActionButton tone="ghost" onClick={() => onChoose('cancel')}>Cancel &amp; edit</ActionButton>
              {canRedact && <ActionButton tone="primary" onClick={() => onChoose('redact')}>Redact &amp; send</ActionButton>}
            </>
          )}
        </div>

        <div className="mt-4 text-right text-[9.5px] tracking-[0.08em]" style={{ color: 'var(--text-dim)' }}>
          TITAN LLM FIREWALL
        </div>
      </motion.div>
    </div>
  );
}
