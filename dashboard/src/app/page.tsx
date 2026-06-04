"use client";
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Shield, Activity, Settings, Users, Database, FileText, 
  Search, Bell, AlertCircle, ChevronRight, Server,
  Lock, Key, CreditCard, Layout, Network, Cpu, ShieldAlert,
  ClipboardList, Fingerprint, Eye, Sliders, Moon, Sun, Monitor
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, 
  ResponsiveContainer
} from 'recharts';

// --- MOCK DATA ---
const trafficData = Array.from({ length: 24 }).map((_, i) => ({
  time: `${i}:00`,
  requests: Math.floor(Math.random() * 8000) + 2000,
  blocked: Math.floor(Math.random() * 800) + 100,
}));

const incidentData = [
  { id: 'INC-9012', time: '18:22:14', type: 'Prompt Injection', target: 'Agent-Alpha', severity: 'Critical', action: 'Blocked' },
  { id: 'INC-9011', time: '18:19:02', type: 'PII Leakage (SSN)', target: 'SupportBot-X', severity: 'High', action: 'Redacted' },
  { id: 'INC-9010', time: '18:15:59', type: 'Sandbox Escape', target: 'DevOps-Agent', severity: 'Critical', action: 'Terminated' },
  { id: 'INC-9009', time: '18:02:44', type: 'Rate Limit', target: 'Scraper-Agent', severity: 'Medium', action: 'Throttled' },
  { id: 'INC-9008', time: '17:55:12', type: 'Unauthorized File', target: 'Analysis-Bot', severity: 'High', action: 'Blocked' },
];

export default function Dashboard() {
  const [isClient, setIsClient] = useState(false);
  const [activeTab, setActiveTab] = useState('Overview');
  const [activeSettingsTab, setActiveSettingsTab] = useState('Appearance');
  const [theme, setTheme] = useState('theme-dark'); // theme-light, theme-dark, theme-midnight, theme-cobalt

  useEffect(() => { setIsClient(true); }, []);

  const fadeSlide = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -10 },
    transition: { duration: 0.2, ease: "easeOut" }
  };

  if (!isClient) return null;

  return (
    <div className={`flex h-screen overflow-hidden antialiased selection:bg-base-accent/30 ${theme}`}>
      
      {/* SIDEBAR */}
      <div className="w-64 border-r border-base-border bg-base-main flex flex-col relative z-20 transition-colors duration-300">
        
        {/* Brand */}
        <div className="h-14 px-5 flex items-center border-b border-base-border">
          <div className="w-6 h-6 bg-base-accent rounded-sm flex items-center justify-center mr-3 transition-colors">
            <Shield className="w-3.5 h-3.5 text-base-main" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-base-text">CyberFort TITAN</span>
        </div>
        
        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-5 flex flex-col gap-6 scrollbar-hide">
          
          <NavSection title="Platform">
            <NavItem active={activeTab === 'Overview'} onClick={() => setActiveTab('Overview')} icon={<Activity size={16}/>} label="Overview" />
            <NavItem active={activeTab === 'Analytics'} onClick={() => setActiveTab('Analytics')} icon={<AreaChart size={16}/>} label="Analytics" />
            <NavItem active={activeTab === 'Edge Nodes'} onClick={() => setActiveTab('Edge Nodes')} icon={<Network size={16}/>} label="Edge Routing" />
          </NavSection>

          <NavSection title="Security Operations">
            <NavItem active={activeTab === 'Events'} onClick={() => setActiveTab('Events')} icon={<AlertCircle size={16}/>} label="Security Events" />
            <NavItem active={activeTab === 'Policies'} onClick={() => setActiveTab('Policies')} icon={<FileText size={16}/>} label="Policy Engine" />
            <NavItem active={activeTab === 'Sandboxes'} onClick={() => setActiveTab('Sandboxes')} icon={<Cpu size={16}/>} label="Active Sandboxes" />
            <NavItem active={activeTab === 'Vulnerabilities'} onClick={() => setActiveTab('Vulnerabilities')} icon={<ShieldAlert size={16}/>} label="Vulnerabilities" />
          </NavSection>

          <NavSection title="Auditing & Compliance">
            <NavItem active={activeTab === 'Audit Logs'} onClick={() => setActiveTab('Audit Logs')} icon={<ClipboardList size={16}/>} label="Audit Logs" />
            <NavItem active={activeTab === 'Access Control'} onClick={() => setActiveTab('Access Control')} icon={<Fingerprint size={16}/>} label="Access Control" />
            <NavItem active={activeTab === 'Data Privacy'} onClick={() => setActiveTab('Data Privacy')} icon={<Eye size={16}/>} label="Data Privacy" />
          </NavSection>

          <NavSection title="Configuration">
            <NavItem active={activeTab === 'Settings'} onClick={() => setActiveTab('Settings')} icon={<Settings size={16}/>} label="Settings" />
            <NavItem active={activeTab === 'Team'} onClick={() => setActiveTab('Team')} icon={<Users size={16}/>} label="Team" />
            <NavItem active={activeTab === 'API Keys'} onClick={() => setActiveTab('API Keys')} icon={<Key size={16}/>} label="API Keys" />
            <NavItem active={activeTab === 'Billing'} onClick={() => setActiveTab('Billing')} icon={<CreditCard size={16}/>} label="Billing" />
          </NavSection>

        </div>

        {/* User Context */}
        <div className="h-16 px-5 border-t border-base-border flex items-center justify-between cursor-pointer hover:bg-base-sec transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-base-accent text-base-main flex items-center justify-center text-xs font-bold transition-colors">
              SS
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-base-text">Sharvik</span>
              <span className="text-xs text-base-muted">Enterprise Org</span>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex flex-col bg-base-sec transition-colors duration-300">
        
        {/* Header */}
        <header className="h-14 border-b border-base-border flex items-center justify-between px-8 bg-base-main z-10 sticky top-0 transition-colors">
          <div className="flex items-center text-sm font-medium text-base-muted">
            <span>Acme Corp</span>
            <ChevronRight size={14} className="mx-2" />
            <span className="text-base-text">{activeTab}</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative group">
              <Search className="w-4 h-4 text-base-muted absolute left-3 top-1/2 transform -translate-y-1/2 transition-colors" />
              <input 
                type="text" 
                placeholder="Search resources..." 
                className="bg-base-sec border border-base-border rounded-md py-1.5 pl-9 pr-4 text-xs w-64 focus:outline-none focus:border-base-muted text-base-text placeholder-base-muted transition-colors"
              />
            </div>
            <button className="text-base-muted hover:text-base-text transition-colors">
              <Bell size={18} />
            </button>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-8 scrollbar-hide relative">
          <AnimatePresence mode="wait">
            
            {/* --- OVERVIEW TAB --- */}
            {activeTab === 'Overview' && (
              <motion.div key="overview" {...fadeSlide} className="max-w-7xl mx-auto space-y-8">
                
                <div className="flex justify-between items-end">
                  <div>
                    <h1 className="text-2xl font-semibold text-base-text tracking-tight">Overview</h1>
                    <p className="text-sm text-base-muted mt-1">Real-time infrastructure and security posture.</p>
                  </div>
                  <div className="flex gap-3">
                    <button className="px-3 py-1.5 bg-base-sec border border-base-border hover:bg-base-border rounded-md text-sm text-base-text transition-colors">
                      Export Report
                    </button>
                    <button className="px-3 py-1.5 bg-base-accent text-base-main hover:opacity-90 rounded-md text-sm font-medium transition-colors">
                      Deploy Ruleset
                    </button>
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <MetricCard title="Total Requests" value="1.8M" change="+8.2%" />
                  <MetricCard title="Threats Blocked" value="24.8K" change="+12.5%" trend="bad" />
                  <MetricCard title="Active Sandboxes" value="1,402" change="+3.1%" />
                  <MetricCard title="P99 Latency" value="14ms" change="-2ms" trend="good" />
                </div>

                {/* Chart Section */}
                <div className="border border-base-border bg-base-card rounded-xl p-6 transition-colors">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-sm font-medium text-base-text">Traffic vs Interceptions</h3>
                    <select className="bg-base-sec border border-base-border text-xs text-base-text rounded-md px-2 py-1 outline-none">
                      <option>Last 24 Hours</option>
                      <option>Last 7 Days</option>
                    </select>
                  </div>
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trafficData} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                        <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} dy={10} />
                        <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(val) => `${val/1000}k`} />
                        <RechartsTooltip 
                          contentStyle={{ backgroundColor: 'var(--bg-sec)', borderColor: 'var(--border-color)', borderRadius: '8px', fontSize: '12px' }}
                          itemStyle={{ color: 'var(--text-main)' }} cursor={{ stroke: 'var(--text-muted)', strokeWidth: 1, strokeDasharray: '4 4' }}
                        />
                        <Area type="monotone" dataKey="requests" name="Total Traffic" stroke="var(--accent)" strokeWidth={2} fillOpacity={0.1} fill="var(--accent)" />
                        <Area type="monotone" dataKey="blocked" name="Blocked" stroke="var(--text-muted)" strokeWidth={2} fill="transparent" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Events Table */}
                <div className="border border-base-border bg-base-card rounded-xl overflow-hidden transition-colors">
                  <div className="px-5 py-4 border-b border-base-border flex justify-between items-center bg-base-sec/50">
                    <h3 className="text-sm font-medium text-base-text">Recent Security Events</h3>
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead className="bg-base-card text-base-muted">
                      <tr>
                        <th className="px-5 py-3 font-medium border-b border-base-border">Time</th>
                        <th className="px-5 py-3 font-medium border-b border-base-border">Event Type</th>
                        <th className="px-5 py-3 font-medium border-b border-base-border">Target Agent</th>
                        <th className="px-5 py-3 font-medium border-b border-base-border">Severity</th>
                        <th className="px-5 py-3 font-medium border-b border-base-border text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-base-border">
                      {incidentData.map((inc) => (
                        <tr key={inc.id} className="hover:bg-base-sec transition-colors cursor-pointer">
                          <td className="px-5 py-3 text-base-muted">{inc.time}</td>
                          <td className="px-5 py-3 text-base-text">{inc.type}</td>
                          <td className="px-5 py-3 text-base-muted">{inc.target}</td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex items-center gap-1.5 ${inc.severity === 'Critical' ? 'text-red-500' : inc.severity === 'High' ? 'text-orange-500' : 'text-yellow-500'}`}>
                              <div className={`w-1.5 h-1.5 rounded-full ${inc.severity === 'Critical' ? 'bg-red-500' : inc.severity === 'High' ? 'bg-orange-500' : 'bg-yellow-500'}`} />
                              {inc.severity}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-base-text text-right font-medium">{inc.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {/* --- SETTINGS TAB --- */}
            {activeTab === 'Settings' && (
              <motion.div key="settings" {...fadeSlide} className="max-w-5xl mx-auto flex flex-col md:flex-row gap-10">
                
                {/* Settings Sidebar */}
                <div className="w-56 shrink-0 space-y-1">
                  <div className="mb-4 px-3 text-xs font-semibold text-base-muted uppercase tracking-wider">Configuration</div>
                  <SettingsNavItem active={activeSettingsTab === 'General'} onClick={() => setActiveSettingsTab('General')} icon={<Sliders size={16}/>} label="General" />
                  <SettingsNavItem active={activeSettingsTab === 'Appearance'} onClick={() => setActiveSettingsTab('Appearance')} icon={<Layout size={16}/>} label="Appearance" />
                  <SettingsNavItem active={activeSettingsTab === 'Security'} onClick={() => setActiveSettingsTab('Security')} icon={<Lock size={16}/>} label="Security Defaults" />
                  <SettingsNavItem active={activeSettingsTab === 'Advanced'} onClick={() => setActiveSettingsTab('Advanced')} icon={<Server size={16}/>} label="Advanced" />
                </div>

                {/* Settings Content */}
                <div className="flex-1 space-y-8">
                  
                  {activeSettingsTab === 'Appearance' && (
                    <motion.section {...fadeSlide}>
                      <h2 className="text-xl font-semibold text-base-text mb-1">Appearance</h2>
                      <p className="text-sm text-base-muted mb-8">Customize the look and feel of your enterprise dashboard.</p>
                      
                      <div className="space-y-6">
                        <div>
                          <label className="block text-sm font-medium text-base-text mb-3">Theme Preference</label>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <ThemeCard current={theme} target="theme-light" title="Light" icon={<Sun size={20}/>} onClick={setTheme} />
                            <ThemeCard current={theme} target="theme-dark" title="Dark" icon={<Moon size={20}/>} onClick={setTheme} />
                            <ThemeCard current={theme} target="theme-midnight" title="Midnight" icon={<Moon size={20} className="text-blue-400"/>} onClick={setTheme} />
                            <ThemeCard current={theme} target="theme-cobalt" title="Cobalt" icon={<Monitor size={20} className="text-sky-400"/>} onClick={setTheme} />
                          </div>
                        </div>

                        <div className="h-px bg-base-border my-8" />

                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="text-sm font-medium text-base-text">Dense Data Tables</h4>
                            <p className="text-xs text-base-muted">Reduce padding in tables to show more data on screen.</p>
                          </div>
                          <ToggleSwitch defaultState={false} />
                        </div>
                      </div>
                    </motion.section>
                  )}

                  {activeSettingsTab === 'Security' && (
                    <motion.section {...fadeSlide}>
                      <h2 className="text-xl font-semibold text-base-text mb-1">Security Defaults</h2>
                      <p className="text-sm text-base-muted mb-8">Global security behaviors for all connected agent runtimes.</p>
                      
                      <div className="border border-base-border rounded-xl divide-y divide-base-border bg-base-card transition-colors">
                        <ToggleSetting title="Strict PII Redaction (SOC2)" description="Automatically scrub SSNs, Credit Cards, and API keys from outbound LLM responses globally." defaultState={true} />
                        <ToggleSetting title="Auto-Kill Sandboxes" description="Kill microVMs immediately if unexpected outbound network requests are detected." defaultState={true} />
                        <ToggleSetting title="Human-in-the-Loop Fallback" description="Suspend medium-risk tool calls and await manual Slack approval from an administrator." defaultState={false} />
                        <ToggleSetting title="Block Unknown User-Agents" description="Drop traffic at the Go Gateway edge if User-Agent header is missing or malicious." defaultState={true} />
                      </div>
                    </motion.section>
                  )}

                  {activeSettingsTab === 'General' && (
                    <motion.section {...fadeSlide}>
                      <h2 className="text-xl font-semibold text-base-text mb-1">General Settings</h2>
                      <p className="text-sm text-base-muted mb-8">Manage your core platform configurations.</p>
                      
                      <div className="space-y-6 max-w-xl">
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-medium text-base-text">Project Name</label>
                          <input type="text" defaultValue="Acme Production" className="bg-base-sec border border-base-border rounded-md px-3 py-2 text-sm text-base-text focus:outline-none focus:border-base-accent transition-colors" />
                        </div>
                        
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-medium text-base-text">Data Retention (ClickHouse)</label>
                          <select className="bg-base-sec border border-base-border rounded-md px-3 py-2 text-sm text-base-text focus:outline-none focus:border-base-accent transition-colors">
                            <option>30 Days</option>
                            <option>90 Days (SOC2 Default)</option>
                            <option>365 Days</option>
                          </select>
                          <p className="text-xs text-base-muted">Audit logs older than the retention period will be permanently deleted.</p>
                        </div>
                      </div>
                    </motion.section>
                  )}

                  <div className="pt-6">
                    <button className="bg-base-accent text-base-main px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 transition-colors">
                      Save Changes
                    </button>
                  </div>

                </div>
              </motion.div>
            )}

            {/* Placeholder for other tabs */}
            {activeTab !== 'Overview' && activeTab !== 'Settings' && (
              <motion.div key="placeholder" {...fadeSlide} className="flex items-center justify-center h-[60vh] flex-col text-base-muted">
                <Settings className="w-12 h-12 mb-4 opacity-20" />
                <h2 className="text-xl font-medium text-base-text">{activeTab} Module</h2>
                <p className="mt-2 text-sm">This module is currently being provisioned by the SRE team.</p>
              </motion.div>
            )}

          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

// --- Components ---

function NavSection({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div>
      <div className="px-5 mb-2">
        <span className="text-[11px] font-semibold text-base-muted uppercase tracking-wider">{title}</span>
      </div>
      <nav className="space-y-0.5 px-3">
        {children}
      </nav>
    </div>
  );
}

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${
        active ? 'bg-base-sec text-base-text font-medium' : 'text-base-muted hover:text-base-text hover:bg-base-sec/50'
      }`}
    >
      <div className={active ? 'text-base-accent' : 'text-base-muted opacity-70'}>{icon}</div>
      <span className="text-sm">{label}</span>
    </div>
  );
}

function SettingsNavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${
        active ? 'bg-base-sec text-base-text font-medium' : 'text-base-muted hover:text-base-text hover:bg-base-sec/50'
      }`}
    >
      <div className={active ? 'text-base-text' : 'opacity-70'}>{icon}</div>
      <span className="text-sm">{label}</span>
    </div>
  );
}

function MetricCard({ title, value, change, trend }: { title: string, value: string, change: string, trend?: 'bad'|'good' }) {
  return (
    <div className="border border-base-border bg-base-card rounded-xl p-5 hover:border-base-muted transition-colors">
      <h3 className="text-sm text-base-muted mb-1">{title}</h3>
      <div className="flex items-baseline gap-2 mt-2">
        <span className="text-3xl font-semibold tracking-tight text-base-text">{value}</span>
        <span className={`text-xs font-medium ${trend === 'bad' ? 'text-red-500' : trend === 'good' ? 'text-green-500' : 'text-base-muted'}`}>
          {change}
        </span>
      </div>
    </div>
  );
}

function ThemeCard({ current, target, title, icon, onClick }: { current: string, target: string, title: string, icon: React.ReactNode, onClick: (t: string) => void }) {
  const isActive = current === target;
  return (
    <div 
      onClick={() => onClick(target)}
      className={`border rounded-xl p-4 cursor-pointer flex flex-col items-center gap-3 transition-all ${
        isActive ? 'border-base-accent bg-base-sec shadow-[0_0_0_1px_var(--accent)]' : 'border-base-border bg-base-card hover:border-base-muted'
      }`}
    >
      <div className="p-3 rounded-full bg-base-sec border border-base-border">
        {icon}
      </div>
      <span className={`text-sm font-medium ${isActive ? 'text-base-text' : 'text-base-muted'}`}>{title}</span>
    </div>
  );
}

function ToggleSetting({ title, description, defaultState }: { title: string, description: string, defaultState: boolean }) {
  return (
    <div className="flex items-start justify-between p-5 hover:bg-base-sec/50 transition-colors">
      <div className="pr-8">
        <div className="text-sm font-medium text-base-text mb-1">{title}</div>
        <div className="text-sm text-base-muted leading-relaxed">{description}</div>
      </div>
      <ToggleSwitch defaultState={defaultState} />
    </div>
  );
}

function ToggleSwitch({ defaultState }: { defaultState: boolean }) {
  const [isOn, setIsOn] = useState(defaultState);
  return (
    <button 
      onClick={() => setIsOn(!isOn)} 
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isOn ? 'bg-base-accent' : 'bg-base-border'}`}
    >
      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full shadow ring-0 transition duration-200 ease-in-out bg-base-main ${isOn ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}
