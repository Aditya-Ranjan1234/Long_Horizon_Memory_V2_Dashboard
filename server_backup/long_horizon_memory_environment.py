# Copyright (c) Meta Platforms, Inc. and affiliates.
# All rights reserved.
#
# This source code is licensed under the BSD-style license found in the
# LICENSE file in the root directory of this source tree.

"""
Long Horizon Memory Environment Implementation.

This version is aligned with the compressed-memory action schema:
- append: append current message to memory
- rewrite: replace memory with provided compressed memory
- noop: skip the current message

Rewards are shaped for stable training and include:
- per-step relevance rewards
- rewrite quality and growth penalties
- memory budget pressure
- quality-delta shaping
- terminal QA reward based on embedding matches
"""

import json
import os
import random
import re
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from openenv.core.env_server.interfaces import Environment
from openenv.core.env_server.types import State

try:
    from models import LongHorizonMemoryAction, LongHorizonMemoryObservation
except (ImportError, ModuleNotFoundError):
    try:
        from ..models import LongHorizonMemoryAction, LongHorizonMemoryObservation
    except (ImportError, ModuleNotFoundError):
        from long_horizon_memory.models import LongHorizonMemoryAction, LongHorizonMemoryObservation

def broadcast_sync(data_type: str, payload: Dict[str, Any]):
    """Helper to broadcast data to the WebSocket manager if available."""
    try:
        from server.app import manager
        if manager and manager.active_connections:
            # We are in a sync environment, so we need to run the async broadcast
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(manager.enrichment_broadcast({
                    "type": data_type,
                    "payload": payload
                }))
    except Exception:
        pass

class LongHorizonMemoryEnvironment(Environment):
    """Environment where an agent manages compressed long-horizon memory."""

    SUPPORTS_CONCURRENT_SESSIONS: bool = True

    MEMORY_TOKEN_BUDGET = 160
    MAX_REWRITE_GROWTH_RATIO = 1.40

    APPEND_RELEVANT_REWARD = 0.20
    APPEND_IRRELEVANT_PENALTY = -0.20
    NOOP_IRRELEVANT_REWARD = 0.05
    NOOP_RELEVANT_PENALTY = -0.20

    REWRITE_RELEVANT_BASE_REWARD = 0.12
    REWRITE_IRRELEVANT_PENALTY = -0.10
    REWRITE_GROWTH_PENALTY_MAX = 0.25

    QUALITY_DELTA_WEIGHT = 0.25
    TERMINAL_WEIGHT = 0.60

    def __init__(self):
        episodes_path = Path(__file__).with_name("episodes.json")
        with episodes_path.open("r", encoding="utf-8") as f:
            self.episodes = json.load(f)

        self._task_name = os.getenv("LONG_HORIZON_MEMORY_TASK", "all").strip().lower() or "all"
        seed_env = os.getenv("LONG_HORIZON_MEMORY_SEED")
        self._seed = int(seed_env) if seed_env and seed_env.lstrip("-").isdigit() else None
        self._rng = random.Random(self._seed)
        self._episode_id_override = os.getenv("LONG_HORIZON_MEMORY_EPISODE_ID")

        self._state = State(episode_id=str(uuid4()), step_count=0)
        self._reset_count = 0

        self.episode = 0
        self.current_difficulty = "easy"
        self.messages: List[Dict[str, Any]] = []
        self.key_facts: List[Dict[str, Any]] = []
        self.questions: List[Dict[str, Any]] = []

        self.total_message_number = 0
        self.total_relevant_in_episode = 0
        self.memory_text = ""

        self.last_action_error: Optional[str] = None
        self._last_reward_breakdown: Dict[str, float] = {}
        self._last_quality_score = 0.0
        self._done = False

        self._set_random_episode()

    def _infer_difficulty(self, episode_data: Dict[str, Any], episode_index: int) -> str:
        explicit = str(episode_data.get("difficulty", "")).strip().lower()
        if explicit in {"easy", "medium", "hard"}:
            return explicit
        if episode_index <= 1:
            return "easy"
        if episode_index <= 3:
            return "medium"
        return "hard"

    def _candidate_indices_for_task(self) -> List[int]:
        if self._task_name not in {"easy", "medium", "hard", "all"}:
            self._task_name = "all"

        if self._task_name == "all":
            return list(range(len(self.episodes)))

        return [
            i
            for i, episode_data in enumerate(self.episodes)
            if self._infer_difficulty(episode_data, i) == self._task_name
        ]

    def _set_random_episode(self) -> None:
        candidates = self._candidate_indices_for_task()
        if not candidates:
            candidates = list(range(len(self.episodes)))

        chosen_episode: Optional[int] = None
        if self._episode_id_override:
            for idx in candidates:
                if str(self.episodes[idx].get("episode_id", idx)) == str(self._episode_id_override):
                    chosen_episode = idx
                    break

        self.episode = chosen_episode if chosen_episode is not None else self._rng.choice(candidates)
        episode_data = self.episodes[self.episode]

        self.current_difficulty = self._infer_difficulty(episode_data, self.episode)
        self.messages = list(episode_data.get("messages", []))
        self.key_facts = list(episode_data.get("key_facts", []))
        self.questions = list(episode_data.get("questions", []))

        self.total_message_number = 0
        self.total_relevant_in_episode = sum(1 for m in self.messages if bool(m.get("isRelevant", False)))
        self.memory_text = ""
        self.last_action_error = None
        self._last_reward_breakdown = {}
        self._done = len(self.messages) == 0
        self._last_quality_score = self._quality_score(self.memory_text)

    def _tokenize(self, text: str) -> List[str]:
        return re.findall(r"[a-z0-9]+", text.lower())

    def _token_count(self, text: str) -> int:
        return len(self._tokenize(text))

    def _normalize_memory(self, text: str) -> str:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        return "\n".join(lines)

    def _hashed_embedding(self, text: str, dim: int = 256) -> List[float]:
        vec = [0.0] * dim
        tokens = self._tokenize(text)
        if not tokens:
            return vec

        for token in tokens:
            idx = hash(token) % dim
            vec[idx] += 1.0

        norm = sum(v * v for v in vec) ** 0.5
        if norm <= 0.0:
            return vec
        return [v / norm for v in vec]

    def _cosine(self, a: List[float], b: List[float]) -> float:
        if not a or not b:
            return 0.0
        return max(0.0, min(1.0, sum(x * y for x, y in zip(a, b))))

    def _memory_relevance_similarity(self, memory_text: str) -> float:
        relevant_memory = "\n".join(str(f.get("text", "")) for f in self.key_facts)
        if not relevant_memory.strip():
            return 0.0
        return self._cosine(self._hashed_embedding(memory_text), self._hashed_embedding(relevant_memory))

    def _fact_coverage(self, memory_text: str) -> float:
        if not self.key_facts:
            return 0.0

        memory_emb = self._hashed_embedding(memory_text)
        matched = 0
        for fact in self.key_facts:
            fact_text = str(fact.get("text", ""))
            score = self._cosine(memory_emb, self._hashed_embedding(fact_text))
            if score >= 0.45:
                matched += 1
        return matched / len(self.key_facts)

    def _answer_question(self, memory_text: str, question: str) -> str:
        if not memory_text.strip():
            return ""

        candidates = [
            seg.strip()
            for seg in re.split(r"[\n\.!?]+", memory_text)
            if seg.strip()
        ]
        if not candidates:
            return ""

        question_emb = self._hashed_embedding(question)
        best = max(
            candidates,
            key=lambda s: self._cosine(self._hashed_embedding(s), question_emb),
        )
        return best

    def _qa_similarity_score(self, memory_text: str) -> float:
        if not self.questions:
            return 0.0

        scores: List[float] = []
        for q in self.questions:
            question = str(q.get("question", ""))
            expected_answer = str(q.get("answer", "")).strip()
            predicted = self._answer_question(memory_text, question)

            if not expected_answer:
                continue

            sim = self._cosine(
                self._hashed_embedding(predicted),
                self._hashed_embedding(expected_answer),
            )
            if expected_answer.lower() in predicted.lower():
                sim = max(sim, 1.0)
            scores.append(sim)

        if not scores:
            return 0.0
        return sum(scores) / len(scores)

    def _memory_overflow_penalty(self, memory_text: str) -> float:
        token_count = self._token_count(memory_text)
        overflow = max(0, token_count - self.MEMORY_TOKEN_BUDGET)
        if overflow == 0:
            return 0.0
        return min(0.30, 0.30 * (overflow / max(1, self.MEMORY_TOKEN_BUDGET)))

    def _quality_score(self, memory_text: str) -> float:
        fact_coverage = self._fact_coverage(memory_text)
        qa_score = self._qa_similarity_score(memory_text)
        relevance = self._memory_relevance_similarity(memory_text)
        overflow_penalty = self._memory_overflow_penalty(memory_text)

        score = (
            0.45 * fact_coverage
            + 0.35 * qa_score
            + 0.20 * relevance
            - 0.35 * overflow_penalty
        )
        return max(0.0, min(1.0, score))

    def _rewrite_reward(self, old_memory: str, new_memory: str, message_is_relevant: bool) -> Dict[str, float]:
        old_tokens = self._token_count(old_memory)
        new_tokens = self._token_count(new_memory)

        old_quality = self._quality_score(old_memory)
        new_quality = self._quality_score(new_memory)

        reward = 0.0
        if message_is_relevant:
            reward += self.REWRITE_RELEVANT_BASE_REWARD
            reward += 0.20 * (new_quality - old_quality)
        else:
            reward += self.REWRITE_IRRELEVANT_PENALTY

        growth_penalty = 0.0
        if old_tokens > 0:
            growth_ratio = new_tokens / old_tokens
            if growth_ratio > self.MAX_REWRITE_GROWTH_RATIO:
                over = growth_ratio - self.MAX_REWRITE_GROWTH_RATIO
                growth_penalty = min(self.REWRITE_GROWTH_PENALTY_MAX, 0.15 * over)
                reward -= growth_penalty
        elif new_tokens > self.MEMORY_TOKEN_BUDGET // 3:
            growth_penalty = min(self.REWRITE_GROWTH_PENALTY_MAX, 0.10)
            reward -= growth_penalty

        return {
            "rewrite_reward": reward,
            "growth_penalty": growth_penalty,
            "old_quality": old_quality,
            "new_quality": new_quality,
        }

    def _current_message(self) -> Optional[Dict[str, Any]]:
        if self.total_message_number >= len(self.messages):
            return None
        return self.messages[self.total_message_number]

    def _terminal_bonus(self) -> float:
        qa_score = self._qa_similarity_score(self.memory_text)
        fact_coverage = self._fact_coverage(self.memory_text)
        relevance = self._memory_relevance_similarity(self.memory_text)

        terminal = 0.55 * qa_score + 0.30 * fact_coverage + 0.15 * relevance
        return max(0.0, min(1.0, terminal))

    def _task_score(self) -> float:
        quality = self._quality_score(self.memory_text)
        terminal = self._terminal_bonus() if self._done else 0.0
        score = (1.0 - self.TERMINAL_WEIGHT) * quality + self.TERMINAL_WEIGHT * terminal
        return max(0.0, min(1.0, score))

    def _observation(self, reward: float) -> LongHorizonMemoryObservation:
        current_message = self._current_message()
        new_message = "" if current_message is None else str(current_message.get("text", ""))

        metadata = {
            "reset_count": self._reset_count,
            "episode_id": self.episodes[self.episode].get("episode_id", self.episode),
            "task": self.current_difficulty,
            "memory_token_budget": self.MEMORY_TOKEN_BUDGET,
            "memory_token_count": self._token_count(self.memory_text),
            "fact_coverage": self._fact_coverage(self.memory_text),
            "qa_similarity": self._qa_similarity_score(self.memory_text),
            "memory_relevance_similarity": self._memory_relevance_similarity(self.memory_text),
            "task_score": self._task_score(),
            "last_action_error": self.last_action_error,
            "reward_breakdown": self._last_reward_breakdown,
        }

        obs = LongHorizonMemoryObservation(
            domain="long_horizon_memory",
            task_name=self.current_difficulty,
            new_message=new_message,
            memory=self.memory_text,
            memory_count=self._token_count(self.memory_text),
            reward=reward,
            done=self._done,
            metadata=metadata,
        )

        # Broadcast update for UI
        broadcast_sync("agent_state", {
            "step": self._state.step_count,
            "operation": getattr(self, "_last_op", "reset"),
            "reward": reward,
            "memory_count": metadata["memory_token_count"],
            "new_message": new_message,
            "memory": self.memory_text,
            "done": self._done,
            "task_score": metadata["task_score"],
            "fact_coverage": metadata["fact_coverage"],
            "qa_similarity": metadata["qa_similarity"],
            "timestamp": datetime.now().isoformat()
        })
        
        # Also broadcast as a training log for the graph
        broadcast_sync("training_log", {
            "timestamp": datetime.now().isoformat(),
            "reward": reward,
            "episode": int(metadata["episode_id"]) if str(metadata["episode_id"]).isdigit() else 0,
            "env_reward": float(self._last_reward_breakdown.get("append_relevance", self._last_reward_breakdown.get("noop_relevance", self._last_reward_breakdown.get("rewrite_reward", 0)))),
            "fmt_reward": float(self._last_reward_breakdown.get("quality_delta_reward", 0))
        })

        return obs

    def reset(self) -> LongHorizonMemoryObservation:
        self._state = State(episode_id=str(uuid4()), step_count=0)
        self._reset_count += 1
        self._set_random_episode()
        self._last_op = "reset"
        return self._observation(reward=0.0)

    def step(self, action: LongHorizonMemoryAction) -> LongHorizonMemoryObservation:  # type: ignore[override]
        self._state.step_count += 1
        self.last_action_error = None

        if self._done:
            self.last_action_error = "episode_already_done"
            self._last_reward_breakdown = {"already_done_penalty": -0.25}
            return self._observation(reward=-0.25)

        current_message = self._current_message()
        message_text = "" if current_message is None else str(current_message.get("text", ""))
        message_is_relevant = bool(current_message.get("isRelevant", False)) if current_message else False

        reward = 0.0
        breakdown: Dict[str, float] = {}

        operation = action.operation
        self._last_op = operation
        if operation == "append":
            if message_is_relevant:
                reward += self.APPEND_RELEVANT_REWARD
                breakdown["append_relevance"] = self.APPEND_RELEVANT_REWARD
            else:
                reward += self.APPEND_IRRELEVANT_PENALTY
                breakdown["append_relevance"] = self.APPEND_IRRELEVANT_PENALTY

            if message_text:
                self.memory_text = self._normalize_memory(
                    f"{self.memory_text}\n{message_text}" if self.memory_text else message_text
                )

        elif operation == "noop":
            if message_is_relevant:
                reward += self.NOOP_RELEVANT_PENALTY
                breakdown["noop_relevance"] = self.NOOP_RELEVANT_PENALTY
            else:
                reward += self.NOOP_IRRELEVANT_REWARD
                breakdown["noop_relevance"] = self.NOOP_IRRELEVANT_REWARD

        elif operation == "rewrite":
            proposed = action.rewrite_memory
            if proposed is None:
                self.last_action_error = "rewrite_memory_required"
                reward -= 0.20
                breakdown["rewrite_invalid"] = -0.20
            else:
                old_memory = self.memory_text
                new_memory = self._normalize_memory(proposed)
                rewrite_details = self._rewrite_reward(
                    old_memory=old_memory,
                    new_memory=new_memory,
                    message_is_relevant=message_is_relevant,
                )
                self.memory_text = new_memory
                rewrite_reward = float(rewrite_details["rewrite_reward"])
                reward += rewrite_reward
                breakdown["rewrite_reward"] = rewrite_reward
                if float(rewrite_details["growth_penalty"]) > 0:
                    breakdown["rewrite_growth_penalty"] = -float(rewrite_details["growth_penalty"])

        else:
            self.last_action_error = "invalid_operation"
            reward -= 0.20
            breakdown["invalid_operation"] = -0.20

        overflow_penalty = self._memory_overflow_penalty(self.memory_text)
        if overflow_penalty > 0:
            reward -= overflow_penalty
            breakdown["memory_overflow_penalty"] = -overflow_penalty

        new_quality = self._quality_score(self.memory_text)
        quality_delta = new_quality - self._last_quality_score
        delta_reward = self.QUALITY_DELTA_WEIGHT * quality_delta
        reward += delta_reward
        breakdown["quality_delta_reward"] = delta_reward
        self._last_quality_score = new_quality

        self.total_message_number += 1
        if self.total_message_number >= len(self.messages):
            self._done = True

        if self._done:
            terminal_bonus = self._terminal_bonus()
            reward += terminal_bonus
            breakdown["terminal_bonus"] = terminal_bonus

        reward = max(-1.0, min(1.0, reward))
        self._last_reward_breakdown = breakdown
        return self._observation(reward=reward)

    def close(self) -> None:
        return None

    @property
    def state(self) -> State:
        return self._state


if __name__ == "__main__":
    pass
