import { useState } from 'react';
import { 
  Keyboard, 
  Crown, 
  Info, 
  Settings,
  Bell,
  User,
  RotateCcw,
  Command,
  Activity,
  Zap,
  Clock,
  Database
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentData } from './hooks/useAgentData';

function App() {
  const { agentState, logs, connected } = useAgentData();
  const [activeTab, setActiveTab] = useState('monitor');

  // MonkeyType Serika Dark Palette
  const colors = {
    bg: '#323437',
    main: '#e2b714',
    sub: '#646669',
    subAlt: '#2c2e31',
    text: '#d1d0c5',
    error: '#ca4754'
  };

  return (
    <div className="min-h-screen flex flex-col max-w-6xl mx-auto px-8 py-12 gap-12 font-mono selection:bg-[#e2b714] selection:text-[#323437]">
      
      {/* Navbar */}
      <nav className="flex justify-between items-center opacity-80">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 cursor-pointer group">
            <div className="text-[#e2b714]">
              <Keyboard size={32} />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[10px] text-[#646669] ml-1">agent see</span>
              <h1 className="text-3xl font-bold tracking-tight text-[#d1d0c5]">monkeyagent</h1>
            </div>
          </div>
          <div className="flex gap-4 ml-4 text-[#646669]">
            <Keyboard size={20} className="hover:text-[#d1d0c5] cursor-pointer transition-colors" />
            <Crown size={20} className="hover:text-[#d1d0c5] cursor-pointer transition-colors" />
            <Info size={20} className="hover:text-[#d1d0c5] cursor-pointer transition-colors" />
            <Settings size={20} className="hover:text-[#d1d0c5] cursor-pointer transition-colors" />
          </div>
        </div>
        <div className="flex items-center gap-6 text-[#646669]">
          <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-[#2c2e31] text-[10px]">
            <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[#e2b714]' : 'bg-[#ca4754]'}`} />
            {connected ? 'CONNECTED' : 'DISCONNECTED'}
          </div>
          <Bell size={20} className="hover:text-[#d1d0c5] cursor-pointer transition-colors" />
          <User size={20} className="hover:text-[#d1d0c5] cursor-pointer transition-colors" />
        </div>
      </nav>

      {/* Main Stats Display */}
      <div className="grid grid-cols-12 gap-8 items-end">
        <div className="col-span-3 flex flex-col gap-2">
          <div className="flex flex-col leading-none">
            <span className="text-[#646669] text-xl">reward</span>
            <span className="text-6xl font-bold text-[#e2b714]">{agentState?.reward?.toFixed(2) || '0.00'}</span>
          </div>
          <div className="flex flex-col leading-none mt-4">
            <span className="text-[#646669] text-xl">accuracy</span>
            <span className="text-6xl font-bold text-[#e2b714]">
              {((agentState?.task_score || 0) * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        
        <div className="col-span-9 h-[250px] relative">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={logs}>
              <XAxis dataKey="step" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#2c2e31', border: 'none', borderRadius: '4px', fontSize: '12px' }}
                itemStyle={{ color: '#e2b714' }}
                labelStyle={{ display: 'none' }}
              />
              <Line 
                type="monotone" 
                dataKey="reward" 
                stroke="#e2b714" 
                strokeWidth={2} 
                dot={false}
                animationDuration={300}
              />
              <Line 
                type="monotone" 
                dataKey="fmt_reward" 
                stroke="#646669" 
                strokeWidth={1} 
                strokeDasharray="4 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-5 gap-8 py-4 border-y border-[#2c2e31] text-center">
        <div className="flex flex-col">
          <span className="text-[#646669] text-sm">episode</span>
          <span className="text-2xl text-[#e2b714]">{agentState?.step ? Math.floor(agentState.step / 10) : 0}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[#646669] text-sm">mem tokens</span>
          <span className="text-2xl text-[#e2b714]">{agentState?.memory_count || 0}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[#646669] text-sm">consistency</span>
          <span className="text-2xl text-[#e2b714]">{(agentState?.qa_similarity ? agentState.qa_similarity * 100 : 0).toFixed(0)}%</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[#646669] text-sm">step</span>
          <span className="text-2xl text-[#e2b714]">{agentState?.step || 0}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[#646669] text-sm">time</span>
          <span className="text-2xl text-[#e2b714]">00:00:42</span>
        </div>
      </div>

      {/* Action / Content Display */}
      <div className="grid grid-cols-12 gap-12">
        <div className="col-span-8 flex flex-col gap-8">
          {/* Agent Message (The "Words" to type) */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-[#646669] text-sm">
              <Activity size={16} />
              <span>input_stream</span>
            </div>
            <div className="text-2xl leading-relaxed text-[#646669] font-medium tracking-tight">
              {agentState?.new_message ? (
                agentState.new_message.split(' ').map((word, i) => (
                  <span key={i} className={i === 0 ? "text-[#d1d0c5]" : ""}>{word} </span>
                ))
              ) : (
                "waiting for agent to receive next instruction from environment..."
              )}
            </div>
            <div className="mt-4 flex items-center gap-4">
              <RotateCcw size={20} className="text-[#646669] hover:text-[#d1d0c5] cursor-pointer" />
            </div>
          </div>

          {/* Action History */}
          <div className="flex flex-col gap-4">
             <div className="flex items-center gap-2 text-[#646669] text-sm">
              <Zap size={16} />
              <span>action_history</span>
            </div>
            <div className="flex flex-col gap-2">
              <AnimatePresence mode="popLayout">
                {logs.slice().reverse().slice(0, 5).map((log, i) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={log.timestamp}
                    className="flex justify-between items-center p-3 rounded bg-[#2c2e31]/50 border-l-2 border-[#e2b714]"
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-[10px] text-[#646669]">{log.timestamp.split('T')[1].split('.')[0]}</span>
                      <span className="text-sm font-bold text-[#d1d0c5] uppercase tracking-wider">{log.operation || 'step'}</span>
                    </div>
                    <div className="flex gap-6 text-[10px] text-[#646669]">
                      <span>REW: <span className="text-[#e2b714]">{log.reward.toFixed(3)}</span></span>
                      <span>MEM: {log.memory_count || 0}</span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="col-span-4 flex flex-col gap-8">
          {/* Active Memory */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-[#646669] text-sm">
              <Database size={16} />
              <span>active_memory</span>
            </div>
            <div className="p-4 bg-[#2c2e31] rounded-lg border border-[#323437] min-h-[300px] max-h-[500px] overflow-y-auto scrollbar-mt text-xs leading-loose text-[#646669]">
              {agentState?.memory || "No active memory sequences stored."}
            </div>
          </div>
        </div>
      </div>

      {/* Footer Instructions */}
      <footer className="mt-auto flex justify-center gap-8 text-[#646669] text-xs">
        <div className="flex items-center gap-2">
          <kbd className="px-1.5 py-0.5 bg-[#646669] text-[#323437] rounded text-[10px]">tab</kbd>
          <span>+</span>
          <kbd className="px-1.5 py-0.5 bg-[#646669] text-[#323437] rounded text-[10px]">enter</kbd>
          <span className="ml-1">- restart test</span>
        </div>
        <div className="flex items-center gap-2">
          <kbd className="px-1.5 py-0.5 bg-[#646669] text-[#323437] rounded text-[10px]">esc</kbd>
          <span>or</span>
          <div className="flex items-center gap-1">
             <kbd className="px-1.5 py-0.5 bg-[#646669] text-[#323437] rounded text-[10px]">ctrl</kbd>
             <kbd className="px-1.5 py-0.5 bg-[#646669] text-[#323437] rounded text-[10px]">shift</kbd>
             <kbd className="px-1.5 py-0.5 bg-[#646669] text-[#323437] rounded text-[10px]">p</kbd>
          </div>
          <span className="ml-1">- command line</span>
        </div>
      </footer>

      {/* Bottom Social Links */}
      <div className="flex justify-between items-center text-[#646669] text-xs opacity-60 hover:opacity-100 transition-opacity">
        <div className="flex gap-4">
          <span className="hover:text-[#d1d0c5] cursor-pointer">contact</span>
          <span className="hover:text-[#d1d0c5] cursor-pointer">support</span>
          <span className="hover:text-[#d1d0c5] cursor-pointer">github</span>
          <span className="hover:text-[#d1d0c5] cursor-pointer">discord</span>
          <span className="hover:text-[#d1d0c5] cursor-pointer">twitter</span>
          <span className="hover:text-[#d1d0c5] cursor-pointer">terms</span>
        </div>
        <div className="flex items-center gap-2">
           <Command size={12} />
           <span>serika dark</span>
        </div>
      </div>
    </div>
  );
}

export default App;
