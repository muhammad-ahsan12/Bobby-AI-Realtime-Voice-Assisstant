"""Bobby backend (FastAPI).

Jobs:
  1. POST /api/token      -> gives the browser a LiveKit token that also dispatches the "bobby" agent
  2. /api/activity, /ws/activity -> live feed of what Bobby is doing (tools, results) for the dashboard
  3. GET  /api/health     -> quick status check

Run (from D:\\bobby\\apps\\backend):
  uvicorn main:app --host 127.0.0.1 --port 8000 --reload
"""
import datetime, os, time, uuid
from collections import deque
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[2] / ".env")   # D:\bobby\.env

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from livekit import api

LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")
AGENT_NAME = os.getenv("AGENT_NAME", "bobby")
INTERNAL_KEY = os.getenv("INTERNAL_KEY", "")          # optional: protects POST /api/activity
DEFAULT_CORS_ORIGINS = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", ",".join(DEFAULT_CORS_ORIGINS)).split(",")
    if origin.strip()
]

app = FastAPI(title="Bobby backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------- health
@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "agent": AGENT_NAME,
        "livekit_configured": bool(LIVEKIT_URL and LIVEKIT_API_KEY and LIVEKIT_API_SECRET),
    }


# ---------------------------------------------------------------- token
class TokenRequest(BaseModel):
    identity: str | None = None
    name: str | None = None


@app.post("/api/token")
async def create_token(body: TokenRequest | None = None):
    if not (LIVEKIT_URL and LIVEKIT_API_KEY and LIVEKIT_API_SECRET):
        raise HTTPException(500, "LiveKit keys are missing in .env")

    body = body or TokenRequest()
    room = f"bobby-{uuid.uuid4().hex[:8]}"                 # new room per session
    identity = body.identity or f"user-{uuid.uuid4().hex[:6]}"

    token = (
        api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(identity)
        .with_name(body.name or "Ahsan")
        .with_ttl(datetime.timedelta(hours=1))
        .with_grants(api.VideoGrants(room_join=True, room=room))
        .with_room_config(
            api.RoomConfiguration(agents=[api.RoomAgentDispatch(agent_name=AGENT_NAME)])
        )
        .to_jwt()
    )
    return {"token": token, "url": LIVEKIT_URL, "room": room, "identity": identity}


# ---------------------------------------------------------------- activity feed
class ActivityEvent(BaseModel):
    type: str = "info"            # Existing and dashboard-specific event types.
    tool: str | None = None
    message: str
    data: dict | None = None


class Hub:
    def __init__(self):
        self.clients: set[WebSocket] = set()
        self.history: deque = deque(maxlen=100)

    async def publish(self, event: dict):
        if event.get("type") != "transcript":
            self.history.append(event)
        for ws in list(self.clients):
            try:
                await ws.send_json(event)
            except Exception:
                self.clients.discard(ws)


hub = Hub()


@app.post("/api/activity")
async def post_activity(event: ActivityEvent, x_internal_key: str | None = Header(default=None)):
    if INTERNAL_KEY and x_internal_key != INTERNAL_KEY:
        raise HTTPException(401, "bad internal key")
    item = {"id": uuid.uuid4().hex[:8], "ts": time.time(), **event.model_dump()}
    await hub.publish(item)
    return item


@app.get("/api/activity")
async def get_activity():
    return list(hub.history)


@app.websocket("/ws/activity")
async def ws_activity(ws: WebSocket):
    await ws.accept()
    hub.clients.add(ws)
    try:
        for item in hub.history:
            await ws.send_json(item)
        while True:
            await ws.receive_text()        # keep the connection open
    except WebSocketDisconnect:
        pass
    finally:
        hub.clients.discard(ws)