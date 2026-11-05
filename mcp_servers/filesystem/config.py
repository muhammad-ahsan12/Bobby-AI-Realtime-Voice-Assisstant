"""Configuration for Bobby's restricted filesystem server."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

ROOTS_ENV_VAR = "BOBBY_FILESYSTEM_ROOTS"
MAX_READ_BYTES = 256 * 1024
MAX_SEARCH_FILE_BYTES = 1024 * 1024
MAX_RESULTS = 200
MAX_DIRECTORY_ITEMS = 100_000
ACCESS_ENV_VAR = "BOBBY_FILESYSTEM_ACCESS"


def _default_access_roots() -> tuple[Path, ...]:
    home = Path.home()
    if os.name != "nt":
        return (home,)

    system_drive = os.environ.get("SystemDrive", "C:").casefold().rstrip("\\/")
    roots = [home / "Desktop"]
    data_drive = Path("D:\\")
    if str(data_drive).casefold().rstrip("\\/") != system_drive:
        roots.append(data_drive)
    return tuple(roots)


@dataclass(frozen=True)
class FilesystemConfig:
    allowed_roots: tuple[Path, ...]
    max_read_bytes: int = MAX_READ_BYTES
    max_search_file_bytes: int = MAX_SEARCH_FILE_BYTES
    max_results: int = MAX_RESULTS
    max_directory_items: int = MAX_DIRECTORY_ITEMS

    @classmethod
    def from_environment(
        cls, environ: Mapping[str, str] | None = None
    ) -> FilesystemConfig:
        values = os.environ if environ is None else environ
        configured_roots = values.get(ROOTS_ENV_VAR, "").strip()
        if configured_roots:
            roots = tuple(
                Path(value.strip().strip('"')).expanduser()
                for value in configured_roots.split(os.pathsep)
                if value.strip()
            )
        else:
            access = values.get(ACCESS_ENV_VAR, "desktop_and_d_drive").strip().casefold()
            if access not in {"desktop_and_d_drive", "all_data_drives"}:
                raise ValueError(
                    f"Unsupported {ACCESS_ENV_VAR} value: {access!r}. "
                    f"Use 'desktop_and_d_drive' or configure {ROOTS_ENV_VAR}."
                )
            roots = tuple(path for path in _default_access_roots() if path.is_dir())

        return cls(allowed_roots=roots)
