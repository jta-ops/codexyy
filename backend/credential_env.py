"""Load protected key/value files supplied by systemd credentials.

The backend can still be started manually with ordinary environment variables.
In production, systemd decrypts named credentials into an in-memory, private
directory and this module imports them before application configuration loads.
"""

from __future__ import annotations

import os
from pathlib import Path
import shlex


CREDENTIAL_NAMES = ("backend.env", "graph-mail.env", "agent-server.env")


def parse_environment_file(value: str) -> dict[str, str]:
    output: dict[str, str] = {}
    for number, raw_line in enumerate(value.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise ValueError(f"invalid credential environment line {number}")
        key, raw_value = line.split("=", 1)
        key = key.strip()
        if not key or not key.replace("_", "A").isalnum() or not key[0].isalpha():
            raise ValueError(f"invalid credential name on line {number}")
        parsed = shlex.split(raw_value.strip(), posix=True)
        if len(parsed) > 1:
            raise ValueError(f"invalid credential value on line {number}")
        output[key] = parsed[0] if parsed else ""
    return output


def load_credential_environment() -> int:
    directory = os.environ.get("CREDENTIALS_DIRECTORY", "")
    if not directory:
        return 0
    loaded = 0
    root = Path(directory)
    for name in CREDENTIAL_NAMES:
        path = root / name
        if not path.is_file():
            continue
        for key, value in parse_environment_file(path.read_text(encoding="utf-8")).items():
            if key not in os.environ:
                os.environ[key] = value
                loaded += 1
    return loaded
