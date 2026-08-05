#!/usr/bin/env python3
"""codexyy - run in your project, code in your browser."""

import asyncio
import base64
import json
import os
import subprocess
import sys
import termios
import tty
import urllib.request
from pathlib import Path

try:
    import websockets
except ImportError:
    print("Installing websockets...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets", "-q"])
    import websockets

BASE_URL = "https://codexyy.dev"
WS_URL = "wss://codexyy.dev"
CWD = os.getcwd()


def create_session() -> str:
    req = urllib.request.Request(
        f"{BASE_URL}/api/session/create",
        method="POST",
        headers={"Content-Type": "application/json"},
        data=b"{}",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    return data["session_id"]


def copy_to_clipboard(text: str) -> bool:
    # OSC 52 - works in modern terminals including over SSH
    b64 = base64.b64encode(text.encode()).decode()
    sys.stdout.write(f'\033]52;c;{b64}\a')
    sys.stdout.flush()
    return True


def get_keypress() -> str:
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        return sys.stdin.read(1)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def print_banner(url: str, chat_mode: bool):
    W = '\033[1m'    # bold/white
    G = '\033[1;32m' # green
    C = '\033[1;36m' # cyan
    D = '\033[2m'    # dim
    X = '\033[0m'    # reset

    mode = "chat" if chat_mode else "code"
    print(f"\n  {C}codexyy{X}  {D}|  {mode} mode{X}")
    print(f"  {D}{'─' * 40}{X}")
    print(f"  {D}project  {X}{CWD}")
    print(f"  {D}url      {X}{W}{url}{X}")
    print(f"  {D}{'─' * 40}{X}")
    print(f"  {G}c{X}{D} copy url   {G}q{X}{D} quit{X}\n")


def fs_list(path: str) -> dict:
    root = Path(path)
    def build(p: Path, depth=0):
        if depth > 4:
            return None
        ignore = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", ".next", "build"}
        if p.name in ignore:
            return None
        if p.is_file():
            return {"name": p.name, "type": "file", "path": str(p)}
        if p.is_dir():
            children = []
            try:
                for child in sorted(p.iterdir()):
                    node = build(child, depth + 1)
                    if node:
                        children.append(node)
            except PermissionError:
                pass
            return {"name": p.name, "type": "dir", "path": str(p), "children": children}
    return build(root) or {}


def fs_read(path: str) -> str:
    with open(path, "r", errors="replace") as f:
        return f.read()


def fs_write(path: str, content: str):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        f.write(content)


def fs_diff(path: str, new_content: str) -> str:
    import difflib
    try:
        old = Path(path).read_text(errors="replace").splitlines(keepends=True)
    except FileNotFoundError:
        old = []
    new = new_content.splitlines(keepends=True)
    return "".join(difflib.unified_diff(old, new, fromfile=path, tofile=path))


async def shell_run(cmd: str, msg_id: str, ws):
    try:
        proc = await asyncio.create_subprocess_shell(
            cmd, cwd=CWD,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        async for line in proc.stdout:
            await ws.send(json.dumps({"type": "shell.output", "id": msg_id, "chunk": line.decode(errors="replace"), "done": False}))
        await proc.wait()
        await ws.send(json.dumps({"type": "shell.output", "id": msg_id, "chunk": "", "done": True, "exit_code": proc.returncode}))
    except Exception as e:
        await ws.send(json.dumps({"type": "shell.output", "id": msg_id, "chunk": f"Error: {e}\n", "done": True, "exit_code": 1}))


async def handle_message(msg: dict, ws):
    t = msg.get("type")
    mid = msg.get("id", "")
    try:
        if t == "fs.list":
            await ws.send(json.dumps({"type": "fs.list.result", "id": mid, "data": fs_list(msg.get("path", CWD))}))
        elif t == "fs.read":
            await ws.send(json.dumps({"type": "fs.read.result", "id": mid, "content": fs_read(msg["path"])}))
        elif t == "fs.write":
            fs_write(msg["path"], msg["content"])
            await ws.send(json.dumps({"type": "fs.write.result", "id": mid, "ok": True}))
        elif t == "fs.diff":
            await ws.send(json.dumps({"type": "fs.diff.result", "id": mid, "diff": fs_diff(msg["path"], msg["content"])}))
        elif t == "shell.run":
            asyncio.create_task(shell_run(msg["cmd"], mid, ws))
        elif t == "ping":
            await ws.send(json.dumps({"type": "pong", "id": mid}))
    except Exception as e:
        await ws.send(json.dumps({"type": "error", "id": mid, "message": str(e)}))


async def key_listener(url: str, stop_event: asyncio.Event):
    loop = asyncio.get_event_loop()
    D = '\033[2m'
    G = '\033[1;32m'
    X = '\033[0m'
    while not stop_event.is_set():
        try:
            key = await loop.run_in_executor(None, get_keypress)
        except Exception:
            break
        if key in ('c', 'C'):
            copy_to_clipboard(url)
            print(f"  {G}✓{X}{D} copied{X}")
        elif key in ('q', 'Q', '\x03', '\x04'):
            stop_event.set()
            break


async def run(chat_mode: bool = False):
    print(f"\n\033[2m  connecting...\033[0m", end="\r")

    try:
        session_id = create_session()
    except Exception as e:
        print(f"\033[31m  error: could not reach {BASE_URL}\033[0m")
        print(f"\033[2m  {e}\033[0m\n")
        sys.exit(1)

    page = "chat" if chat_mode else "s"
    url = f"{BASE_URL}/{page}/{session_id}"

    print_banner(url, chat_mode)

    stop_event = asyncio.Event()

    async with websockets.connect(f"{WS_URL}/relay/{session_id}?client_type=cli") as ws:
        await ws.send(json.dumps({"type": "info", "cwd": CWD, "session_id": session_id, "mode": "chat" if chat_mode else "code"}))

        key_task = asyncio.create_task(key_listener(url, stop_event))

        try:
            async for raw in ws:
                if stop_event.is_set():
                    break
                try:
                    msg = json.loads(raw)
                    if not chat_mode:
                        await handle_message(msg, ws)
                except json.JSONDecodeError:
                    pass
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            key_task.cancel()

    print("\n\033[2m  disconnected.\033[0m\n")


def main():
    chat_mode = "--chat" in sys.argv
    try:
        asyncio.run(run(chat_mode=chat_mode))
    except KeyboardInterrupt:
        print("\n\033[2m  codexyy stopped.\033[0m\n")


if __name__ == "__main__":
    main()
