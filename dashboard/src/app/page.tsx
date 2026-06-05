"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Activity, Settings, Users, FileText, Search, Bell,
  ChevronRight, Network, Cpu, ShieldAlert, ClipboardList,
  Fingerprint, Eye, Sliders, Plus, Command,
  Sidebar as SidebarIcon, X, Zap, Key, CreditCard,
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
  initial:    { opacity: 0, y: 12, filter: 'blur(3px)' },
  animate:    { opacity: 1, y: 0,  filter: 'blur(0px)' },
  exit:       { opacity: 0, y: -8, filter: 'blur(3px)' },
  transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-5 mb-1.5">
        <span className="text-[10px] font-semibold text-base-muted/70 uppercase tracking-widest">{title}</span>
      </div>
      <nav className="space-y-0.5 px-2">{children}</nav>
    </div>
  );
}

function NavItem({ icon, label, active, onClick, badge }: {
  icon: React.ReactNode; label: string; active: boolean;
  onClick: () => void; badge?: number;
}) {
  return (
    <div onClick={onClick}
      className={`relative flex items-center gap-3 px-3 py-[7px] rounded-md cursor-pointer transition-colors group select-none ${active ? 'text-base-text font-medium' : 'text-base-muted hover:text-base-text'}`}
    >
      {active && (
        <motion.div layoutId="sidebarActive"
          className="absolute inset-0 bg-base-text/5 rounded-md border border-base-border/50"
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}/>
      )}
      <div className={`relative z-10 transition-opacity ${active ? 'text-base-text' : 'opacity-50 group-hover:opacity-100'}`}>{icon}</div>
      <span className="text-[13px] relative z-10 flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="text-[10px] bg-red-400 text-white rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 font-bold z-10">{badge}</span>
      )}
    </div>
  );
}

function CmdkItem({ icon, label, shortcut, onClick }: {
  icon: React.ReactNode; label: string; shortcut: string; onClick?: () => void;
}) {
  return (
    <div onClick={onClick}
      className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-base-sec cursor-pointer text-sm group transition-colors"
    >
      <div className="flex items-center gap-3 text-base-muted group-hover:text-base-text transition-colors">
        {icon} <span>{label}</span>
      </div>
      <div className="flex gap-1 text-[10px] font-mono text-base-muted">
        {shortcut.split(' ').map(s => (
          <span key={s} className="bg-base-card border border-base-border px-1.5 py-0.5 rounded shadow-sm">{s}</span>
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
      fetch('/api/gateway/metrics').then(r => setGateway(r.ok && !!(r))).catch(() => setGateway(false));
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

  return (
    <div className={`flex h-screen w-full overflow-hidden antialiased selection:bg-base-accent/20 font-sans transition-colors duration-500 ${theme}`}
      style={{ background: 'var(--bg-main)', color: 'var(--text-main)' }}
    >
      {/* ── Command Palette ─────────────────────────────────────────── */}
      <AnimatePresence>
        {isCmdkOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setCmdk(false)}/>
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -20, x: '-50%' }}
              animate={{ opacity: 1, scale: 1,    y: 0,   x: '-50%' }}
              exit={{   opacity: 0, scale: 0.96, y: -20, x: '-50%' }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="fixed top-[18%] left-1/2 z-50 w-[540px] rounded-xl overflow-hidden flex flex-col shadow-2xl"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
            >
              <div className="flex items-center px-4 py-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
                <Search size={14} className="text-base-muted mr-3 shrink-0"/>
                <input autoFocus type="text" placeholder="Jump to a page, policy, or action…"
                  className="bg-transparent flex-1 text-sm outline-none" style={{ color: 'var(--text-main)' }}/>
                <span className="text-[10px] px-1.5 py-0.5 rounded ml-3 font-mono shrink-0"
                  style={{ background: 'var(--bg-sec)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>ESC</span>
              </div>
              <div className="p-2 max-h-[320px] overflow-y-auto scrollbar-hide">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-base-muted">Navigate</div>
                {([
                  ['Overview',  <Activity size={13}/>,    '⌘ O'],
                  ['Analytics', <BarChart2 size={13}/>,   '⌘ A'],
                  ['Events',    <AlertCircle size={13}/>, '⌘ E'],
                  ['Policies',  <FileText size={13}/>,    '⌘ P'],
                  ['Audit Logs',<ClipboardList size={13}/>,'⌘ L'],
                  ['Settings',  <Settings size={13}/>,    '⌘ ,'],
                ] as [TabKey, React.ReactNode, string][]).map(([tab, icon, shortcut]) => (
                  <CmdkItem key={tab} icon={icon} label={tab} shortcut={shortcut} onClick={() => navigate(tab)}/>
                ))}
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-base-muted mt-2">Actions</div>
                <CmdkItem icon={<Plus size={13}/>}      label="Create New Policy"       shortcut="C P" onClick={() => navigate('Policies')}/>
                <CmdkItem icon={<Key size={13}/>}       label="Generate API Key"        shortcut="G K" onClick={() => navigate('API Keys')}/>
                <CmdkItem icon={<Cpu size={13}/>}       label="View Active Sandboxes"   shortcut="V S" onClick={() => navigate('Sandboxes')}/>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <motion.div layout initial={false}
        animate={{ width: isSidebarOpen ? 252 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
        className="shrink-0 flex flex-col relative z-20 overflow-hidden"
        style={{ borderRight: '1px solid var(--border-color)', background: 'var(--bg-sec)' }}
      >
        {/* Logo */}
        <div className="h-14 px-5 flex items-center shrink-0 gap-3">
          <div className="w-6 h-6 rounded-md flex items-center justify-center shadow-sm" style={{ background: 'var(--text-main)' }}>
            <Shield className="w-3.5 h-3.5" style={{ color: 'var(--bg-main)' }}/>
          </div>
          <div className="w-[252px]">
            <span className="text-sm font-semibold tracking-tight">TITAN</span>
            <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded font-semibold" style={{ background: gatewayOnline ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', color: gatewayOnline ? '#4ade80' : '#f87171' }}>
              {gatewayOnline === null ? '…' : gatewayOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-5 flex flex-col gap-7 scrollbar-hide px-3" style={{ width: 252 }}>
          <NavSection title="Platform">
            <NavItem active={activeTab === 'Overview'}    onClick={() => setActiveTab('Overview')}    icon={<Activity size={14}/>}    label="Overview"/>
            <NavItem active={activeTab === 'Analytics'}   onClick={() => setActiveTab('Analytics')}   icon={<BarChart2 size={14}/>}   label="Analytics"/>
            <NavItem active={activeTab === 'Edge Routing'}onClick={() => setActiveTab('Edge Routing')} icon={<Network size={14}/>}     label="Edge Routing"/>
          </NavSection>
          <NavSection title="Security Operations">
            <NavItem active={activeTab === 'Events'}         onClick={() => setActiveTab('Events')}         icon={<AlertCircle size={14}/>} label="Events & Logs"/>
            <NavItem active={activeTab === 'Policies'}       onClick={() => setActiveTab('Policies')}       icon={<FileText size={14}/>}   label="Policy Engine"/>
            <NavItem active={activeTab === 'Sandboxes'}      onClick={() => setActiveTab('Sandboxes')}      icon={<Cpu size={14}/>}        label="Sandboxes"/>
            <NavItem active={activeTab === 'Vulnerabilities'}onClick={() => setActiveTab('Vulnerabilities')} icon={<ShieldAlert size={14}/>} label="Vulnerabilities"/>
          </NavSection>
          <NavSection title="Auditing & Compliance">
            <NavItem active={activeTab === 'Audit Logs'}    onClick={() => setActiveTab('Audit Logs')}    icon={<ClipboardList size={14}/>} label="Audit Logs"/>
            <NavItem active={activeTab === 'Access Control'}onClick={() => setActiveTab('Access Control')} icon={<Fingerprint size={14}/>}   label="Access Control"/>
            <NavItem active={activeTab === 'Data Privacy'}  onClick={() => setActiveTab('Data Privacy')}  icon={<Eye size={14}/>}            label="Data Privacy"/>
          </NavSection>
          <NavSection title="Administration">
            <NavItem active={activeTab === 'Settings'} onClick={() => setActiveTab('Settings')} icon={<Settings size={14}/>}   label="Settings"/>
            <NavItem active={activeTab === 'Team'}     onClick={() => setActiveTab('Team')}     icon={<Users size={14}/>}      label="Team"/>
            <NavItem active={activeTab === 'API Keys'} onClick={() => setActiveTab('API Keys')} icon={<Key size={14}/>}        label="API Keys"/>
            <NavItem active={activeTab === 'Billing'}  onClick={() => setActiveTab('Billing')}  icon={<CreditCard size={14}/>} label="Billing"/>
          </NavSection>
        </div>

        {/* User footer */}
        <div className="h-14 px-4 flex items-center gap-3 shrink-0 cursor-pointer hover:bg-base-sec/50 transition-colors"
          style={{ borderTop: '1px solid var(--border-color)', width: 252 }}>
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0" style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)' }}>S</div>
          <div>
            <div className="text-xs font-medium">Sharvik</div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Enterprise Admin</div>
          </div>
        </div>
      </motion.div>

      {/* ── Main area ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Ambient glow for dark themes */}
        {theme !== 'theme-light' && (
          <div className="pointer-events-none fixed top-0 left-1/4 w-[40%] h-[30%] rounded-full opacity-[0.025] blur-[120px]" style={{ background: 'var(--accent)' }}/>
        )}

        {/* Header */}
        <header className="h-14 flex items-center justify-between px-6 shrink-0 sticky top-0 z-10 backdrop-blur-md"
          style={{ borderBottom: '1px solid var(--border-color)', background: 'color-mix(in srgb, var(--bg-main) 80%, transparent)' }}>
          <div className="flex items-center text-sm gap-3">
            <button onClick={() => setSidebar(v => !v)} className="p-1.5 rounded-md transition-colors hover:bg-base-sec" style={{ color: 'var(--text-muted)' }}>
              <SidebarIcon size={15}/>
            </button>
            <span style={{ color: 'var(--text-muted)' }}>Acme Corp</span>
            <ChevronRight size={13} style={{ color: 'var(--text-muted)', opacity: 0.5 }}/>
            <span className="font-semibold">{activeTab}</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setCmdk(true)}
              className="flex items-center justify-between w-44 px-3 py-1.5 rounded-lg text-xs transition-colors"
              style={{ background: 'var(--bg-sec)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              <div className="flex items-center gap-2"><Search size={11}/> Search…</div>
              <div className="flex items-center gap-0.5 font-mono"><Command size={10}/><span>K</span></div>
            </button>
            <div className="w-px h-4" style={{ background: 'var(--border-color)' }}/>
            <button className="relative p-1.5 rounded-md transition-colors hover:bg-base-sec" style={{ color: 'var(--text-muted)' }}>
              <Bell size={15}/>
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-400 rounded-full border" style={{ borderColor: 'var(--bg-main)' }}/>
            </button>
          </div>
        </header>

        {/* Tab content */}
        <main className="flex-1 overflow-y-auto p-8 scrollbar-hide">
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
