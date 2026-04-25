# Copyright (c) Meta Platforms, Inc. and affiliates.
# All rights reserved.
#
# This source code is licensed under the BSD-style license found in the
# LICENSE file in the root directory of this source tree.

"""Data models for the Long Horizon Memory Environment."""

from typing import Literal, Optional

from openenv.core.env_server.types import Action, Observation
from pydantic import Field


class LongHorizonMemoryAction(Action):
    """Action to manage compressed memory with append/rewrite/noop operations."""

    operation: Literal["append", "rewrite", "noop"] = Field(
        default="noop",
        description="Memory operation to apply at this step.",
    )
    rewrite_memory: Optional[str] = Field(
        default=None,
        description="Replacement memory content when operation is rewrite.",
    )


class LongHorizonMemoryObservation(Observation):
    """Observation for long_horizon_memory episodes."""

    domain: str = Field(
        default="long_horizon_memory",
        description="Environment domain identifier.",
    )
    task_name: str = Field(
        default="easy",
        description="Task difficulty bucket for grading: easy, medium, or hard.",
    )
    new_message: str = Field(
        default="",
        description="The current message shown to the agent.",
    )
    memory: str = Field(
        default="",
        description="Current long-term memory entries retained by the agent.",
    )
    memory_count: int = Field(
        default=0,
        description="Token Count",
    )
    reward: float = Field(
        default=0.0,
        description="Step reward after applying the latest action.",
    )
    done: bool = Field(
        default=False,
        description="Whether the current episode is finished.",
    )