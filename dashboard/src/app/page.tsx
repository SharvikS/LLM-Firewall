"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Activity, Settings, Users, FileText, Search, Bell,
  ChevronRight, Network, Cpu, ShieldAlert, ClipboardList,
  Fingerprint, Eye, Plus, Command,
  PanelLeft, Key, CreditCard,
  AlertCircle, BarChart2, CornerDownLeft,
} from 'lucide-react';

import OverviewTab    from './components/tabs/OverviewTab';
import EventsTab      from './components/tabs/EventsTab';
import AnalyticsTab   from './components/tabs/AnalyticsTab';
import PoliciesTab    from './components/tabs/PoliciesTab';
import AuditLogsTab   from './components/tabs/AuditLogsTab';
import SettingsTab    from './components/tabs/SettingsTab';
import ApiKeysTab     from './components/tabs/ApiKeysTab';
import {
  EdgeRoutingTab, TeamTab, BillingTab, AccessControlTab,
  DataPrivacyTab, SandboxesTab, VulnerabilitiesTab,
} from './components/tabs/RemainingTabs';

// ─── Types ───────────────────────────────────────────────────────────────────

type TabKey =
  | 'Overview' | 'Analytics' | 'Edge Routing'
  | 'Events' | 'Policies' | 'Sandboxes' | 'Vulnerabilities'
  | 'Audit Logs' | 'Access Control' | 'Data Privacy'
  | 'Settings' | 'Team' | 'API Keys' | 'Billing';

interface NavEntry { key: TabKey; label: string; icon: React.ReactNode; keywords?: string }
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
      { key: 'Policies',        label: 'Policy Engine',   icon: <FileText size={15}/>,    keywords: 'cedar abac rules allow deny' },
      { key: 'Sandboxes',       label: 'Sandboxes',       icon: <Cpu size={15}/>,         keywords: 'firecracker microvm isolation' },
      { key: 'Vulnerabilities', label: 'Vulnerabilities', icon: <ShieldAlert size={15}/>, keywords: 'cve threats injection' },
    ],
  },
  {
    section: 'Compliance',
    items: [
      { key: 'Audit Logs',     label: 'Audit Logs',     icon: <ClipboardList size={15}/>, keywords: 'history export csv soc2' },
      { key: 'Access Control', label: 'Access Control', icon: <Fingerprint size={15}/>,   keywords: 'rbac permissions roles' },
      { key: 'Data Privacy',   label: 'Data Privacy',   icon: <Eye size={15}/>,           keywords: 'pii masking gdpr presidio' },
    ],
  },
  {
    section: 'Admin',
    items: [
      { key: 'Settings', label: 'Settings', icon: <Settings size={15}/>,   keywords: 'theme preferences config' },
      { key: 'Team',     label: 'Team',     icon: <Users size={15}/>,      keywords: 'members invite' },
      { key: 'API Keys', label: 'API Keys', icon: <Key size={15}/>,        keywords: 'tokens credentials tenants' },
      { key: 'Billing',  label: 'Billing',  icon: <CreditCard size={15}/>, keywords: 'usage cost invoice' },
    ],
  },
];

const ALL_NAV: NavEntry[] = NAV.flatMap(g => g.items);

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

function CommandPalette({ open, onClose, onNavigate }: {
  open: boolean; onClose: () => void; onNavigate: (t: TabKey) => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset on open
  useEffect(() => { if (open) { setQuery(''); setIndex(0); } }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const navMatches = ALL_NAV
      .filter(e => !q || e.label.toLowerCase().includes(q) || (e.keywords ?? '').includes(q))
      .map(e => ({ kind: 'nav' as const, label: e.label, icon: e.icon, tab: e.key }));
    const actionMatches = PALETTE_ACTIONS
      .filter(a => !q || a.label.toLowerCase().includes(q) || (a.keywords ?? '').includes(q))
      .map(a => ({ kind: 'action' as const, label: a.label, icon: a.icon, tab: a.tab }));
    return [...navMatches, ...actionMatches];
  }, [query]);

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

// ─── Main component ───────────────────────────────────────────────────────────

const RAIL_W = 60;
const FULL_W = 232;

export default function Dashboard() {
  const [activeTab, setActiveTab]   = useState<TabKey>('Overview');
  const [theme, setThemeState]      = useState('theme-dark');
  const [rail, setRail]             = useState(false);
  const [isCmdkOpen, setCmdk]       = useState(false);
  const [gatewayOnline, setGateway] = useState<boolean | null>(null);

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
    switch (activeTab) {
      case 'Overview':       return <OverviewTab/>;
      case 'Analytics':      return <AnalyticsTab/>;
      case 'Edge Routing':   return <EdgeRoutingTab/>;
      case 'Events':         return <EventsTab/>;
      case 'Policies':       return <PoliciesTab/>;
      case 'Sandboxes':      return <SandboxesTab/>;
      case 'Vulnerabilities':return <VulnerabilitiesTab/>;
      case 'Audit Logs':     return <AuditLogsTab/>;
      case 'Access Control': return <AccessControlTab/>;
      case 'Data Privacy':   return <DataPrivacyTab/>;
      case 'Settings':       return <SettingsTab theme={theme} onThemeChange={setTheme}/>;
      case 'Team':           return <TeamTab/>;
      case 'API Keys':       return <ApiKeysTab/>;
      case 'Billing':        return <BillingTab/>;
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

      <CommandPalette open={isCmdkOpen} onClose={() => setCmdk(false)} onNavigate={navigate}/>

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
            <Shield className="w-4 h-4 relative z-10" style={{ color: 'var(--bg-main)' }}/>
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
          {NAV.map(group => (
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
        <div className={`h-12 flex items-center shrink-0 cursor-pointer transition-colors hover:bg-white/[0.03] ${rail ? 'justify-center' : 'px-3 gap-2.5'}`}
          style={{ borderTop: '1px solid var(--border-color)' }}>
          <div className="relative shrink-0 rail-tip" data-tip="Sharvik — Enterprise Admin">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold relative z-10"
              style={{ background: 'linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 50%, var(--bg-card)) 100%)', color: 'var(--bg-main)' }}>
              S
            </div>
            <span className="absolute -bottom-px -right-px w-2 h-2 rounded-full border-2 z-20"
              style={{ background: '#4ade80', borderColor: 'var(--bg-sec)' }}/>
          </div>
          {!rail && (
            <div className="min-w-0">
              <div className="text-[12px] font-semibold leading-tight whitespace-nowrap">Sharvik</div>
              <div className="text-[10px] leading-tight whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Enterprise Admin</div>
            </div>
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
              <span className="hidden sm:inline" style={{ color: 'var(--text-muted)' }}>Acme Corp</span>
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

            <button aria-label="Notifications" className="relative p-1.5 rounded-md transition-colors hover:bg-white/[0.06]"
              style={{ color: 'var(--text-muted)' }}>
              <Bell size={15}/>
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full"
                style={{ boxShadow: '0 0 4px rgba(239,68,68,0.6)' }}/>
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
