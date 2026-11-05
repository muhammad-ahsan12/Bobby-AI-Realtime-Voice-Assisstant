from fastapi.testclient import TestClient

from apps.backend import main as backend


def test_activity_accepts_dashboard_event_metadata(monkeypatch):
    monkeypatch.setattr(backend, "INTERNAL_KEY", "")
    backend.hub.history.clear()
    client = TestClient(backend.app)

    response = client.post(
        "/api/activity",
        json={
            "type": "tool_call",
            "tool": "read_file",
            "message": "Tool started.",
            "data": {
                "call_id": "call-1",
                "group": "filesystem",
                "status": "running",
            },
        },
    )

    assert response.status_code == 200
    item = response.json()
    assert item["type"] == "tool_call"
    assert item["data"]["call_id"] == "call-1"
    assert item["data"]["group"] == "filesystem"
    assert backend.hub.history[-1]["id"] == item["id"]
    backend.hub.history.clear()


def test_transcripts_are_live_but_not_retained_in_history(monkeypatch):
    monkeypatch.setattr(backend, "INTERNAL_KEY", "")
    backend.hub.history.clear()
    client = TestClient(backend.app)

    response = client.post(
        "/api/activity",
        json={
            "type": "transcript",
            "message": "Transcript updated.",
            "data": {"role": "user", "text": "سلام"},
        },
    )

    assert response.status_code == 200
    assert response.json()["data"]["text"] == "سلام"
    assert list(backend.hub.history) == []


def test_cors_allows_localhost_and_loopback_origins():
    client = TestClient(backend.app)
    origins = (
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    )

    for origin in origins:
        response = client.get("/api/health", headers={"Origin": origin})
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin
