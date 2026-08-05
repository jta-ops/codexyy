#!/usr/bin/env python3
"""Execute a service process after loading its systemd credential environment."""

from __future__ import annotations

import os
import sys

from credential_env import load_credential_environment


def main() -> int:
    args = sys.argv[1:]
    if args[:1] == ["--"]:
        args = args[1:]
    if not args:
        raise SystemExit("usage: exec_with_credentials.py -- PROGRAM [ARG ...]")
    load_credential_environment()
    os.execvpe(args[0], args, os.environ)
    return 127


if __name__ == "__main__":
    raise SystemExit(main())
