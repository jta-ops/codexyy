#!/usr/bin/env python3
"""Create an encrypted Codexyy + Gitea backup and perform a restore drill."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import time
import zipfile


BACKUP_ROOT = Path("/home/ubuntu/backups/codexyy")
CREDENTIAL_DIRECTORY = Path(os.environ.get("CREDENTIALS_DIRECTORY", "/nonexistent"))
KEY_PATH = (
    CREDENTIAL_DIRECTORY / "backup.key"
    if (CREDENTIAL_DIRECTORY / "backup.key").is_file()
    else Path("/home/ubuntu/.config/codexyy/backup.key")
)
MAIN_DB = Path(os.environ.get("CODEXYY_DB", "/home/ubuntu/codexyy/data.db"))
GITEA = Path("/home/ubuntu/gitea/bin/gitea")
GITEA_CONFIG = Path("/home/ubuntu/gitea/custom/conf/app.ini")


def ensure_key() -> None:
    if os.environ.get("CREDENTIALS_DIRECTORY") and KEY_PATH.is_file():
        return
    KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not KEY_PATH.exists():
        descriptor = os.open(KEY_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(base64.urlsafe_b64encode(os.urandom(48)) + b"\n")
    os.chmod(KEY_PATH, 0o600)


def sqlite_backup(source: Path, destination: Path) -> None:
    with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as source_db:
        with sqlite3.connect(destination) as destination_db:
            source_db.backup(destination_db)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_sqlite(path: Path) -> None:
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
        result = db.execute("PRAGMA integrity_check").fetchone()
    if not result or result[0] != "ok":
        raise RuntimeError(f"SQLite restore drill failed for {path.name}")


def restore_drill(encrypted_path: Path) -> dict:
    if not encrypted_path.is_file():
        raise RuntimeError(f"Backup does not exist: {encrypted_path}")
    with tempfile.TemporaryDirectory(prefix="codexyy-restore-") as temp_name:
        temp = Path(temp_name)
        restored_archive = temp / "restore.tar.gz"
        subprocess.run(
            [
                "openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2",
                "-in", str(encrypted_path), "-out", str(restored_archive),
                "-pass", f"file:{KEY_PATH}",
            ],
            check=True,
            timeout=300,
        )
        restore_dir = temp / "restore"
        restore_dir.mkdir()
        with tarfile.open(restored_archive, "r:gz") as tar:
            tar.extractall(restore_dir, filter="data")
        payload = restore_dir / "codexyy"
        manifest = json.loads((payload / "manifest.json").read_text())
        for relative_name, expected in manifest.get("files", {}).items():
            restored_file = payload / relative_name
            if not restored_file.is_file():
                raise RuntimeError(f"Restore drill is missing {relative_name}")
            if restored_file.stat().st_size != int(expected["bytes"]):
                raise RuntimeError(f"Restore drill size mismatch for {relative_name}")
            if sha256(restored_file) != expected["sha256"]:
                raise RuntimeError(f"Restore drill checksum mismatch for {relative_name}")
        verify_sqlite(payload / "data.db")
        with zipfile.ZipFile(payload / "gitea-dump.zip") as archive_zip:
            corrupt_name = archive_zip.testzip()
            if corrupt_name is not None:
                raise RuntimeError(f"Gitea restore drill found a corrupt file: {corrupt_name}")
        return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--retention-days", type=int, default=14)
    parser.add_argument("--verify-latest", action="store_true")
    args = parser.parse_args()
    BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    os.chmod(BACKUP_ROOT, 0o700)
    ensure_key()

    if args.verify_latest:
        state_path = BACKUP_ROOT / "latest.json"
        if not state_path.is_file():
            raise RuntimeError("No completed backup is available to verify")
        state = json.loads(state_path.read_text())
        encrypted_path = BACKUP_ROOT / str(state.get("file") or "")
        if sha256(encrypted_path) != state.get("sha256"):
            raise RuntimeError("Latest backup checksum does not match its state record")
        restore_drill(encrypted_path)
        result = {
            "status": "ok",
            "verified_at": int(time.time()),
            "file": encrypted_path.name,
            "sha256": state["sha256"],
            "restore_drill": "passed",
        }
        print(json.dumps(result))
        return 0

    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    final_path = BACKUP_ROOT / f"codexyy-{stamp}.tar.gz.enc"

    with tempfile.TemporaryDirectory(prefix="codexyy-backup-") as temp_name:
        temp = Path(temp_name)
        payload = temp / "payload"
        payload.mkdir()
        sqlite_backup(MAIN_DB, payload / "data.db")
        gitea_dump = payload / "gitea-dump.zip"
        subprocess.run(
            [
                str(GITEA), "dump", "--quiet", "--skip-log", "--skip-index",
                "--work-path", "/home/ubuntu/gitea", "--config", str(GITEA_CONFIG),
                "--file", str(gitea_dump),
            ],
            cwd="/home/ubuntu/gitea",
            check=True,
            timeout=300,
        )
        config_dir = payload / "protected-config"
        config_dir.mkdir()
        for source in (
            CREDENTIAL_DIRECTORY / "backend.env",
            CREDENTIAL_DIRECTORY / "graph-mail.env",
            CREDENTIAL_DIRECTORY / "auth.dev.vars",
        ):
            if source.exists():
                shutil.copy2(source, config_dir / source.name)
        manifest = {
            "created_at": int(time.time()),
            "format": 1,
            "files": {
                str(path.relative_to(payload)): {"bytes": path.stat().st_size, "sha256": sha256(path)}
                for path in payload.rglob("*") if path.is_file()
            },
        }
        (payload / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        archive = temp / "codexyy.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(payload, arcname="codexyy")
        subprocess.run(
            [
                "openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-salt",
                "-in", str(archive), "-out", str(final_path),
                "-pass", f"file:{KEY_PATH}",
            ],
            check=True,
            timeout=300,
        )
        os.chmod(final_path, 0o600)

        restore_drill(final_path)

    cutoff = time.time() - max(1, args.retention_days) * 86400
    for old_backup in BACKUP_ROOT.glob("codexyy-*.tar.gz.enc"):
        if old_backup != final_path and old_backup.stat().st_mtime < cutoff:
            old_backup.unlink()
    state = {
        "status": "ok",
        "created_at": int(time.time()),
        "file": final_path.name,
        "bytes": final_path.stat().st_size,
        "sha256": sha256(final_path),
        "restore_drill": "passed",
    }
    state_path = BACKUP_ROOT / "latest.json"
    state_path.write_text(json.dumps(state, indent=2) + "\n")
    os.chmod(state_path, 0o600)
    print(json.dumps(state))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
