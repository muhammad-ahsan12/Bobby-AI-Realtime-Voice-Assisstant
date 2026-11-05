"""LiveKit integration for GitHub's official remote MCP server."""

from __future__ import annotations

import logging
import os

from livekit.agents import mcp

logger = logging.getLogger(__name__)

GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/"


async def build_github_toolset() -> mcp.MCPToolset:
    token = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_PERSONAL_ACCESS_TOKEN is missing in .env")

    server = mcp.MCPServerHTTP(
        url=GITHUB_MCP_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "X-MCP-Readonly": "true",  # remove this line later to allow writes
            "X-MCP-Toolsets": "repos,issues,pull_requests",
        },
        client_session_timeout_seconds=30,
    )
    toolset = mcp.MCPToolset(id="github", mcp_server=server)
    try:
        await toolset.setup()
        names = sorted(t.info.name for t in toolset.tools)
        logger.info("GitHub MCP ready with %d tools: %s", len(names), ", ".join(names))
        return toolset
    except Exception:
        logger.exception("Could not connect to the GitHub MCP server.")
        try:
            await toolset.aclose()
        except Exception:
            logger.exception("Could not close the failed GitHub MCP connection.")
        raise