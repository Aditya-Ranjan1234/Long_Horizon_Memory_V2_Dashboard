export interface AgentState {
  step: number;
  operation: 'append' | 'rewrite' | 'noop';
  reward: number;
  memory_count: number;
  new_message: string;
  memory: string;
  done: boolean;
  timestamp: string;
  task_score: number;
  fact_coverage: number;
  qa_similarity: number;
}

export interface TrainingLog {
  timestamp: string;
  step?: number;
  loss?: number;
  reward: number;
  fmt_reward?: number;
  env_reward?: number;
  episode: number;
  operation?: 'append' | 'rewrite' | 'noop';
  memory_count?: number;
}
