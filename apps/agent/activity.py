"""Privacy-conscious activity publishing for the web dashboard."""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any

import aiohttp

logger = logging.getLogger(__name__)

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000").rstrip("/")
INTERNAL_KEY = os.getenv("INTERNAL_KEY", "")
MAX_TRANSCRIPT_LENGTH = 240

_SECRET_PATTERNS = (
    re.compile(r"(?i)\b(?:api[_ -]?key|token|password|secret|authorization)\b\s*[:=]\s*\S+"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/-]+=*"),
    re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk-[A-Za-z0-9_-]{12,})\b"),
    re.compile(r"\b[A-Za-z0-9_-]{48,}\b"),
)


def safe_transcript(text: str) -> str:
    """Redact credential-like values and bound transcript text sent to the backend."""
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub("[redacted]", text)
    if len(text) > MAX_TRANSCRIPT_LENGTH:
        text = text[:MAX_TRANSCRIPT_LENGTH].rstrip() + "…"
    return text


async def publish_activity(
    event_type: str,
    message: str,
    *,
    tool: str | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    payload: dict[str, Any] = {
        "type": event_type,
        "message": message[:180],
    }
    if tool is not None:
        payload["tool"] = tool
    if data is not None:
        payload["data"] = data

    headers = {"X-Internal-Key": INTERNAL_KEY} if INTERNAL_KEY else {}
    timeout = aiohttp.ClientTimeout(total=2)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as client:
            async with client.post(
                f"{BACKEND_URL}/api/activity",
                json=payload,
                headers=headers,
            ) as response:
                if response.status >= 400:
                    logger.warning(
                        "Activity publish failed with HTTP status %d.", response.status
                    )
    except (aiohttp.ClientError, asyncio.TimeoutError):
        logger.warning("Could not publish activity to the Bobby backend.")
