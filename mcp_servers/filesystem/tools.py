"""Restricted filesystem operations exposed by the filesystem MCP server."""

from __future__ import annotations

import fnmatch
import hashlib
import json
import logging
import mimetypes
import os
import shutil
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from send2trash import send2trash

from .config import FilesystemConfig
from .security import (
    FileSizeLimitError,
    FilesystemError,
    FilesystemSecurity,
    NotTextFileError,
    SensitiveContentError,
    is_reparse_point,
    is_sensitive_path,
    reject_secret_content,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FilesystemOperation:
    action: str
    path: str
    destination: str
    new_name: str
    find_text: str
    replacement_text: str
    new_content: str
    original_digest: str
    recursive: bool


class FilesystemTools:
    def __init__(self, config: FilesystemConfig) -> None:
        self.config = config
        self.security = FilesystemSecurity(config.allowed_roots)

    def list_allowed_roots(self) -> str:
        if not self.security.allowed_roots:
            return "No filesystem folders are configured for Bobby."
        return json.dumps(
            [str(path) for path in self.security.allowed_roots], ensure_ascii=False
        )

    @staticmethod
    def list_available_drives() -> str:
        if os.name == "nt":
            drives = [
                f"{letter}:\\"
                for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                if Path(f"{letter}:\\").is_dir()
            ]
        else:
            drives = ["/"]
        return json.dumps(drives, ensure_ascii=False)

    def _resolve(self, path: str, *, allow_missing: bool = False) -> Path:
        return self.security.resolve(path, allow_missing=allow_missing)

    def _read_text(self, path: Path, limit: int) -> str:
        if not path.is_file():
            raise FilesystemError(f"Not a file: {path}")
        try:
            with path.open("rb") as file:
                data = file.read(limit + 1)
        except PermissionError as error:
            raise FilesystemError(f"Permission denied reading '{path.name}'.") from error
        if len(data) > limit:
            raise FileSizeLimitError(
                f"'{path.name}' exceeds the {limit}-byte read limit."
            )
        try:
            content = data.decode("utf-8")
        except UnicodeDecodeError as error:
            raise NotTextFileError(
                f"'{path.name}' is not a UTF-8 text file and was not read."
            ) from error
        reject_secret_content(content, path)
        return content

    def _entries(
        self, path: Path, recursive: bool, limit: int | None = None
    ) -> tuple[list[Path], int, bool]:
        if not path.is_dir():
            raise FilesystemError(f"Not a folder: {path}")
        result_limit = limit or self.config.max_results
        pending = [path]
        results: list[Path] = []
        omitted = 0
        while pending and len(results) < result_limit:
            folder = pending.pop()
            try:
                with os.scandir(folder) as iterator:
                    entries = sorted(iterator, key=lambda entry: entry.name.casefold())
            except PermissionError as error:
                if folder == path:
                    raise FilesystemError(
                        f"Permission denied listing '{folder.name}'."
                    ) from error
                omitted += 1
                continue
            for entry in entries:
                child = Path(entry.path)
                if is_sensitive_path(child) or is_reparse_point(child):
                    omitted += 1
                    continue
                safe_path = self._resolve(str(child))
                results.append(safe_path)
                if recursive and entry.is_dir(follow_symlinks=False):
                    pending.append(safe_path)
                if len(results) >= result_limit:
                    break
        return (
            results,
            omitted,
            bool(pending) or len(results) >= result_limit,
        )

    def _search_roots(self, path: str) -> tuple[Path, ...]:
        if path.strip():
            return (self._resolve(path),)
        if not self.security.allowed_roots:
            raise FilesystemError("No filesystem folders are configured for Bobby.")
        return self.security.allowed_roots

    def _search_entries(
        self, path: str, recursive: bool
    ) -> tuple[list[Path], int, bool]:
        entries: list[Path] = []
        omitted = 0
        truncated = False
        limit = self.config.max_directory_items if recursive else self.config.max_results
        for root in self._search_roots(path):
            remaining = limit - len(entries)
            if remaining <= 0:
                truncated = True
                break
            found, skipped, root_truncated = self._entries(
                root, recursive, limit=remaining
            )
            entries.extend(found)
            omitted += skipped
            truncated = truncated or root_truncated
        return entries, omitted, truncated

    def list_directory(self, path: str, recursive: bool = False) -> str:
        folder = self._resolve(path)
        logger.info("Listed an allowed filesystem folder.")
        entries, omitted, truncated = self._entries(folder, recursive)
        result = [
            {
                "name": item.name,
                "path": str(item),
                "type": "folder" if item.is_dir() else "file",
                "size_bytes": item.stat().st_size if item.is_file() else None,
            }
            for item in entries
        ]
        message = json.dumps(result, ensure_ascii=False)
        if omitted:
            message += f"\nOmitted {omitted} sensitive or linked item(s)."
        if truncated:
            message += f"\nResults capped at {self.config.max_results} entries."
        return message

    def read_file(self, path: str) -> str:
        file_path = self._resolve(path)
        content = self._read_text(file_path, self.config.max_read_bytes)
        logger.info("Read an allowed UTF-8 filesystem file.")
        return content

    def search_files(
        self, path: str, pattern: str, recursive: bool = True
    ) -> str:
        if not pattern.strip():
            raise FilesystemError("A filename pattern is required.")
        entries, omitted, truncated = self._search_entries(path, recursive)
        logger.info("Searched filenames in an allowed folder.")
        matches = [
            str(item)
            for item in entries
            if item.is_file() and fnmatch.fnmatchcase(item.name.casefold(), pattern.casefold())
        ]
        result = json.dumps(matches[: self.config.max_results], ensure_ascii=False)
        if omitted:
            result += f"\nOmitted {omitted} sensitive or linked item(s)."
        if truncated:
            result += f"\nSearch capped at {self.config.max_results} entries."
        return result

    def find_files_by_name(self, query: str, path: str = "") -> str:
        normalized_query = query.strip().casefold()
        if not normalized_query:
            raise FilesystemError("A filename or part of a filename is required.")
        entries, omitted, truncated = self._search_entries(path, recursive=True)
        matches = [
            str(item)
            for item in entries
            if normalized_query in item.name.casefold()
        ]
        result = json.dumps(matches[:50], ensure_ascii=False)
        if omitted:
            result += f"\nOmitted {omitted} sensitive, linked, or inaccessible folder(s)."
        if truncated:
            result += (
                f"\nSearch reached its {self.config.max_directory_items}-item limit."
            )
        return result

    def find_by_extension(
        self, path: str, extension: str, recursive: bool = True
    ) -> str:
        suffix = extension.strip().casefold()
        if not suffix:
            raise FilesystemError("A file extension is required.")
        if not suffix.startswith("."):
            suffix = f".{suffix}"
        entries, omitted, truncated = self._search_entries(path, recursive)
        logger.info("Searched file extensions in an allowed folder.")
        matches = [
            str(item)
            for item in entries
            if item.is_file() and item.suffix.casefold() == suffix
        ]
        result = json.dumps(matches[: self.config.max_results], ensure_ascii=False)
        if omitted:
            result += f"\nOmitted {omitted} sensitive or linked item(s)."
        if truncated:
            result += f"\nSearch capped at {self.config.max_results} entries."
        return result

    def search_file_contents(
        self, path: str, query: str, recursive: bool = True
    ) -> str:
        if not query:
            raise FilesystemError("A non-empty search string is required.")
        entries, omitted, truncated = self._search_entries(path, recursive)
        logger.info("Searched text in an allowed folder.")
        matches: list[dict[str, Any]] = []
        skipped = 0
        for item in entries:
            if not item.is_file():
                continue
            try:
                content = self._read_text(item, self.config.max_search_file_bytes)
            except (SensitiveContentError, FileSizeLimitError, NotTextFileError):
                skipped += 1
                continue
            line_numbers = [
                number
                for number, line in enumerate(content.splitlines(), start=1)
                if query.casefold() in line.casefold()
            ]
            if line_numbers:
                matches.append({"path": str(item), "line_numbers": line_numbers[:50]})
            if len(matches) >= self.config.max_results:
                break
        result = json.dumps(matches, ensure_ascii=False)
        if omitted or skipped or truncated:
            result += (
                f"\nOmitted {omitted} sensitive or linked item(s) and "
                f"{skipped} unreadable, binary, oversized, or credential-bearing file(s)."
            )
        if truncated:
            result += f"\nSearch capped at {self.config.max_results} entries."
        return result

    def get_info(self, path: str, recursive_summary: bool = False) -> str:
        item = self._resolve(path)
        metadata = item.stat()
        logger.info("Read metadata for an allowed filesystem path.")
        is_directory = item.is_dir()
        result: dict[str, Any] = {
            "path": str(item),
            "name": item.name or str(item),
            "type": "folder" if is_directory else "file",
            "extension": item.suffix if item.is_file() else "",
            "mime_type": mimetypes.guess_type(item.name)[0] if item.is_file() else None,
            "size_bytes": metadata.st_size if item.is_file() else None,
            "created": datetime.fromtimestamp(
                getattr(metadata, "st_birthtime", metadata.st_ctime)
            ).astimezone().isoformat(),
            "modified": datetime.fromtimestamp(metadata.st_mtime)
            .astimezone()
            .isoformat(),
        }
        if is_directory and recursive_summary:
            entries, omitted, truncated = self._entries(
                item, recursive=True, limit=self.config.max_directory_items
            )
            result.update(
                file_count=sum(child.is_file() for child in entries),
                folder_count=sum(child.is_dir() for child in entries),
                total_size_bytes=sum(
                    child.stat().st_size for child in entries if child.is_file()
                ),
                omitted_items=omitted,
                truncated=truncated,
            )
        return json.dumps(result, ensure_ascii=False)

    def path_exists(self, path: str) -> str:
        item = self._resolve(path, allow_missing=True)
        logger.info("Checked an allowed filesystem path.")
        return json.dumps({"exists": item.exists(), "path": str(item)}, ensure_ascii=False)

    def create_file(self, path: str, content: str = "") -> str:
        if len(content.encode("utf-8")) > self.config.max_read_bytes:
            raise FilesystemError(
                f"New file content exceeds the {self.config.max_read_bytes}-byte limit."
            )
        item = self._resolve(path, allow_missing=True)
        self.security.ensure_mutable_target(item)
        if not item.parent.is_dir():
            raise FilesystemError(f"Parent folder does not exist: {item.parent}")
        try:
            with item.open("x", encoding="utf-8", newline="") as file:
                file.write(content)
        except FileExistsError as error:
            raise FilesystemError(f"Refusing to overwrite existing file: {item}") from error
        except PermissionError as error:
            raise FilesystemError(f"Permission denied creating '{item.name}'.") from error
        logger.info("Created a new filesystem file.")
        return f"Created file: {item}"

    def create_directory(self, path: str) -> str:
        folder = self._resolve(path, allow_missing=True)
        self.security.ensure_mutable_target(folder)
        try:
            folder.mkdir(parents=True, exist_ok=False)
        except FileExistsError as error:
            raise FilesystemError(f"Path already exists: {folder}") from error
        except PermissionError as error:
            raise FilesystemError(f"Permission denied creating '{folder.name}'.") from error
        logger.info("Created a filesystem folder.")
        return f"Created folder: {folder}"

    def append_file(self, path: str, content: str) -> str:
        if not content:
            raise FilesystemError("Content to append cannot be empty.")
        if len(content.encode("utf-8")) > self.config.max_read_bytes:
            raise FilesystemError("Appended content exceeds the configured size limit.")
        item = self._resolve(path)
        self._read_text(item, self.config.max_read_bytes)
        try:
            with item.open("a", encoding="utf-8", newline="") as file:
                file.write(content)
        except PermissionError as error:
            raise FilesystemError(f"Permission denied updating '{item.name}'.") from error
        logger.info("Appended to an allowed filesystem file.")
        return f"Appended content to: {item}"

    def open_path(self, path: str) -> str:
        item = self._resolve(path)
        if item.is_dir():
            if os.name != "nt":
                raise FilesystemError("Opening folders in Explorer is available on Windows only.")
            os.startfile(str(item))
            logger.info("Opened an allowed folder in File Explorer.")
            return f"Opened folder in File Explorer: {item}"

        blocked_extensions = {
            ".app",
            ".bat",
            ".cmd",
            ".com",
            ".exe",
            ".hta",
            ".jar",
            ".js",
            ".lnk",
            ".msi",
            ".ps1",
            ".py",
            ".reg",
            ".scr",
            ".url",
            ".vbs",
            ".wsf",
        }
        if item.suffix.casefold() in blocked_extensions:
            raise FilesystemError(
                f"Opening '{item.name}' is blocked because it may execute code."
            )
        if os.name != "nt":
            raise FilesystemError("Opening files with their Windows app is Windows-only.")
        os.startfile(str(item))
        logger.info("Opened an allowed data file in its associated application.")
        return f"Opened file in its associated application: {item}"

    def perform_operation(
        self,
        action: str,
        path: str,
        destination: str = "",
        new_name: str = "",
        find_text: str = "",
        replacement_text: str = "",
        new_content: str = "",
        recursive: bool = False,
    ) -> str:
        if action not in {"copy", "move", "rename", "delete", "edit", "write"}:
            raise FilesystemError(
                "Supported operations are copy, move, rename, delete, edit, and write."
            )
        source = self._resolve(path)
        original_digest = ""
        self.security.ensure_mutable_target(source)
        if action in {"copy", "move", "delete"}:
            self.security.ensure_safe_tree(
                source,
                recursive=recursive,
                max_items=self.config.max_directory_items,
            )
        if action in {"copy", "move"}:
            if not destination:
                raise FilesystemError("A complete destination path is required.")
            target = self._resolve(destination, allow_missing=True)
            if target.exists() and target.is_dir():
                target = target / source.name
            target = self._resolve(str(target), allow_missing=True)
            self.security.ensure_mutable_target(target)
            if target.exists():
                raise FilesystemError(f"Destination already exists: {target}")
            if not target.parent.is_dir():
                raise FilesystemError(f"Destination folder does not exist: {target.parent}")
            if source == target or source in target.parents:
                raise FilesystemError("A folder cannot be copied or moved inside itself.")
            destination = str(target)
        elif action == "rename":
            if not new_name or Path(new_name).name != new_name or new_name in {".", ".."}:
                raise FilesystemError("Provide a new filename without folder separators.")
            target = self._resolve(str(source.with_name(new_name)), allow_missing=True)
            if target.exists():
                raise FilesystemError(f"Destination already exists: {target}")
            new_name = target.name
        elif action == "edit":
            if not source.is_file() or not find_text:
                raise FilesystemError("Editing requires a text file and non-empty old text.")
            content = self._read_text(source, self.config.max_read_bytes)
            if content.count(find_text) != 1:
                raise FilesystemError(
                    "The old text must match exactly once. No changes were made."
                )
            if len(replacement_text.encode("utf-8")) > self.config.max_read_bytes:
                raise FilesystemError("Replacement text is too large.")
        elif action == "write":
            if not source.is_file():
                raise FilesystemError("Full-file edits require an existing text file.")
            if len(new_content.encode("utf-8")) > self.config.max_read_bytes:
                raise FilesystemError(
                    f"Updated content exceeds the {self.config.max_read_bytes}-byte limit."
                )
            current_content = self._read_text(source, self.config.max_read_bytes)
            reject_secret_content(new_content, source)
            original_digest = hashlib.sha256(current_content.encode("utf-8")).hexdigest()

        operation = FilesystemOperation(
            action=action,
            path=str(source),
            destination=destination,
            new_name=new_name,
            find_text=find_text,
            replacement_text=replacement_text,
            new_content=new_content,
            original_digest=original_digest if action == "write" else "",
            recursive=recursive,
        )
        logger.info("Executing filesystem %s for '%s'.", action, source.name)
        return self._execute_operation(operation)

    def _execute_operation(self, operation: FilesystemOperation) -> str:
        source = self._resolve(operation.path)
        self.security.ensure_mutable_target(source)
        action = operation.action
        if action == "delete":
            self.security.ensure_safe_tree(
                source,
                recursive=operation.recursive,
                max_items=self.config.max_directory_items,
            )
            try:
                send2trash(str(source))
            except OSError as error:
                raise FilesystemError(
                    f"Could not move '{source.name}' to the Recycle Bin: {error}"
                ) from error
            logger.info("Completed filesystem delete for '%s'.", source.name)
            return f"Moved to the Recycle Bin: {source}"
        if action in {"copy", "move"}:
            self.security.ensure_safe_tree(
                source,
                recursive=operation.recursive,
                max_items=self.config.max_directory_items,
            )
            target = self._resolve(operation.destination, allow_missing=True)
            if target.exists():
                raise FilesystemError(f"Destination already exists: {target}")
            if not target.parent.is_dir():
                raise FilesystemError(f"Destination folder no longer exists: {target.parent}")
            if action == "copy":
                created_target = False
                try:
                    if source.is_dir():
                        shutil.copytree(source, target, copy_function=shutil.copy2)
                    else:
                        with source.open("rb") as source_file, target.open("xb") as target_file:
                            created_target = True
                            shutil.copyfileobj(source_file, target_file)
                        shutil.copystat(source, target)
                except OSError as error:
                    if created_target:
                        target.unlink(missing_ok=True)
                    raise FilesystemError(
                        f"Could not copy '{source.name}' to '{target}': {error}"
                    ) from error
                logger.info("Completed filesystem copy for '%s'.", source.name)
                return f"Copied to: {target}"
            try:
                shutil.move(str(source), str(target))
            except OSError as error:
                raise FilesystemError(
                    f"Could not move '{source.name}' to '{target}': {error}"
                ) from error
            logger.info("Completed filesystem move for '%s'.", source.name)
            return f"Moved to: {target}"
        if action == "rename":
            target = self._resolve(
                str(source.with_name(operation.new_name)), allow_missing=True
            )
            if target.exists():
                raise FilesystemError(f"Destination already exists: {target}")
            try:
                source.rename(target)
            except OSError as error:
                raise FilesystemError(
                    f"Could not rename '{source.name}' to '{target.name}': {error}"
                ) from error
            logger.info("Completed filesystem rename for '%s'.", source.name)
            return f"Renamed to: {target}"
        if action in {"edit", "write"}:
            current = self._read_text(source, self.config.max_read_bytes)
            if action == "write":
                current_digest = hashlib.sha256(current.encode("utf-8")).hexdigest()
                if current_digest != operation.original_digest:
                    raise FilesystemError(
                        "The file changed after the edit was prepared. No changes were made."
                    )
                updated = operation.new_content
            else:
                if current.count(operation.find_text) != 1:
                    raise FilesystemError(
                        "The old text no longer matches exactly once. No changes were made."
                    )
                updated = current.replace(
                    operation.find_text, operation.replacement_text, 1
                )
            backup = self._write_with_backup(source, updated)
            logger.info("Completed filesystem edit for '%s'.", source.name)
            return f"Updated '{source.name}'. A backup was created at '{backup.name}'."
        raise FilesystemError(f"Unsupported operation: {action}")

    @staticmethod
    def _write_with_backup(source: Path, content: str) -> Path:
        backup = source.with_name(f"{source.name}.bobby-backup-{time.time_ns()}")
        temporary_path: Path | None = None
        try:
            shutil.copy2(source, backup)
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                newline="",
                dir=source.parent,
                prefix=".bobby-edit-",
                suffix=".tmp",
                delete=False,
            ) as temporary:
                temporary.write(content)
                temporary_path = Path(temporary.name)
            os.replace(temporary_path, source)
        except OSError as error:
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    logger.warning("Could not remove a temporary edit file.")
            raise FilesystemError(
                f"Could not safely update '{source.name}': {error}"
            ) from error
        return backup
