from __future__ import annotations

import importlib
import sys

import pytest


@pytest.fixture
def windows():
    if sys.platform != "win32":
        pytest.skip("Windows window APIs are required")
    importlib.import_module("apps.agent.runtime")
    return importlib.import_module("apps.agent.tools.windows")


def test_find_window_includes_minimized_windows(monkeypatch, windows) -> None:
    title = "Example - Google Chrome"
    monkeypatch.setattr(windows.user32, "EnumWindows", lambda callback, _param: callback(42, 0))
    monkeypatch.setattr(windows.user32, "IsIconic", lambda _hwnd: True)
    monkeypatch.setattr(windows.user32, "IsWindowVisible", lambda _hwnd: False)
    monkeypatch.setattr(windows.user32, "GetWindowTextLengthW", lambda _hwnd: len(title))
    monkeypatch.setattr(
        windows.user32,
        "GetWindowTextW",
        lambda _hwnd, buffer, _size: setattr(buffer, "value", title),
    )
    monkeypatch.setattr(
        windows.user32,
        "GetClassNameW",
        lambda _hwnd, buffer, _size: setattr(buffer, "value", "Chrome_WidgetWin_1"),
    )

    assert windows._find_window("Google Chrome", prefer_minimized=True) == 42


def test_open_app_restores_existing_chrome_before_launching(monkeypatch, windows) -> None:
    restored: list[int] = []
    monkeypatch.setattr(windows, "_find_window", lambda *_args, **_kwargs: 42)
    monkeypatch.setattr(windows, "_window_title", lambda _hwnd: "Example - Google Chrome")
    monkeypatch.setattr(windows, "_restore_window", lambda hwnd: restored.append(hwnd) or True)
    monkeypatch.setattr(windows.os, "startfile", lambda _target: (_ for _ in ()).throw(AssertionError()))

    assert windows._launch("chrome") == "Restored and focused: Example - Google Chrome."
    assert restored == [42]


def test_restore_window_shows_and_focuses_target(monkeypatch, windows) -> None:
    calls: list[tuple[str, int, int | None]] = []
    monkeypatch.setattr(
        windows.user32,
        "ShowWindow",
        lambda hwnd, command: calls.append(("show", hwnd, command)),
    )
    monkeypatch.setattr(
        windows.user32,
        "BringWindowToTop",
        lambda hwnd: calls.append(("raise", hwnd, None)),
    )
    monkeypatch.setattr(
        windows.user32,
        "SetForegroundWindow",
        lambda hwnd: calls.append(("focus", hwnd, None)),
    )
    monkeypatch.setattr(windows.user32, "GetForegroundWindow", lambda: 42)

    assert windows._restore_window(42)
    assert calls == [
        ("show", 42, windows.SW_RESTORE),
        ("raise", 42, None),
        ("focus", 42, None),
    ]
