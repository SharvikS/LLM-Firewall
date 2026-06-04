"use client";
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Shield, Activity, Lock, AlertTriangle, Zap, Server, Search, 
  Settings, Users, Database, Globe, Network, Cpu, FileText, 
  ToggleLeft, ToggleRight, MoreVertical, CheckCircle2, XCircle
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, 
  ResponsiveContainer, BarChart, Bar, Legend
} from 'recharts';

// --- Mock Data ---
const trafficData = Array.from({ length: 24 }).map((_, i) => ({
  time: `${i}:00`,
  requests: Math.floor(Math.random() * 5000) + 1000,
  blocked: Math.floor(Math.random() * 500) + 50,
}));

const incidentData = [
  { id: 'INC-9012', time: '18:22:10', tenant: 'Tenant-A', type: 'Prompt Injection (DAN)', severity: 'Critical', status: 'Blocked', agent: 'Agent-Alpha' },
  { id: 'INC-9011', time: '18:19:05', tenant: 'Tenant-B', type: 'PII Leakage (SSN)', severity: 'High', status: 'Redacted', agent: 'SupportBot-X' },
  { id: 'INC-9010', time: '18:15:44', tenant: 'Tenant-C', type: 'Sandbox Escape Attempt', severity: 'Critical', status: 'Terminated', agent: 'DevOps-Agent' },
  { id: 'INC-9009', time: '18:02:11', tenant: 'Tenant-A', type: 'Rate Limit Exceeded', severity: 'Medium', status: 'Throttled', agent: 'Scraper-Agent' },
  { id: 'INC-9008', time: '17:55:00', tenant: 'Tenant-B', type: 'Unauthorized File Access', severity: 'High', status: 'Blocked', agent: 'Analysis-Bot' },
];

const policyData = [
  { id: 'POL-001', name: 'Global Jailbreak Protection', engine: 'ASR Heuristics', mode: 'Enforcing', hits: '1.2M' },
  { id: 'POL-002', name: 'SOC2 PII Redaction', engine: 'Presidio ML', mode: 'Enforcing', hits: '450K' },
  { id: 'POL-003', name: 'Strict File System Isolation', engine: 'Cedar ABAC', mode: 'Enforcing', hits: '89K' },
  { id: 'POL-004', name: 'Experimental API Throttling', engine: 'Gateway Go', mode: 'Audit Only', hits: '12K' },
];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('Command Center');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => { setIsLoaded(true); }, []);

  return (
    <div className="flex h-screen bg-[#070709] text-gray-200 font-sans overflow-hidden text-sm selection:bg-blue-500/30">
      
      {/* SIDEBAR */}
      <motion.div 
        initial={{ x: -300 }} animate={{ x: 0 }} transition={{ type: "spring", stiffness: 100, damping: 20 }}
        className="w-64 border-r border-white/10 bg-[#0a0a0c] flex flex-col relative z-20 shadow-2xl"
      >
        {/* Logo Area */}
        <div className="p-5 border-b border-white/5 flex items-center space-x-3">
          <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-cyan-400 p-0.5 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
            <div className="absolute inset-0 bg-black/50 rounded-lg"></div>
            <Shield className="w-4 h-4 text-cyan-300 relative z-10" />
          </div>
          <div>
            <span className="text-lg font-bold tracking-tight text-white leading-none block">TITAN OS</span>
            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Enterprise Edition</span>
          </div>
        </div>
        
        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4 scrollbar-hide">
          <div className="px-3 mb-2">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider ml-2">Platform</span>
          </div>
          <nav className="space-y-1 px-2">
            <NavItem active={activeTab === 'Command Center'} onClick={() => setActiveTab('Command Center')} icon={<Activity />} label="Command Center" />
            <NavItem active={activeTab === 'Policies'} onClick={() => setActiveTab('Policies')} icon={<FileText />} label="Policy Engine" />
            <NavItem active={activeTab === 'Threats'} onClick={() => setActiveTab('Threats')} icon={<AlertTriangle />} label="Threat Intel" />
            <NavItem active={activeTab === 'Agents'} onClick={() => setActiveTab('Agents')} icon={<Cpu />} label="Agent Runtimes" />
          </nav>

          <div className="px-3 mt-8 mb-2">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider ml-2">Administration</span>
          </div>
          <nav className="space-y-1 px-2">
            <NavItem active={activeTab === 'Settings'} onClick={() => setActiveTab('Settings')} icon={<Settings />} label="System Settings" />
            <NavItem active={activeTab === 'Tenants'} onClick={() => setActiveTab('Tenants')} icon={<Users />} label="Tenant Management" />
            <NavItem active={activeTab === 'Infra'} onClick={() => setActiveTab('Infra')} icon={<Database />} label="Data Infrastructure" />
          </nav>
        </div>
        
        {/* System Status */}
        <div className="p-4 border-t border-white/5 bg-white/[0.02]">
           <div className="flex items-center justify-between mb-2">
             <span className="text-xs text-gray-400">Cluster Status</span>
             <div className="flex items-center space-x-1.5">
                <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]"></div>
                <span className="text-xs font-mono text-green-400">HEALTHY</span>
             </div>
           </div>
           <div className="space-y-1">
             <div className="flex justify-between text-[11px] text-gray-500 font-mono"><span>Redpanda</span><span>0ms lag</span></div>
             <div className="flex justify-between text-[11px] text-gray-500 font-mono"><span>CockroachDB</span><span>Syncing</span></div>
           </div>
        </div>
      </motion.div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col relative bg-[#070709]">
        {/* Top Header */}
        <header className="h-14 border-b border-white/5 flex items-center justify-between px-6 bg-[#0a0a0c] z-10 sticky top-0">
          <div className="flex items-center space-x-4">
            <h1 className="text-lg font-semibold text-white">{activeTab}</h1>
            {activeTab === 'Command Center' && (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">LIVE DATA</span>
            )}
          </div>
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 transform -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Search resources, IP addresses, logs..." 
                className="bg-black/50 border border-white/10 rounded-md py-1.5 pl-9 pr-4 text-xs w-72 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-white placeholder-gray-600"
              />
            </div>
            <div className="w-8 h-8 rounded-md bg-gradient-to-tr from-purple-600 to-blue-600 flex items-center justify-center cursor-pointer shadow-lg text-white font-bold text-xs">
              AD
            </div>
          </div>
        </header>

        {/* Scrollable Canvas */}
        <main className="flex-1 overflow-y-auto p-6 scrollbar-hide">
          <AnimatePresence mode="wait">
            
            {/* --- COMMAND CENTER TAB --- */}
            {activeTab === 'Command Center' && (
              <motion.div key="cmd" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
                
                {/* Metrics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <CompactMetric title="Total Requests (24h)" value="1,842,901" trend="+8.2%" color="blue" />
                  <CompactMetric title="Threats Intercepted" value="24,892" trend="+12.5%" color="red" />
                  <CompactMetric title="Active Agents" value="1,402" trend="+3.1%" color="purple" />
                  <CompactMetric title="Avg Latency Penalty" value="14ms" trend="-2ms" color="green" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column: Chart (Takes 2 columns) */}
                  <div className="lg:col-span-2 bg-[#0d0d12] border border-white/5 rounded-xl p-5 shadow-sm">
                    <div className="flex justify-between items-center mb-4">
                      <div>
                        <h3 className="text-white font-medium">Traffic & Threat Volume</h3>
                        <p className="text-xs text-gray-500">Global requests vs blocked payloads over 24 hours.</p>
                      </div>
                      <select className="bg-black border border-white/10 text-xs text-gray-300 rounded px-2 py-1 outline-none">
                        <option>Last 24 Hours</option>
                        <option>Last 7 Days</option>
                      </select>
                    </div>
                    <div className="h-72 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trafficData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorReq" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="colorBlk" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                          <XAxis dataKey="time" stroke="#ffffff40" fontSize={10} tickLine={false} axisLine={false} />
                          <YAxis stroke="#ffffff40" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `${val/1000}k`} />
                          <RechartsTooltip 
                            contentStyle={{ backgroundColor: '#0a0a0c', borderColor: '#ffffff20', fontSize: '12px' }}
                            itemStyle={{ color: '#fff' }}
                          />
                          <Area type="monotone" dataKey="requests" name="Total Requests" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorReq)" />
                          <Area type="monotone" dataKey="blocked" name="Blocked Threats" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorBlk)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Right Column: System Health */}
                  <div className="bg-[#0d0d12] border border-white/5 rounded-xl p-5 shadow-sm flex flex-col">
                    <h3 className="text-white font-medium mb-1">Infrastructure Health</h3>
                    <p className="text-xs text-gray-500 mb-6">Real-time resource utilization across global clusters.</p>
                    
                    <div className="space-y-5 flex-1">
                      <HealthBar label="Go Gateway CPU" value={42} color="bg-blue-500" />
                      <HealthBar label="Python ASR Memory" value={78} color="bg-orange-500" />
                      <HealthBar label="Redpanda IO Queue" value={12} color="bg-green-500" />
                      <HealthBar label="CockroachDB Sync Latency" value={5} color="bg-green-500" />
                    </div>
                    
                    <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
                      <span className="text-xs text-gray-400">Autoscaler Status</span>
                      <span className="text-xs font-mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">STANDBY</span>
                    </div>
                  </div>
                </div>

                {/* Data Table: Recent Incidents */}
                <div className="bg-[#0d0d12] border border-white/5 rounded-xl shadow-sm overflow-hidden">
                  <div className="p-4 border-b border-white/5 flex justify-between items-center bg-black/20">
                    <h3 className="text-white font-medium">Real-Time Threat Log</h3>
                    <button className="text-xs text-blue-400 hover:text-blue-300">View All Logs &rarr;</button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-black/40 text-gray-400 font-medium">
                        <tr>
                          <th className="px-4 py-3">Incident ID</th>
                          <th className="px-4 py-3">Time</th>
                          <th className="px-4 py-3">Tenant</th>
                          <th className="px-4 py-3">Attack Type / Trigger</th>
                          <th className="px-4 py-3">Agent ID</th>
                          <th className="px-4 py-3">Severity</th>
                          <th className="px-4 py-3">Action Taken</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {incidentData.map((inc) => (
                          <tr key={inc.id} className="hover:bg-white/[0.02] transition-colors group">
                            <td className="px-4 py-3 font-mono text-gray-300">{inc.id}</td>
                            <td className="px-4 py-3 text-gray-500">{inc.time}</td>
                            <td className="px-4 py-3 text-gray-300">{inc.tenant}</td>
                            <td className="px-4 py-3 text-white font-medium">{inc.type}</td>
                            <td className="px-4 py-3 text-gray-400">{inc.agent}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                                inc.severity === 'Critical' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 
                                inc.severity === 'High' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' : 
                                'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                              }`}>{inc.severity}</span>
                            </td>
                            <td className="px-4 py-3 text-gray-300 flex items-center space-x-1.5">
                              {inc.status === 'Blocked' || inc.status === 'Terminated' ? <XCircle className="w-3.5 h-3.5 text-red-400" /> : <CheckCircle2 className="w-3.5 h-3.5 text-orange-400" />}
                              <span>{inc.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {/* --- SETTINGS / ADMIN TAB --- */}
            {activeTab === 'Settings' && (
              <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-white mb-1">System Administration</h2>
                  <p className="text-gray-400 text-sm">Configure global platform behavior, compliance modes, and routing parameters.</p>
                </div>

                <div className="bg-[#0d0d12] border border-white/5 rounded-xl overflow-hidden">
                  <div className="p-4 border-b border-white/5 bg-black/20"><h3 className="font-medium text-white">Security & Compliance</h3></div>
                  <div className="divide-y divide-white/5">
                    <SettingToggle title="SOC2 Strict Data Redaction" desc="Automatically redact PII (SSN, Emails) from all LLM outputs globally." defaultOn={true} />
                    <SettingToggle title="Auto-Kill Sandboxes" desc="Immediately terminate Firecracker microVMs if CPU spikes > 90% for 5s." defaultOn={true} />
                    <SettingToggle title="Human-in-the-Loop (HITL) Fallback" desc="Pause medium-risk agent executions and alert Slack for manual admin approval." defaultOn={false} />
                  </div>
                </div>

                <div className="bg-[#0d0d12] border border-white/5 rounded-xl overflow-hidden">
                  <div className="p-4 border-b border-white/5 bg-black/20"><h3 className="font-medium text-white">Data Infrastructure</h3></div>
                  <div className="p-5 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Audit Log Retention (ClickHouse)</label>
                      <select className="w-full bg-black border border-white/10 rounded-md p-2 text-sm text-white focus:outline-none focus:border-blue-500">
                        <option>30 Days</option>
                        <option>90 Days (Compliance Minimum)</option>
                        <option>1 Year</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Redpanda Event Batching Mode</label>
                      <select className="w-full bg-black border border-white/10 rounded-md p-2 text-sm text-white focus:outline-none focus:border-blue-500">
                        <option>Low Latency (Sub 5ms)</option>
                        <option>High Throughput (Batched 50ms)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* --- POLICIES TAB --- */}
            {activeTab === 'Policies' && (
              <motion.div key="policies" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                 <div className="flex justify-between items-end">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-1">Policy Engine (AWS Cedar)</h2>
                    <p className="text-gray-400 text-sm">Manage global ABAC rules, firewall engines, and heuristic filters.</p>
                  </div>
                  <button className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
                    + Create New Policy
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {policyData.map(pol => (
                    <div key={pol.id} className="bg-[#0d0d12] border border-white/5 p-4 rounded-xl shadow-sm hover:border-white/10 transition-colors">
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-[10px] font-mono bg-white/5 text-gray-400 px-1.5 py-0.5 rounded">{pol.id}</span>
                        <ToggleLeft className={`w-5 h-5 ${pol.mode === 'Enforcing' ? 'text-blue-500' : 'text-gray-600'}`} />
                      </div>
                      <h4 className="text-sm font-semibold text-white mb-1">{pol.name}</h4>
                      <p className="text-xs text-gray-500 mb-4">Engine: {pol.engine}</p>
                      <div className="flex justify-between items-center text-xs border-t border-white/5 pt-3">
                        <span className={pol.mode === 'Enforcing' ? 'text-green-400' : 'text-yellow-400'}>{pol.mode}</span>
                        <span className="text-gray-400 font-mono">{pol.hits} hits</span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

// --- Reusable Components ---

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className={`relative flex items-center space-x-3 px-3 py-2 rounded-md cursor-pointer transition-colors group ${
        active ? 'text-white bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/[0.02]'
      }`}
    >
      {active && <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-blue-500 rounded-r-md shadow-[0_0_8px_rgba(59,130,246,0.8)]"></div>}
      <div className={`w-4 h-4 ${active ? 'text-blue-400' : 'group-hover:text-gray-300'}`}>{icon}</div>
      <span className="font-medium text-sm">{label}</span>
    </div>
  );
}

function CompactMetric({ title, value, trend, color }: { title: string, value: string, trend: string, color: 'blue'|'red'|'purple'|'green' }) {
  const colorMap = {
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    red: 'text-red-400 bg-red-500/10 border-red-500/20',
    purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    green: 'text-green-400 bg-green-500/10 border-green-500/20',
  };
  return (
    <div className="bg-[#0d0d12] border border-white/5 rounded-xl p-4 shadow-sm flex flex-col justify-between hover:bg-white/[0.02] transition-colors">
      <h3 className="text-gray-500 text-xs font-medium mb-2">{title}</h3>
      <div className="flex items-end justify-between">
        <span className="text-2xl font-bold text-white tracking-tight">{value}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${colorMap[color]}`}>{trend}</span>
      </div>
    </div>
  );
}

function HealthBar({ label, value, color }: { label: string, value: number, color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-mono">{value}%</span>
      </div>
      <div className="w-full bg-black rounded-full h-1.5 border border-white/5 overflow-hidden">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${value}%` }}></div>
      </div>
    </div>
  );
}

function SettingToggle({ title, desc, defaultOn }: { title: string, desc: string, defaultOn: boolean }) {
  const [isOn, setIsOn] = useState(defaultOn);
  return (
    <div className="flex items-center justify-between p-5 hover:bg-white/[0.01] transition-colors">
      <div>
        <h4 className="text-sm font-medium text-white mb-0.5">{title}</h4>
        <p className="text-xs text-gray-500">{desc}</p>
      </div>
      <button onClick={() => setIsOn(!isOn)} className="focus:outline-none">
        {isOn ? (
          <ToggleRight className="w-8 h-8 text-blue-500" />
        ) : (
          <ToggleLeft className="w-8 h-8 text-gray-600" />
        )}
      </button>
    </div>
  );
}
