"""Fast, deterministic Windows control for Bobby: keyboard shortcuts and window actions.

No screenshots, no mouse guessing. Each spoken command maps to a fixed shortcut or Win32 call.

Tools:
  windows_command(command, repeat, target_window)   shortcuts, window control, volume, media
  open_app(app)                                      open a few common apps by name
"""
from __future__ import annotations

import asyncio
import ctypes
import logging
import os
import shutil
import sys
import time
from ctypes import wintypes

from livekit.agents import RunContext, function_tool

logger = logging.getLogger(__name__)
IS_WINDOWS = sys.platform == "win32"

# ---------------------------------------------------------------- Win32 plumbing
if IS_WINDOWS:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    ULONG_PTR = wintypes.WPARAM

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [
            ("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
            ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR),
        ]

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR),
        ]

    class HARDWAREINPUT(ctypes.Structure):
        _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]

    class _INPUTUNION(ctypes.Union):
        _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]

    class INPUT(ctypes.Structure):
        _anonymous_ = ("u",)
        _fields_ = [("type", wintypes.DWORD), ("u", _INPUTUNION)]

    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    user32.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
    user32.SendInput.restype = wintypes.UINT
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.ShowWindow.argtypes = (wintypes.HWND, ctypes.c_int)
    user32.PostMessageW.argtypes = (wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    user32.GetWindowTextLengthW.argtypes = (wintypes.HWND,)
    user32.GetWindowTextW.argtypes = (wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)
    user32.GetClassNameW.argtypes = (wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)
    user32.IsWindowVisible.argtypes = (wintypes.HWND,)
    user32.IsIconic.argtypes = (wintypes.HWND,)
    user32.BringWindowToTop.argtypes = (wintypes.HWND,)
    user32.SetForegroundWindow.argtypes = (wintypes.HWND,)
    user32.EnumWindows.argtypes = (WNDENUMPROC, wintypes.LPARAM)

INPUT_KEYBOARD = 1
KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002
SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE = 3, 6, 9
WM_CLOSE = 0x0010

VK: dict[str, int] = {
    "win": 0x5B, "ctrl": 0x11, "alt": 0x12, "shift": 0x10, "tab": 0x09, "enter": 0x0D,
    "esc": 0x1B, "space": 0x20, "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28,
    "delete": 0x2E, "home": 0x24, "end": 0x23, "pageup": 0x21, "pagedown": 0x22,
    "printscreen": 0x2C, "f4": 0x73, "f5": 0x74, "f11": 0x7A,
    "plus": 0xBB, "minus": 0xBD, "period": 0xBE,
    "volume_mute": 0xAD, "volume_down": 0xAE, "volume_up": 0xAF,
    "media_next": 0xB0, "media_prev": 0xB1, "media_play_pause": 0xB3,
}
for _c in "abcdefghijklmnopqrstuvwxyz":
    VK[_c] = ord(_c.upper())
for _d in "0123456789":
    VK[_d] = ord(_d)
EXTENDED_KEYS = {0x25, 0x26, 0x27, 0x28, 0x2E, 0x24, 0x23, 0x21, 0x22, 0x5B, 0x2C}

# Protected shell windows: never minimize or close these.
PROTECTED_CLASSES = {"Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"}


def _key_event(vk: int, key_up: bool) -> None:
    flags = KEYEVENTF_KEYUP if key_up else 0
    if vk in EXTENDED_KEYS:
        flags |= KEYEVENTF_EXTENDEDKEY
    event = INPUT()
    event.type = INPUT_KEYBOARD
    event.ki = KEYBDINPUT(vk, 0, flags, 0, 0)
    if user32.SendInput(1, ctypes.byref(event), ctypes.sizeof(INPUT)) != 1:
        raise OSError(f"Windows blocked the key press (error {ctypes.get_last_error()}).")


def _send_combo(keys: tuple[str, ...]) -> None:
    codes = [VK[k] for k in keys]
    for code in codes:
        _key_event(code, False)
        time.sleep(0.02)
    for code in reversed(codes):
        _key_event(code, True)
        time.sleep(0.02)


def _window_title(hwnd) -> str:
    length = user32.GetWindowTextLengthW(hwnd)
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


def _window_class(hwnd) -> str:
    buffer = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buffer, 256)
    return buffer.value


def _find_window(
    text: str,
    *,
    class_name: str | None = None,
    prefer_minimized: bool = False,
):
    found: list[tuple[object, bool]] = []

    @WNDENUMPROC
    def _collect(hwnd, _lparam):
        minimized = bool(user32.IsIconic(hwnd))
        if user32.IsWindowVisible(hwnd) or minimized:
            title = _window_title(hwnd)
            matches_title = bool(text) and text.casefold() in title.casefold()
            matches_class = bool(class_name) and class_name.casefold() == _window_class(hwnd).casefold()
            if matches_title or matches_class:
                found.append((hwnd, minimized))
        return True

    user32.EnumWindows(_collect, 0)
    if prefer_minimized:
        return next((hwnd for hwnd, minimized in found if minimized), None) or (
            found[0][0] if found else None
        )
    return found[0][0] if found else None


def _resolve_window(target: str | None, *, prefer_minimized: bool = False):
    """Return (hwnd, title) for a named window or the active window."""
    if target:
        hwnd = _find_window(target, prefer_minimized=prefer_minimized)
        if not hwnd:
            raise LookupError(f"No visible or minimized window with '{target}' in its title.")
    else:
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            raise LookupError("There is no active window.")
    if _window_class(hwnd) in PROTECTED_CLASSES:
        raise LookupError("That is the desktop or taskbar, so I won't change it.")
    return hwnd, _window_title(hwnd) or "(untitled window)"


# ---------------------------------------------------------------- command tables
# name -> (keys to press together, short description)
SHORTCUTS: dict[str, tuple[tuple[str, ...], str]] = {
    # windows and desktops
    "show_desktop": (("win", "d"), "show or hide the desktop (minimize everything)"),
    "minimize_others": (("win", "home"), "minimize everything except the active window"),
    "snap_left": (("win", "left"), "snap the active window to the left half"),
    "snap_right": (("win", "right"), "snap the active window to the right half"),
    "switch_window": (("alt", "tab"), "switch to the previous window"),
    "task_view": (("win", "tab"), "show all windows and desktops"),
    "next_desktop": (("win", "ctrl", "right"), "go to the next virtual desktop"),
    "previous_desktop": (("win", "ctrl", "left"), "go to the previous virtual desktop"),
    "new_desktop": (("win", "ctrl", "d"), "create a new virtual desktop"),
    # system
    "open_start": (("win",), "open the Start menu"),
    "open_search": (("win", "s"), "open Windows search"),
    "open_settings": (("win", "i"), "open Settings"),
    "open_run": (("win", "r"), "open the Run box"),
    "open_explorer": (("win", "e"), "open File Explorer"),
    "task_manager": (("ctrl", "shift", "esc"), "open Task Manager"),
    "notifications": (("win", "n"), "open notifications and calendar"),
    "quick_settings": (("win", "a"), "open quick settings (wifi, brightness)"),
    "widgets": (("win", "w"), "open widgets"),
    "clipboard_history": (("win", "v"), "open clipboard history"),
    "emoji_panel": (("win", "period"), "open the emoji panel"),
    "screenshot_tool": (("win", "shift", "s"), "start the snipping screenshot tool"),
    "screenshot_full": (("printscreen",), "take a screenshot"),
    "project_display": (("win", "p"), "choose the screen projection mode"),
    "magnifier_on": (("win", "plus"), "turn on the magnifier or zoom in"),
    "magnifier_off": (("win", "esc"), "turn off the magnifier"),
    # editing
    "copy": (("ctrl", "c"), "copy"),
    "cut": (("ctrl", "x"), "cut"),
    "paste": (("ctrl", "v"), "paste"),
    "select_all": (("ctrl", "a"), "select all"),
    "undo": (("ctrl", "z"), "undo"),
    "redo": (("ctrl", "y"), "redo"),
    "save": (("ctrl", "s"), "save"),
    "find": (("ctrl", "f"), "find in the page or document"),
    "new": (("ctrl", "n"), "new window or document"),
    "press_enter": (("enter",), "press Enter"),
    "press_escape": (("esc",), "press Escape"),
    "press_delete": (("delete",), "press Delete (deletes the selection)"),
    # navigation and view
    "refresh": (("f5",), "refresh"),
    "fullscreen": (("f11",), "toggle full screen"),
    "scroll_up": (("pageup",), "page up"),
    "scroll_down": (("pagedown",), "page down"),
    "scroll_top": (("ctrl", "home"), "go to the top"),
    "scroll_bottom": (("ctrl", "end"), "go to the bottom"),
    "zoom_in": (("ctrl", "plus"), "zoom in"),
    "zoom_out": (("ctrl", "minus"), "zoom out"),
    "zoom_reset": (("ctrl", "0"), "reset zoom"),
    # browser or app tabs
    "new_tab": (("ctrl", "t"), "new tab"),
    "close_tab": (("ctrl", "w"), "close the current tab"),
    "reopen_tab": (("ctrl", "shift", "t"), "reopen the last closed tab"),
    "next_tab": (("ctrl", "tab"), "next tab"),
    "previous_tab": (("ctrl", "shift", "tab"), "previous tab"),
    # sound and media
    "volume_up": (("volume_up",), "volume up (each step is about 2%)"),
    "volume_down": (("volume_down",), "volume down (each step is about 2%)"),
    "mute": (("volume_mute",), "mute or unmute the system sound"),
    "media_play_pause": (("media_play_pause",), "play or pause media"),
    "media_next": (("media_next",), "next track"),
    "media_previous": (("media_prev",), "previous track"),
}

# Commands handled with Win32 calls instead of key presses.
API_COMMANDS = {
    "minimize_window": "minimize the active window, or the one named in target_window",
    "maximize_window": "maximize the active window, or the one named in target_window",
    "restore_window": "restore a minimized or maximized window",
    "close_window": "close the active window or target_window (ask the user first)",
    "lock_screen": "lock the PC (ask the user first)",
}

# Commands that should only run after the user clearly said yes.
NEEDS_CONFIRMATION = {"close_window", "lock_screen", "press_delete"}

APP_LAUNCH: dict[str, str] = {
    "notepad": "notepad",
    "calculator": "calc",
    "paint": "mspaint",
    "file explorer": "explorer",
    "task manager": "taskmgr",
    "control panel": "control",
    "settings": "ms-settings:",
    "snipping tool": "ms-screenclip:",
    "chrome": "chrome",
    "edge": "msedge",
    "vscode": "code",
    "terminal": "wt",
    "word": "winword",
    "excel": "excel",
    "powerpoint": "powerpnt",
}

APP_WINDOW_TITLES = {
    "notepad": "Notepad",
    "calculator": "Calculator",
    "paint": "Paint",
    "task manager": "Task Manager",
    "control panel": "Control Panel",
    "settings": "Settings",
    "snipping tool": "Snipping Tool",
    "chrome": "Google Chrome",
    "edge": "Microsoft Edge",
    "vscode": "Visual Studio Code",
    "word": "Word",
    "excel": "Excel",
    "powerpoint": "PowerPoint",
}

_COMMAND_LIST = ", ".join(sorted([*SHORTCUTS, *API_COMMANDS]))
_APP_LIST = ", ".join(sorted(APP_LAUNCH))


# ---------------------------------------------------------------- command runners
def _run_api_command(command: str, target: str | None) -> str:
    if command == "lock_screen":
        if not user32.LockWorkStation():
            raise OSError("Windows would not lock the screen.")
        return "Locked the screen."

    hwnd, title = _resolve_window(
        target,
        prefer_minimized=command == "restore_window",
    )
    if command == "minimize_window":
        user32.ShowWindow(hwnd, SW_MINIMIZE)
        return f"Minimized: {title}."
    if command == "maximize_window":
        user32.ShowWindow(hwnd, SW_MAXIMIZE)
        return f"Maximized: {title}."
    if command == "restore_window":
        focused = _restore_window(hwnd)
        if focused:
            return f"Restored and focused: {title}."
        return f"Restored: {title}, but Windows did not allow Bobby to focus it."
    if command == "close_window":
        user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)  # polite close; apps may ask to save first
        return f"Asked this window to close: {title}."
    raise ValueError(command)


def _restore_window(hwnd) -> bool:
    user32.ShowWindow(hwnd, SW_RESTORE)
    user32.BringWindowToTop(hwnd)
    user32.SetForegroundWindow(hwnd)
    return user32.GetForegroundWindow() == hwnd


def _run_shortcut(command: str, repeat: int) -> str:
    keys, _description = SHORTCUTS[command]
    for _ in range(repeat):
        _send_combo(keys)
        time.sleep(0.05)
    label = "+".join(key.title() for key in keys)
    suffix = f" x{repeat}" if repeat > 1 else ""
    return f"Sent {label}{suffix} for {command}."


def _launch(app: str) -> str:
    key = app.strip().lower()
    if key not in APP_LAUNCH:
        return f"I can't open '{app}' this way. Available: {_APP_LIST}."

    title_match = APP_WINDOW_TITLES.get(key, "")
    class_match = "CabinetWClass" if key == "file explorer" else None
    existing = _find_window(
        title_match,
        class_name=class_match,
        prefer_minimized=True,
    )
    if existing:
        title = _window_title(existing) or app
        if _restore_window(existing):
            return f"Restored and focused: {title}."
        return f"Restored: {title}, but Windows did not allow Bobby to focus it."

    target = APP_LAUNCH[key]
    try:
        os.startfile(target)  # type: ignore[attr-defined]
    except OSError:
        resolved = shutil.which(target)
        if not resolved:
            return f"Could not find {app} on this PC."
        os.startfile(resolved)  # type: ignore[attr-defined]
    return f"Asked Windows to open {app}."


# ---------------------------------------------------------------- tools
async def windows_command(
    context: RunContext,
    command: str,
    repeat: int = 1,
    target_window: str | None = None,
) -> str:
    """Run a fast Windows command: a keyboard shortcut, window control, volume or media key.
    Use this first for any minimize, maximize, snap, switch, volume, copy/paste or system shortcut.

    Args:
        command: One of: __COMMANDS__.
        repeat: How many times to press it, from 1 to 10 (useful for volume steps).
        target_window: Part of a window title for minimize_window, maximize_window, restore_window
            or close_window. Leave empty to use the active window.
    """
    name = command.strip().lower().replace(" ", "_")
    if not IS_WINDOWS:
        return "Windows commands only work on Windows."
    if name not in SHORTCUTS and name not in API_COMMANDS:
        return f"Unknown command '{command}'. Valid commands: {_COMMAND_LIST}."
    if not 1 <= repeat <= 10:
        return "repeat must be between 1 and 10."

    try:
        if name in API_COMMANDS:
            result = await asyncio.to_thread(_run_api_command, name, target_window)
        else:
            result = await asyncio.to_thread(_run_shortcut, name, repeat)
    except (LookupError, OSError) as error:
        return f"Windows command failed: {error}"
    return result


async def open_app(context: RunContext, app: str) -> str:
    """Open a common Windows app by name, restoring its existing window when found.

    Args:
        app: One of: __APPS__.
    """
    if not IS_WINDOWS:
        return "Opening apps only works on Windows."
    try:
        result = await asyncio.to_thread(_launch, app)
    except OSError as error:
        return f"Could not open {app}: {error}"
    return result


# Build the tool descriptions BEFORE wrapping, so the model sees the real command lists.
windows_command.__doc__ = (windows_command.__doc__ or "").replace("__COMMANDS__", _COMMAND_LIST)
open_app.__doc__ = (open_app.__doc__ or "").replace("__APPS__", _APP_LIST)
windows_command = function_tool()(windows_command)
open_app = function_tool()(open_app)

WINDOWS_TOOLS = [windows_command, open_app]