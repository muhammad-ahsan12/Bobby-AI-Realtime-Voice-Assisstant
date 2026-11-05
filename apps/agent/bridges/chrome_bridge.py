"""Loopback-only RPC bridge between Bobby and the approved Chrome extension."""

import asyncio
import json
import logging
import uuid

from aiohttp import web

from apps.agent.activity import publish_activity

logger = logging.getLogger(__name__)

EXTENSION_ID = "hpmgfcjoafmckcfkobcaiihoahdlnajj"
EXTENSION_ORIGIN = f"chrome-extension://{EXTENSION_ID}"
DEFAULT_ACTION_TIMEOUT_SECONDS = 30
YOUTUBE_ACTION_TIMEOUT_SECONDS = 90
ALLOWED_ACTIONS = {
    "tabs.list",
    "tabs.activate",
    "tabs.new",
    "tabs.close",
    "page.navigate",
    "page.back",
    "page.reload",
    "page.snapshot",
    "page.click",
    "page.type",
    "page.key",
    "page.scroll",
    "media.control",
    "youtube.search_play",
}


class ChromeBridgeError(RuntimeError):
    """Raised when an authorized Chrome operation cannot be completed."""


class ChromeBridge:
    def __init__(self, host: str = "127.0.0.1", port: int = 8765) -> None:
        self._host = host
        self._port = port
        self._runner: web.AppRunner | None = None
        self._websocket: web.WebSocketResponse | None = None
        self._pending: dict[str, asyncio.Future[object]] = {}

    async def start(self) -> None:
        app = web.Application(client_max_size=1024 * 1024)
        app.router.add_get("/browser", self._handle_websocket)
        self._runner = web.AppRunner(app, access_log=None)
        try:
            await self._runner.setup()
            site = web.TCPSite(self._runner, self._host, self._port)
            await site.start()
        except Exception:
            await self._runner.cleanup()
            self._runner = None
            raise
        logger.info("Chrome extension bridge listening on %s:%s.", self._host, self._port)

    async def close(self) -> None:
        websocket = self._websocket
        self._websocket = None
        if websocket is not None and not websocket.closed:
            await websocket.close()
        for future in self._pending.values():
            if not future.done():
                future.set_exception(ChromeBridgeError("The Chrome bridge has closed."))
        self._pending.clear()
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None

    async def request(self, action: str, params: dict[str, object]) -> object:
        if action not in ALLOWED_ACTIONS:
            raise ChromeBridgeError(f"Unsupported Chrome action: {action}")
        websocket = self._websocket
        if websocket is None or websocket.closed:
            raise ChromeBridgeError(
                "The Chrome extension is not connected. Start a Bobby voice session and check "
                "that its extension is enabled."
            )

        request_id = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        timeout_seconds = (
            YOUTUBE_ACTION_TIMEOUT_SECONDS
            if action == "youtube.search_play"
            else DEFAULT_ACTION_TIMEOUT_SECONDS
        )
        try:
            await websocket.send_json(
                {"type": "request", "id": request_id, "action": action, "params": params}
            )
            return await asyncio.wait_for(future, timeout=timeout_seconds)
        except ChromeBridgeError:
            raise
        except asyncio.TimeoutError as error:
            raise ChromeBridgeError(
                f"Chrome did not respond within {timeout_seconds} seconds. "
                "Check that the extension is connected."
            ) from error
        except (ConnectionError, RuntimeError) as error:
            raise ChromeBridgeError(f"Could not reach Chrome: {error}") from error
        finally:
            self._pending.pop(request_id, None)

    async def _handle_websocket(self, request: web.Request) -> web.StreamResponse:
        if request.headers.get("Origin") != EXTENSION_ORIGIN:
            raise web.HTTPForbidden(text="Only Bobby's Chrome extension may connect.")

        websocket = web.WebSocketResponse(heartbeat=20, max_msg_size=1024 * 1024)
        await websocket.prepare(request)
        previous = self._websocket
        self._websocket = websocket
        if previous is not None and previous is not websocket and not previous.closed:
            await previous.close()
        logger.info("Authorized Chrome extension connected.")
        await publish_activity(
            "toolset_status",
            "Chrome extension connected.",
            tool="browser",
            data={"group": "browser", "status": "ready"},
        )

        try:
            async for message in websocket:
                if message.type != web.WSMsgType.TEXT:
                    continue
                try:
                    payload = json.loads(message.data)
                except json.JSONDecodeError:
                    logger.warning("Ignoring malformed message from Chrome extension.")
                    continue
                if not isinstance(payload, dict) or payload.get("type") != "response":
                    continue

                request_id = payload.get("id")
                future = self._pending.get(request_id) if isinstance(request_id, str) else None
                if future is None or future.done():
                    continue
                error = payload.get("error")
                if isinstance(error, str) and error:
                    future.set_exception(ChromeBridgeError(error))
                else:
                    future.set_result(payload.get("result"))
        finally:
            if self._websocket is websocket:
                self._websocket = None
            logger.info("Chrome extension disconnected.")
            await publish_activity(
                "toolset_status",
                "Chrome extension disconnected.",
                tool="browser",
                data={"group": "browser", "status": "disconnected"},
            )
        return websocket
