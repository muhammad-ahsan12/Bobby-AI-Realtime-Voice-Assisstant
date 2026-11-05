"""Path confinement and sensitive-file protections for filesystem tools."""

from __future__ import annotations

import os
import re
import stat
from pathlib import Path


class FilesystemError(RuntimeError):
    """An expected filesystem operation or security check failed."""


class SensitiveContentError(FilesystemError):
    """Content appears to contain credentials or a private key."""


class FileSizeLimitError(FilesystemError):
    """A read exceeded its configured size limit."""


class NotTextFileError(FilesystemError):
    """A file could not be decoded as supported UTF-8 text."""


_PRIVATE_KEY_HEADER = re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")
_SECRET_ASSIGNMENT = re.compile(
    r"(?i)\b(?:api[_-]?key|client[_-]?secret|password|passwd|secret|"
    r"access[_-]?token|refresh[_-]?token|auth[_-]?token)\b"
    r"\s*[:=]\s*['\"]?[^\s'\";,]{6,}"
)
_GOOGLE_KEY = re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b")
_AWS_KEY = re.compile(r"\bAKIA[0-9A-Z]{16}\b")
_GITHUB_TOKEN = re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b")
_SENSITIVE_NAMES = {
    "authorized_keys",
    "credentials",
    "credentials.json",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
    "login data",
    "local state",
    "master.key",
    "web data",
}
_SENSITIVE_SUFFIXES = {".kdbx", ".key", ".pem", ".p12", ".pfx", ".ppk"}
_SENSITIVE_DIRECTORY_NAMES = {
    ".aws",
    ".ssh",
    ".azure",
    "appdata",
    "$recycle.bin",
    "boot",
    "credentials",
    "documents and settings",
    "firefox",
    "identitycache",
    "msocache",
    "perflogs",
    "protect",
    "program files",
    "program files (x86)",
    "programdata",
    "recovery",
    "system volume information",
    "tokenbroker",
    "vault",
    "windows",
}


def is_reparse_point(path: Path) -> bool:
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return False
    if stat.S_ISLNK(metadata.st_mode):
        return True
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    return bool(getattr(metadata, "st_file_attributes", 0) & reparse_flag)


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def is_sensitive_path(path: Path) -> bool:
    parts = tuple(part.casefold() for part in path.parts)
    name = path.name.casefold()
    if any(part == ".env" or part.startswith(".env.") for part in parts):
        return True
    if any(part in _SENSITIVE_DIRECTORY_NAMES for part in parts):
        return True
    if name in _SENSITIVE_NAMES or Path(name).suffix in _SENSITIVE_SUFFIXES:
        return True
    if name.endswith(".credentials") or name.endswith("_credentials.json"):
        return True
    if name.startswith("service-account") and name.endswith(".json"):
        return True

    for index, part in enumerate(parts[:-1]):
        if part in {"chrome", "edge"} and parts[index + 1] == "user data":
            return True
        if part == "firefox" and parts[index + 1] == "profiles":
            return True
    return False


def reject_secret_content(content: str, path: Path) -> None:
    if any(
        pattern.search(content)
        for pattern in (
            _PRIVATE_KEY_HEADER,
            _SECRET_ASSIGNMENT,
            _GOOGLE_KEY,
            _AWS_KEY,
            _GITHUB_TOKEN,
        )
    ):
        raise SensitiveContentError(
            f"Reading '{path.name}' is blocked because it appears to contain credentials."
        )


class FilesystemSecurity:
    def __init__(self, allowed_roots: tuple[Path, ...]) -> None:
        roots: list[Path] = []
        for configured_root in allowed_roots:
            try:
                root = configured_root.expanduser().resolve(strict=True)
            except OSError as error:
                raise FilesystemError(
                    f"Configured filesystem root is unavailable: {configured_root}"
                ) from error
            if not root.is_dir():
                raise FilesystemError(
                    f"Configured filesystem root is not a directory: {root}"
                )
            if is_sensitive_path(root):
                raise FilesystemError(
                    f"Sensitive directories cannot be configured as filesystem roots: {root}"
                )
            self._reject_reparse_components(root)
            if root not in roots:
                roots.append(root)
        self.allowed_roots = tuple(roots)

    @staticmethod
    def _reject_reparse_components(path: Path) -> None:
        components = list(reversed((path, *path.parents)))
        for component in components:
            if is_reparse_point(component):
                raise FilesystemError(
                    f"Symbolic links and junctions are not allowed: {component}"
                )

    def resolve(self, value: str, *, allow_missing: bool = False) -> Path:
        if not value or "\x00" in value:
            raise FilesystemError("A valid filesystem path is required.")
        candidate = Path(value).expanduser()
        if not candidate.is_absolute():
            if len(self.allowed_roots) != 1:
                raise FilesystemError(
                    "Use a full path, or configure exactly one allowed root for relative paths."
                )
            candidate = self.allowed_roots[0] / candidate
        candidate = Path(os.path.abspath(candidate))
        if os.name == "nt" and any(":" in part for part in candidate.parts[1:]):
            raise FilesystemError("Windows alternate data stream paths are not allowed.")

        matching_roots = [
            root for root in self.allowed_roots if _is_within(candidate, root)
        ]
        if not matching_roots:
            raise FilesystemError(f"Path is outside the configured allowed folders: {value}")
        root = max(matching_roots, key=lambda item: len(item.parts))

        try:
            resolved = candidate.resolve(strict=not allow_missing)
        except FileNotFoundError:
            if not allow_missing:
                raise FilesystemError(f"Path does not exist: {value}") from None
            resolved = candidate.resolve(strict=False)
        except OSError as error:
            raise FilesystemError(f"Cannot access path '{value}': {error}") from error

        if not _is_within(resolved, root):
            raise FilesystemError(f"Path resolves outside the configured allowed folder: {value}")
        if is_sensitive_path(candidate) or is_sensitive_path(resolved):
            raise FilesystemError("Access to credential and sensitive-data paths is blocked.")

        self._reject_reparse_components(root)
        relative = candidate.relative_to(root)
        current = root
        for part in relative.parts:
            current = current / part
            if is_reparse_point(current):
                raise FilesystemError(
                    f"Symbolic links and junctions are not allowed: {current}"
                )

        if not allow_missing and not candidate.exists():
            raise FilesystemError(f"Path does not exist: {value}")
        return resolved

    def ensure_mutable_target(self, path: Path) -> None:
        if path in self.allowed_roots:
            raise FilesystemError("An allowed root folder cannot be replaced or deleted.")

    def ensure_safe_tree(
        self, path: Path, *, recursive: bool, max_items: int = 100_000
    ) -> None:
        if path.is_dir() and not recursive:
            raise FilesystemError(
                "This operation targets a folder; set recursive=true to include its contents."
            )
        if path.is_dir():
            item_count = 0
            for directory, subdirectories, filenames in os.walk(
                path, followlinks=False, onerror=_raise_walk_error
            ):
                parent = Path(directory)
                for name in (*subdirectories, *filenames):
                    item_count += 1
                    if item_count > max_items:
                        raise FilesystemError(
                            f"Folder operations are limited to {max_items} items."
                        )
                    child = parent / name
                    self.resolve(str(child))
                    if is_reparse_point(child):
                        raise FilesystemError(
                            f"Symbolic links and junctions are not allowed: {child}"
                        )


def _raise_walk_error(error: OSError) -> None:
    raise error
