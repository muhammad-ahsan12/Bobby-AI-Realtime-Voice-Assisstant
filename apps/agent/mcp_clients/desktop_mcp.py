"""LiveKit integration for the official Windows desktop-touch MCP package."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from livekit.agents import mcp

logger = logging.getLogger(__name__)

DESKTOP_MCP_PACKAGE = "@harusame64/desktop-touch-mcp@2.4.0"
DESKTOP_MCP_FETCH_TIMEOUT_MS = "180000"
DESKTOP_MCP_CLIENT_TIMEOUT_SECONDS = 300

DESKTOP_TOOL_ALLOWLIST = frozenset(
    {
        "desktop_act",
        "desktop_discover",
        "desktop_state",
        "screenshot",
        "workspace_snapshot",
        "server_status",
        "keyboard",
        "mouse_click",
        "mouse_drag",
        "scroll",
        "click_element",
        "wait_until",
        "window_dock",
        "focus_window",
        "workspace_launch",
    }
)
REQUIRED_DESKTOP_TOOLS = frozenset(
    {"desktop_act", "desktop_discover", "desktop_state", "screenshot"}
)


def _desktop_server_environment() -> dict[str, str]:
    inherited_names = {
        "PATH",
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMDATA",
        "HOMEDRIVE",
        "HOMEPATH",
        "COMSPEC",
    }
    environment = {
        key: value
        for key, value in os.environ.items()
        if key.upper() in inherited_names and value
    }
    environment["DESKTOP_TOUCH_MCP_FETCH_TIMEOUT_MS"] = os.environ.get(
        "DESKTOP_TOUCH_MCP_FETCH_TIMEOUT_MS", DESKTOP_MCP_FETCH_TIMEOUT_MS
    )
    return environment


def create_desktop_mcp_server(project_root: Path) -> mcp.MCPServerStdio:
    """Create one local stdio server process for the pinned official package."""
    command = os.environ.get("COMSPEC", "cmd.exe")
    return mcp.MCPServerStdio(
        command=command,
        args=[
            "/d",
            "/s",
            "/c",
            f"npx.cmd -y {DESKTOP_MCP_PACKAGE}",
        ],
        env=_desktop_server_environment(),
        cwd=project_root,
        client_session_timeout_seconds=DESKTOP_MCP_CLIENT_TIMEOUT_SECONDS,
    )


async def build_desktop_toolset(project_root: Path) -> mcp.MCPToolset:
    """Start, discover, and restrict the official desktop MCP tools."""
    server = create_desktop_mcp_server(project_root)
    toolset = mcp.MCPToolset(id="desktop-touch", mcp_server=server)
    try:
        logger.info("Starting official desktop MCP package %s.", DESKTOP_MCP_PACKAGE)
        await toolset.setup()
        discovered = {tool.info.name for tool in toolset.tools}
        missing_required = REQUIRED_DESKTOP_TOOLS - discovered
        if missing_required:
            raise RuntimeError(
                "The desktop MCP server did not expose required tools: "
                + ", ".join(sorted(missing_required))
            )

        enabled = discovered & DESKTOP_TOOL_ALLOWLIST
        toolset.filter_tools(
            lambda tool: tool.info.name in DESKTOP_TOOL_ALLOWLIST
        )
        logger.info(
            "Desktop MCP ready: discovered %d tools and enabled %d: %s.",
            len(discovered),
            len(enabled),
            ", ".join(sorted(enabled)),
        )
        if ignored := discovered - enabled:
            logger.info(
                "Desktop MCP tools excluded by policy: %s.",
                ", ".join(sorted(ignored)),
            )
        return toolset
    except Exception as error:
        logger.exception("Could not initialize or discover desktop MCP tools.")
        try:
            await toolset.aclose()
        except Exception:
            logger.exception("Could not close the failed desktop MCP connection.")
        raise RuntimeError(
            "Desktop control could not start. Check that Node.js 20+ and npm are installed, "
            "and that npm/GitHub release downloads are reachable."
        ) from error
