from __future__ import annotations

import asyncio
import importlib
import json
import os
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType
from types import SimpleNamespace

import pytest

import mcp_servers.filesystem.config as filesystem_config
from mcp_servers.filesystem.config import FilesystemConfig
from mcp_servers.filesystem.security import FilesystemError
from mcp_servers.filesystem.tools import FilesystemOperation, FilesystemTools

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _import_bobby_agent() -> ModuleType:
    agent_directory = PROJECT_ROOT / "apps" / "agent"
    sys.path.insert(0, str(agent_directory))
    try:
        importlib.import_module("agent")
        return importlib.import_module("apps.agent.runtime")
    finally:
        sys.path.remove(str(agent_directory))


@pytest.fixture
def tmp_path() -> Iterator[Path]:
    sandbox = PROJECT_ROOT / "sandbox"
    with tempfile.TemporaryDirectory(prefix="filesystem-test-", dir=sandbox) as path:
        yield Path(path)


@pytest.fixture
def filesystem(tmp_path: Path) -> FilesystemTools:
    return FilesystemTools(FilesystemConfig(allowed_roots=(tmp_path,)))


def test_list_read_search_metadata_and_unicode_paths(
    filesystem: FilesystemTools, tmp_path: Path
) -> None:
    folder = tmp_path / "AI Projects" / "東京"
    folder.mkdir(parents=True)
    source = folder / "résumé.py"
    source.write_bytes(b"first line\nfind this phrase\n")

    assert "résumé.py" in filesystem.list_directory(str(folder))
    assert filesystem.read_file(str(source)) == "first line\nfind this phrase\n"
    assert str(source) in json.loads(filesystem.search_files(str(tmp_path), "*.py"))
    assert str(source) in json.loads(
        filesystem.find_by_extension(str(tmp_path), "py")
    )
    assert json.loads(
        filesystem.search_file_contents(str(tmp_path), "find this phrase")
    ) == [{"path": str(source), "line_numbers": [2]}]
    info = json.loads(filesystem.get_info(str(tmp_path / "AI Projects"), True))
    assert info["file_count"] == 1
    assert info["folder_count"] == 1
    assert filesystem.path_exists(str(source)).find('"exists": true') >= 0


def test_create_nested_folders_files_and_append(
    filesystem: FilesystemTools, tmp_path: Path
) -> None:
    folder = tmp_path / "new" / "nested folder"
    assert "Created folder" in filesystem.create_directory(str(folder))
    file_path = folder / "notes.txt"
    assert "Created file" in filesystem.create_file(str(file_path), "start")
    assert "Appended" in filesystem.append_file(str(file_path), " end")
    assert file_path.read_text(encoding="utf-8") == "start end"
    with pytest.raises(FilesystemError, match="Refusing to overwrite"):
        filesystem.create_file(str(file_path), "replacement")
    assert file_path.read_text(encoding="utf-8") == "start end"


def test_edit_executes_directly_and_creates_backup(
    filesystem: FilesystemTools, tmp_path: Path
) -> None:
    source = tmp_path / "readme.txt"
    source.write_text("before\n", encoding="utf-8")

    result = filesystem.perform_operation(
        "edit", str(source), find_text="before", replacement_text="after"
    )
    assert "Updated" in result
    assert source.read_text(encoding="utf-8") == "after\n"
    backups = list(tmp_path.glob("readme.txt.bobby-backup-*"))
    assert len(backups) == 1
    assert backups[0].read_text(encoding="utf-8") == "before\n"


def test_full_text_edit_executes_directly_and_creates_backup(
    filesystem: FilesystemTools, tmp_path: Path
) -> None:
    source = tmp_path / "notes.txt"
    source.write_text("original", encoding="utf-8")
    result = filesystem.perform_operation(
        "write", str(source), new_content="rewritten"
    )
    assert "Updated" in result
    assert source.read_text(encoding="utf-8") == "rewritten"
    backup = next(tmp_path.glob("notes.txt.bobby-backup-*"))
    assert backup.read_text(encoding="utf-8") == "original"


def test_full_text_edit_detects_concurrent_change_before_replacement(
    filesystem: FilesystemTools, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "notes.txt"
    source.write_text("original", encoding="utf-8")
    execute = filesystem._execute_operation

    def change_file_before_execute(operation: FilesystemOperation) -> str:
        source.write_text("changed by another process", encoding="utf-8")
        return execute(operation)

    monkeypatch.setattr(filesystem, "_execute_operation", change_file_before_execute)
    with pytest.raises(FilesystemError, match="file changed"):
        filesystem.perform_operation("write", str(source), new_content="replacement")
    assert source.read_text(encoding="utf-8") == "changed by another process"


def test_copy_move_and_rename_execute_directly(
    filesystem: FilesystemTools, tmp_path: Path
) -> None:
    source = tmp_path / "source.txt"
    destination = tmp_path / "destination.txt"
    source.write_text("data", encoding="utf-8")

    copy = filesystem.perform_operation("copy", str(source), destination=str(destination))
    assert "Copied" in copy
    assert destination.read_text(encoding="utf-8") == "data"

    renamed = tmp_path / "renamed.txt"
    rename = filesystem.perform_operation("rename", str(destination), new_name=renamed.name)
    assert "Renamed" in rename
    assert renamed.exists()

    moved = tmp_path / "subfolder" / renamed.name
    (tmp_path / "subfolder").mkdir()
    move = filesystem.perform_operation("move", str(renamed), destination=str(moved))
    assert "Moved" in move
    assert moved.exists()


def test_binary_pdf_copy_and_filename_search_across_roots(
    tmp_path: Path,
) -> None:
    documents = tmp_path / "Documents"
    data_drive = tmp_path / "Data Drive"
    documents.mkdir()
    data_drive.mkdir()
    source = documents / "Muhammad Ahsan Resume.pdf"
    source_bytes = b"%PDF-1.7\x00binary document bytes"
    source.write_bytes(source_bytes)
    destination_folder = data_drive / "Ali"
    destination_folder.mkdir()
    filesystem = FilesystemTools(
        FilesystemConfig(allowed_roots=(documents, data_drive))
    )

    matches = json.loads(filesystem.find_files_by_name("Ahsan Resume"))
    assert matches == [str(source)]
    result = filesystem.perform_operation(
        "copy", matches[0], destination=str(destination_folder)
    )
    assert "Copied" in result
    assert (destination_folder / source.name).read_bytes() == source_bytes


def test_open_path_uses_associated_app_but_never_launches_scripts(
    filesystem: FilesystemTools, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from mcp_servers.filesystem import tools as filesystem_tools

    document = tmp_path / "resume.pdf"
    document.write_bytes(b"%PDF")
    launched: list[str] = []
    monkeypatch.setattr(os, "name", "nt")
    monkeypatch.setattr(filesystem_tools.os, "startfile", launched.append, raising=False)

    assert "Opened file" in filesystem.open_path(str(document))
    assert launched == [str(document)]
    script = tmp_path / "tool.py"
    script.write_text("print('do not launch')", encoding="utf-8")
    with pytest.raises(FilesystemError, match="may execute code"):
        filesystem.open_path(str(script))


def test_default_roots_include_desktop_and_d_drive_but_exclude_system_drive(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    if os.name != "nt":
        pytest.skip("Desktop and D: defaults are Windows-specific.")
    monkeypatch.setattr(filesystem_config.Path, "home", lambda: tmp_path)
    monkeypatch.setenv("SystemDrive", "C:")

    roots = filesystem_config._default_access_roots()
    assert roots == (tmp_path / "Desktop", Path("D:\\"))

    monkeypatch.setenv("SystemDrive", "D:")
    assert filesystem_config._default_access_roots() == (tmp_path / "Desktop",)


def test_recursive_copy_executes_directly(
    filesystem: FilesystemTools, tmp_path: Path
) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "file.txt").write_text("data", encoding="utf-8")
    destination = tmp_path / "copy"

    with pytest.raises(FilesystemError, match="recursive=true"):
        filesystem.perform_operation("copy", str(source), destination=str(destination))
    result = filesystem.perform_operation(
        "copy", str(source), destination=str(destination), recursive=True
    )
    assert "Copied" in result
    assert (destination / "file.txt").read_text(encoding="utf-8") == "data"


def test_delete_executes_directly_and_uses_recycle_bin(
    filesystem: FilesystemTools, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "temporary.txt"
    source.write_text("temporary", encoding="utf-8")
    recycled: list[str] = []
    monkeypatch.setattr(
        "mcp_servers.filesystem.tools.send2trash", lambda path: recycled.append(path)
    )

    result = filesystem.perform_operation("delete", str(source))
    assert "Moved to the Recycle Bin" in result
    assert recycled == [str(source)]
    assert source.exists()


def test_paths_outside_roots_and_traversal_are_rejected(
    filesystem: FilesystemTools, tmp_path: Path
) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-outside.txt"
    outside.write_text("outside", encoding="utf-8")
    try:
        with pytest.raises(FilesystemError, match="outside"):
            filesystem.read_file(str(outside))
        with pytest.raises(FilesystemError, match="outside"):
            filesystem.create_file(str(tmp_path / ".." / outside.name))
    finally:
        outside.unlink(missing_ok=True)


def test_sensitive_paths_and_likely_secret_content_are_blocked(
    filesystem: FilesystemTools, tmp_path: Path
) -> None:
    appdata = tmp_path / "AppData" / "Local" / "Temp"
    appdata.mkdir(parents=True)
    with pytest.raises(FilesystemError, match="Sensitive directories"):
        FilesystemTools(FilesystemConfig(allowed_roots=(appdata,)))

    env_file = tmp_path / ".env"
    env_file.write_text("API_KEY=not-a-real-key", encoding="utf-8")
    with pytest.raises(FilesystemError, match="sensitive-data"):
        filesystem.read_file(str(env_file))

    source = tmp_path / "notes.txt"
    source.write_text("password = 'example-value-123'", encoding="utf-8")
    with pytest.raises(FilesystemError, match="credentials"):
        filesystem.read_file(str(source))


def test_locked_file_reports_permission_error(
    filesystem: FilesystemTools, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "locked.txt"
    source.write_text("data", encoding="utf-8")
    original_open = Path.open

    def permission_denied(
        path: Path, *args: object, **kwargs: object
    ) -> object:
        if path == source:
            raise PermissionError("locked for this test")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", permission_denied)
    with pytest.raises(FilesystemError, match="Permission denied"):
        filesystem.read_file(str(source))


def test_missing_paths_and_drives_are_not_authorized(
    filesystem: FilesystemTools, tmp_path: Path
) -> None:
    missing = tmp_path / "missing folder" / "missing.txt"
    assert '"exists": false' in filesystem.path_exists(str(missing))
    if os.name == "nt":
        available = set(json.loads(filesystem.list_available_drives()))
        unavailable = next(
            (f"{letter}:\\not-a-real-folder" for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
             if f"{letter}:\\"
             not in available),
            None,
        )
        if unavailable is not None:
            with pytest.raises(FilesystemError, match="outside"):
                filesystem.path_exists(unavailable)


def test_windows_alternate_data_stream_paths_are_rejected(
    filesystem: FilesystemTools, tmp_path: Path
) -> None:
    if os.name != "nt":
        pytest.skip("Windows alternate data streams are platform-specific.")
    with pytest.raises(FilesystemError, match="alternate data stream"):
        filesystem.path_exists(str(tmp_path / "ordinary.txt:secret"))


def test_symbolic_links_are_rejected(
    filesystem: FilesystemTools, tmp_path: Path
) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-linked.txt"
    outside.write_text("outside", encoding="utf-8")
    link = tmp_path / "linked.txt"
    try:
        link.symlink_to(outside)
    except OSError:
        outside.unlink(missing_ok=True)
        pytest.skip("This Windows environment does not allow creating a symlink.")
    try:
        with pytest.raises(FilesystemError):
            filesystem.read_file(str(link))
    finally:
        link.unlink(missing_ok=True)
        outside.unlink(missing_ok=True)


def test_mcp_server_startup_discovery_and_shutdown(tmp_path: Path) -> None:
    agent_module = _import_bobby_agent()
    mcp = agent_module.mcp

    async def exercise() -> None:
        child_env = {
            key: os.environ[key]
            for key in ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE")
            if os.environ.get(key)
        }
        child_env.update(
            BOBBY_FILESYSTEM_ROOTS=str(tmp_path),
            PYTHONUTF8="1",
            PYTHONIOENCODING="utf-8",
        )
        server = mcp.MCPServerStdio(
            command=sys.executable,
            args=["-m", "mcp_servers.filesystem.server"],
            env=child_env,
            cwd=PROJECT_ROOT,
            client_session_timeout_seconds=20,
        )
        toolset = mcp.MCPToolset(id="test-filesystem", mcp_server=server)
        await toolset.setup()
        names = {tool.info.name for tool in toolset.tools}
        assert {
            "list_directory",
            "find_files_by_name",
            "open_path",
            "read_file",
            "create_file",
            "perform_operation",
        } <= names
        assert "confirm_operation" not in names
        await toolset.aclose()
        assert not server.initialized

    asyncio.run(exercise())


def test_desktop_mcp_discovers_tools_and_closes() -> None:
    _import_bobby_agent()
    desktop_module = importlib.import_module("apps.agent.mcp_clients.desktop_mcp")

    async def exercise() -> None:
        toolset = await desktop_module.build_desktop_toolset(PROJECT_ROOT)
        try:
            names = {tool.info.name for tool in toolset.tools}
            assert desktop_module.REQUIRED_DESKTOP_TOOLS <= names
            assert names <= desktop_module.DESKTOP_TOOL_ALLOWLIST
            assert not any(name.startswith("browser_") for name in names)
            assert not {"terminal", "key_locker", "excel", "clipboard"} & names
        finally:
            await toolset.aclose()
        assert not toolset._mcp_server.initialized

    asyncio.run(exercise())


def test_mcp_returns_actionable_filesystem_errors(tmp_path: Path) -> None:
    from mcp_servers.filesystem.server import build_server

    async def exercise() -> None:
        server = build_server(FilesystemConfig(allowed_roots=(tmp_path,)))
        result = await server.call_tool(
            "read_file", {"path": str(tmp_path / "missing.txt")}
        )
        assert not result.is_error
        assert "Filesystem operation failed: Path does not exist" in result.content[0].text
        source = tmp_path / "source.txt"
        source.write_text("direct", encoding="utf-8")
        destination = tmp_path / "destination.txt"
        result = await server.call_tool(
            "perform_operation",
            {
                "action": "copy",
                "path": str(source),
                "destination": str(destination),
            },
        )
        assert not result.is_error
        assert "Copied to:" in result.content[0].text
        assert destination.read_text(encoding="utf-8") == "direct"

    asyncio.run(exercise())


def test_agent_preserves_existing_model_and_browser_tools(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bobby_agent = _import_bobby_agent()
    monkeypatch.setenv("BOBBY_FILESYSTEM_ROOTS", str(tmp_path))
    monkeypatch.setenv("GOOGLE_API_KEY", "test-only-secret")
    toolset = bobby_agent.build_filesystem_toolset()
    filesystem_server = toolset._mcp_server
    assert filesystem_server.env is not None
    assert "GOOGLE_API_KEY" not in filesystem_server.env

    browser_tools = bobby_agent.build_browser_tools(bobby_agent.ChromeBridge())
    browser_names = {tool.info.name for tool in browser_tools}
    assert {"web_search", "browser_list_tabs", "browser_media_control"} <= browser_names
    bobby_agent.Bobby(tools=[*browser_tools, toolset])
    assert "screenshot immediately" in bobby_agent.INSTRUCTIONS
    assert "target `hwnd` or `windowTitle`" in bobby_agent.INSTRUCTIONS
    assert "no cursor-only move tool" in bobby_agent.INSTRUCTIONS
    assert bobby_agent.GOOGLE_REALTIME_MODEL == "gemini-3.1-flash-live-preview"
    room_options = bobby_agent.build_room_options()
    audio_input = room_options.get_audio_input_options()
    assert audio_input is not None
    assert audio_input.sample_rate == 16_000
    text_input = room_options.get_text_input_options()
    assert text_input is not None
    assert text_input.text_input_cb is bobby_agent._handle_text_input
    desktop_module = importlib.import_module("apps.agent.mcp_clients.desktop_mcp")
    desktop_server = desktop_module.create_desktop_mcp_server(PROJECT_ROOT)
    assert desktop_server.command.casefold().endswith("cmd.exe")
    assert desktop_server.args == [
        "/d",
        "/s",
        "/c",
        "npx.cmd -y @harusame64/desktop-touch-mcp@2.4.0",
    ]
    assert desktop_server.env is not None
    assert "GOOGLE_API_KEY" not in desktop_server.env
    assert "LIVEKIT_API_SECRET" not in desktop_server.env
    assert "terminal" not in desktop_module.DESKTOP_TOOL_ALLOWLIST
    assert not any(name.startswith("browser_") for name in desktop_module.DESKTOP_TOOL_ALLOWLIST)
    assert bobby_agent.ChromeBridge.__module__ == "apps.agent.bridges.chrome_bridge"
    assert isinstance(toolset, bobby_agent.mcp.MCPToolset)


def test_text_input_publishes_redacted_transcript_and_requests_reply(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bobby_agent = _import_bobby_agent()
    published: list[dict[str, object]] = []

    async def publish_activity(event_type: str, message: str, **kwargs: object) -> None:
        published.append({"type": event_type, "message": message, **kwargs})

    class SessionStub:
        interrupted = False
        reply_text: str | None = None

        async def interrupt(self) -> None:
            self.interrupted = True

        async def generate_reply(self, *, user_input: str) -> None:
            self.reply_text = user_input

    monkeypatch.setattr(bobby_agent, "publish_activity", publish_activity)
    session = SessionStub()
    asyncio.run(
        bobby_agent._handle_text_input(
            session,
            SimpleNamespace(text="password=private-value"),
        )
    )

    assert session.interrupted
    assert session.reply_text == "password=private-value"
    assert published[0]["type"] == "transcript"
    assert published[0]["data"]["text"] == "[redacted]"
