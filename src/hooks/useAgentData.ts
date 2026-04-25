import { useState, useEffect, useRef } from 'react';
import { AgentState, TrainingLog } from '../types';

const PLAYBACK_INTERVAL_MS = 800;
const MAX_BUFFERED_EVENTS = 500;

export const useAgentData = () => {
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [logs, setLogs] = useState<TrainingLog[]>([]);
  const [memoryHistory, setMemoryHistory] = useState<Array<{ timestamp: string; step: number; memory: string }>>([]);
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const pendingStatesRef = useRef<AgentState[]>([]);
  const nextSyntheticStepRef = useRef(1);
  const lastRenderedTimestampRef = useRef<string>('');
  const lastEnqueuedSignatureRef = useRef<string>('');

  const buildStateSignature = (state: AgentState) =>
    [
      state.step,
      state.operation,
      state.reward.toFixed(4),
      state.memory_count,
      state.new_message,
      state.memory,
      state.done ? '1' : '0',
      state.task_score.toFixed(4),
      state.fact_coverage.toFixed(4),
      state.qa_similarity.toFixed(4),
    ].join('|');

  const enqueueState = (state: AgentState) => {
    const q = pendingStatesRef.current;
    const stateSig = buildStateSignature(state);
    if (stateSig === lastEnqueuedSignatureRef.current) return;

    const lastQueued = q[q.length - 1];
    if (lastQueued && lastQueued.timestamp === state.timestamp) return;

    q.push(state);
    lastEnqueuedSignatureRef.current = stateSig;
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
      timestamp: String(payload?.timestamp ?? ''),
    };
  };

  useEffect(() => {
    const playbackTimer = window.setInterval(() => {
      const nextState = pendingStatesRef.current.shift();
      if (!nextState) return;

      const effectiveTimestamp = nextState.timestamp || new Date().toISOString();
      if (effectiveTimestamp === lastRenderedTimestampRef.current) return;
      lastRenderedTimestampRef.current = effectiveTimestamp;

      const renderedState: AgentState = {
        ...nextState,
        timestamp: effectiveTimestamp,
      };

      setAgentState(renderedState);
      setLogs((prev) => {
        const nextLog: TrainingLog = {
          timestamp: renderedState.timestamp,
          step: renderedState.step,
          reward: renderedState.reward,
          env_reward: renderedState.reward,
          fmt_reward: renderedState.fact_coverage,
          episode: Math.floor(renderedState.step / 10),
          operation: renderedState.operation,
          memory_count: renderedState.memory_count,
        };
        const lastLog = prev[prev.length - 1];
        if (lastLog && lastLog.timestamp === nextLog.timestamp) return prev;
        return [...prev.slice(-49), nextLog];
      });

      if (renderedState.memory.trim()) {
        setMemoryHistory((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.memory === renderedState.memory) return prev;
          const next = [...prev, {
            timestamp: renderedState.timestamp,
            step: renderedState.step,
            memory: renderedState.memory,
          }];
          return next.slice(-20);
        });
      }
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

  return { agentState, logs, connected, memoryHistory };
};
