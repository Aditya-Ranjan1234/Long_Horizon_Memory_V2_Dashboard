import { useState, useEffect, useRef } from 'react';
import { AgentState, TrainingLog } from '../types';

export const useAgentData = () => {
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [logs, setLogs] = useState<TrainingLog[]>([]);
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    const connect = () => {
      // In production deploys we consume the HF stream directly.
      // Local development can still use the local backend proxy.
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const hostname = window.location.hostname;
      const isLocalDev = hostname === 'localhost' || hostname === '127.0.0.1';
      const hfWsUrl = "wss://aditya-ranjan1234-long-horizon-memory-v2.hf.space/ws/monitor";
      
      const wsUrl = isLocalDev
        ? `${protocol}//${window.location.host}/api/ws/monitor`
        : hfWsUrl;
      
      console.log(`[WS] Attempting connection to: ${wsUrl}`);
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        console.log(`[WS] Connected to ${isLocalDev ? 'Agent Backend' : 'HF Space'}`);
        setConnected(true);
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'agent_state') {
            setAgentState(data.payload);
          } else if (data.type === 'training_log') {
            setLogs(prev => {
              // Avoid duplicate logs if they come in too fast
              const lastLog = prev[prev.length - 1];
              if (lastLog && lastLog.timestamp === data.payload.timestamp) return prev;
              return [...prev.slice(-49), data.payload];
            });
          }
        } catch (e) {
          console.error("[WS] Error parsing message:", e);
        }
      };

      ws.current.onerror = (err) => {
        console.error("[WS] Connection error:", err);
        setConnected(false);
      };

      ws.current.onclose = () => {
        console.log('[WS] Connection closed');
        setConnected(false);
        // Attempt reconnection
        setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      ws.current?.close();
    };
  }, []);

  return { agentState, logs, connected };
};
