"""MCP stdio server for Bobby's authorized filesystem operations."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Literal, TypeVar

from mcp.server.mcpserver import MCPServer

from .config import FilesystemConfig
from .security import FilesystemError
from .tools import FilesystemTools

logger = logging.getLogger(__name__)
ResultT = TypeVar("ResultT", bound=str)


def _run_tool(operation: Callable[[], ResultT]) -> ResultT | str:
    try:
        return operation()
    except FilesystemError as error:
        logger.warning("Filesystem operation rejected: %s", error)
        return f"Filesystem operation failed: {error}"
    except PermissionError as error:
        logger.warning("Filesystem operation denied by Windows permissions: %s", error)
        return f"Filesystem operation failed: Windows denied access: {error}"
    except OSError as error:
        logger.warning("Filesystem operation failed: %s", error)
        return f"Filesystem operation failed: {error}"


def build_server(config: FilesystemConfig | None = None) -> MCPServer:
    filesystem = FilesystemTools(config or FilesystemConfig.from_environment())
    server = MCPServer(
        name="bobby-filesystem",
        description=(
            "Manage files only inside Bobby's configured allowed folders. "
            "Sensitive paths and credentials are blocked."
        ),
    )

    @server.tool(description="List the filesystem folders Bobby is authorized to access.")
    def list_allowed_roots() -> str:
        return filesystem.list_allowed_roots()

    @server.tool(description="List detected Windows drives; use list_allowed_roots to see access.")
    def list_available_drives() -> str:
        return filesystem.list_available_drives()

    @server.tool(description="List files and folders in an allowed folder.")
    def list_directory(path: str, recursive: bool = False) -> str:
        """List a folder, optionally including descendants.

        Args:
            path: Full path to an allowed folder.
            recursive: Include nested folders when true.
        """
        return _run_tool(lambda: filesystem.list_directory(path, recursive))

    @server.tool(
        description="Read a small UTF-8 text file. Use open_path for PDFs and other documents."
    )
    def read_file(path: str) -> str:
        """Read an allowed text file.

        Args:
            path: Full path to an allowed text file.
        """
        return _run_tool(lambda: filesystem.read_file(path))

    @server.tool(description="Search allowed folders for filenames matching a glob pattern.")
    def search_files(
        pattern: str, path: str = "", recursive: bool = True
    ) -> str:
        """Search filenames in an allowed folder.

        Args:
            pattern: Filename glob, such as '*.py' or '*report*'.
            path: Optional allowed folder; omit to search all allowed roots.
            recursive: Include nested folders when true.
        """
        return _run_tool(lambda: filesystem.search_files(path, pattern, recursive))

    @server.tool(
        description=(
            "Find a file by part of its name in allowed folders. Use this before copy, "
            "move, rename, delete, or edit when the exact filename is uncertain."
        )
    )
    def find_files_by_name(query: str, path: str = "") -> str:
        """Find files whose names contain the requested phrase.

        Args:
            query: A filename or distinctive part of a filename.
            path: Optional allowed folder; omit to search all allowed roots.
        """
        return _run_tool(lambda: filesystem.find_files_by_name(query, path))

    @server.tool(description="Find files by extension without reading their contents.")
    def find_by_extension(
        extension: str, path: str = "", recursive: bool = True
    ) -> str:
        """Find files that have the requested extension.

        Args:
            extension: File extension, with or without a leading dot.
            path: Optional allowed folder; omit to search all allowed roots.
            recursive: Include nested folders when true.
        """
        return _run_tool(lambda: filesystem.find_by_extension(path, extension, recursive))

    @server.tool(
        description="Search text in allowed text files; results include paths and line numbers only."
    )
    def search_file_contents(
        query: str, path: str = "", recursive: bool = True
    ) -> str:
        """Search file text without returning matching text.

        Args:
            query: Non-empty text to search for.
            path: Optional allowed folder; omit to search all allowed roots.
            recursive: Include nested folders when true.
        """
        return _run_tool(
            lambda: filesystem.search_file_contents(path, query, recursive)
        )

    @server.tool(
        description=(
            "Open an allowed folder in File Explorer or a non-executable document in its "
            "associated Windows app. Never launches scripts or programs."
        )
    )
    def open_path(path: str) -> str:
        """Open an allowed folder or non-executable data file.

        Args:
            path: Full path to an allowed folder or document.
        """
        return _run_tool(lambda: filesystem.open_path(path))

    @server.tool(description="Get file or folder information and optional recursive totals.")
    def get_info(path: str, recursive_summary: bool = False) -> str:
        """Get metadata for an allowed path.

        Args:
            path: Full path to an allowed file or folder.
            recursive_summary: Count files/folders and size for a folder when true.
        """
        return _run_tool(lambda: filesystem.get_info(path, recursive_summary))

    @server.tool(description="Check whether a path exists inside allowed folders.")
    def path_exists(path: str) -> str:
        """Check an allowed path without accessing anything outside its roots.

        Args:
            path: Full path to check.
        """
        return _run_tool(lambda: filesystem.path_exists(path))

    @server.tool(description="Create a new UTF-8 file; existing files are never overwritten.")
    def create_file(path: str, content: str = "") -> str:
        """Create a new file.

        Args:
            path: Full path for the new file.
            content: Optional UTF-8 text to write into the new file.
        """
        return _run_tool(lambda: filesystem.create_file(path, content))

    @server.tool(description="Create a folder and any missing nested folders.")
    def create_directory(path: str) -> str:
        """Create a new folder tree.

        Args:
            path: Full path for the new folder.
        """
        return _run_tool(lambda: filesystem.create_directory(path))

    @server.tool(description="Append text to an existing safe UTF-8 text file.")
    def append_file(path: str, content: str) -> str:
        """Append text without replacing existing content.

        Args:
            path: Full path to an allowed text file.
            content: Text to append.
        """
        return _run_tool(lambda: filesystem.append_file(path, content))

    @server.tool(
        description=(
            "Immediately perform a requested copy, move, rename, delete, exact text edit, "
            "or full text replacement. Edit operations create a backup, and deletes go "
            "to the Recycle Bin."
        )
    )
    def perform_operation(
        action: Literal["copy", "move", "rename", "delete", "edit", "write"],
        path: str,
        destination: str = "",
        new_name: str = "",
        find_text: str = "",
        replacement_text: str = "",
        new_content: str = "",
        recursive: bool = False,
    ) -> str:
        """Perform a filesystem operation immediately after the user requests it.

        Args:
            action: Operation to perform: copy, move, rename, delete, edit, or write.
            path: Full path to the source file or folder.
            destination: Complete destination path for copy or move.
            new_name: New filename for rename.
            find_text: Exact unique text to replace during an edit.
            replacement_text: Replacement text for an edit.
            new_content: Complete replacement text for a full-file edit.
            recursive: Required to include descendants in folder operations.
        """
        return _run_tool(
            lambda: filesystem.perform_operation(
                action,
                path,
                destination,
                new_name,
                find_text,
                replacement_text,
                new_content,
                recursive,
            )
        )

    return server


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    server = build_server()
    logger.info("Starting filesystem MCP server over stdio.")
    server.run("stdio")


if __name__ == "__main__":
    main()
