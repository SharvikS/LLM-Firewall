"use client";
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Activity, Lock, AlertTriangle, Zap, Server, Search, ChevronRight, XCircle, CheckCircle, Cpu } from 'lucide-react';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(true);
  }, []);

  return (
    <div className="flex h-screen bg-[#050505] text-white font-sans overflow-hidden selection:bg-blue-500/30">
      
      {/* Sidebar (Glassmorphic) */}
      <motion.div 
        initial={{ x: -300 }} 
        animate={{ x: 0 }} 
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
        className="w-64 border-r border-white/5 bg-black/40 backdrop-blur-xl flex flex-col relative z-20"
      >
        <div className="p-6 flex items-center space-x-3 group cursor-pointer">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-400 p-0.5 shadow-[0_0_20px_rgba(59,130,246,0.5)] group-hover:shadow-[0_0_30px_rgba(59,130,246,0.8)] transition-all duration-300">
            <div className="absolute inset-0 bg-black/50 rounded-xl"></div>
            <Shield className="w-5 h-5 text-cyan-300 relative z-10" />
          </div>
          <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400 group-hover:to-white transition-all">TITAN OS</span>
        </div>
        
        <nav className="flex-1 px-4 space-y-2 mt-8">
          <NavItem active={activeTab === 'Dashboard'} onClick={() => setActiveTab('Dashboard')} icon={<Activity />} label="Command Center" />
          <NavItem active={activeTab === 'Threats'} onClick={() => setActiveTab('Threats')} icon={<AlertTriangle />} label="Threat Intelligence" />
          <NavItem active={activeTab === 'API'} onClick={() => setActiveTab('API')} icon={<Zap />} label="API Activity" />
          <NavItem active={activeTab === 'Agents'} onClick={() => setActiveTab('Agents')} icon={<Cpu />} label="Agent Security" />
        </nav>
        
        <div className="p-6 border-t border-white/5">
           <div className="flex items-center space-x-3">
             <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.8)]"></div>
             <span className="text-xs font-medium text-gray-400 tracking-wider">ALL SYSTEMS ONLINE</span>
           </div>
        </div>
      </motion.div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-y-auto relative">
        {/* Background ambient glows */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-900/20 blur-[120px] pointer-events-none"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-cyan-900/10 blur-[120px] pointer-events-none"></div>

        <header className="h-20 border-b border-white/5 flex items-center justify-between px-10 bg-black/20 backdrop-blur-md sticky top-0 z-10">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h1 className="text-2xl font-bold tracking-tight text-white/90">{activeTab}</h1>
            <p className="text-xs text-gray-400 font-mono mt-1 flex items-center">
              THREATCON LEVEL: <span className="text-yellow-400 ml-2 drop-shadow-[0_0_5px_rgba(250,204,21,0.8)] animate-pulse">ELEVATED</span>
            </p>
          </motion.div>
          
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-3 bg-white/5 border border-white/10 px-4 py-2 rounded-full hover:bg-white/10 transition-colors focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
              <Search className="w-4 h-4 text-gray-400" />
              <input type="text" placeholder="Search global logs..." className="bg-transparent border-none focus:outline-none text-sm w-64 text-white placeholder-gray-500" />
            </div>
            
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-purple-500 to-blue-500 flex items-center justify-center cursor-pointer shadow-lg hover:shadow-blue-500/25 transition-all">
              <span className="font-bold text-sm">AD</span>
            </div>
          </div>
        </header>

        <main className="p-10 space-y-8 relative z-10">
          <AnimatePresence mode="wait">
            {activeTab === 'Dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                {/* Metric Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <MetricCard title="Total Threats Blocked" value="24,892" trend="+12.5%" color="from-red-500/20 to-red-900/20" textColor="text-red-400" delay={0.1} />
                  <MetricCard title="API Requests Processed" value="1.84M" trend="+8.1%" color="from-blue-500/20 to-blue-900/20" textColor="text-blue-400" delay={0.2} />
                  <MetricCard title="Agent Sandbox Executions" value="3,104" trend="-2.4%" color="from-purple-500/20 to-purple-900/20" textColor="text-purple-400" delay={0.3} />
                </div>

                {/* Live Charts & Incidents */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  {/* Animated Live Traffic */}
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.4 }}
                    className="bg-black/40 border border-white/5 rounded-2xl p-6 h-96 flex flex-col relative overflow-hidden group"
                  >
                    <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                    <div className="flex justify-between items-center mb-6 relative z-10">
                      <h3 className="text-lg font-semibold text-white/80">Live Global Traffic</h3>
                      <div className="flex items-center space-x-2 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping"></div>
                        <span className="text-xs text-blue-400 font-medium">STREAMING</span>
                      </div>
                    </div>
                    <LiveTrafficChart />
                  </motion.div>
                  
                  {/* Animated Incident Log */}
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.5 }}
                    className="bg-black/40 border border-white/5 rounded-2xl p-6 h-96 flex flex-col relative"
                  >
                    <h3 className="text-lg font-semibold text-white/80 mb-6">Real-Time Threat Interceptions</h3>
                    <div className="flex-1 overflow-y-auto pr-2 space-y-3 scrollbar-hide">
                      <IncidentRow time="18:12:44" type="Prompt Injection" agent="Agent-Alpha" severity="Critical" action="Blocked" />
                      <IncidentRow time="18:11:02" type="Sandbox Escape (rm -rf)" agent="Dev-Agent-1" severity="Critical" action="Killed" />
                      <IncidentRow time="18:05:33" type="PII Leakage (SSN)" agent="Support-Bot" severity="High" action="Redacted" />
                      <IncidentRow time="17:59:12" type="Unauthorized AWS S3" agent="Data-Agent" severity="High" action="Blocked" />
                      <IncidentRow time="17:42:05" type="Malicious URL payload" agent="Web-Scraper" severity="Medium" action="Blocked" />
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            )}

            {activeTab === 'Threats' && (
              <motion.div 
                key="threats"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="flex items-center justify-center h-[60vh] flex-col space-y-4"
              >
                <div className="w-24 h-24 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/30 shadow-[0_0_50px_rgba(239,68,68,0.2)]">
                  <AlertTriangle className="w-10 h-10 text-red-500" />
                </div>
                <h2 className="text-2xl font-bold text-white/90">Threat Intelligence Module</h2>
                <p className="text-gray-400 text-center max-w-md">Detailed forensic analysis and vector embeddings poisoning detection algorithms are active.</p>
              </motion.div>
            )}
            
             {activeTab === 'API' && (
              <motion.div 
                key="api"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="bg-black/40 border border-white/5 rounded-2xl p-8"
              >
                <h2 className="text-xl font-bold mb-6 flex items-center"><Zap className="w-5 h-5 mr-3 text-yellow-400"/> API Edge Routing</h2>
                <div className="space-y-4 font-mono text-sm">
                  <div className="p-4 bg-white/5 rounded-lg border border-white/10 hover:border-white/20 transition-colors cursor-pointer flex justify-between">
                    <span className="text-green-400">GET /v1/models</span>
                    <span className="text-gray-500">12ms • Route: Groq</span>
                  </div>
                  <div className="p-4 bg-white/5 rounded-lg border border-white/10 hover:border-white/20 transition-colors cursor-pointer flex justify-between">
                    <span className="text-blue-400">POST /v1/chat/completions</span>
                    <span className="text-gray-500">145ms • Route: OpenAI</span>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'Agents' && (
              <motion.div 
                key="agents"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="grid grid-cols-1 lg:grid-cols-2 gap-6"
              >
                <div className="bg-gradient-to-br from-black/60 to-purple-900/10 border border-purple-500/20 rounded-2xl p-8 hover:border-purple-500/50 transition-colors">
                  <h3 className="text-xl font-bold text-purple-400 mb-2">Agent Security Runtime (ASR)</h3>
                  <p className="text-gray-400 text-sm mb-6">MicroVM sandbox isolated executions protecting host kernels.</p>
                  <div className="h-40 flex items-center justify-center">
                    <div className="relative">
                      <div className="absolute inset-0 bg-purple-500/20 blur-xl rounded-full animate-pulse"></div>
                      <Cpu className="w-16 h-16 text-purple-400 relative z-10" />
                    </div>
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

// --- Components ---

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className={`relative flex items-center space-x-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-300 group overflow-hidden ${
        active ? 'text-white' : 'text-gray-400 hover:text-white'
      }`}
    >
      {active && (
        <motion.div 
          layoutId="activeTabIndicator" 
          className="absolute inset-0 bg-white/10 border border-white/10 rounded-xl"
          initial={false}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />
      )}
      
      {/* Glow effect on hover */}
      <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-blue-500/0 to-transparent opacity-0 group-hover:opacity-10 group-hover:via-blue-500/10 transition-opacity"></div>
      
      <div className={`relative z-10 w-5 h-5 transition-transform duration-300 ${active ? 'scale-110 text-blue-400' : 'group-hover:scale-110'}`}>
        {icon}
      </div>
      <span className="relative z-10 font-medium text-sm">{label}</span>
    </div>
  );
}

function MetricCard({ title, value, trend, color, textColor, delay }: { title: string, value: string, trend: string, color: string, textColor: string, delay: number }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      whileHover={{ y: -5, scale: 1.02 }}
      className={`bg-gradient-to-br ${color} border border-white/5 rounded-2xl p-6 relative overflow-hidden backdrop-blur-sm shadow-xl`}
    >
      {/* Decorative gradient orb */}
      <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/5 rounded-full blur-2xl"></div>
      
      <h3 className="text-gray-400 font-medium text-sm mb-4">{title}</h3>
      <div className="flex items-end justify-between">
        <span className="text-4xl font-bold tracking-tight text-white">{value}</span>
        <div className={`flex items-center space-x-1 bg-black/40 px-2 py-1 rounded-md border border-white/5 ${textColor}`}>
          <span className="text-xs font-bold">{trend}</span>
        </div>
      </div>
    </motion.div>
  );
}

function LiveTrafficChart() {
  // Generate smooth random bars that constantly update
  const [bars, setBars] = useState<number[]>(Array(30).fill(50));
  
  useEffect(() => {
    const interval = setInterval(() => {
      setBars(prev => {
        const newBars = [...prev.slice(1)];
        // Create an organic wave-like pattern combined with randomness
        const base = Math.sin(Date.now() / 1000) * 20 + 40; 
        const variance = Math.random() * 40;
        newBars.push(base + variance);
        return newBars;
      });
    }, 500); // 500ms update rate for high-tech feel
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 flex items-end space-x-1.5 mt-2 h-full">
      {bars.map((height, i) => (
        <motion.div 
          key={i} 
          className="flex-1 bg-gradient-to-t from-blue-600 to-cyan-400 rounded-t-sm relative group"
          animate={{ height: `${height}%` }}
          transition={{ type: "tween", duration: 0.5, ease: "linear" }}
        >
          {/* Neon glow effect on taller bars */}
          {height > 70 && (
            <div className="absolute top-0 left-0 right-0 h-4 bg-cyan-300 blur-[4px] rounded-t-sm opacity-50"></div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

function IncidentRow({ time, type, agent, severity, action }: { time: string, type: string, agent: string, severity: string, action: string }) {
  const isCritical = severity === 'Critical';
  
  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      whileHover={{ scale: 1.01, backgroundColor: "rgba(255,255,255,0.05)" }}
      className="flex items-center justify-between p-3 rounded-lg border border-white/5 bg-white/[0.02] transition-colors cursor-pointer group"
    >
      <div className="flex items-center space-x-4">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isCritical ? 'bg-red-500/10' : 'bg-orange-500/10'}`}>
          {isCritical ? <XCircle className="w-4 h-4 text-red-500" /> : <AlertTriangle className="w-4 h-4 text-orange-500" />}
        </div>
        <div>
          <h4 className="text-sm font-semibold text-white/90 group-hover:text-white transition-colors">{type}</h4>
          <p className="text-xs text-gray-500 font-mono mt-0.5">{agent} • {time}</p>
        </div>
      </div>
      
      <div className="text-right">
        <span className={`text-xs font-bold px-2 py-1 rounded-md border ${
          isCritical ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-orange-500/10 text-orange-400 border-orange-500/20'
        }`}>
          {severity}
        </span>
        <p className="text-xs text-gray-400 mt-1">Action: <span className="text-white/80 font-medium">{action}</span></p>
      </div>
    </motion.div>
  );
}
