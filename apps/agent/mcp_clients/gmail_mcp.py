"""LiveKit integration for the Gmail MCP server (stdio)."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from livekit.agents import mcp

logger = logging.getLogger(__name__)

GMAIL_MCP_PACKAGE = "@gongrzhe/server-gmail-autoauth-mcp"  # pin a version later

# Delete, filter and batch-delete tools are deliberately left out.
GMAIL_TOOL_ALLOWLIST = frozenset(
    {
        "search_emails",
        "read_email",
        "draft_email",
        "send_email",
        "modify_email",
        "list_email_labels",
    }
)


def _gmail_environment() -> dict[str, str]:
    names = {
        "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE",
        "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "COMSPEC",
    }
    return {k: v for k, v in os.environ.items() if k.upper() in names and v}


async def build_gmail_toolset(project_root: Path) -> mcp.MCPToolset:
    server = mcp.MCPServerStdio(
        command=os.environ.get("COMSPEC", "cmd.exe"),
        args=["/d", "/s", "/c", f"npx.cmd -y {GMAIL_MCP_PACKAGE}"],
        env=_gmail_environment(),
        cwd=project_root,
        client_session_timeout_seconds=60,
    )
    toolset = mcp.MCPToolset(id="gmail", mcp_server=server)
    try:
        await toolset.setup()
        discovered = {t.info.name for t in toolset.tools}
        logger.info("Gmail MCP discovered tools: %s", ", ".join(sorted(discovered)))
        toolset.filter_tools(lambda t: t.info.name in GMAIL_TOOL_ALLOWLIST)
        return toolset
    except Exception:
        logger.exception("Could not start the Gmail MCP server.")
        try:
            await toolset.aclose()
        except Exception:
            logger.exception("Could not close the failed Gmail MCP connection.")
        raise