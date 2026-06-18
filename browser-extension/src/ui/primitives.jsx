// Shared design-system primitives for the popup, options page, and modal.
// Premium dark aesthetic matching the admin portal: glass surfaces, the brand
// blue accent, and Framer Motion micro-interactions on hover/tap.
import { motion } from 'framer-motion';
import TitanLogo from './TitanLogo.jsx';

const EASE = [0.16, 1, 0.3, 1];

// ── Brand lockup ────────────────────────────────────────────────────────────
// Mirrors the admin portal's logo treatment exactly: the TitanLogo mark, dark
// (var(--bg-main)) on an accent-gradient rounded tile with a soft glow, beside
// the "TITAN" wordmark. Keep in sync with dashboard so the logo is identical
// across portal and extension.
export function Logo({ subtitle, size = 'md' }) {
  const tile = size === 'lg' ? 32 : 28;
  const mark = size === 'lg' ? 18 : 16;
  return (
    <div className="flex items-center gap-2.5">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.45, ease: EASE }}
        className="relative grid shrink-0 place-items-center overflow-hidden rounded-lg"
        style={{
          width: tile,
          height: tile,
          background: 'linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 55%, transparent) 100%)',
          boxShadow: '0 0 12px color-mix(in srgb, var(--accent) 25%, transparent)',
        }}
      >
        <TitanLogo style={{ width: mark, height: mark, color: 'var(--bg-main)' }} strokeWidth={1.9} />
      </motion.div>
      <div className="leading-tight">
        <div className={`font-bold tracking-tight ${size === 'lg' ? 'text-[16px]' : 'text-[14px]'}`} style={{ color: 'var(--text)' }}>
          TITAN
        </div>
        {subtitle && (
          <div className="text-[10.5px] font-medium" style={{ color: 'var(--text-dim)' }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Glass card ──────────────────────────────────────────────────────────────
export function Card({ glow = false, className = '', children, style, ...props }) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl glass ${glow ? 'card-glow' : ''} ${className}`}
      style={{ boxShadow: 'var(--shadow-md)', ...style }}
      {...props}
    >
      {children}
    </div>
  );
}

// ── Animated toggle switch ──────────────────────────────────────────────────
export function Toggle({ checked, onChange, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full transition-colors duration-200 outline-none"
      style={{
        background: checked ? 'var(--accent)' : 'var(--bg-elev)',
        border: '1px solid',
        borderColor: checked ? 'var(--accent)' : 'var(--border)',
      }}
    >
      <motion.span
        className="block h-[16px] w-[16px] rounded-full bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }}
        animate={{ x: checked ? 21 : 3 }}
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
      />
    </button>
  );
}

// ── Button ──────────────────────────────────────────────────────────────────
const BTN_VARIANTS = {
  primary: { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' },
  danger: { background: 'var(--danger)', color: '#1a0b0b', border: '1px solid var(--danger)' },
  ghost: { background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)' },
  subtle: { background: 'var(--bg-elev)', color: 'var(--text-muted)', border: '1px solid var(--border)' },
};

export function Button({ variant = 'ghost', className = '', style, children, ...props }) {
  return (
    <motion.button
      type="button"
      whileHover={{ y: -1, filter: 'brightness(1.08)' }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.12 }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold cursor-pointer select-none disabled:opacity-50 disabled:cursor-default ${className}`}
      style={{ ...BTN_VARIANTS[variant], ...style }}
      {...props}
    >
      {children}
    </motion.button>
  );
}

// ── Segmented control (e.g. enforcement mode) ───────────────────────────────
export function Segmented({ value, onChange, options }) {
  return (
    <div
      className="relative flex gap-1 rounded-xl p-1"
      style={{ background: 'var(--bg-main)', border: '1px solid var(--border)' }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="relative flex-1 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold transition-colors duration-150"
            style={{ color: active ? '#fff' : 'var(--text-muted)' }}
          >
            {active && (
              <motion.span
                layoutId="seg-active"
                className="absolute inset-0 rounded-lg"
                style={{ background: 'var(--accent)' }}
                transition={{ type: 'spring', stiffness: 480, damping: 36 }}
              />
            )}
            <span className="relative z-10 flex items-center justify-center gap-1.5">
              {opt.icon}
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Small status chip ───────────────────────────────────────────────────────
export function Chip({ tone = 'muted', children }) {
  const tones = {
    ok: { color: 'var(--ok)', bg: 'rgba(74,222,128,0.12)', bd: 'rgba(74,222,128,0.3)' },
    warn: { color: 'var(--warn)', bg: 'rgba(251,191,36,0.12)', bd: 'rgba(251,191,36,0.3)' },
    danger: { color: 'var(--danger)', bg: 'rgba(248,113,113,0.12)', bd: 'rgba(248,113,113,0.3)' },
    accent: { color: '#9ec2ff', bg: 'var(--accent-soft)', bd: 'rgba(37,99,235,0.4)' },
    muted: { color: 'var(--text-dim)', bg: 'var(--glass)', bd: 'var(--border)' },
  };
  const t = tones[tone] || tones.muted;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
      style={{ color: t.color, background: t.bg, border: `1px solid ${t.bd}` }}
    >
      {children}
    </span>
  );
}

export { EASE };
