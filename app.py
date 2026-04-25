# Copyright (c) Meta Platforms, Inc. and affiliates.
# All rights reserved.
#
# This source code is licensed under the BSD-style license found in the
# LICENSE file in the root directory of this source tree.

"""
FastAPI application for the Long Horizon Memory Environment.

This module creates an HTTP server that exposes the LongHorizonMemoryEnvironment
over HTTP and WebSocket endpoints, compatible with EnvClient.

Endpoints:
    - POST /reset: Reset the environment
    - POST /step: Execute an action
    - GET /state: Get current environment state
    - GET /schema: Get action/observation schemas
    - WS /ws: WebSocket endpoint for persistent sessions

Usage:
    # Development (with auto-reload):
    uvicorn server.app:app --reload --host 0.0.0.0 --port 8000

    # Production:
    uvicorn server.app:app --host 0.0.0.0 --port 8000 --workers 4

    # Or run directly:
    python -m server.app
"""

try:
    from openenv.core.env_server.http_server import create_app
except Exception as e:  # pragma: no cover
    raise ImportError(
        "openenv is required for the web interface. Install dependencies with '\n    uv sync\n'"
    ) from e

try:
    from long_horizon_memory_environment import LongHorizonMemoryEnvironment
    # If models exist as a separate file, we'd import them here. 
    # For now, let's assume they are handled by openenv or accessible.
    from models import LongHorizonMemoryAction, LongHorizonMemoryObservation
except (ImportError, ModuleNotFoundError):
    # Fallback to local imports if the above fails
    from long_horizon_memory_environment import LongHorizonMemoryEnvironment
    # Dummy models if not found, though openenv usually provides them
    class LongHorizonMemoryAction: pass
    class LongHorizonMemoryObservation: pass


from datetime import datetime
import json
import asyncio
from typing import List
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
import os

import httpx
import websockets

# --- Monitor Logic ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.hf_task = None
        self.loop = None
        try:
            self.loop = asyncio.get_event_loop()
        except Exception:
            pass

    async def enrichment_broadcast(self, data: dict):
        if not self.loop:
            try:
                self.loop = asyncio.get_running_loop()
            except Exception:
                pass

        if "timestamp" not in data:
            data["timestamp"] = datetime.now().isoformat()
        
        message = json.dumps(data)
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                pass

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Only start HF proxy task if not already running AND not on HF Space
        is_hf = os.environ.get("SPACE_ID") is not None
        if not is_hf:
            if not self.hf_task or self.hf_task.done():
                self.hf_task = asyncio.create_task(self.proxy_hf_updates())
        else:
            print("[SERVER] Running on HF Space, skipping self-proxy.")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def proxy_hf_updates(self):
        """Proxy updates from the HF Space WebSocket to our local clients."""
        # Using the base URL provided in test scripts but with wss protocol
        hf_ws_url = "wss://aditya-ranjan1234-long-horizon-memory-v2.hf.space/ws/monitor"
        print(f"[PROXY] Connecting to HF Space: {hf_ws_url}")
        
        while True:
            try:
                async with websockets.connect(hf_ws_url) as hf_ws:
                    print("[PROXY] Connected to HF Space WebSocket")
                    while True:
                        msg = await hf_ws.recv()
                        data = json.loads(msg)
                        await self.enrichment_broadcast(data)
            except Exception as e:
                print(f"[PROXY] HF Space Connection Error: {e}. Retrying in 5s...")
                await asyncio.sleep(5)

manager = ConnectionManager()

# Create the app with web interface and README integration
def get_monitored_env_class(manager):
    class MonitoredEnv(LongHorizonMemoryEnvironment):
        def _broadcast(self, data: dict):
            if manager.loop:
                manager.loop.call_soon_threadsafe(
                    lambda: asyncio.create_task(manager.enrichment_broadcast(data))
                )
            else:
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        loop.create_task(manager.enrichment_broadcast(data))
                except Exception:
                    pass

        def step(self, action: LongHorizonMemoryAction) -> LongHorizonMemoryObservation:
            obs = super().step(action)
            try:
                data = obs.model_dump() if hasattr(obs, "model_dump") else obs.dict()
                data["operation"] = action.operation
                self._broadcast(data)
            except Exception as e:
                print(f"[BROADCAST ERROR] {e}")
            return obs

        def reset(self) -> LongHorizonMemoryObservation:
            obs = super().reset()
            try:
                data = obs.model_dump() if hasattr(obs, "model_dump") else obs.dict()
                data["operation"] = "reset"
                self._broadcast(data)
            except Exception as e:
                print(f"[BROADCAST ERROR] {e}")
            return obs
    return MonitoredEnv

app = create_app(
    get_monitored_env_class(manager),
    LongHorizonMemoryAction,
    LongHorizonMemoryObservation,
    env_name="long_horizon_memory",
    max_concurrent_envs=1,
)

# --- Serve custom UI if available ---
ui_dist_path = os.path.join(os.path.dirname(__file__), "dist")
if os.path.exists(ui_dist_path):
    print(f"[SERVER] Mounting custom UI from {ui_dist_path}")
    app.mount("/web", StaticFiles(directory=ui_dist_path, html=True), name="custom_web")
else:
    print(f"[SERVER] Custom UI dist not found at {ui_dist_path}")

@app.websocket("/ws/monitor")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Just keep connection alive, we primarily push
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Middleware to intercept environment calls and broadcast updates
@app.post("/step")
async def monitored_step(action_req: dict):
    # This is a bit tricky because create_app hides the original route
    # We'll use a wrapper or just rely on the environment class broadcasting
    pass # See next step for better integration

# --- Existing routes ---


@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.post("/api/broadcast")
async def broadcast_endpoint(data: dict):
    """Endpoint for HF Space to push updates to the Vercel dashboard."""
    await manager.enrichment_broadcast(data)
    return {"status": "broadcasted"}


@app.get("/")
async def root_redirect():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/web")


@app.get("/routes")
async def list_routes():
    return [{"path": route.path, "name": route.name} for route in app.routes]


def main(host: str = "0.0.0.0", port: int = 7860):
    """
    Entry point for direct execution via uv run or python -m.

    This function enables running the server without Docker:
        uv run --project . server
        uv run --project . server --port 8001
        python -m long_horizon_memory.server.app

    Args:
        host: Host address to bind to (default: "0.0.0.0")
        port: Port number to listen on (default: 8000)

    For production deployments, consider using uvicorn directly with
    multiple workers:
        uvicorn long_horizon_memory.server.app:app --workers 4
    """
    import uvicorn

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
