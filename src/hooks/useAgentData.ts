import { useState, useEffect, useRef } from 'react';
import { AgentState, TrainingLog } from '../types';

const PLAYBACK_INTERVAL_MS = 5000;
const MAX_BUFFERED_EVENTS = 500;

export const useAgentData = () => {
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [logs, setLogs] = useState<TrainingLog[]>([]);
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const pendingStatesRef = useRef<AgentState[]>([]);
  const nextSyntheticStepRef = useRef(1);
  const lastRenderedTimestampRef = useRef<string>('');

  const enqueueState = (state: AgentState) => {
    const q = pendingStatesRef.current;
    const lastQueued = q[q.length - 1];
    if (lastQueued && lastQueued.timestamp === state.timestamp) return;
    q.push(state);
    if (q.length > MAX_BUFFERED_EVENTS) {
      q.splice(0, q.length - MAX_BUFFERED_EVENTS);
    }
  };

  const normalizeStateEvent = (raw: any): AgentState | null => {
    const payload = raw?.payload ?? raw;
    const messageType = raw?.type ?? '';
    const observation = payload?.observation ?? payload;

    const isTypedState = messageType === 'agent_state' && payload;
    const hasStepFields = observation && (
      Object.prototype.hasOwnProperty.call(observation, 'new_message') ||
      Object.prototype.hasOwnProperty.call(observation, 'memory') ||
      Object.prototype.hasOwnProperty.call(payload ?? {}, 'reward')
    );

    if (!isTypedState && !hasStepFields) return null;

    const stepFromPayload = Number(payload?.step);
    const step = Number.isFinite(stepFromPayload) && stepFromPayload > 0
      ? stepFromPayload
      : nextSyntheticStepRef.current++;

    return {
      step,
      operation: (payload?.operation ?? 'noop') as AgentState['operation'],
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
  };

  useEffect(() => {
    const playbackTimer = window.setInterval(() => {
      const nextState = pendingStatesRef.current.shift();
      if (!nextState) return;

      if (nextState.timestamp === lastRenderedTimestampRef.current) return;
      lastRenderedTimestampRef.current = nextState.timestamp;

      setAgentState(nextState);
      setLogs((prev) => {
        const nextLog: TrainingLog = {
          timestamp: nextState.timestamp,
          step: nextState.step,
          reward: nextState.reward,
          env_reward: nextState.reward,
          fmt_reward: nextState.fact_coverage,
          episode: Math.floor(nextState.step / 10),
          operation: nextState.operation,
          memory_count: nextState.memory_count,
        };
        const lastLog = prev[prev.length - 1];
        if (lastLog && lastLog.timestamp === nextLog.timestamp) return prev;
        return [...prev.slice(-49), nextLog];
      });
    }, PLAYBACK_INTERVAL_MS);

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
          const normalized = normalizeStateEvent(data);
          if (normalized) {
            enqueueState(normalized);
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
      window.clearInterval(playbackTimer);
      ws.current?.close();
    };
  }, []);

  return { agentState, logs, connected };
};
