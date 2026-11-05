# Bobby Filesystem MCP

This module provides a local MCP stdio server for filesystem operations. LiveKit launches one
server subprocess per Bobby agent session, discovers its tools with `MCPToolset`, and closes the
MCP connection with the agent lifecycle. It does not expose a network listener or start another
voice agent.

## Project integration

- `server.py` registers MCP tools and runs the MCP SDK 2 stdio server.
- `tools.py` implements listing, searching, metadata, reading, creation, append, and staged
  filesystem operations.
- `security.py` confines paths and blocks links, credential locations, and likely secret content.
- `config.py` reads allowed roots and operation limits.
- `apps/agent/agent.py` connects MCP clients from `apps/agent/mcp_clients/` to the existing Bobby
  agent alongside browser and filesystem tools.
- `requirements.txt` enables LiveKit Agents' MCP extra; `.env.example` demonstrates root
  configuration.
- `tests/test_filesystem.py` exercises security, filesystem operations, MCP discovery/lifecycle,
  and the agent/browser integration.

The existing Gemini Realtime model, voice settings, LiveKit room, browser bridge, and browser tools
are unchanged. The MCP child process receives only the runtime paths and filesystem-root setting;
it does not inherit the agent's Google API key.

## Configuration

By default, the server authorizes the current user's Desktop and the `D:\` drive, unless `D:\` is
the Windows system drive. Windows/system locations, credential paths, and browser profiles are
blocked. A clear user request authorizes that file operation directly, with no extra yes or code
prompt. To restrict this access to a list of existing folders instead, set
`BOBBY_FILESYSTEM_ROOTS` in the existing project `.env`:

```dotenv
BOBBY_FILESYSTEM_ROOTS=C:\Users\Ahsan\Documents;D:\Projects
```

Only those folders and their descendants are authorized when this variable is set.
`BOBBY_FILESYSTEM_ACCESS=desktop_and_d_drive` enables the default. `all_data_drives` is accepted
as a legacy alias for the same default scope. These roots do not bypass Windows permissions.

## Tools and safeguards

The server provides root/drive discovery, directory listing, filename search across authorized
roots, file and text search, metadata, existence checks, UTF-8 reads, document opening, new
file/folder creation, and append-only updates. Binary-safe copy supports PDFs without reading them.
Copy, move, rename, delete, and exact/full-text edits execute immediately with
`perform_operation` when the user requests them. Bobby does not ask for a confirmation code.
Deletions use the Windows Recycle Bin and never fall back to permanent deletion. Existing files
are not overwritten by `create_file`; edits create a backup first. Bobby asks for a clear yes
before moving, renaming, deleting, or overwriting existing data.

Every requested path is resolved and checked against configured roots. Symbolic links and Windows
junctions are rejected. Common credential paths and filenames are blocked, and file reads reject
content matching common private-key and credential patterns. Reads are UTF-8-only and size-limited.
The server never executes discovered files. Recursive searches and listings are capped at 200
results; recursive totals and folder operations inspect at most 100,000 items and report or raise
an explicit limit rather than silently claiming a complete result.

The credential checks are defense-in-depth heuristics, not a general-purpose data-loss-prevention
system. Windows permissions remain in force, but a local process that can alter files concurrently
could race path checks. System, browser-profile, and credential directories remain excluded even
when a complete data drive is authorized.

## Install and test

From `D:\bobby` in PowerShell:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest tests
```

The MCP SDK dependency is supplied by the `livekit-agents[mcp]` extra. The implementation uses
the MCP SDK 2 server API and LiveKit Agents' `MCPServerStdio`/`MCPToolset` integration.

## Troubleshooting

- **A folder or drive is missing:** inspect `list_allowed_roots`; configure
  `BOBBY_FILESYSTEM_ROOTS` in the existing `.env` if you want to narrow the default roots.
- **Access is denied or a path is rejected:** verify the folder is beneath a listed allowed root,
  is not a protected system/credential location, and that Windows permits access.
- **MCP tools fail during session startup:** inspect the agent log for the subprocess error, check
  `python -m pip check`, and reinstall with `python -m pip install -r requirements.txt`.
- **An operation did not complete:** read the specific filesystem error Bobby reports; no
  success should be claimed unless the tool confirms it.
- **A folder operation is refused:** set `recursive=true` only when the user requested the whole
  folder. Operations beyond the configured item limit are refused.
