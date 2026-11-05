import asyncio

from apps.agent.bridges import chrome_bridge


def test_youtube_actions_get_a_longer_bounded_bridge_timeout(monkeypatch):
    async def verify_timeouts():
        bridge = chrome_bridge.ChromeBridge()
        observed_timeouts = []

        class FakeWebSocket:
            closed = False

            async def send_json(self, _payload):
                return None

        async def complete_immediately(future, *, timeout):
            observed_timeouts.append(timeout)
            future.set_result({"ok": True})
            return await future

        bridge._websocket = FakeWebSocket()
        monkeypatch.setattr(chrome_bridge.asyncio, "wait_for", complete_immediately)

        await bridge.request("youtube.search_play", {"query": "latest naat"})
        await bridge.request("tabs.list", {})

        assert observed_timeouts == [
            chrome_bridge.YOUTUBE_ACTION_TIMEOUT_SECONDS,
            chrome_bridge.DEFAULT_ACTION_TIMEOUT_SECONDS,
        ]
        assert bridge._pending == {}

    asyncio.run(verify_timeouts())
