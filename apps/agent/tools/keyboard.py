"""Guarded keyboard tools for Bobby: press any safe key combination and type plain text.

Tools:
  press_keys(keys)    press a combination such as "ctrl+shift+n" or "f2"
  type_text(text)     type plain, non-sensitive text into the active window

Works together with windows.py (fixed command list). Dangerous combinations are blocked.
"""
from __future__ import annotations

import asyncio
import ctypes
import logging
import time

from livekit.agents import RunContext, function_tool

from apps.agent.tools import windows as tw

logger = logging.getLogger(__name__)

KEYEVENTF_UNICODE = 0x0004
MAX_KEYS = 4
MAX_TEXT_LENGTH = 300

MODIFIERS = {"ctrl", "alt", "shift", "win"}

# Extra keys on top of the ones windows already knows.
EXTRA_KEYS: dict[str, int] = {"backspace": 0x08, "insert": 0x2D}
for _n in range(1, 13):
    EXTRA_KEYS[f"f{_n}"] = 0x6F + _n          # F1 = 0x70 ... F12 = 0x7B

ALIASES = {
    "control": "ctrl", "windows": "win", "super": "win", "cmd": "win", "option": "alt",
    "return": "enter", "escape": "esc", "del": "delete", "pgup": "pageup", "pgdn": "pagedown",
    "page_up": "pageup", "page_down": "pagedown", "bksp": "backspace", "spacebar": "space",
    "equals": "plus", "=": "plus", "-": "minus", ".": "period",
}

# Never allowed through press_keys. Each has a safer dedicated route.
BLOCKED_COMBOS = {
    frozenset({"alt", "f4"}): "Use windows_command close_window instead.",
    frozenset({"ctrl", "alt", "delete"}): "That opens the security screen and is not allowed.",
    frozenset({"win", "l"}): "Use windows_command lock_screen instead.",
    frozenset({"shift", "delete"}): "That deletes permanently and is not allowed.",
    frozenset({"win", "x"}): "The power menu is not allowed.",
}


def _key_code(name: str) -> int | None:
    if name in tw.VK:
        return tw.VK[name]
    return EXTRA_KEYS.get(name)


def _parse(keys: str) -> tuple[list[str], str | None]:
    """Return (normalized key names, error message or None)."""
    parts = [ALIASES.get(p.strip().lower(), p.strip().lower()) for p in keys.split("+") if p.strip()]
    if not parts:
        return [], "No keys given. Example: ctrl+shift+n."
    if len(parts) > MAX_KEYS:
        return [], f"At most {MAX_KEYS} keys at once."
    if len(set(parts)) != len(parts):
        return [], "A key was repeated."
    for part in parts:
        if _key_code(part) is None:
            return [], f"Unknown key '{part}'."
    non_modifiers = [p for p in parts if p not in MODIFIERS]
    if len(non_modifiers) > 1:
        return [], "Use at most one normal key plus modifiers (ctrl, alt, shift, win)."
    blocked = BLOCKED_COMBOS.get(frozenset(parts))
    if blocked:
        return [], f"Blocked: {blocked}"
    # Put modifiers first so the normal key is pressed last.
    ordered = [p for p in parts if p in MODIFIERS] + non_modifiers
    return ordered, None


def _press(names: list[str]) -> None:
    codes = [_key_code(n) for n in names]
    for code in codes:
        tw._key_event(code, False)
        time.sleep(0.02)
    for code in reversed(codes):
        tw._key_event(code, True)
        time.sleep(0.02)


def _unicode_event(unit: int, key_up: bool) -> None:
    flags = KEYEVENTF_UNICODE | (tw.KEYEVENTF_KEYUP if key_up else 0)
    event = tw.INPUT()
    event.type = tw.INPUT_KEYBOARD
    event.ki = tw.KEYBDINPUT(0, unit, flags, 0, 0)
    if tw.user32.SendInput(1, ctypes.byref(event), ctypes.sizeof(tw.INPUT)) != 1:
        raise OSError(f"Windows blocked typing (error {ctypes.get_last_error()}).")


def _type(text: str) -> None:
    for char in text:
        if char == "\n":
            _press(["enter"])
            continue
        if char == "\t":
            _press(["tab"])
            continue
        if ord(char) < 32:
            raise ValueError("Control characters are not allowed in typed text.")
        data = char.encode("utf-16-le")
        for index in range(0, len(data), 2):          # surrogate pairs for emoji
            unit = int.from_bytes(data[index:index + 2], "little")
            _unicode_event(unit, False)
            _unicode_event(unit, True)
        time.sleep(0.01)


@function_tool()
async def press_keys(context: RunContext, keys: str) -> str:
    """Press a keyboard shortcut in the active window, for example "ctrl+shift+n", "f2",
    "alt+left", "ctrl+backspace" or "win+shift+s". Prefer windows_command when a named command
    exists. Not allowed: alt+f4, ctrl+alt+delete, win+l, shift+delete, win+x.

    Args:
        keys: Keys joined with +, using at most one normal key plus ctrl, alt, shift or win.
    """
    if not tw.IS_WINDOWS:
        return "Key presses only work on Windows."
    names, error = _parse(keys)
    if error:
        return f"Key press not sent: {error}"
    label = "+".join(n.title() for n in names)
    try:
        await asyncio.to_thread(_press, names)
    except OSError as err:
        return f"Key press failed: {err}"
    return f"Sent {label}."


@function_tool()
async def type_text(context: RunContext, text: str) -> str:
    """Type plain text into the window that is active right now. Click or focus the right
    field first. Never use this for passwords, tokens, card numbers or other secrets.

    Args:
        text: The text to type, up to 300 characters. New lines press Enter.
    """
    if not tw.IS_WINDOWS:
        return "Typing only works on Windows."
    if not text:
        return "There was no text to type."
    if len(text) > MAX_TEXT_LENGTH:
        return f"Typing is limited to {MAX_TEXT_LENGTH} characters at a time."
    try:
        await asyncio.to_thread(_type, text)
    except (OSError, ValueError) as err:
        return f"Typing failed: {err}"
    return f"Typed {len(text)} characters into the active window."


KEYBOARD_TOOLS = [press_keys, type_text]