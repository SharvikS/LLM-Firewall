import React from 'react';
import { Shield, Activity, Lock, AlertTriangle, Zap, Server, Search } from 'lucide-react';

export default function Dashboard() {
  return (
    <div className="flex h-screen bg-[#0a0a0a] text-white font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-[#1f1f1f] bg-[#0d0d0d] flex flex-col">
        <div className="p-6 flex items-center space-x-3">
          <Shield className="w-8 h-8 text-blue-500" />
          <span className="text-xl font-bold tracking-tight">CyberFort AI</span>
        </div>
        
        <nav className="flex-1 px-4 space-y-1 mt-4">
          <NavItem active icon={<Activity />} label="Dashboard" />
          <NavItem icon={<AlertTriangle />} label="Threats" />
          <NavItem icon={<Zap />} label="API Activity" />
          <NavItem icon={<Lock />} label="Prompt Injection" />
          <NavItem icon={<Server />} label="Systems" />
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        <header className="h-20 border-b border-[#1f1f1f] flex items-center justify-between px-8 bg-[#0a0a0a]">
          <div>
            <h1 className="text-2xl font-semibold">Security Operations Command</h1>
            <p className="text-sm text-gray-400">Threat Level: <span className="text-yellow-500">Medium</span></p>
          </div>
          <div className="flex items-center space-x-4 bg-[#141414] border border-[#1f1f1f] px-4 py-2 rounded-lg">
            <Search className="w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search logs..." className="bg-transparent border-none focus:outline-none text-sm w-48" />
          </div>
        </header>

        <main className="p-8 space-y-6">
          <div className="grid grid-cols-3 gap-6">
            <MetricCard title="Threats Blocked" value="18,451" trend="+8.2%" color="text-red-500" />
            <MetricCard title="API Requests" value="1.45M" trend="+12.1%" color="text-green-500" />
            <MetricCard title="Injection Attempts" value="932" trend="-4.3%" color="text-yellow-500" />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="bg-[#0f0f0f] border border-[#1f1f1f] rounded-xl p-6 h-80 flex flex-col justify-between">
              <h3 className="text-lg font-medium text-gray-300">Live Traffic</h3>
              <div className="flex-1 flex items-end space-x-2 mt-4">
                {[...Array(24)].map((_, i) => (
                  <div key={i} className="w-full bg-blue-600 rounded-t-sm" style={{height: `${Math.random() * 80 + 20}%`}}></div>
                ))}
              </div>
            </div>
            
            <div className="bg-[#0f0f0f] border border-[#1f1f1f] rounded-xl p-6 h-80 overflow-hidden">
              <h3 className="text-lg font-medium text-gray-300 mb-4">Latest Incidents</h3>
              <table className="w-full text-sm text-left">
                <thead className="text-gray-500 pb-2 block">
                  <tr><th className="w-32">Timestamp</th><th className="w-32">Type</th><th>Action</th></tr>
                </thead>
                <tbody className="block h-48 overflow-y-auto">
                  <IncidentRow time="14:22:53" type="Malware" severity="Critical" />
                  <IncidentRow time="15:32:33" type="Phishing" severity="High" />
                  <IncidentRow time="13:22:32" type="Jailbreak" severity="High" />
                  <IncidentRow time="16:32:34" type="Phishing" severity="High" />
                  <IncidentRow time="16:32:53" type="Injection" severity="Critical" />
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function NavItem({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <div className={`flex items-center space-x-3 px-3 py-2.5 rounded-lg cursor-pointer ${active ? 'bg-[#1f1f1f] text-white' : 'text-gray-400 hover:text-white hover:bg-[#141414]'}`}>
      <div className="w-5 h-5">{icon}</div>
      <span className="font-medium">{label}</span>
    </div>
  );
}

function MetricCard({ title, value, trend, color }: { title: string, value: string, trend: string, color: string }) {
  return (
    <div className="bg-[#0f0f0f] border border-[#1f1f1f] rounded-xl p-6">
      <h3 className="text-gray-400 font-medium text-sm">{title}</h3>
      <div className="flex items-end space-x-3 mt-2">
        <span className="text-4xl font-bold">{value}</span>
        <span className={`text-sm mb-1 ${color}`}>{trend}</span>
      </div>
    </div>
  );
}

function IncidentRow({ time, type, severity }: { time: string, type: string, severity: string }) {
  const color = severity === 'Critical' ? 'text-red-500' : 'text-orange-500';
  return (
    <tr className="border-b border-[#1f1f1f] block py-2">
      <td className="w-32 text-gray-400">{time}</td>
      <td className="w-32">{type}</td>
      <td className={color}>{severity} - Blocked</td>
    </tr>
  );
}
