"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Activity, Settings, Users, FileText, Search, Bell,
  ChevronRight, Network, Cpu, ShieldAlert, ClipboardList,
  Fingerprint, Eye, Sliders, Plus, Command,
  PanelLeft, X, Zap, Key, CreditCard,
  AlertCircle, BarChart2,
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

// ─── Page transition variants ────────────────────────────────────────────────

const pageVariants = {
  initial:    { opacity: 0, y: 10, filter: 'blur(2px)' },
  animate:    { opacity: 1, y: 0,  filter: 'blur(0px)' },
  exit:       { opacity: 0, y: -6, filter: 'blur(2px)' },
  transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 mb-1">
        <span className="text-[9px] font-bold text-base-muted/50 uppercase tracking-[0.12em]">{title}</span>
      </div>
      <nav className="space-y-0.5">{children}</nav>
    </div>
  );
}

function NavItem({ icon, label, active, onClick, badge }: {
  icon: React.ReactNode; label: string; active: boolean;
  onClick: () => void; badge?: number;
}) {
  return (
    <div onClick={onClick}
      className={`relative flex items-center gap-2.5 px-3 py-[7px] rounded-lg cursor-pointer transition-all duration-150 group select-none ${
        active
          ? 'text-base-text font-medium'
          : 'text-base-muted hover:text-base-text hover:bg-white/[0.03]'
      }`}
    >
      {active && (
        <motion.div
          layoutId="sidebarActive"
          className="absolute inset-0 rounded-lg"
          style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 14%, var(--border-color))' }}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
        />
      )}
      {/* Left accent bar for active */}
      {active && (
        <motion.div
          layoutId="sidebarBar"
          className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full"
          style={{ background: 'var(--accent)' }}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
        />
      )}
      <div className={`relative z-10 transition-all duration-150 ${active ? '' : 'opacity-40 group-hover:opacity-70'}`}>
        {icon}
      </div>
      <span className="text-[13px] relative z-10 flex-1 leading-none">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="text-[10px] bg-red-500 text-white rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 font-bold z-10 leading-none">
          {badge}
        </span>
      )}
    </div>
  );
}

function CmdkItem({ icon, label, shortcut, onClick }: {
  icon: React.ReactNode; label: string; shortcut: string; onClick?: () => void;
}) {
  return (
    <div onClick={onClick}
      className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-base-sec cursor-pointer text-sm group transition-colors"
    >
      <div className="flex items-center gap-3 text-base-muted group-hover:text-base-text transition-colors">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex gap-1 text-[10px] font-mono text-base-muted">
        {shortcut.split(' ').map(s => (
          <span key={s} className="bg-base-main border border-base-border px-1.5 py-0.5 rounded-md shadow-sm">{s}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [mounted, setMounted]         = useState(false);
  const [activeTab, setActiveTab]     = useState<TabKey>('Overview');
  const [theme, setTheme]             = useState('theme-dark');
  const [isSidebarOpen, setSidebar]   = useState(true);
  const [isCmdkOpen, setCmdk]         = useState(false);
  const [gatewayOnline, setGateway]   = useState<boolean | null>(null);

  // Gateway health probe
  useEffect(() => {
    const check = () =>
      fetch('/api/gateway/metrics').then(r => setGateway(r.ok)).catch(() => setGateway(false));
    check();
    const id = setInterval(check, 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'k') { e.preventDefault(); setCmdk(v => !v); }
      if (e.metaKey && e.key === 'b') { e.preventDefault(); setSidebar(v => !v); }
      if (e.key === 'Escape')          setCmdk(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navigate = useCallback((tab: TabKey) => {
    setActiveTab(tab);
    setCmdk(false);
  }, []);

  if (!mounted) return null;

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
    <div className={`flex h-screen w-full overflow-hidden antialiased font-sans transition-colors duration-500 ${theme}`}
      style={{ background: 'var(--bg-main)', color: 'var(--text-main)' }}
    >
      {/* ── Ambient glow ──────────────────────────────────────────────── */}
      {theme !== 'theme-light' && (
        <>
          <div className="pointer-events-none fixed top-0 left-1/3 w-[50%] h-[40%] rounded-full opacity-[0.022] blur-[140px]"
            style={{ background: 'var(--accent)' }}/>
          <div className="pointer-events-none fixed bottom-0 right-0 w-[30%] h-[30%] rounded-full opacity-[0.012] blur-[120px]"
            style={{ background: 'var(--accent)' }}/>
        </>
      )}

      {/* ── Command Palette ─────────────────────────────────────────── */}
      <AnimatePresence>
        {isCmdkOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => setCmdk(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: -16, x: '-50%' }}
              animate={{ opacity: 1, scale: 1,    y: 0,   x: '-50%' }}
              exit={{   opacity: 0, scale: 0.97, y: -16, x: '-50%' }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="fixed top-[16%] left-1/2 z-50 w-[560px] rounded-2xl overflow-hidden flex flex-col"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                boxShadow: '0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
              }}
            >
              {/* Search input */}
              <div className="flex items-center px-4 py-3.5 gap-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
                <Search size={14} className="text-base-muted shrink-0"/>
                <input autoFocus type="text" placeholder="Jump to a page, policy, or action…"
                  className="bg-transparent flex-1 text-sm outline-none placeholder:text-base-muted/50"
                  style={{ color: 'var(--text-main)' }}
                />
                <span className="text-[10px] px-1.5 py-0.5 rounded-md ml-1 font-mono shrink-0"
                  style={{ background: 'var(--bg-sec)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  ESC
                </span>
              </div>
              {/* Results */}
              <div className="p-2 max-h-[340px] overflow-y-auto scrollbar-hide">
                <div className="px-3 py-2 text-[9px] font-bold uppercase tracking-[0.1em] text-base-muted/60">Navigate</div>
                {([
                  ['Overview',   <Activity size={13}/>,     '⌘ O'],
                  ['Analytics',  <BarChart2 size={13}/>,    '⌘ A'],
                  ['Events',     <AlertCircle size={13}/>,  '⌘ E'],
                  ['Policies',   <FileText size={13}/>,     '⌘ P'],
                  ['Audit Logs', <ClipboardList size={13}/>,'⌘ L'],
                  ['Settings',   <Settings size={13}/>,     '⌘ ,'],
                ] as [TabKey, React.ReactNode, string][]).map(([tab, icon, shortcut]) => (
                  <CmdkItem key={tab} icon={icon} label={tab} shortcut={shortcut} onClick={() => navigate(tab)}/>
                ))}
                <div className="px-3 py-2 text-[9px] font-bold uppercase tracking-[0.1em] text-base-muted/60 mt-1">Actions</div>
                <CmdkItem icon={<Plus size={13}/>} label="Create New Policy"     shortcut="C P" onClick={() => navigate('Policies')}/>
                <CmdkItem icon={<Key size={13}/>}  label="Generate API Key"      shortcut="G K" onClick={() => navigate('API Keys')}/>
                <CmdkItem icon={<Cpu size={13}/>}  label="View Active Sandboxes" shortcut="V S" onClick={() => navigate('Sandboxes')}/>
              </div>
              <div className="px-4 py-2 border-t border-base-border flex items-center gap-3 text-[10px] text-base-muted/50">
                <span>↵ to select</span>
                <span>↑↓ to navigate</span>
                <span>ESC to close</span>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <motion.div layout initial={false}
        animate={{ width: isSidebarOpen ? 248 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
        className="shrink-0 flex flex-col relative z-20 overflow-hidden"
        style={{ borderRight: '1px solid var(--border-color)', background: 'var(--bg-sec)' }}
      >
        <div style={{ width: 248 }}>
          {/* Logo row */}
          <div className="h-14 px-4 flex items-center shrink-0 gap-3">
            {/* Gradient shield icon */}
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 relative overflow-hidden"
              style={{ background: 'linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 55%, transparent) 100%)', boxShadow: '0 0 12px color-mix(in srgb, var(--accent) 25%, transparent)' }}>
              <Shield className="w-4 h-4 relative z-10" style={{ color: 'var(--bg-main)' }}/>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-bold tracking-tight">TITAN</span>
              {/* Status badge */}
              <span className="flex items-center gap-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{
                  background: `color-mix(in srgb, ${statusColor} 10%, transparent)`,
                  color: statusColor,
                  border: `1px solid color-mix(in srgb, ${statusColor} 25%, transparent)`,
                }}>
                <span className="live-dot w-1.5 h-1.5 rounded-full shrink-0" style={{ color: statusColor, background: statusColor }}/>
                {statusLabel}
              </span>
            </div>
          </div>

          {/* Nav */}
          <div className="py-4 flex flex-col gap-5 overflow-y-auto scrollbar-hide px-2"
            style={{ maxHeight: 'calc(100vh - 112px)' }}>
            <NavSection title="Platform">
              <NavItem active={activeTab === 'Overview'}     onClick={() => setActiveTab('Overview')}     icon={<Activity size={14}/>}    label="Overview"/>
              <NavItem active={activeTab === 'Analytics'}    onClick={() => setActiveTab('Analytics')}    icon={<BarChart2 size={14}/>}   label="Analytics"/>
              <NavItem active={activeTab === 'Edge Routing'} onClick={() => setActiveTab('Edge Routing')} icon={<Network size={14}/>}     label="Edge Routing"/>
            </NavSection>

            <NavSection title="Security Operations">
              <NavItem active={activeTab === 'Events'}          onClick={() => setActiveTab('Events')}          icon={<AlertCircle size={14}/>}  label="Events & Logs"/>
              <NavItem active={activeTab === 'Policies'}        onClick={() => setActiveTab('Policies')}        icon={<FileText size={14}/>}     label="Policy Engine"/>
              <NavItem active={activeTab === 'Sandboxes'}       onClick={() => setActiveTab('Sandboxes')}       icon={<Cpu size={14}/>}          label="Sandboxes"/>
              <NavItem active={activeTab === 'Vulnerabilities'} onClick={() => setActiveTab('Vulnerabilities')} icon={<ShieldAlert size={14}/>}  label="Vulnerabilities"/>
            </NavSection>

            <NavSection title="Compliance">
              <NavItem active={activeTab === 'Audit Logs'}     onClick={() => setActiveTab('Audit Logs')}     icon={<ClipboardList size={14}/>} label="Audit Logs"/>
              <NavItem active={activeTab === 'Access Control'} onClick={() => setActiveTab('Access Control')} icon={<Fingerprint size={14}/>}   label="Access Control"/>
              <NavItem active={activeTab === 'Data Privacy'}   onClick={() => setActiveTab('Data Privacy')}   icon={<Eye size={14}/>}           label="Data Privacy"/>
            </NavSection>

            <NavSection title="Administration">
              <NavItem active={activeTab === 'Settings'} onClick={() => setActiveTab('Settings')} icon={<Settings size={14}/>}   label="Settings"/>
              <NavItem active={activeTab === 'Team'}     onClick={() => setActiveTab('Team')}     icon={<Users size={14}/>}      label="Team"/>
              <NavItem active={activeTab === 'API Keys'} onClick={() => setActiveTab('API Keys')} icon={<Key size={14}/>}        label="API Keys"/>
              <NavItem active={activeTab === 'Billing'}  onClick={() => setActiveTab('Billing')}  icon={<CreditCard size={14}/>} label="Billing"/>
            </NavSection>
          </div>

          {/* User footer */}
          <div className="h-14 px-3 flex items-center gap-3 shrink-0 cursor-pointer transition-colors hover:bg-white/[0.03]"
            style={{ borderTop: '1px solid var(--border-color)' }}>
            {/* Avatar with ring */}
            <div className="relative shrink-0">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold relative z-10"
                style={{ background: 'linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 50%, var(--bg-card)) 100%)', color: 'var(--bg-main)' }}>
                S
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold leading-tight">Sharvik</div>
              <div className="text-[10px] leading-tight" style={{ color: 'var(--text-muted)' }}>Enterprise Admin</div>
            </div>
            <div className="ml-auto">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#4ade80', boxShadow: '0 0 4px #4ade80' }}/>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Main area ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-6 shrink-0 sticky top-0 z-10 backdrop-blur-xl"
          style={{
            borderBottom: '1px solid var(--border-color)',
            background: 'color-mix(in srgb, var(--bg-main) 75%, transparent)',
          }}>
          <div className="flex items-center gap-2.5">
            <button onClick={() => setSidebar(v => !v)}
              className="p-1.5 rounded-md transition-colors hover:bg-white/[0.06]"
              style={{ color: 'var(--text-muted)' }}>
              <PanelLeft size={15}/>
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span style={{ color: 'var(--text-muted)' }}>Acme Corp</span>
              <ChevronRight size={12} style={{ color: 'var(--text-muted)', opacity: 0.4 }}/>
              <span className="font-semibold">{activeTab}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Search trigger */}
            <button onClick={() => setCmdk(true)}
              className="flex items-center justify-between w-48 px-3 py-1.5 rounded-lg text-xs transition-all"
              style={{
                background: 'var(--bg-sec)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-muted)',
              }}>
              <div className="flex items-center gap-2">
                <Search size={11}/>
                <span>Search…</span>
              </div>
              <div className="flex items-center gap-0.5 font-mono text-[10px]">
                <Command size={10}/><span>K</span>
              </div>
            </button>

            <div className="w-px h-4" style={{ background: 'var(--border-color)' }}/>

            {/* Notification bell */}
            <button className="relative p-1.5 rounded-md transition-colors hover:bg-white/[0.06]"
              style={{ color: 'var(--text-muted)' }}>
              <Bell size={15}/>
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full"
                style={{ boxShadow: '0 0 4px rgba(239,68,68,0.6)' }}/>
            </button>
          </div>
        </header>

        {/* Tab content */}
        <main className="flex-1 overflow-y-auto p-8 scrollbar-thin">
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} variants={pageVariants} initial="initial" animate="animate" exit="exit">
              {renderTab()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
