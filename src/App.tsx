import { useEffect, useMemo, useState } from 'react';
import { 
  BrainCircuit,
  Activity,
  ShieldCheck,
  Gauge,
  Bell,
  User,
  RotateCcw,
  Command,
  Zap,
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
  const [renderedMessage, setRenderedMessage] = useState('');
  const [actionTransition, setActionTransition] = useState('awaiting');
  const [lastOperation, setLastOperation] = useState<string | null>(null);

  // Demo typing speed control (ms per character).
  const TYPING_SPEED_MS = 24;

  // MonkeyType Serika Dark Palette
  const colors = {
    bg: '#323437',
    main: '#e2b714',
    sub: '#646669',
    subAlt: '#2c2e31',
    text: '#d1d0c5',
    error: '#ca4754'
  };

  useEffect(() => {
    const text = agentState?.new_message ?? '';
    if (!text) {
      setRenderedMessage('');
      return;
    }

    let i = 0;
    setRenderedMessage('');
    const interval = window.setInterval(() => {
      i += 1;
      setRenderedMessage(text.slice(0, i));
      if (i >= text.length) window.clearInterval(interval);
    }, TYPING_SPEED_MS);

    return () => window.clearInterval(interval);
  }, [agentState?.new_message]);

  useEffect(() => {
    const currentOp = agentState?.operation ?? null;
    if (!currentOp) return;
    if (!lastOperation) {
      setLastOperation(currentOp);
      setActionTransition(`start -> ${currentOp}`);
      return;
    }
    if (currentOp !== lastOperation) {
      setActionTransition(`${lastOperation} -> ${currentOp}`);
      setLastOperation(currentOp);
    }
  }, [agentState?.operation, lastOperation]);

  const chartData = useMemo(() => logs, [logs]);

  return (
    <div className="min-h-screen w-full flex flex-col max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 gap-8 font-mono overflow-x-hidden selection:bg-[#e2b714] selection:text-[#323437]">
      
      {/* Navbar */}
      <nav className="flex flex-wrap justify-between items-center gap-4 opacity-90">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 cursor-pointer group">
            <div className="text-[#e2b714]">
              <BrainCircuit size={28} />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[10px] text-[#646669] ml-1 uppercase tracking-wider">live inference monitor</span>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#d1d0c5]">Long Horizon Memory Dashboard</h1>
            </div>
          </div>
          <div className="hidden sm:flex gap-3 ml-2 text-[#646669]">
            <Activity size={18} />
            <ShieldCheck size={18} />
            <Gauge size={18} />
          </div>
        </div>
        <div className="flex items-center gap-4 text-[#646669]">
          <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-[#2c2e31] text-[10px]">
            <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[#e2b714]' : 'bg-[#ca4754]'}`} />
            {connected ? 'CONNECTED' : 'DISCONNECTED'}
          </div>
          <Bell size={18} className="hover:text-[#d1d0c5] cursor-pointer transition-colors" />
          <User size={18} className="hover:text-[#d1d0c5] cursor-pointer transition-colors" />
        </div>
      </nav>

      {/* Main Stats Display */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-3 flex flex-col gap-3">
          <div className="flex flex-col leading-none">
            <span className="text-[#646669] text-base sm:text-lg">reward</span>
            <span className="text-4xl sm:text-5xl font-bold text-[#e2b714]">{agentState?.reward?.toFixed(2) || '0.00'}</span>
          </div>
          <div className="flex flex-col leading-none mt-2">
            <span className="text-[#646669] text-base sm:text-lg">accuracy</span>
            <span className="text-4xl sm:text-5xl font-bold text-[#e2b714]">
              {((agentState?.task_score || 0) * 100).toFixed(0)}%
            </span>
          </div>
          <div className="mt-2 p-3 rounded-md bg-[#2c2e31]/70 border border-[#3a3c40]">
            <div className="text-[10px] text-[#646669] uppercase tracking-wider">transition</div>
            <div className="text-sm text-[#d1d0c5] mt-1">{actionTransition}</div>
          </div>
        </div>
        
        <div className="lg:col-span-9 h-[230px] sm:h-[280px] w-full min-w-0 relative rounded-md bg-[#2c2e31]/35 border border-[#3a3c40] p-2">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={180}>
            <LineChart data={chartData}>
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 py-4 border-y border-[#2c2e31] text-center">
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
          <span className="text-2xl text-[#e2b714]">{agentState?.timestamp ? agentState.timestamp.slice(11, 19) : "--:--:--"}</span>
        </div>
      </div>

      {/* Action / Content Display */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        <div className="xl:col-span-8 flex flex-col gap-8 min-w-0">
          {/* Agent Message (The "Words" to type) */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-[#646669] text-sm">
              <Activity size={16} />
              <span>input_stream</span>
            </div>
            <div className="text-lg sm:text-xl leading-relaxed text-[#646669] font-medium tracking-tight min-h-[90px]">
              {renderedMessage ? (
                renderedMessage.split(' ').map((word, i) => (
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
                {logs.slice().reverse().slice(0, 6).map((log) => (
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

        <div className="xl:col-span-4 flex flex-col gap-8 min-w-0">
          {/* Active Memory */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-[#646669] text-sm">
              <Database size={16} />
              <span>active_memory</span>
            </div>
            <div className="p-4 bg-[#2c2e31] rounded-lg border border-[#323437] min-h-[220px] max-h-[420px] overflow-y-auto scrollbar-mt text-xs leading-loose text-[#646669] break-words">
              {agentState?.memory || "No active memory sequences stored."}
            </div>
          </div>
        </div>
      </div>

      {/* Footer Instructions */}
      <footer className="mt-auto flex flex-wrap justify-center gap-6 text-[#646669] text-xs">
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
      <div className="flex flex-wrap justify-between items-center gap-3 text-[#646669] text-xs opacity-60 hover:opacity-100 transition-opacity">
        <div className="flex flex-wrap gap-4">
          <span className="hover:text-[#d1d0c5] cursor-pointer">contact</span>
          <span className="hover:text-[#d1d0c5] cursor-pointer">support</span>
          <span className="hover:text-[#d1d0c5] cursor-pointer">github</span>
          <span className="hover:text-[#d1d0c5] cursor-pointer">discord</span>
          <span className="hover:text-[#d1d0c5] cursor-pointer">twitter</span>
          <span className="hover:text-[#d1d0c5] cursor-pointer">terms</span>
        </div>
        <div className="flex items-center gap-2">
           <Command size={12} />
           <span>production monitor theme</span>
        </div>
      </div>
    </div>
  );
}

export default App;
