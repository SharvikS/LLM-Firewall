"use client";
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { 
  Shield, Activity, Settings, Users, FileText, Search, Bell, 
  ChevronRight, Server, Lock, Key, CreditCard, Layout, Network, 
  Cpu, ShieldAlert, ClipboardList, Fingerprint, Eye, Sliders, 
  Moon, Sun, Monitor, Plus, Trash2, Filter, Command, Maximize2, 
  Sidebar as SidebarIcon, X, Zap, ChevronLeft
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

// --- GOD-TIER MOCK DATA ---
const trafficData = Array.from({ length: 48 }).map((_, i) => ({
  time: `${Math.floor(i/2)}:${i%2===0?'00':'30'}`, 
  requests: Math.floor(Math.sin(i/5) * 3000 + 5000 + Math.random() * 1000), 
  blocked: Math.floor(Math.cos(i/4) * 300 + 400 + Math.random() * 100),
}));

const incidentData = [
  { id: 'EVT-0X91', time: 'Just now', type: 'Prompt Injection', target: 'Agent-Alpha', severity: 'Critical', status: 'Blocked', icon: <ShieldAlert size={14}/> },
  { id: 'EVT-0X90', time: '2m ago', type: 'PII Leakage (SSN)', target: 'SupportBot-X', severity: 'High', status: 'Redacted', icon: <Eye size={14}/> },
  { id: 'EVT-0X8F', time: '15m ago', type: 'Sandbox Escape', target: 'DevOps-Agent', severity: 'Critical', status: 'Terminated', icon: <Cpu size={14}/> },
  { id: 'EVT-0X8E', time: '1h ago', type: 'Rate Limit', target: 'Scraper-Agent', severity: 'Medium', status: 'Throttled', icon: <Zap size={14}/> },
];

export default function Dashboard() {
  const [isClient, setIsClient] = useState(false);
  const [activeTab, setActiveTab] = useState('Overview');
  const [theme, setTheme] = useState('theme-dark');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isCmdkOpen, setIsCmdkOpen] = useState(false);

  useEffect(() => { 
    setIsClient(true); 
    
    // Cmd+K and Cmd+B Listeners
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'k') { e.preventDefault(); setIsCmdkOpen(prev => !prev); }
      if (e.metaKey && e.key === 'b') { e.preventDefault(); setIsSidebarOpen(prev => !prev); }
      if (e.key === 'Escape') { setIsCmdkOpen(false); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!isClient) return null;

  const pageVariants = {
    initial: { opacity: 0, y: 15, filter: 'blur(4px)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    exit: { opacity: 0, y: -15, filter: 'blur(4px)' },
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } // Custom spring-like bezier
  };

  return (
    <div className={`flex h-screen w-full bg-base-main text-base-text overflow-hidden antialiased selection:bg-base-accent/20 transition-colors duration-500 font-sans ${theme}`}>
      
      {/* COMMAND PALETTE (Cmd+K) */}
      <AnimatePresence>
        {isCmdkOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={() => setIsCmdkOpen(false)} 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: -20, x: '-50%' }} animate={{ opacity: 1, scale: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, scale: 0.95, y: -20, x: '-50%' }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="fixed top-[20%] left-1/2 z-50 w-[550px] bg-base-card border border-base-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="flex items-center px-4 py-3 border-b border-base-border">
                <Search size={16} className="text-base-muted mr-3" />
                <input autoFocus type="text" placeholder="Search commands, policies, or resources..." className="bg-transparent border-none flex-1 text-sm outline-none text-base-text placeholder-base-muted" />
                <span className="text-[10px] bg-base-sec border border-base-border px-1.5 py-0.5 rounded text-base-muted">ESC</span>
              </div>
              <div className="p-2 space-y-1 max-h-[300px] overflow-y-auto">
                <div className="px-3 py-1.5 text-xs font-semibold text-base-muted uppercase tracking-wider">Quick Actions</div>
                <CmdkItem icon={<Plus size={14}/>} label="Create New Policy" shortcut="C P" />
                <CmdkItem icon={<Cpu size={14}/>} label="Kill All Active Sandboxes" shortcut="K S" />
                <CmdkItem icon={<Sliders size={14}/>} label="Open Settings" shortcut="G S" />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* SIDEBAR (Collapsible) */}
      <motion.div 
        layout
        initial={false}
        animate={{ width: isSidebarOpen ? 260 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="shrink-0 border-r border-base-border bg-base-sec/30 flex flex-col relative z-20 overflow-hidden"
      >
        <div className="h-14 px-5 flex items-center shrink-0">
          <div className="w-5 h-5 bg-base-text rounded-sm flex items-center justify-center mr-3 shadow-sm">
            <Shield className="w-3 h-3 text-base-main" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-base-text">TITAN</span>
        </div>
        
        <div className="flex-1 overflow-y-auto py-6 flex flex-col gap-8 scrollbar-hide px-3 w-[260px]">
          <NavSection title="Platform">
            <NavItem active={activeTab === 'Overview'} onClick={() => setActiveTab('Overview')} icon={<Activity size={14}/>} label="Overview" />
            <NavItem active={activeTab === 'Edge Routing'} onClick={() => setActiveTab('Edge Routing')} icon={<Network size={14}/>} label="Edge Routing" />
          </NavSection>
          <NavSection title="Security Operations">
            <NavItem active={activeTab === 'Events'} onClick={() => setActiveTab('Events')} icon={<AlertCircle size={14}/>} label="Events & Logs" />
            <NavItem active={activeTab === 'Policies'} onClick={() => setActiveTab('Policies')} icon={<FileText size={14}/>} label="Policy Engine" />
            <NavItem active={activeTab === 'Sandboxes'} onClick={() => setActiveTab('Sandboxes')} icon={<Cpu size={14}/>} label="Sandboxes" />
          </NavSection>
          <NavSection title="Administration">
            <NavItem active={activeTab === 'Settings'} onClick={() => setActiveTab('Settings')} icon={<Settings size={14}/>} label="Settings" />
            <NavItem active={activeTab === 'API Keys'} onClick={() => setActiveTab('API Keys')} icon={<Key size={14}/>} label="API Keys" />
          </NavSection>
        </div>

        <div className="h-14 px-4 border-t border-base-border flex items-center justify-between w-[260px] shrink-0 hover:bg-base-sec/50 cursor-pointer transition-colors">
          <div className="flex items-center gap-3">
            <img src="https://api.dicebear.com/7.x/notionists/svg?seed=Sharvik" alt="User" className="w-7 h-7 rounded-full bg-base-sec border border-base-border" />
            <div className="flex flex-col">
              <span className="text-xs font-medium text-base-text">Sharvik</span>
              <span className="text-[10px] text-base-muted">Enterprise Admin</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex flex-col min-w-0 bg-base-main relative">
        
        {/* Subtle Ambient Background Glow (Only in Dark Modes) */}
        {theme !== 'theme-light' && (
          <>
            <div className="absolute top-[-20%] left-[-10%] w-[40%] h-[40%] rounded-full bg-base-accent opacity-[0.03] blur-[100px] pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] rounded-full bg-base-accent opacity-[0.02] blur-[100px] pointer-events-none" />
          </>
        )}

        {/* Header */}
        <header className="h-14 border-b border-base-border flex items-center justify-between px-6 bg-base-main/80 backdrop-blur-md z-10 sticky top-0 shrink-0">
          <div className="flex items-center text-sm">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="mr-4 text-base-muted hover:text-base-text transition-colors p-1 rounded-md hover:bg-base-sec">
              <SidebarIcon size={16} />
            </button>
            <span className="text-base-muted font-medium">Acme Corp</span>
            <ChevronRight size={14} className="mx-2 text-base-muted/50" />
            <span className="text-base-text font-semibold">{activeTab}</span>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsCmdkOpen(true)}
              className="flex items-center justify-between w-48 px-3 py-1.5 bg-base-sec/50 border border-base-border rounded-md text-xs text-base-muted hover:bg-base-sec transition-colors group"
            >
              <div className="flex items-center gap-2"><Search size={12}/> <span>Search...</span></div>
              <div className="flex items-center gap-0.5"><Command size={10}/><span>K</span></div>
            </button>
            <div className="w-px h-4 bg-base-border mx-1"></div>
            <button className="text-base-muted hover:text-base-text transition-colors relative">
              <Bell size={16} />
              <span className="absolute top-0 right-0 w-1.5 h-1.5 bg-red-500 rounded-full border border-base-main"></span>
            </button>
          </div>
        </header>

        {/* Viewport */}
        <main className="flex-1 overflow-y-auto p-8 relative scrollbar-hide">
          <AnimatePresence mode="wait">
            
            {/* --- OVERVIEW --- */}
            {activeTab === 'Overview' && (
              <motion.div key="overview" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="max-w-6xl mx-auto space-y-8">
                
                <div className="flex justify-between items-end">
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
                    <p className="text-sm text-base-muted mt-1">Real-time telemetry and edge analytics.</p>
                  </div>
                  <button className="px-4 py-1.5 bg-base-text text-base-main rounded-md text-sm font-medium hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-lg shadow-base-text/10">
                    Deploy Configuration
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <AnimatedMetric title="Edge Requests" value={1842901} suffix="+" trend={8.2} />
                  <AnimatedMetric title="Threats Blocked" value={24892} trend={12.5} bad />
                  <AnimatedMetric title="Active Sandboxes" value={1402} trend={3.1} />
                  <AnimatedMetric title="P99 Latency" value={14} suffix="ms" trend={-2} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Master Chart */}
                  <div className="lg:col-span-2 border border-base-border bg-base-card rounded-xl p-6 shadow-sm flex flex-col h-[380px]">
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="text-sm font-semibold">Global Traffic & Interceptions</h3>
                      <div className="flex gap-1 bg-base-sec p-0.5 rounded-md border border-base-border">
                        {['24h', '7d', '30d'].map(t => (
                          <button key={t} className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${t === '24h' ? 'bg-base-card text-base-text shadow-sm' : 'text-base-muted hover:text-base-text'}`}>{t}</button>
                        ))}
                      </div>
                    </div>
                    <div className="flex-1 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trafficData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorReq" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.15}/>
                              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} opacity={0.5} />
                          <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} dy={10} minTickGap={30} />
                          <YAxis stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `${val/1000}k`} />
                          <RechartsTooltip 
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                return (
                                  <div className="bg-base-card border border-base-border p-3 rounded-lg shadow-xl text-xs">
                                    <div className="text-base-muted mb-2">{payload[0].payload.time}</div>
                                    <div className="flex justify-between gap-4 font-medium"><span className="text-base-text">Requests</span><span>{payload[0].value?.toLocaleString()}</span></div>
                                    <div className="flex justify-between gap-4 font-medium mt-1"><span className="text-base-muted">Blocked</span><span>{payload[1].value?.toLocaleString()}</span></div>
                                  </div>
                                );
                              }
                              return null;
                            }}
                            cursor={{ stroke: 'var(--text-muted)', strokeWidth: 1, strokeDasharray: '4 4' }}
                          />
                          <Area type="monotone" dataKey="requests" stroke="var(--accent)" strokeWidth={2} fillOpacity={1} fill="url(#colorReq)" animationDuration={1500} />
                          <Area type="monotone" dataKey="blocked" stroke="var(--text-muted)" strokeWidth={2} fill="transparent" strokeDasharray="3 3" animationDuration={1500} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Incident Feed */}
                  <div className="border border-base-border bg-base-card rounded-xl flex flex-col h-[380px] overflow-hidden shadow-sm">
                    <div className="p-5 border-b border-base-border flex justify-between items-center bg-base-sec/30">
                      <h3 className="text-sm font-semibold">Live Threat Feed</h3>
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 scrollbar-hide">
                      <motion.ul variants={{ show: { transition: { staggerChildren: 0.05 } } }} initial="hidden" animate="show">
                        {incidentData.map((inc) => (
                          <motion.li key={inc.id} variants={{ hidden: { opacity: 0, x: 20 }, show: { opacity: 1, x: 0 } }} 
                            className="p-3 mx-2 my-1 rounded-md hover:bg-base-sec transition-colors cursor-pointer flex items-center justify-between group"
                          >
                            <div className="flex items-center gap-3">
                              <div className={`p-1.5 rounded-md ${inc.severity === 'Critical' ? 'bg-red-500/10 text-red-500' : inc.severity === 'High' ? 'bg-orange-500/10 text-orange-500' : 'bg-yellow-500/10 text-yellow-500'}`}>
                                {inc.icon}
                              </div>
                              <div>
                                <div className="text-sm font-medium text-base-text">{inc.type}</div>
                                <div className="text-xs text-base-muted">{inc.target} • {inc.time}</div>
                              </div>
                            </div>
                            <ChevronRight size={14} className="text-base-muted opacity-0 group-hover:opacity-100 transition-opacity transform group-hover:translate-x-1" />
                          </motion.li>
                        ))}
                      </motion.ul>
                    </div>
                    <div className="p-3 border-t border-base-border text-center">
                      <button className="text-xs text-base-muted hover:text-base-text transition-colors">View All Events &rarr;</button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* --- SETTINGS --- */}
            {activeTab === 'Settings' && (
              <motion.div key="settings" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="max-w-5xl mx-auto flex flex-col md:flex-row gap-12">
                
                <div className="w-48 shrink-0">
                  <h2 className="text-lg font-semibold tracking-tight mb-6">Configuration</h2>
                  <div className="space-y-1 relative">
                    <SettingsTabItem active={activeSettingsTab === 'Appearance'} onClick={() => setActiveSettingsTab('Appearance')} label="Appearance" />
                    <SettingsTabItem active={activeSettingsTab === 'Security'} onClick={() => setActiveSettingsTab('Security')} label="Security Defaults" />
                    <SettingsTabItem active={activeSettingsTab === 'General'} onClick={() => setActiveSettingsTab('General')} label="General" />
                  </div>
                </div>

                <div className="flex-1">
                  <AnimatePresence mode="wait">
                    {activeSettingsTab === 'Appearance' && (
                      <motion.div key="app" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}>
                        <div className="mb-8">
                          <h3 className="text-xl font-semibold mb-1">Appearance</h3>
                          <p className="text-sm text-base-muted">Customize the aesthetic of your workspace.</p>
                        </div>
                        <div className="space-y-4">
                          <label className="text-sm font-medium">Interface Theme</label>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <ThemeBox current={theme} target="theme-light" name="Light" onClick={setTheme} />
                            <ThemeBox current={theme} target="theme-dark" name="Dark" onClick={setTheme} />
                            <ThemeBox current={theme} target="theme-midnight" name="Midnight" onClick={setTheme} />
                            <ThemeBox current={theme} target="theme-cobalt" name="Cobalt" onClick={setTheme} />
                          </div>
                        </div>
                        <div className="h-px bg-base-border my-10" />
                        <div className="flex justify-between items-center">
                          <div>
                            <div className="text-sm font-medium">Compact Density</div>
                            <div className="text-xs text-base-muted mt-0.5">Reduce padding in tables to show more data.</div>
                          </div>
                          <ToggleSwitch defaultState={false} />
                        </div>
                      </motion.div>
                    )}

                    {activeSettingsTab === 'Security' && (
                       <motion.div key="sec" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}>
                        <div className="mb-8">
                          <h3 className="text-xl font-semibold mb-1">Security Defaults</h3>
                          <p className="text-sm text-base-muted">Global baseline policies applied before Cedar evaluation.</p>
                        </div>
                        <div className="space-y-6">
                          <div className="flex justify-between items-start">
                            <div className="pr-10">
                              <div className="text-sm font-medium">Strict SOC2 PII Redaction</div>
                              <div className="text-xs text-base-muted mt-1 leading-relaxed">Automatically redact SSNs, API Keys, and credit cards from LLM responses globally using the Presidio ML engine.</div>
                            </div>
                            <ToggleSwitch defaultState={true} />
                          </div>
                          <div className="h-px bg-base-border" />
                          <div className="flex justify-between items-start">
                            <div className="pr-10">
                              <div className="text-sm font-medium">Aggressive Sandbox Termination</div>
                              <div className="text-xs text-base-muted mt-1 leading-relaxed">Kill Firecracker microVMs immediately if unexpected outbound network requests are detected.</div>
                            </div>
                            <ToggleSwitch defaultState={true} />
                          </div>
                          <div className="h-px bg-base-border" />
                          <div className="flex justify-between items-start">
                            <div className="pr-10">
                              <div className="text-sm font-medium">Human-in-the-Loop Fallback</div>
                              <div className="text-xs text-base-muted mt-1 leading-relaxed">Suspend medium-risk tool calls and await manual administrator approval via Slack.</div>
                            </div>
                            <ToggleSwitch defaultState={false} />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}

            {/* Placeholder for others */}
            {activeTab !== 'Overview' && activeTab !== 'Settings' && (
              <motion.div key="empty" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col items-center justify-center h-[60vh] text-base-muted">
                <div className="w-16 h-16 bg-base-sec rounded-2xl flex items-center justify-center mb-6 border border-base-border shadow-sm">
                  <Command size={24} className="opacity-50" />
                </div>
                <h2 className="text-lg font-medium text-base-text">{activeTab} Module</h2>
                <p className="mt-2 text-sm text-center max-w-sm">This orchestrator module is initializing and synchronizing state with the Go Gateway.</p>
              </motion.div>
            )}

          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

// --- GOD-TIER COMPONENTS ---

function NavSection({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div>
      <div className="px-5 mb-1.5"><span className="text-[10px] font-semibold text-base-muted/80 uppercase tracking-widest">{title}</span></div>
      <nav className="space-y-0.5 px-2">{children}</nav>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <div onClick={onClick} className={`relative flex items-center gap-3 px-3 py-1.5 rounded-md cursor-pointer transition-colors group ${active ? 'text-base-text font-medium' : 'text-base-muted hover:text-base-text'}`}>
      {active && <motion.div layoutId="sidebarActive" className="absolute inset-0 bg-base-text/5 rounded-md border border-base-border/50" transition={{ type: "spring", stiffness: 300, damping: 30 }} />}
      <div className={`relative z-10 ${active ? 'text-base-text' : 'opacity-60 group-hover:opacity-100 transition-opacity'}`}>{icon}</div>
      <span className="text-[13px] relative z-10">{label}</span>
    </div>
  );
}

function SettingsTabItem({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) {
  return (
    <div onClick={onClick} className={`relative px-3 py-2 cursor-pointer text-sm transition-colors ${active ? 'text-base-text font-medium' : 'text-base-muted hover:text-base-text'}`}>
      {active && <motion.div layoutId="settingsActive" className="absolute left-0 top-0 bottom-0 w-0.5 bg-base-text rounded-r-full" transition={{ type: "spring", stiffness: 300, damping: 30 }} />}
      {label}
    </div>
  );
}

function AnimatedMetric({ title, value, suffix = '', trend, bad = false }: { title: string, value: number, suffix?: string, trend: number, bad?: boolean }) {
  // Ultra-simple mock counter animation (in real app, use framer-motion useSpring)
  const [count, setCount] = useState(0);
  useEffect(() => {
    const duration = 1000;
    const steps = 30;
    const stepTime = Math.abs(Math.floor(duration / steps));
    let current = 0;
    const timer = setInterval(() => {
      current += (value / steps);
      if (current >= value) { setCount(value); clearInterval(timer); }
      else { setCount(Math.floor(current)); }
    }, stepTime);
    return () => clearInterval(timer);
  }, [value]);

  const isUp = trend > 0;
  const isGood = bad ? !isUp : isUp;

  return (
    <div className="border border-base-border bg-base-card rounded-xl p-5 relative overflow-hidden group hover:border-base-muted/50 transition-colors shadow-sm">
      <div className="text-[13px] font-medium text-base-muted mb-3">{title}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight text-base-text">
          {count.toLocaleString()}{suffix}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-md bg-base-sec border border-base-border ${isGood ? 'text-green-500' : 'text-red-500'}`}>
          {isUp ? '+' : ''}{trend}%
        </span>
        <span className="text-xs text-base-muted">vs last hour</span>
      </div>
    </div>
  );
}

function ThemeBox({ current, target, name, onClick }: { current: string, target: string, name: string, onClick: (t:string) => void }) {
  const active = current === target;
  return (
    <div onClick={() => onClick(target)} className={`relative flex items-center justify-center h-20 rounded-xl cursor-pointer border transition-all duration-300 ${active ? 'border-base-text shadow-[0_0_0_1px_var(--text-main)]' : 'border-base-border hover:border-base-muted/50 bg-base-sec/30 hover:bg-base-sec'}`}>
      <span className={`text-sm font-medium ${active ? 'text-base-text' : 'text-base-muted'}`}>{name}</span>
      {active && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-base-text" />}
    </div>
  );
}

function CmdkItem({ icon, label, shortcut }: { icon: React.ReactNode, label: string, shortcut: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-base-sec cursor-pointer text-sm group transition-colors">
      <div className="flex items-center gap-3 text-base-muted group-hover:text-base-text transition-colors">
        {icon} <span>{label}</span>
      </div>
      <div className="flex gap-1 text-[10px] font-mono text-base-muted">
        {shortcut.split(' ').map(s => <span key={s} className="bg-base-card border border-base-border px-1.5 py-0.5 rounded shadow-sm">{s}</span>)}
      </div>
    </div>
  );
}

function ToggleSwitch({ defaultState }: { defaultState: boolean }) {
  const [isOn, setIsOn] = useState(defaultState);
  return (
    <button onClick={() => setIsOn(!isOn)} className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isOn ? 'bg-base-text' : 'bg-base-border'}`}>
      <span className={`pointer-events-none inline-block h-[18px] w-[18px] transform rounded-full shadow-sm ring-0 transition duration-200 ease-in-out bg-base-main ${isOn ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}
