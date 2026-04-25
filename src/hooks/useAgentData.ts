import { useState, useEffect, useRef } from 'react';
import { AgentState, TrainingLog } from '../types';

export const useAgentData = () => {
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [logs, setLogs] = useState<TrainingLog[]>([]);
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const lastStepRef = useRef(0);

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
          const payload = data?.payload ?? data;
          const messageType = data?.type ?? '';

          // Preferred typed stream emitted by environment broadcast.
          if (messageType === 'agent_state' && payload) {
            setAgentState(payload);
            if (typeof payload.step === 'number') {
              lastStepRef.current = payload.step;
            }
            return;
          }

          if (messageType === 'training_log' && payload) {
            setLogs(prev => {
              const lastLog = prev[prev.length - 1];
              if (lastLog && lastLog.timestamp === payload.timestamp) return prev;
              return [...prev.slice(-49), payload];
            });
            return;
          }

          // Fallback for untyped/raw messages: map step-like payloads to UI model.
          const observation = payload?.observation ?? payload;
          const hasStepFields = observation && (
            Object.prototype.hasOwnProperty.call(observation, 'new_message') ||
            Object.prototype.hasOwnProperty.call(observation, 'memory') ||
            Object.prototype.hasOwnProperty.call(payload, 'reward')
          );

          if (hasStepFields) {
            const nextStep = (lastStepRef.current || 0) + 1;
            const normalizedState = {
              step: nextStep,
              operation: payload?.operation ?? 'noop',
              reward: Number(payload?.reward ?? observation?.reward ?? 0),
              memory_count: Number(observation?.memory_count ?? 0),
              new_message: String(observation?.new_message ?? ''),
              memory: String(observation?.memory ?? ''),
              done: Boolean(payload?.done ?? observation?.done ?? false),
              task_score: Number(observation?.metadata?.task_score ?? payload?.task_score ?? 0),
              fact_coverage: Number(observation?.metadata?.fact_coverage ?? payload?.fact_coverage ?? 0),
              qa_similarity: Number(observation?.metadata?.qa_similarity ?? payload?.qa_similarity ?? 0),
              timestamp: String(payload?.timestamp ?? new Date().toISOString()),
            };

            lastStepRef.current = nextStep;
            setAgentState(normalizedState);
            setLogs(prev => {
              const log = {
                timestamp: normalizedState.timestamp,
                reward: normalizedState.reward,
                episode: Math.floor(nextStep / 10),
                operation: normalizedState.operation,
                memory_count: normalizedState.memory_count,
              };
              const lastLog = prev[prev.length - 1];
              if (lastLog && lastLog.timestamp === log.timestamp) return prev;
              return [...prev.slice(-49), log];
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
