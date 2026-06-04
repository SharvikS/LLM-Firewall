"use client";
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Shield, Activity, Settings, Users, Database, FileText, 
  Search, Bell, Plus, Check, ChevronRight, Server, AlertCircle
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, 
  ResponsiveContainer
} from 'recharts';

// --- Minimalist Data ---
const trafficData = Array.from({ length: 24 }).map((_, i) => ({
  time: `${i}:00`,
  requests: Math.floor(Math.random() * 5000) + 1000,
  blocked: Math.floor(Math.random() * 500) + 50,
}));

const incidentData = [
  { id: 'INC-9012', time: '18:22', type: 'Prompt Injection', target: 'Agent-Alpha', severity: 'Critical', action: 'Blocked' },
  { id: 'INC-9011', time: '18:19', type: 'PII Leakage', target: 'SupportBot-X', severity: 'High', action: 'Redacted' },
  { id: 'INC-9010', time: '18:15', type: 'Sandbox Escape', target: 'DevOps-Agent', severity: 'Critical', action: 'Terminated' },
  { id: 'INC-9009', time: '18:02', type: 'Rate Limit', target: 'Scraper-Agent', severity: 'Medium', action: 'Throttled' },
  { id: 'INC-9008', time: '17:55', type: 'Unauthorized File', target: 'Analysis-Bot', severity: 'High', action: 'Blocked' },
];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('Overview');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => { setIsLoaded(true); }, []);

  // Subtle, fast transition variants
  const fadeSlide = {
    initial: { opacity: 0, y: 5 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -5 },
    transition: { duration: 0.2, ease: "easeOut" }
  };

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-[#EDEDED] font-sans overflow-hidden antialiased selection:bg-white/20">
      
      {/* SIDEBAR: Minimalist & Flat */}
      <div className="w-64 border-r border-[#222222] bg-[#0A0A0A] flex flex-col relative z-20">
        
        {/* Brand */}
        <div className="h-14 px-6 flex items-center border-b border-[#222222]">
          <div className="w-5 h-5 bg-white rounded-sm flex items-center justify-center mr-3">
            <div className="w-2.5 h-2.5 bg-black rounded-sm"></div>
          </div>
          <span className="text-sm font-semibold tracking-tight">CyberFort TITAN</span>
        </div>
        
        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-6 flex flex-col gap-6">
          
          <div>
            <div className="px-6 mb-2">
              <span className="text-[11px] font-medium text-[#888888]">Platform</span>
            </div>
            <nav className="space-y-0.5 px-3">
              <NavItem active={activeTab === 'Overview'} onClick={() => setActiveTab('Overview')} icon={<Activity size={16}/>} label="Overview" />
              <NavItem active={activeTab === 'Events'} onClick={() => setActiveTab('Events')} icon={<AlertCircle size={16}/>} label="Security Events" />
              <NavItem active={activeTab === 'Policies'} onClick={() => setActiveTab('Policies')} icon={<FileText size={16}/>} label="Policies" />
            </nav>
          </div>

          <div>
            <div className="px-6 mb-2">
              <span className="text-[11px] font-medium text-[#888888]">Configuration</span>
            </div>
            <nav className="space-y-0.5 px-3">
              <NavItem active={activeTab === 'Settings'} onClick={() => setActiveTab('Settings')} icon={<Settings size={16}/>} label="Settings" />
              <NavItem active={activeTab === 'Team'} onClick={() => setActiveTab('Team')} icon={<Users size={16}/>} label="Team" />
            </nav>
          </div>

        </div>

        {/* User / Org Context */}
        <div className="h-16 px-6 border-t border-[#222222] flex items-center justify-between cursor-pointer hover:bg-[#111111] transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#333] to-[#555] flex items-center justify-center text-xs font-medium">
              SS
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium">Sharvik</span>
              <span className="text-xs text-[#888888]">Enterprise Org</span>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex flex-col bg-[#0A0A0A]">
        
        {/* Header */}
        <header className="h-14 border-b border-[#222222] flex items-center justify-between px-8 bg-[#0A0A0A] z-10 sticky top-0">
          <div className="flex items-center text-sm font-medium text-[#888888]">
            <span>Acme Corp</span>
            <ChevronRight size={14} className="mx-2 text-[#444]" />
            <span className="text-[#EDEDED]">{activeTab}</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative group">
              <Search className="w-4 h-4 text-[#666] absolute left-3 top-1/2 transform -translate-y-1/2 group-focus-within:text-[#EDEDED] transition-colors" />
              <input 
                type="text" 
                placeholder="Search..." 
                className="bg-[#111] border border-[#333] rounded-md py-1.5 pl-9 pr-4 text-xs w-64 focus:outline-none focus:border-[#666] focus:bg-[#1A1A1A] transition-all text-[#EDEDED] placeholder-[#666]"
              />
            </div>
            <button className="text-[#888888] hover:text-[#EDEDED] transition-colors">
              <Bell size={18} />
            </button>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-8 scrollbar-hide">
          <AnimatePresence mode="wait">
            
            {/* --- OVERVIEW TAB --- */}
            {activeTab === 'Overview' && (
              <motion.div key="overview" {...fadeSlide} className="max-w-7xl mx-auto space-y-8">
                
                {/* Header Actions */}
                <div className="flex justify-between items-end">
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
                    <p className="text-sm text-[#888888] mt-1">Monitor real-time infrastructure and security posture.</p>
                  </div>
                  <div className="flex gap-3">
                    <button className="px-3 py-1.5 bg-[#111] border border-[#333] hover:bg-[#1A1A1A] rounded-md text-sm transition-colors">
                      Export Report
                    </button>
                    <button className="px-3 py-1.5 bg-white text-black hover:bg-gray-200 rounded-md text-sm font-medium transition-colors">
                      Deploy Ruleset
                    </button>
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <MetricCard title="Total Requests" value="1.8M" change="+8.2%" />
                  <MetricCard title="Threats Blocked" value="24.8K" change="+12.5%" trend="up" />
                  <MetricCard title="Active Sandboxes" value="1,402" change="+3.1%" />
                  <MetricCard title="P99 Latency" value="14ms" change="-2ms" trend="down" />
                </div>

                {/* Chart Section */}
                <div className="border border-[#222] bg-[#0A0A0A] rounded-xl p-6">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-sm font-medium">Traffic vs Interceptions</h3>
                    <select className="bg-[#111] border border-[#333] text-xs text-[#EDEDED] rounded-md px-2 py-1 outline-none focus:border-[#666]">
                      <option>Last 24 Hours</option>
                      <option>Last 7 Days</option>
                      <option>Last 30 Days</option>
                    </select>
                  </div>
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trafficData} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorReq" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ffffff" stopOpacity={0.1}/>
                            <stop offset="95%" stopColor="#ffffff" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                        <XAxis dataKey="time" stroke="#666" fontSize={11} tickLine={false} axisLine={false} dy={10} />
                        <YAxis stroke="#666" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(val) => `${val/1000}k`} />
                        <RechartsTooltip 
                          contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '8px', fontSize: '12px' }}
                          itemStyle={{ color: '#fff' }} cursor={{ stroke: '#444', strokeWidth: 1, strokeDasharray: '4 4' }}
                        />
                        <Area type="monotone" dataKey="requests" name="Total Traffic" stroke="#fff" strokeWidth={1.5} fillOpacity={1} fill="url(#colorReq)" />
                        <Area type="monotone" dataKey="blocked" name="Blocked" stroke="#666" strokeWidth={1.5} fill="transparent" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Recent Events Table */}
                <div className="border border-[#222] bg-[#0A0A0A] rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-[#222] flex justify-between items-center bg-[#111]/50">
                    <h3 className="text-sm font-medium">Recent Security Events</h3>
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#0A0A0A] text-[#888888]">
                      <tr>
                        <th className="px-5 py-3 font-medium border-b border-[#222]">Time</th>
                        <th className="px-5 py-3 font-medium border-b border-[#222]">Event Type</th>
                        <th className="px-5 py-3 font-medium border-b border-[#222]">Target Agent</th>
                        <th className="px-5 py-3 font-medium border-b border-[#222]">Severity</th>
                        <th className="px-5 py-3 font-medium border-b border-[#222] text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#222]">
                      {incidentData.map((inc) => (
                        <tr key={inc.id} className="hover:bg-[#111] transition-colors">
                          <td className="px-5 py-3 text-[#888888]">{inc.time}</td>
                          <td className="px-5 py-3 text-[#EDEDED]">{inc.type}</td>
                          <td className="px-5 py-3 text-[#888888]">{inc.target}</td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex items-center gap-1.5 ${inc.severity === 'Critical' ? 'text-red-400' : inc.severity === 'High' ? 'text-orange-400' : 'text-yellow-400'}`}>
                              <div className={`w-1.5 h-1.5 rounded-full ${inc.severity === 'Critical' ? 'bg-red-400' : inc.severity === 'High' ? 'bg-orange-400' : 'bg-yellow-400'}`} />
                              {inc.severity}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-[#EDEDED] text-right">{inc.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {/* --- SETTINGS TAB (Practical & Minimal) --- */}
            {activeTab === 'Settings' && (
              <motion.div key="settings" {...fadeSlide} className="max-w-5xl mx-auto flex flex-col md:flex-row gap-10">
                
                {/* Settings Sidebar */}
                <div className="w-48 shrink-0 space-y-1">
                  <div className="px-3 py-2 text-sm font-medium bg-[#111] rounded-md cursor-pointer">General</div>
                  <div className="px-3 py-2 text-sm text-[#888888] hover:text-[#EDEDED] rounded-md cursor-pointer transition-colors">Security</div>
                  <div className="px-3 py-2 text-sm text-[#888888] hover:text-[#EDEDED] rounded-md cursor-pointer transition-colors">Billing</div>
                  <div className="px-3 py-2 text-sm text-[#888888] hover:text-[#EDEDED] rounded-md cursor-pointer transition-colors">API Keys</div>
                </div>

                {/* Settings Content */}
                <div className="flex-1 space-y-8">
                  
                  <section>
                    <h2 className="text-xl font-semibold mb-1">Project Settings</h2>
                    <p className="text-sm text-[#888888] mb-6">Manage your core platform configurations.</p>
                    
                    <div className="space-y-6 max-w-2xl">
                      <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-[#EDEDED]">Project Name</label>
                        <input type="text" defaultValue="Acme Production" className="bg-[#111] border border-[#333] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#666] transition-colors" />
                      </div>
                      
                      <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-[#EDEDED]">Data Retention (ClickHouse)</label>
                        <select className="bg-[#111] border border-[#333] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#666] transition-colors">
                          <option>30 Days</option>
                          <option>90 Days (SOC2 Default)</option>
                          <option>365 Days</option>
                        </select>
                        <p className="text-xs text-[#888888]">Audit logs older than the retention period will be permanently deleted.</p>
                      </div>
                    </div>
                  </section>

                  <div className="h-px bg-[#222] my-8" />

                  <section>
                    <h2 className="text-xl font-semibold mb-1">Security Defaults</h2>
                    <p className="text-sm text-[#888888] mb-6">Global security behaviors for all connected agent runtimes.</p>
                    
                    <div className="border border-[#222] rounded-xl divide-y divide-[#222] max-w-2xl bg-[#0A0A0A]">
                      <ToggleSetting 
                        title="Strict PII Redaction" 
                        description="Automatically scrub SSNs, Credit Cards, and API keys from outbound LLM responses." 
                        defaultState={true} 
                      />
                      <ToggleSetting 
                        title="Aggressive Sandbox Termination" 
                        description="Kill microVMs immediately if unexpected outbound network requests are detected." 
                        defaultState={true} 
                      />
                      <ToggleSetting 
                        title="Human-in-the-Loop Fallback" 
                        description="Suspend medium-risk tool calls and await manual Slack approval." 
                        defaultState={false} 
                      />
                    </div>
                  </section>

                  <div className="mt-8">
                    <button className="bg-white text-black px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors">
                      Save Changes
                    </button>
                  </div>

                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

// --- Minimalist Components ---

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-1.5 rounded-md cursor-pointer transition-colors ${
        active ? 'bg-[#1A1A1A] text-[#EDEDED]' : 'text-[#888888] hover:text-[#EDEDED] hover:bg-[#111]'
      }`}
    >
      <div className={`${active ? 'text-[#EDEDED]' : 'text-[#666]'}`}>{icon}</div>
      <span className="text-sm">{label}</span>
    </div>
  );
}

function MetricCard({ title, value, change, trend }: { title: string, value: string, change: string, trend?: 'up'|'down' }) {
  return (
    <div className="border border-[#222] bg-[#0A0A0A] rounded-xl p-5 hover:border-[#333] transition-colors">
      <h3 className="text-sm text-[#888888] mb-1">{title}</h3>
      <div className="flex items-baseline gap-2 mt-2">
        <span className="text-3xl font-semibold tracking-tight">{value}</span>
        <span className={`text-xs font-medium ${trend === 'up' ? 'text-red-400' : trend === 'down' ? 'text-green-400' : 'text-[#888888]'}`}>
          {change}
        </span>
      </div>
    </div>
  );
}

function ToggleSetting({ title, description, defaultState }: { title: string, description: string, defaultState: boolean }) {
  const [isOn, setIsOn] = useState(defaultState);
  return (
    <div className="flex items-start justify-between p-5">
      <div className="pr-8">
        <div className="text-sm font-medium text-[#EDEDED] mb-1">{title}</div>
        <div className="text-sm text-[#888888] leading-relaxed">{description}</div>
      </div>
      <button 
        onClick={() => setIsOn(!isOn)} 
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isOn ? 'bg-white' : 'bg-[#333]'}`}
      >
        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full shadow ring-0 transition duration-200 ease-in-out ${isOn ? 'translate-x-4 bg-black' : 'translate-x-0 bg-[#888]'}`} />
      </button>
    </div>
  );
}
