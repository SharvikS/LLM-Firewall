"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, Settings, Users, FileText, Search, Bell, Globe,
  ChevronRight, Network, Cpu, ShieldAlert, ClipboardList,
  Fingerprint, Eye, Plus, Command,
  PanelLeft, Key, CreditCard,
  AlertCircle, BarChart2, CornerDownLeft, Flag, Lock,
} from 'lucide-react';

import OverviewTab    from './components/tabs/OverviewTab';
import EventsTab      from './components/tabs/EventsTab';
import FlagsTab       from './components/tabs/FlagsTab';
import BrowserDLPTab  from './components/tabs/BrowserDLPTab';
import AnalyticsTab   from './components/tabs/AnalyticsTab';
import PoliciesTab    from './components/tabs/PoliciesTab';
import AuditLogsTab   from './components/tabs/AuditLogsTab';
import SettingsTab    from './components/tabs/SettingsTab';
import ApiKeysTab     from './components/tabs/ApiKeysTab';
import {
  EdgeRoutingTab, TeamTab, BillingTab, AccessControlTab,
  DataPrivacyTab, SandboxesTab, VulnerabilitiesTab,
} from './components/tabs/RemainingTabs';
import { TitanLogo } from './components/TitanLogo';
import { fetchMe, logout, hasFeature, ROLE_LABEL, type Me, type Feature } from '@/lib/me';
import { LogOut } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type TabKey =
  | 'Overview' | 'Analytics' | 'Edge Routing'
  | 'Events' | 'Browser DLP' | 'Flags' | 'Policies' | 'Sandboxes' | 'Vulnerabilities'
  | 'Audit Logs' | 'Access Control' | 'Data Privacy'
  | 'Settings' | 'Team' | 'API Keys' | 'Billing';

// `feature` marks an entry as a commercial (TITAN Enterprise) surface; it is
// hidden unless the current session's edition entitles that feature. The data
// plane enforces the paywall regardless — this only keeps the UI honest.
interface NavEntry { key: TabKey; label: string; icon: React.ReactNode; keywords?: string; badge?: number; feature?: Feature }
interface NavGroup { section: string; items: NavEntry[] }

// ─── Navigation model (single source for sidebar + command palette) ──────────

const NAV: NavGroup[] = [
  {
    section: 'Platform',
    items: [
      { key: 'Overview',     label: 'Overview',     icon: <Activity size={15}/>,    keywords: 'home dashboard metrics' },
      { key: 'Analytics',    label: 'Analytics',    icon: <BarChart2 size={15}/>,   keywords: 'charts traffic latency clickhouse' },
      { key: 'Edge Routing', label: 'Edge Routing', icon: <Network size={15}/>,     keywords: 'regions failover providers' },
    ],
  },
  {
    section: 'Security',
    items: [
      { key: 'Events',          label: 'Events & Logs',   icon: <AlertCircle size={15}/>, keywords: 'live feed requests' },
      { key: 'Browser DLP',     label: 'Browser DLP',     icon: <Globe size={15}/>,       keywords: 'extension chatgpt claude gemini endpoint monitoring installs paste' },
      { key: 'Flags',           label: 'DLP Flags',       icon: <Flag size={15}/>,        keywords: 'browser dlp repeat offender violations sensitive data leak' },
      { key: 'Policies',        label: 'Policy Engine',   icon: <FileText size={15}/>,    keywords: 'cedar abac rules allow deny' },
      { key: 'Sandboxes',       label: 'Sandboxes',       icon: <Cpu size={15}/>,         keywords: 'firecracker microvm isolation' },
      { key: 'Vulnerabilities', label: 'Vulnerabilities', icon: <ShieldAlert size={15}/>, keywords: 'cve threats injection' },
    ],
  },
  {
    section: 'Compliance',
    items: [
      { key: 'Audit Logs',     label: 'Audit Logs',     icon: <ClipboardList size={15}/>, keywords: 'history export csv soc2' },
      { key: 'Access Control', label: 'Access Control', icon: <Fingerprint size={15}/>,   keywords: 'rbac permissions roles sso', feature: 'sso' },
      { key: 'Data Privacy',   label: 'Data Privacy',   icon: <Eye size={15}/>,           keywords: 'pii masking gdpr presidio' },
    ],
  },
  {
    section: 'Admin',
    items: [
      { key: 'Settings', label: 'Settings', icon: <Settings size={15}/>,   keywords: 'theme preferences config' },
      { key: 'Team',     label: 'Team',     icon: <Users size={15}/>,      keywords: 'members invite sso', feature: 'sso' },
      { key: 'API Keys', label: 'API Keys', icon: <Key size={15}/>,        keywords: 'tokens credentials tenants' },
      { key: 'Billing',  label: 'Billing',  icon: <CreditCard size={15}/>, keywords: 'usage cost invoice', feature: 'billing' },
    ],
  },
];

// ─── Page transition variants ────────────────────────────────────────────────

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -4 },
};

// ─── Sidebar pieces ──────────────────────────────────────────────────────────

function NavItem({ entry, active, rail, onClick }: {
  entry: NavEntry; active: boolean; rail: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} data-tip={entry.label}
      className={`relative w-full flex items-center rounded-lg cursor-pointer transition-colors duration-150 group select-none ${
        rail ? 'rail-tip justify-center h-9' : 'gap-2.5 px-3 py-[7px]'
      } ${active ? 'text-base-text font-medium' : 'text-base-muted hover:text-base-text hover:bg-white/[0.03]'}`}
    >
      {active && (
        <motion.span
          layoutId="sidebarActive"
          className="absolute inset-0 rounded-lg"
          style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 14%, var(--border-color))' }}
          transition={{ type: 'spring', stiffness: 420, damping: 38 }}
        />
      )}
      {active && !rail && (
        <motion.span
          layoutId="sidebarBar"
          className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full"
          style={{ background: 'var(--accent)' }}
          transition={{ type: 'spring', stiffness: 420, damping: 38 }}
        />
      )}
      <span className={`relative z-10 transition-opacity duration-150 ${active ? '' : 'opacity-45 group-hover:opacity-75'}`}>
        {entry.icon}
      </span>
      {!rail && <span className="text-[13px] relative z-10 flex-1 text-left leading-none truncate">{entry.label}</span>}
      {entry.badge ? (
        <span className={`relative z-10 inline-flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full ${
          rail ? 'absolute top-0.5 right-0.5 min-w-[15px] h-[15px] px-1' : 'min-w-[18px] h-[18px] px-1.5'
        }`}>{entry.badge > 99 ? '99+' : entry.badge}</span>
      ) : null}
    </button>
  );
}

// ─── Command palette ─────────────────────────────────────────────────────────

interface PaletteAction { label: string; icon: React.ReactNode; tab: TabKey; hint?: string; keywords?: string }

const PALETTE_ACTIONS: PaletteAction[] = [
  { label: 'Create New Policy',     icon: <Plus size={13}/>, tab: 'Policies', hint: 'Action', keywords: 'add cedar rule' },
  { label: 'Generate API Key',      icon: <Key size={13}/>,  tab: 'API Keys', hint: 'Action', keywords: 'new token credential' },
  { label: 'View Active Sandboxes', icon: <Cpu size={13}/>,  tab: 'Sandboxes', hint: 'Action', keywords: 'firecracker vm' },
];

function CommandPalette({ open, onClose, onNavigate, entries }: {
  open: boolean; onClose: () => void; onNavigate: (t: TabKey) => void; entries: NavEntry[];
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset on open
  useEffect(() => { if (open) { setQuery(''); setIndex(0); } }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const navMatches = entries
      .filter(e => !q || e.label.toLowerCase().includes(q) || (e.keywords ?? '').includes(q))
      .map(e => ({ kind: 'nav' as const, label: e.label, icon: e.icon, tab: e.key }));
    const actionMatches = PALETTE_ACTIONS
      .filter(a => !q || a.label.toLowerCase().includes(q) || (a.keywords ?? '').includes(q))
      .map(a => ({ kind: 'action' as const, label: a.label, icon: a.icon, tab: a.tab }));
    return [...navMatches, ...actionMatches];
  }, [query, entries]);

  // Clamp selection when results shrink
  useEffect(() => { setIndex(i => Math.min(i, Math.max(0, results.length - 1))); }, [results.length]);

  // Keep the active row in view
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[index]) { e.preventDefault(); onNavigate(results[index].tab); }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: -12, x: '-50%' }}
            animate={{ opacity: 1, scale: 1,    y: 0,   x: '-50%' }}
            exit={{   opacity: 0, scale: 0.98, y: -12, x: '-50%' }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="fixed top-[14%] left-1/2 z-50 w-[min(580px,92vw)] rounded-2xl overflow-hidden flex flex-col"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              boxShadow: '0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
            }}
          >
            <div className="flex items-center px-4 py-3 gap-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <Search size={14} className="text-base-muted shrink-0"/>
              <input autoFocus type="text" placeholder="Jump to a page or action…"
                value={query}
                onChange={e => { setQuery(e.target.value); setIndex(0); }}
                onKeyDown={onKeyDown}
                className="bg-transparent flex-1 text-sm outline-none placeholder:text-base-muted/50"
                style={{ color: 'var(--text-main)' }}
              />
              <kbd className="text-[10px] px-1.5 py-0.5 rounded-md font-mono shrink-0"
                style={{ background: 'var(--bg-sec)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                ESC
              </kbd>
            </div>

            <div ref={listRef} className="p-1.5 max-h-[320px] overflow-y-auto scrollbar-thin">
              {results.length === 0 && (
                <div className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  No results for “{query}”
                </div>
              )}
              {results.map((r, i) => (
                <div key={`${r.kind}-${r.label}`} data-idx={i}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => onNavigate(r.tab)}
                  className="flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors"
                  style={i === index ? { background: 'var(--bg-sec)' } : undefined}
                >
                  <div className="flex items-center gap-3"
                    style={{ color: i === index ? 'var(--text-main)' : 'var(--text-muted)' }}>
                    {r.icon}
                    <span>{r.label}</span>
                    {r.kind === 'action' && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--text-muted)' }}>
                        Action
                      </span>
                    )}
                  </div>
                  {i === index && <CornerDownLeft size={12} style={{ color: 'var(--text-muted)' }}/>}
                </div>
              ))}
            </div>

            <div className="px-4 py-2 flex items-center gap-4 text-[10px]"
              style={{ borderTop: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              <span className="flex items-center gap-1"><kbd>↑↓</kbd> navigate</span>
              <span className="flex items-center gap-1"><kbd>↵</kbd> open</span>
              <span className="flex items-center gap-1"><kbd>esc</kbd> close</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Enterprise upsell (shown if a gated tab is reached without entitlement) ──

function EnterpriseUpsell({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="max-w-md text-center rounded-2xl border p-8"
        style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card, rgba(255,255,255,0.02))' }}>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl"
          style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}>
          <Lock size={22}/>
        </div>
        <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-main)' }}>
          {label} is a TITAN Enterprise feature
        </h2>
        <p className="text-[13px] mb-5" style={{ color: 'var(--text-muted)' }}>
          This surface is part of the commercial edition. You&apos;re running TITAN
          Community (open-core). Upgrade to unlock multi-tenant governance, SSO/RBAC,
          usage metering &amp; quotas, SOC alerting, and hallucination detection.
        </p>
        <a href="https://titan.sharvik.tech/pricing" target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium text-white"
          style={{ background: 'var(--accent)' }}>
          View Enterprise plans
        </a>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const RAIL_W = 60;
const FULL_W = 232;

export default function Dashboard() {
  const [activeTab, setActiveTab]   = useState<TabKey>('Overview');
  const [theme, setThemeState]      = useState('theme-dark');
  const [rail, setRail]             = useState(false);
  const [isCmdkOpen, setCmdk]       = useState(false);
  const [gatewayOnline, setGateway] = useState<boolean | null>(null);
  const [me, setMe]                 = useState<Me | null>(null);
  const [openFlags, setOpenFlags]   = useState(0);

  // Restore persisted UI state (theme class itself is applied pre-paint by
  // the boot script in layout.tsx — here we only sync React state).
  useEffect(() => {
    const t = localStorage.getItem('titan-theme');
    if (t) setThemeState(t);
    setRail(localStorage.getItem('titan-sidebar') === 'rail');
  }, []);

  const setTheme = useCallback((t: string) => {
    setThemeState(prev => {
      document.documentElement.classList.remove(prev);
      document.documentElement.classList.add(t);
      localStorage.setItem('titan-theme', t);
      return t;
    });
  }, []);

  const toggleRail = useCallback(() => {
    setRail(v => {
      localStorage.setItem('titan-sidebar', v ? 'open' : 'rail');
      return !v;
    });
  }, []);

  // Gateway health probe
  useEffect(() => {
    const check = () =>
      fetch('/api/gateway/metrics').then(r => setGateway(r.ok)).catch(() => setGateway(false));
    check();
    const id = setInterval(check, 10_000);
    return () => clearInterval(id);
  }, []);

  // Open DLP-flag count → live nav badge so the admin sees repeat offenders
  // the moment they cross the threshold, without opening the Flags tab.
  useEffect(() => {
    const poll = () =>
      fetch('/api/admin/dlp/summary')
        .then(r => r.json()).then(d => setOpenFlags(d?.open_flags ?? 0)).catch(() => {});
    poll();
    const id = setInterval(poll, 10_000);
    return () => clearInterval(id);
  }, []);

  // Breadcrumb context: the nav section the active tab belongs to (real,
  // derived) rather than a hardcoded org name (the session carries no org).
  const activeSection = useMemo(
    () => NAV.find(g => g.items.some(it => it.key === activeTab))?.section ?? 'Platform',
    [activeTab],
  );

  // NAV with the live open-flag badge injected onto the Flags entry, and
  // commercial entries dropped unless the session's edition entitles them.
  // Empty groups are removed so the sidebar shows no orphan section headers.
  const navWithBadges = useMemo<NavGroup[]>(() =>
    NAV.map(g => ({
      ...g,
      items: g.items
        .filter(it => !it.feature || hasFeature(me, it.feature))
        .map(it => it.key === 'Flags' ? { ...it, badge: openFlags } : it),
    })).filter(g => g.items.length > 0), [openFlags, me]);

  // Flattened, entitlement-filtered entries for the command palette.
  const navEntries = useMemo<NavEntry[]>(
    () => navWithBadges.flatMap(g => g.items), [navWithBadges]);

  // Current session identity (the proxy guarantees we're authenticated here).
  useEffect(() => { fetchMe().then(setMe); }, []);

  const doLogout = useCallback(async () => {
    await logout();
    window.location.href = '/login';
  }, []);

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'k') { e.preventDefault(); setCmdk(v => !v); }
      if (mod && e.key === 'b') { e.preventDefault(); toggleRail(); }
      if (e.key === 'Escape')    setCmdk(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRail]);

  const navigate = useCallback((tab: TabKey) => {
    setActiveTab(tab);
    setCmdk(false);
  }, []);

  const renderTab = () => {
    // Defensive: gated tabs are hidden from the nav, but if a session lands on
    // one without entitlement (e.g. an edition downgrade) show an upsell instead.
    const gated = NAV.flatMap(g => g.items).find(it => it.key === activeTab)?.feature;
    if (gated && !hasFeature(me, gated)) return <EnterpriseUpsell label={activeTab}/>;
    switch (activeTab) {
      case 'Overview':       return <OverviewTab/>;
      case 'Analytics':      return <AnalyticsTab/>;
      case 'Edge Routing':   return <EdgeRoutingTab/>;
      case 'Events':         return <EventsTab/>;
      case 'Browser DLP':    return <BrowserDLPTab/>;
      case 'Flags':          return <FlagsTab/>;
      case 'Policies':       return <PoliciesTab/>;
      case 'Sandboxes':      return <SandboxesTab/>;
      case 'Vulnerabilities':return <VulnerabilitiesTab/>;
      case 'Audit Logs':     return <AuditLogsTab/>;
      case 'Access Control': return <AccessControlTab/>;
      case 'Data Privacy':   return <DataPrivacyTab/>;
      case 'Settings':       return <SettingsTab theme={theme} onThemeChange={setTheme}/>;
      case 'Team':           return <TeamTab myRole={me?.role}/>;
      case 'API Keys':       return <ApiKeysTab/>;
      case 'Billing':        return <BillingTab myRole={me?.role}/>;
    }
  };

  const statusColor = gatewayOnline === null ? 'var(--text-muted)' : gatewayOnline ? '#4ade80' : '#f87171';
  const statusLabel = gatewayOnline === null ? '…' : gatewayOnline ? 'ONLINE' : 'OFFLINE';

  return (
    <div className="flex h-screen w-full overflow-hidden antialiased font-sans"
      style={{ background: 'var(--bg-main)', color: 'var(--text-main)' }}
    >
      {/* ── Ambient glow ──────────────────────────────────────────────── */}
      <div className="pointer-events-none fixed top-0 left-1/3 w-[50%] h-[40%] rounded-full opacity-[0.022] blur-[140px]"
        style={{ background: 'var(--accent)' }}/>
      <div className="pointer-events-none fixed bottom-0 right-0 w-[30%] h-[30%] rounded-full opacity-[0.012] blur-[120px]"
        style={{ background: 'var(--accent)' }}/>

      <CommandPalette open={isCmdkOpen} onClose={() => setCmdk(false)} onNavigate={navigate} entries={navEntries}/>

      {/* ── Sidebar (full ↔ icon rail, never fully hidden) ───────────── */}
      <motion.aside initial={false}
        animate={{ width: rail ? RAIL_W : FULL_W }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        className="shrink-0 flex flex-col relative z-20 overflow-hidden"
        style={{ borderRight: '1px solid var(--border-color)', background: 'var(--bg-sec)' }}
      >
        {/* Logo row */}
        <div className={`h-12 flex items-center shrink-0 ${rail ? 'justify-center' : 'px-3.5 gap-2.5'}`}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 55%, transparent) 100%)', boxShadow: '0 0 12px color-mix(in srgb, var(--accent) 25%, transparent)' }}>
            <TitanLogo className="w-4 h-4 relative z-10" style={{ color: 'var(--bg-main)' }}/>
          </div>
          {!rail && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-bold tracking-tight">TITAN</span>
              <span className="flex items-center gap-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                style={{
                  background: `color-mix(in srgb, ${statusColor} 10%, transparent)`,
                  color: statusColor,
                  border: `1px solid color-mix(in srgb, ${statusColor} 25%, transparent)`,
                }}>
                <span className="live-dot w-1.5 h-1.5 rounded-full shrink-0" style={{ color: statusColor, background: statusColor }}/>
                {statusLabel}
              </span>
            </div>
          )}
        </div>

        {/* Nav */}
        <div className={`flex-1 py-3 flex flex-col overflow-y-auto overflow-x-hidden scrollbar-hide ${rail ? 'px-2 gap-4' : 'px-2 gap-4'}`}>
          {navWithBadges.map(group => (
            <div key={group.section}>
              {!rail ? (
                <div className="px-3 mb-1">
                  <span className="text-[9px] font-bold text-base-muted/50 uppercase tracking-[0.12em] whitespace-nowrap">{group.section}</span>
                </div>
              ) : (
                <div className="mx-2 mb-2 h-px" style={{ background: 'var(--border-color)' }}/>
              )}
              <nav className="space-y-0.5">
                {group.items.map(entry => (
                  <NavItem key={entry.key} entry={entry} rail={rail}
                    active={activeTab === entry.key}
                    onClick={() => setActiveTab(entry.key)}/>
                ))}
              </nav>
            </div>
          ))}
        </div>

        {/* User footer */}
        <div className={`h-12 flex items-center shrink-0 transition-colors ${rail ? 'justify-center' : 'px-3 gap-2.5'}`}
          style={{ borderTop: '1px solid var(--border-color)' }}>
          <div className="relative shrink-0 rail-tip" data-tip={`${me?.email ?? '…'} — ${me?.role ? ROLE_LABEL[me.role] : ''}`}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold relative z-10 uppercase"
              style={{ background: 'linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 50%, var(--bg-card)) 100%)', color: 'var(--bg-main)' }}>
              {(me?.email?.[0] ?? '?')}
            </div>
            {/* Presence dot reflects real gateway health, not a hardcoded green. */}
            <span className="absolute -bottom-px -right-px w-2 h-2 rounded-full border-2 z-20"
              style={{ background: statusColor, borderColor: 'var(--bg-sec)' }}/>
          </div>
          {!rail && (
            <>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold leading-tight truncate">{me?.email ?? '…'}</div>
                <div className="text-[10px] leading-tight whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{me?.role ? ROLE_LABEL[me.role] : ''}</div>
              </div>
              <button onClick={doLogout} aria-label="Sign out" data-tip="Sign out"
                className="p-1.5 rounded-md transition-colors hover:bg-white/[0.06]" style={{ color: 'var(--text-muted)' }}>
                <LogOut size={14}/>
              </button>
            </>
          )}
        </div>
      </motion.aside>

      {/* ── Main area ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header className="h-12 flex items-center justify-between pl-3 pr-4 shrink-0 sticky top-0 z-10 backdrop-blur-xl"
          style={{
            borderBottom: '1px solid var(--border-color)',
            background: 'color-mix(in srgb, var(--bg-main) 75%, transparent)',
          }}>
          <div className="flex items-center gap-2">
            <button onClick={toggleRail} aria-label="Toggle sidebar"
              className="p-1.5 rounded-md transition-colors hover:bg-white/[0.06]"
              style={{ color: 'var(--text-muted)' }}>
              <PanelLeft size={15}/>
            </button>
            <div className="flex items-center gap-2 text-[13px]">
              <span className="hidden sm:inline" style={{ color: 'var(--text-muted)' }}>{activeSection}</span>
              <ChevronRight size={12} className="hidden sm:inline" style={{ color: 'var(--text-muted)', opacity: 0.4 }}/>
              <span className="font-semibold">{activeTab}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button onClick={() => setCmdk(true)}
              className="flex items-center justify-between w-44 md:w-52 px-3 py-1.5 rounded-lg text-xs transition-all hover:border-base-muted/40"
              style={{
                background: 'var(--bg-sec)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-muted)',
              }}>
              <span className="flex items-center gap-2">
                <Search size={11}/>
                <span>Search…</span>
              </span>
              <span className="flex items-center gap-0.5 font-mono text-[10px]">
                <Command size={10}/><span>K</span>
              </span>
            </button>

            <div className="w-px h-4 mx-1" style={{ background: 'var(--border-color)' }}/>

            <button aria-label="Notifications" onClick={() => setActiveTab('Flags')}
              data-tip={openFlags > 0 ? `${openFlags} open DLP flag${openFlags === 1 ? '' : 's'}` : 'No open flags'}
              className="relative p-1.5 rounded-md transition-colors hover:bg-white/[0.06]"
              style={{ color: 'var(--text-muted)' }}>
              <Bell size={15}/>
              {/* Only show the unread dot when there are actually open flags. */}
              {openFlags > 0 && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full"
                  style={{ boxShadow: '0 0 4px rgba(239,68,68,0.6)' }}/>
              )}
            </button>
          </div>
        </header>

        {/* Tab content */}
        <main className="flex-1 overflow-y-auto px-4 py-5 md:px-6 scrollbar-thin">
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} variants={pageVariants}
              initial="initial" animate="animate" exit="exit"
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="h-full">
              {renderTab()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
