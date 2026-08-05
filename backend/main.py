from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, HTMLResponse, RedirectResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
import aiosqlite
import httpx
import shlex
import json
import uuid
import time
import random
import string
import re
import os
import asyncio
import secrets
import base64
import hashlib
import html
import urllib.parse
import threading
from email import policy
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid
import gitea

from credential_env import load_credential_environment

load_credential_environment()

GRAPH_TENANT_ID = os.environ.get("GRAPH_TENANT_ID", "")
GRAPH_CLIENT_ID = os.environ.get("GRAPH_CLIENT_ID", "")
GRAPH_CLIENT_SECRET = os.environ.get("GRAPH_CLIENT_SECRET", "")
GRAPH_SENDER = os.environ.get("GRAPH_SENDER", "platform@codexyy.dev")
_graph_access_token = ""
_graph_access_token_expires_at = 0.0
_graph_token_lock = threading.Lock()
_provider_state_lock = threading.Lock()
_provider_state: dict[str, dict[str, float | int]] = {}


def provider_available(name: str) -> bool:
    """Return false while a provider circuit is cooling down."""
    with _provider_state_lock:
        state = _provider_state.get(name, {})
        return time.monotonic() >= float(state.get("open_until", 0.0))


def provider_succeeded(name: str) -> None:
    with _provider_state_lock:
        _provider_state[name] = {
            "failures": 0,
            "open_until": 0.0,
            "last_success": int(time.time()),
            "last_failure": int(_provider_state.get(name, {}).get("last_failure", 0)),
        }


def provider_failed(name: str) -> None:
    """Open a short circuit after repeated terminal provider failures."""
    with _provider_state_lock:
        previous = _provider_state.get(name, {})
        failures = int(previous.get("failures", 0)) + 1
        _provider_state[name] = {
            "failures": failures,
            "open_until": time.monotonic() + (60.0 if failures >= 4 else 0.0),
            "last_success": int(previous.get("last_success", 0)),
            "last_failure": int(time.time()),
        }


def provider_snapshot() -> dict[str, dict[str, int | str]]:
    now = time.monotonic()
    with _provider_state_lock:
        return {
            name: {
                "status": "open" if now < float(state.get("open_until", 0.0)) else "closed",
                "failures": int(state.get("failures", 0)),
                "last_success": int(state.get("last_success", 0)),
                "last_failure": int(state.get("last_failure", 0)),
            }
            for name, state in _provider_state.items()
        }


class EmailDeliveryError(RuntimeError):
    """A safe email delivery error that never contains credentials."""


def _microsoft_graph_access_token() -> str:
    global _graph_access_token, _graph_access_token_expires_at
    now = time.monotonic()
    with _graph_token_lock:
        if _graph_access_token and now < _graph_access_token_expires_at:
            return _graph_access_token
        if not all((GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET)):
            raise EmailDeliveryError("Microsoft Graph is not configured")
        try:
            response = httpx.post(
                f"https://login.microsoftonline.com/{urllib.parse.quote(GRAPH_TENANT_ID, safe='')}/oauth2/v2.0/token",
                data={
                    "client_id": GRAPH_CLIENT_ID,
                    "client_secret": GRAPH_CLIENT_SECRET,
                    "scope": "https://graph.microsoft.com/.default",
                    "grant_type": "client_credentials",
                },
                timeout=15.0,
            )
        except httpx.HTTPError as exc:
            raise EmailDeliveryError("Microsoft Graph authentication is unavailable") from exc
        try:
            body = response.json()
        except ValueError as exc:
            raise EmailDeliveryError("Microsoft Graph returned an invalid authentication response") from exc
        token = body.get("access_token") if isinstance(body, dict) else None
        if response.status_code != 200 or not isinstance(token, str) or not token:
            error_code = body.get("error", "unknown_error") if isinstance(body, dict) else "unknown_error"
            raise EmailDeliveryError(
                f"Microsoft Graph authentication failed ({response.status_code}, {error_code})"
            )
        try:
            expires_in = max(60, int(body.get("expires_in", 3600)))
        except (TypeError, ValueError):
            expires_in = 3600
        _graph_access_token = token
        _graph_access_token_expires_at = time.monotonic() + max(30, expires_in - 120)
        return token

def _send_email_raw(
    to: str,
    subject: str,
    html: str,
    text: str = "",
    from_email: str | None = None,
    from_name: str = "Codexyy",
):
    sender = (from_email or GRAPH_SENDER).strip().lower()
    recipient = to.strip().lower()
    clean_subject = re.sub(r"[\r\n]+", " ", subject).strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", recipient):
        raise EmailDeliveryError("Invalid email recipient")
    if not re.fullmatch(r"[^\s@]+@codexyy\.dev", sender):
        raise EmailDeliveryError("Microsoft Graph sender must be a codexyy.dev mailbox")
    if not clean_subject:
        raise EmailDeliveryError("Email subject is required")
    msg = MIMEMultipart("alternative")
    msg["Subject"] = clean_subject
    msg["From"] = f"{from_name} <{sender}>"
    msg["Reply-To"] = sender
    msg["To"] = recipient
    msg["Date"] = formatdate(localtime=False, usegmt=True)
    msg["Message-ID"] = make_msgid(domain="codexyy.dev")
    msg["X-Auto-Response-Suppress"] = "All"
    if text:
        msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))
    mime_body = base64.b64encode(msg.as_bytes(policy=policy.SMTP)).decode("ascii")
    global _graph_access_token, _graph_access_token_expires_at
    for attempt in range(4):
        token = _microsoft_graph_access_token()
        try:
            response = httpx.post(
                f"https://graph.microsoft.com/v1.0/users/{urllib.parse.quote(sender, safe='')}/sendMail",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "text/plain",
                },
                content=mime_body,
                timeout=20.0,
            )
        except httpx.HTTPError as exc:
            if attempt < 3:
                time.sleep(0.5 * (2 ** attempt))
                continue
            raise EmailDeliveryError("Microsoft Graph sendMail is unavailable") from exc
        if response.status_code == 202:
            return
        if response.status_code == 401 and attempt == 0:
            with _graph_token_lock:
                _graph_access_token = ""
                _graph_access_token_expires_at = 0.0
            continue
        if (response.status_code == 429 or response.status_code >= 500) and attempt < 3:
            retry_after = response.headers.get("retry-after", "")
            try:
                delay = min(30.0, max(0.25, float(retry_after)))
            except ValueError:
                delay = 0.5 * (2 ** attempt)
            time.sleep(delay)
            continue
        raise EmailDeliveryError(f"Microsoft Graph sendMail failed ({response.status_code})")
    raise EmailDeliveryError("Microsoft Graph sendMail retry limit reached")


def send_email(
    to: str,
    subject: str,
    html: str,
    text: str = "",
    from_email: str | None = None,
    from_name: str = "Codexyy",
):
    if not provider_available("microsoft_graph"):
        raise EmailDeliveryError("Microsoft Graph circuit is cooling down")
    try:
        result = _send_email_raw(to, subject, html, text, from_email, from_name)
    except Exception:
        provider_failed("microsoft_graph")
        raise
    provider_succeeded("microsoft_graph")
    return result

app = FastAPI()

WEB_ORIGINS = [
    "https://codexyy.dev",
    "https://www.codexyy.dev",
    "https://codexyy.vltgg.net",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=WEB_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)

DB = os.environ.get("CODEXYY_DB", "/home/ubuntu/codexyy/data.db")

GOOGLE_CLIENT_ID     = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
OPENROUTER_API_KEY   = os.environ.get("OPENROUTER_API_KEY", "")
CF_ACCOUNT_ID        = os.environ.get("CF_ACCOUNT_ID", "")
CF_API_TOKEN         = os.environ.get("CF_API_TOKEN", "")
CF_MODEL             = "@cf/qwen/qwen2.5-coder-32b-instruct"
FREE_WEEKLY_LIMIT    = 30
STRIPE_SECRET_KEY    = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICES = {
    "pro":        os.environ.get("STRIPE_PRICE_PRO", ""),
    "promax_15":  os.environ.get("STRIPE_PRICE_PROMAX_15", ""),
    "promax_20":  os.environ.get("STRIPE_PRICE_PROMAX_20", ""),
    "promax_25":  os.environ.get("STRIPE_PRICE_PROMAX_25", ""),
    "promax_30":  os.environ.get("STRIPE_PRICE_PROMAX_30", ""),
}
STRIPE_PRICE_LOOKUPS = {
    "pro":        "codexyy_pro_5",
    "promax_15": "codexyy_pro_max_15",
    "promax_20": "codexyy_pro_max_20",
    "promax_25": "codexyy_pro_max_25",
    "promax_30": "codexyy_pro_max_30",
}
BASE_URL             = os.environ.get("CODEXYY_BASE_URL", "https://codexyy.dev").rstrip("/")
CODEXYY_AUTH_CLIENT  = "codexyy-web"
ALLOWED_HOSTS        = {
    "codexyy.dev", "www.codexyy.dev", "codexyy.vltgg.net",
    "codexyy.com", "www.codexyy.com",
}

def public_origin_for(request: Request) -> str:
    host = request.headers.get("host", "codexyy.dev").split(":", 1)[0].lower()
    return f"https://{host}" if host in ALLOWED_HOSTS else BASE_URL

def google_redirect_for(request: Request) -> str:
    host = request.headers.get("host", "codexyy.dev").split(":")[0]
    if host in ALLOWED_HOSTS and host != "codexyy.dev" and host != "www.codexyy.dev":
        return f"https://{host}/auth/callback"
    return f"{BASE_URL}/auth/callback"

CX_OPENAPI_SCHEMA = {
    "openapi": "3.1.0",
    "info": {
        "title": "cx Language API",
        "version": "1.0.0",
        "description": (
            "Run cx code on a connected machine and manage cx files in the user's cxgpt/ workspace. "
            "The user must run 'cx gpt' locally first to get a session code, then provide it when making API calls. "
            "cx is a minimalist programming language with clean syntax — functions, loops, conditionals, and string interpolation.\n\n"
            "Workflow:\n"
            "1. Call cxSession to get a session code\n"
            "2. Tell the user to run 'cx gpt' and enter the code\n"
            "3. Call cxStatus to verify they're connected\n"
            "4. Use cxWrite to create .cx files in their cxgpt/ directory\n"
            "5. Use cxRun to execute code on their machine\n"
            "6. Use cxRead/cxEdit/cxFiles to inspect and iterate on files"
        )
    },
    "servers": [{"url": "https://codexyy.dev"}],
    "paths": {
        "/api/cx/session": {
            "post": {
                "operationId": "cxSession",
                "summary": "Create a new cx session",
                "description": "Creates a new cx execution session. Returns a session code that the user's local machine connects to via 'cx gpt'. Share this code with the user so they can connect their terminal.",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/CxSessionRequest"}
                        }
                    }
                },
                "responses": {
                    "200": {
                        "description": "Session created",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CxSessionResponse"}
                            }
                        }
                    }
                }
            }
        },
        "/api/cx/run": {
            "post": {
                "operationId": "cxRun",
                "summary": "Execute cx code",
                "description": "Runs cx code on the user's connected machine. The user must have run 'cx gpt' locally and provided their session code. Supports all cx language features: variables, functions, loops, conditionals, and string interpolation.",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/CxRunRequest"}
                        }
                    }
                },
                "responses": {
                    "200": {
                        "description": "Execution result",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CxRunResponse"}
                            }
                        }
                    }
                }
            }
        },
        "/api/cx/status": {
            "post": {
                "operationId": "cxStatus",
                "summary": "Check session status",
                "description": "Check if a cx session has a connected machine ready to execute code.",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/CxSessionCode"}
                        }
                    }
                },
                "responses": {
                    "200": {
                        "description": "Status info",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CxStatusResponse"}
                            }
                        }
                    }
                }
            }
        },
        "/api/cx/files": {
            "post": {
                "operationId": "cxFiles",
                "summary": "List cx files",
                "description": "List all .cx files in the user's cxgpt/ directory. The user must have run 'cx gpt' and provided their session code.",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/CxSessionCode"}
                        }
                    }
                },
                "responses": {
                    "200": {
                        "description": "File list",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CxFilesResponse"}
                            }
                        }
                    }
                }
            }
        },
        "/api/cx/read": {
            "post": {
                "operationId": "cxRead",
                "summary": "Read a cx file",
                "description": "Read the contents of a .cx file from the user's cxgpt/ directory.",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/CxPathRequest"}
                        }
                    }
                },
                "responses": {
                    "200": {
                        "description": "File contents",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CxReadResponse"}
                            }
                        }
                    }
                }
            }
        },
        "/api/cx/write": {
            "post": {
                "operationId": "cxWrite",
                "summary": "Create or overwrite a cx file",
                "description": "Create a new .cx file or overwrite an existing one in the user's cxgpt/ directory. Use this to write programs that can then be executed with cxRun.",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/CxWriteRequest"}
                        }
                    }
                },
                "responses": {
                    "200": {
                        "description": "File written",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CxWriteResponse"}
                            }
                        }
                    }
                }
            }
        },
        "/api/cx/edit": {
            "post": {
                "operationId": "cxEdit",
                "summary": "Edit a cx file",
                "description": "Make a targeted edit to a .cx file in the user's cxgpt/ directory. Finds the 'old' text and replaces it with 'new' text. Safer than overwriting the entire file.",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/CxEditRequest"}
                        }
                    }
                },
                "responses": {
                    "200": {
                        "description": "File edited",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CxEditResponse"}
                            }
                        }
                    }
                }
            }
        }
    },
    "components": {
        "schemas": {
            "CxSessionCode": {
                "type": "object",
                "required": ["code"],
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Session code from the user (obtained from 'cx gpt')"
                    }
                }
            },
            "CxSessionRequest": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Optional existing session code to reconnect to"
                    }
                }
            },
            "CxRunRequest": {
                "type": "object",
                "required": ["code", "source"],
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Session code from the user (from 'cx gpt')"
                    },
                    "source": {
                        "type": "string",
                        "description": "cx source code to execute"
                    }
                }
            },
            "CxPathRequest": {
                "type": "object",
                "required": ["code", "path"],
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Session code from the user"
                    },
                    "path": {
                        "type": "string",
                        "description": "Filename relative to cxgpt/ directory (e.g. 'main.cx', 'utils.cx')"
                    }
                }
            },
            "CxWriteRequest": {
                "type": "object",
                "required": ["code", "path", "content"],
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Session code from the user"
                    },
                    "path": {
                        "type": "string",
                        "description": "Filename to write (e.g. 'hello.cx')"
                    },
                    "content": {
                        "type": "string",
                        "description": "Full file content to write"
                    }
                }
            },
            "CxEditRequest": {
                "type": "object",
                "required": ["code", "path", "old", "new"],
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Session code from the user"
                    },
                    "path": {
                        "type": "string",
                        "description": "Filename to edit"
                    },
                    "old": {
                        "type": "string",
                        "description": "Exact text to find and replace"
                    },
                    "new": {
                        "type": "string",
                        "description": "Replacement text"
                    }
                }
            },
            "CxSessionResponse": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "The session code — share this with the user so they can run 'cx gpt' and connect"
                    },
                    "url": {
                        "type": "string",
                        "description": "URL the user can visit or share"
                    },
                    "status": {
                        "type": "string",
                        "enum": ["waiting", "connected"],
                        "description": "Whether a machine is currently connected"
                    }
                }
            },
            "CxRunResponse": {
                "type": "object",
                "properties": {
                    "output": {
                        "type": "string",
                        "description": "stdout output from the cx program"
                    },
                    "error": {
                        "type": "string",
                        "description": "Error message if execution failed, null if successful"
                    },
                    "exit_code": {
                        "type": "integer",
                        "description": "0 for success, non-zero for errors"
                    }
                }
            },
            "CxStatusResponse": {
                "type": "object",
                "properties": {
                    "connected": {
                        "type": "boolean",
                        "description": "Whether a machine is connected and ready to execute code"
                    },
                    "url": {
                        "type": "string",
                        "description": "Web URL for the session"
                    }
                }
            },
            "CxFilesResponse": {
                "type": "object",
                "properties": {
                    "files": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": "Filename (e.g. 'main.cx')"
                                },
                                "size": {
                                    "type": "integer",
                                    "description": "File size in bytes"
                                },
                                "modified": {
                                    "type": "string",
                                    "description": "Last modified timestamp"
                                }
                            }
                        }
                    }
                }
            },
            "CxReadResponse": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string"
                    },
                    "content": {
                        "type": "string",
                        "description": "File contents"
                    },
                    "lines": {
                        "type": "integer",
                        "description": "Number of lines"
                    }
                }
            },
            "CxWriteResponse": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string"
                    },
                    "ok": {
                        "type": "boolean"
                    }
                }
            },
            "CxEditResponse": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string"
                    },
                    "ok": {
                        "type": "boolean"
                    },
                    "replacements": {
                        "type": "integer",
                        "description": "Number of replacements made (0 if not found)"
                    }
                }
            }
        }
    }
}

# OpenRouter spend limits in USD (shown to users as AUD)
PLAN_LIMITS_USD = {
    "pro":     3.80,   # $10/mo → $6 AUD spend
    "pro_max": None,   # dynamic: computed from plan_amount
}
# Pro Max: ~47% of monthly price goes to spend (vs Pro's 38%)
PRO_MAX_SPEND_RATIO = 0.47

# Per-model rates (USD per 1M tokens): (input, output)
MODEL_RATES_USD = {
    "anthropic/claude-3.5-sonnet":  (3.00, 15.00),
    "anthropic/claude-3.5-haiku":   (0.80, 4.00),
    "anthropic/claude-3-opus":      (15.00, 75.00),
    "openai/gpt-4o":                (5.00, 15.00),
    "openai/gpt-4o-mini":           (0.15, 0.60),
    "google/gemini-flash-1.5":      (0.075, 0.30),
    "deepseek/deepseek-r1":         (0.55, 2.19),
}

def estimate_cost_usd(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    rates = MODEL_RATES_USD.get(model, (5.00, 15.00))
    return (prompt_tokens / 1e6) * rates[0] + (completion_tokens / 1e6) * rates[1]

def get_spend_limit(user: dict) -> float:
    plan = user.get("plan", "free")
    if plan == "pro":
        return PLAN_LIMITS_USD["pro"]
    if plan == "pro_max":
        amount = float(user.get("plan_amount", 15))
        return amount * PRO_MAX_SPEND_RATIO
    return 0.0

# ─── DB init ──────────────────────────────────────────────────────────────────

async def init_db():
    async with aiosqlite.connect(DB) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS pastes (
                id TEXT PRIMARY KEY,
                title TEXT,
                content TEXT NOT NULL,
                language TEXT DEFAULT 'plaintext',
                created_at INTEGER NOT NULL,
                expires_at INTEGER,
                private INTEGER DEFAULT 0,
                views INTEGER DEFAULT 0
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS tools (
                id TEXT PRIMARY KEY,
                slug TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                script TEXT,
                github_url TEXT,
                author TEXT DEFAULT 'anonymous',
                stars INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                google_id TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                name TEXT,
                avatar TEXT,
                plan TEXT DEFAULT 'free',
                created_at INTEGER NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )
        """)
        # cli_codes: short-lived codes the CLI opens in browser, polls until redeemed
        await db.execute("""
            CREATE TABLE IF NOT EXISTS cli_codes (
                code TEXT PRIMARY KEY,
                token TEXT,
                state TEXT,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS oauth_states (
                state_hash TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                code_verifier TEXT DEFAULT '',
                cli_code TEXT DEFAULT '',
                plan TEXT DEFAULT '',
                amount TEXT DEFAULT '',
                next_path TEXT DEFAULT '/play',
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS local_email_auth (
                token_hash TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                cli_code TEXT DEFAULT '',
                plan TEXT DEFAULT '',
                amount TEXT DEFAULT '',
                next_path TEXT DEFAULT '/play',
                request_ip_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                used INTEGER NOT NULL DEFAULT 0
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS local_email_auth_email_time "
            "ON local_email_auth(email, created_at DESC)"
        )
        await db.execute("""
            CREATE TABLE IF NOT EXISTS product_interest (
                user_id TEXT NOT NULL,
                product TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, product)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS waitlist (
                email TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS paste_stars (
                paste_id TEXT NOT NULL,
                user_id  TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (paste_id, user_id)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS paste_forks (
                id TEXT PRIMARY KEY,
                parent_id TEXT NOT NULL,
                user_id TEXT,
                created_at INTEGER NOT NULL
            )
        """)
        for col, defn in [
            ("star_count", "INTEGER DEFAULT 0"),
            ("fork_count", "INTEGER DEFAULT 0"),
        ]:
            try:
                await db.execute(f"ALTER TABLE pastes ADD COLUMN {col} {defn}")
            except Exception:
                pass
        await db.execute("""
            CREATE TABLE IF NOT EXISTS beta_codes (
                email TEXT NOT NULL,
                code TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                used INTEGER DEFAULT 0
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS beta_access (
                token TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS support_access_email_log (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                request_ip_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                status TEXT NOT NULL
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS support_access_email_recipient_time "
            "ON support_access_email_log(email, created_at DESC)"
        )
        await db.execute("""CREATE TABLE IF NOT EXISTS local_support_links (
            token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)""")
        await db.execute("""CREATE TABLE IF NOT EXISTS local_support_sessions (
            token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL)""")
        await db.execute("""CREATE TABLE IF NOT EXISTS local_support_audit (
            id TEXT PRIMARY KEY, admin_email TEXT NOT NULL, sender TEXT NOT NULL,
            recipient TEXT NOT NULL, subject TEXT NOT NULL, created_at INTEGER NOT NULL,
            status TEXT NOT NULL)""")
        await db.execute("""CREATE TABLE IF NOT EXISTS stripe_webhook_events (
            event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at INTEGER NOT NULL,
            processed_at INTEGER, status TEXT NOT NULL, error_code TEXT DEFAULT '')""")
        await db.execute("""CREATE TABLE IF NOT EXISTS subscription_audit (
            id TEXT PRIMARY KEY, user_id TEXT, stripe_subscription_id TEXT,
            local_plan TEXT, stripe_status TEXT, action TEXT NOT NULL,
            created_at INTEGER NOT NULL)""")
        await db.execute("""CREATE TABLE IF NOT EXISTS operation_jobs (
            id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
            available_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
            completed_at INTEGER, error_code TEXT DEFAULT '')""")
        await db.execute(
            "CREATE INDEX IF NOT EXISTS operation_jobs_ready "
            "ON operation_jobs(status,available_at)"
        )
        await db.execute("""CREATE TABLE IF NOT EXISTS usage_alerts (
            user_id TEXT NOT NULL, month TEXT NOT NULL, threshold INTEGER NOT NULL,
            created_at INTEGER NOT NULL, status TEXT NOT NULL,
            PRIMARY KEY(user_id,month,threshold))""")
        # Migrate: add new columns safely (ALTER TABLE ignores existing)
        for col, defn in [
            ("auth_id",            "TEXT DEFAULT NULL"),
            ("monthly_spend",      "REAL DEFAULT 0"),
            ("spend_month",        "TEXT DEFAULT ''"),
            ("plan_amount",        "REAL DEFAULT 0"),
            ("stripe_customer_id", "TEXT DEFAULT NULL"),
            ("stripe_sub_id",      "TEXT DEFAULT NULL"),
            ("custom_prompt",      "TEXT DEFAULT NULL"),
            ("free_count",         "INTEGER DEFAULT 0"),
            ("free_week",          "TEXT DEFAULT ''"),
        ]:
            try:
                await db.execute(f"ALTER TABLE users ADD COLUMN {col} {defn}")
            except Exception:
                pass
        await db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS users_auth_id_unique "
            "ON users(auth_id) WHERE auth_id IS NOT NULL"
        )
        try:
            await db.execute("ALTER TABLE pastes ADD COLUMN user_id TEXT DEFAULT NULL")
        except Exception:
            pass
        await db.execute("""
            CREATE TABLE IF NOT EXISTS repos (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                language TEXT DEFAULT 'python',
                private INTEGER DEFAULT 0,
                star_count INTEGER DEFAULT 0,
                fork_count INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS repo_files (
                id TEXT PRIMARY KEY,
                repo_id TEXT NOT NULL,
                path TEXT NOT NULL,
                content TEXT DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(repo_id, path)
            )
        """)
        try: await db.execute("ALTER TABLE repos ADD COLUMN packages TEXT DEFAULT ''")
        except Exception: pass
        # Gitea-backed repos: git owns the file content, these columns cache the
        # bits we would otherwise have to hit the Gitea API for on every list.
        for _col, _defn in (
            ("gitea_owner",    "TEXT DEFAULT ''"),
            ("default_branch", "TEXT DEFAULT 'main'"),
            ("file_count",     "INTEGER DEFAULT 0"),
            ("commit_count",   "INTEGER DEFAULT 0"),
            ("migrated",       "INTEGER DEFAULT 0"),
        ):
            try: await db.execute(f"ALTER TABLE repos ADD COLUMN {_col} {_defn}")
            except Exception: pass
        await db.execute("""
            CREATE TABLE IF NOT EXISTS repo_stars (
                repo_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (repo_id, user_id)
            )
        """)
        await db.commit()

_operation_worker_task: asyncio.Task | None = None


async def enqueue_operation(kind: str, payload: dict, *, delay: int = 15, job_id: str | None = None) -> str:
    """Persist a retryable side effect without putting credentials in logs."""
    identifier = job_id or uuid.uuid4().hex
    now = int(time.time())
    encoded_payload = json.dumps(payload, separators=(",", ":"))
    if len(encoded_payload.encode("utf-8")) > 2_000_000:
        raise RuntimeError("operation payload is too large to queue")
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            """INSERT INTO operation_jobs
               (id,kind,payload,status,attempts,available_at,created_at)
               VALUES(?,?,?,'pending',0,?,?) ON CONFLICT(id) DO NOTHING""",
            (identifier, kind, encoded_payload, now + max(0, delay), now),
        )
        await db.commit()
    return identifier


def email_operation_payload(
    to: str,
    subject: str,
    message_html: str,
    message_text: str = "",
    from_email: str | None = None,
    from_name: str = "Codexyy",
) -> dict:
    return {
        "to": to,
        "subject": subject,
        "html": message_html,
        "text": message_text,
        "from_email": from_email or GRAPH_SENDER,
        "from_name": from_name,
    }


async def _execute_operation(kind: str, payload: dict) -> None:
    if kind == "email":
        await asyncio.to_thread(
            send_email,
            str(payload.get("to") or ""),
            str(payload.get("subject") or ""),
            str(payload.get("html") or ""),
            str(payload.get("text") or ""),
            str(payload.get("from_email") or GRAPH_SENDER),
            str(payload.get("from_name") or "Codexyy"),
        )
        return
    if kind == "repo_metadata":
        await gitea.set_repo_meta(
            str(payload["login"]),
            str(payload["rid"]),
            description=payload.get("description"),
            private=payload.get("private"),
        )
        return
    if kind == "repo_sync":
        await gitea.sync_files(
            str(payload["login"]),
            str(payload["rid"]),
            list(payload["files"]),
            message=str(payload["message"]),
            branch=str(payload["branch"]),
            author_name=str(payload.get("author_name") or payload["login"]),
            author_email=str(payload.get("author_email") or ""),
            prune=bool(payload.get("prune", True)),
        )
        await refresh_repo_stats(str(payload["rid"]), str(payload["login"]), str(payload["branch"]))
        return
    if kind == "github_import":
        await gitea.migrate(
            str(payload["login"]),
            str(payload["rid"]),
            str(payload["clone_url"]),
            description=str(payload.get("description") or "")[:255],
            private=bool(payload.get("private", False)),
        )
        branch = str(payload.get("branch") or gitea.DEFAULT_BRANCH)
        try:
            file_count = len(await gitea.list_tree(str(payload["login"]), str(payload["rid"]), branch))
        except gitea.GiteaError:
            branch = gitea.DEFAULT_BRANCH
            file_count = len(await gitea.list_tree(str(payload["login"]), str(payload["rid"]), branch))
        async with aiosqlite.connect(DB) as db:
            await db.execute(
                "UPDATE repos SET migrated=1,file_count=?,default_branch=?,updated_at=? WHERE id=?",
                (file_count, branch, int(time.time()), str(payload["rid"])),
            )
            await db.commit()
        return
    raise RuntimeError("unsupported operation kind")


async def operation_worker() -> None:
    while True:
        try:
            now = int(time.time())
            async with aiosqlite.connect(DB) as db:
                db.row_factory = aiosqlite.Row
                row = await (
                    await db.execute(
                        """SELECT id,kind,payload,attempts FROM operation_jobs
                           WHERE status='pending' AND available_at<=?
                           ORDER BY available_at,created_at LIMIT 1""",
                        (now,),
                    )
                ).fetchone()
                if row:
                    claimed = await db.execute(
                        "UPDATE operation_jobs SET status='processing',attempts=attempts+1 WHERE id=? AND status='pending'",
                        (row["id"],),
                    )
                    await db.commit()
                    if claimed.rowcount != 1:
                        row = None
            if not row:
                await asyncio.sleep(2)
                continue
            try:
                await _execute_operation(str(row["kind"]), json.loads(str(row["payload"])))
            except Exception as exc:
                attempts = int(row["attempts"]) + 1
                terminal = attempts >= 7
                delay = min(3600, 15 * (2 ** min(attempts, 8)))
                async with aiosqlite.connect(DB) as db:
                    await db.execute(
                        """UPDATE operation_jobs SET status=?,available_at=?,error_code=?
                           WHERE id=?""",
                        (
                            "failed" if terminal else "pending",
                            int(time.time()) + delay,
                            type(exc).__name__[:80],
                            row["id"],
                        ),
                    )
                    await db.commit()
            else:
                async with aiosqlite.connect(DB) as db:
                    await db.execute(
                        "UPDATE operation_jobs SET status='completed',completed_at=?,error_code='' WHERE id=?",
                        (int(time.time()), row["id"]),
                    )
                    await db.commit()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(json.dumps({
                "level": "error", "event": "operation_worker_failed",
                "error_type": type(exc).__name__,
            }), flush=True)
            await asyncio.sleep(5)


@app.on_event("startup")
async def startup():
    global _operation_worker_task
    await init_db()
    _operation_worker_task = asyncio.create_task(operation_worker(), name="codexyy-operation-worker")


@app.on_event("shutdown")
async def shutdown():
    if _operation_worker_task:
        _operation_worker_task.cancel()
        try:
            await _operation_worker_task
        except asyncio.CancelledError:
            pass

# ─── Helpers ──────────────────────────────────────────────────────────────────

def short_id(n=8):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=n))

def slugify(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return s.strip('-')[:48]

def make_token():
    return secrets.token_urlsafe(32)

async def get_user_by_token(token: str):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        now = int(time.time())
        cur = await db.execute(
            "SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?",
            (token, now)
        )
        row = await cur.fetchone()
        return dict(row) if row else None

async def require_auth(request: Request):
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token:
        token = request.cookies.get("cxy_token", "")
    if not token:
        raise HTTPException(401, "Not authenticated")
    user = await get_user_by_token(token)
    if not user:
        raise HTTPException(401, "Invalid or expired session")
    return user

def request_is_same_origin(request: Request) -> bool:
    host = request.headers.get("host", "").split(":", 1)[0].lower()
    for header in ("origin", "referer"):
        value = request.headers.get(header)
        if not value or value == "null":
            continue
        try:
            parsed = urllib.parse.urlsplit(value)
        except ValueError:
            return False
        return (
            parsed.hostname == host
            and (parsed.scheme == "https" or host in ("localhost", "127.0.0.1"))
        )
    return request.headers.get("sec-fetch-site") != "cross-site"


PROCESS_STARTED_AT = int(time.time())
_request_metrics: dict[str, dict[str, float | int]] = {}
_rate_buckets: dict[tuple[str, str], tuple[int, int]] = {}
_operations_lock = asyncio.Lock()


def _metric_route(path: str) -> str:
    normalized = re.sub(r"/[A-Za-z0-9_-]{8,128}(?=/|$)", "/:id", path)
    return normalized[:180]


def _rate_policy(request: Request) -> tuple[str, int, int] | None:
    path, method = request.url.path, request.method
    if method == "POST" and path in {
        "/auth/email/request", "/auth/support/request", "/api/beta/request",
    }:
        return "login_email", 10, 900
    if method == "POST" and path == "/api/support/access-email":
        return "support_relay", 10, 900
    if method == "POST" and path in {
        "/api/free/v1/chat/completions", "/api/v1/chat/completions",
    }:
        return "chat", 90, 60
    if method != "GET" and path.startswith("/api/repos"):
        return "repository_write", 120, 60
    if method == "POST" and path == "/api/piston/execute":
        return "code_execution", 120, 60
    return None


async def _rate_limited(request: Request, policy: tuple[str, int, int]) -> tuple[bool, int]:
    scope, limit, window = policy
    source = (
        request.headers.get("x-real-ip")
        or request.headers.get("cf-connecting-ip")
        or (request.client.host if request.client else "unknown")
    )[:128]
    source_key = hashlib.sha256(f"rate-v1:{scope}:{source}".encode()).hexdigest()[:24]
    now = int(time.time())
    window_start = now - (now % window)
    async with _operations_lock:
        key = (scope, source_key)
        current_window, count = _rate_buckets.get(key, (window_start, 0))
        if current_window != window_start:
            current_window, count = window_start, 0
        count += 1
        _rate_buckets[key] = (current_window, count)
        if len(_rate_buckets) > 5000:
            stale_before = now - 3600
            for bucket_key, (bucket_window, _) in list(_rate_buckets.items()):
                if bucket_window < stale_before:
                    _rate_buckets.pop(bucket_key, None)
        return count > limit, max(1, window_start + window - now)


async def _record_request_metric(route: str, status: int, elapsed_ms: float) -> None:
    async with _operations_lock:
        metric = _request_metrics.setdefault(
            route,
            {"requests": 0, "errors": 0, "latency_ms_total": 0.0, "latency_ms_max": 0.0},
        )
        metric["requests"] = int(metric["requests"]) + 1
        metric["errors"] = int(metric["errors"]) + (1 if status >= 500 else 0)
        metric["latency_ms_total"] = float(metric["latency_ms_total"]) + elapsed_ms
        metric["latency_ms_max"] = max(float(metric["latency_ms_max"]), elapsed_ms)


@app.middleware("http")
async def production_request_middleware(request: Request, call_next):
    supplied_request_id = request.headers.get("x-request-id", "")
    request_id = (
        supplied_request_id
        if re.fullmatch(r"[A-Za-z0-9_.:-]{8,80}", supplied_request_id)
        else uuid.uuid4().hex
    )
    started = time.perf_counter()
    route = _metric_route(request.url.path)
    policy = _rate_policy(request)
    if policy:
        limited, retry_after = await _rate_limited(request, policy)
        if limited:
            response = JSONResponse(
                {"detail": "Too many requests", "request_id": request_id},
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )
            await _record_request_metric(route, 429, (time.perf_counter() - started) * 1000)
            response.headers["X-Request-ID"] = request_id
            return response
    try:
        response = await call_next(request)
        status = response.status_code
    except Exception as exc:
        status = 500
        elapsed_ms = (time.perf_counter() - started) * 1000
        await _record_request_metric(route, status, elapsed_ms)
        print(json.dumps({
            "level": "error",
            "event": "request_failed",
            "request_id": request_id,
            "method": request.method,
            "path": route,
            "error_type": type(exc).__name__,
            "elapsed_ms": round(elapsed_ms, 2),
        }), flush=True)
        raise
    elapsed_ms = (time.perf_counter() - started) * 1000
    await _record_request_metric(route, status, elapsed_ms)
    response.headers["X-Request-ID"] = request_id
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    )
    response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if request.url.path.startswith("/auth/") and "text/html" in response.headers.get("content-type", ""):
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src https://fonts.gstatic.com; img-src 'self' data:; form-action 'self'; "
            "base-uri 'self'; frame-ancestors 'none'",
        )
    if elapsed_ms >= 2000:
        print(json.dumps({
            "level": "warning",
            "event": "slow_request",
            "request_id": request_id,
            "method": request.method,
            "path": route,
            "status": status,
            "elapsed_ms": round(elapsed_ms, 2),
        }), flush=True)
    return response

# ─── Auth: provider choice, Google, and Codexyy email ─────────────────────────

def safe_next_path(value: str) -> str:
    value = (value or "/play").strip()
    if not value.startswith("/") or value.startswith("//") or "\\" in value:
        return "/play"
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme or parsed.netloc or parsed.fragment:
        return "/play"
    return value

def safe_plan(plan: str, amount: str) -> tuple[str, str]:
    if plan not in ("pro", "pro_max"):
        return "", ""
    if plan == "pro":
        return plan, ""
    try:
        normalized = max(15, min(30, int(float(amount or "15"))))
    except (TypeError, ValueError):
        normalized = 15
    return plan, str(normalized)

def oauth_state_hash(state: str) -> str:
    return hashlib.sha256(state.encode("utf-8")).hexdigest()

async def create_oauth_state(
    provider: str,
    *,
    code_verifier: str = "",
    cli_code: str = "",
    plan: str = "",
    amount: str = "",
    next_path: str = "/play",
) -> str:
    state = secrets.token_urlsafe(32)
    now = int(time.time())
    plan, amount = safe_plan(plan, amount)
    async with aiosqlite.connect(DB) as db:
        await db.execute("DELETE FROM oauth_states WHERE expires_at <= ?", (now,))
        await db.execute(
            """INSERT INTO oauth_states
               (state_hash, provider, code_verifier, cli_code, plan, amount,
                next_path, created_at, expires_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                oauth_state_hash(state), provider, code_verifier,
                cli_code[:128], plan, amount, safe_next_path(next_path),
                now, now + 600,
            ),
        )
        await db.commit()
    return state

async def consume_oauth_state(state: str, provider: str) -> dict | None:
    if not state:
        return None
    now = int(time.time())
    key = oauth_state_hash(state)
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM oauth_states WHERE state_hash=? AND provider=? AND expires_at>?",
            (key, provider, now),
        )
        row = await cur.fetchone()
        await db.execute("DELETE FROM oauth_states WHERE state_hash=?", (key,))
        await db.commit()
    return dict(row) if row else None

async def complete_main_login(user_id: str, display_name: str, flow: dict):
    session_token = make_token()
    now = int(time.time())
    cli_code = flow.get("cli_code") or ""
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "INSERT INTO sessions VALUES (?,?,?,?)",
            (session_token, user_id, now, now + 30 * 86400),
        )
        if cli_code:
            redeemed = await db.execute(
                "UPDATE cli_codes SET token=? WHERE code=? AND expires_at>?",
                (session_token, cli_code, now),
            )
            if redeemed.rowcount != 1:
                await db.rollback()
                return HTMLResponse(error_page("The CLI sign-in code expired. Start cxy login again."), status_code=400)
        await db.commit()

    if cli_code:
        return HTMLResponse(cli_success_page(display_name))

    plan = flow.get("plan") or ""
    if plan == "pro":
        destination = "/api/stripe/checkout?plan=pro"
    elif plan == "pro_max":
        _, amount = safe_plan(plan, flow.get("amount") or "")
        destination = f"/api/stripe/checkout?plan=pro_max&amount={amount}"
    else:
        destination = safe_next_path(flow.get("next_path") or "/play")

    response = RedirectResponse(destination, status_code=303)
    response.set_cookie(
        "cxy_token",
        session_token,
        max_age=30 * 86400,
        path="/",
        secure=True,
        httponly=True,
        samesite="lax",
    )
    return response

@app.get("/auth/google")
async def auth_google(
    request: Request,
    cli_code: str = "",
    plan: str = "",
    amount: str = "",
    next: str = "/play",
):
    if not GOOGLE_CLIENT_ID:
        return HTMLResponse(error_page("Google sign-in is not configured. Use email instead."), status_code=503)
    redirect_uri = google_redirect_for(request)
    state = await create_oauth_state(
        "google", cli_code=cli_code, plan=plan, amount=amount, next_path=next,
    )
    params = urllib.parse.urlencode({
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "offline",
        "prompt": "select_account",
    })
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")

@app.get("/auth/callback")
async def auth_callback(
    request: Request,
    code: str = "",
    state: str = "",
    error: str = "",
    error_description: str = "",
):
    flow = await consume_oauth_state(state, "google")
    if not flow:
        return HTMLResponse(error_page("This sign-in request expired or was already used."), status_code=400)
    if error:
        return HTMLResponse(error_page(error_description or error), status_code=400)
    if not code:
        return HTMLResponse(error_page("Google did not return a sign-in code."), status_code=400)
    redirect_uri = google_redirect_for(request)

    async with httpx.AsyncClient(timeout=20.0) as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_resp.status_code != 200:
            return HTMLResponse(error_page("Google could not complete the token exchange."), status_code=400)
        access_token = token_resp.json().get("access_token")
        userinfo_resp = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if userinfo_resp.status_code != 200:
            return HTMLResponse(error_page("Google could not return your account details."), status_code=400)
        info = userinfo_resp.json()

    google_id = str(info.get("id") or "")
    email = str(info.get("email") or "").strip().lower()
    name = str(info.get("name") or "").strip()
    avatar = str(info.get("picture") or "")
    if not google_id or not email or "@" not in email:
        return HTMLResponse(error_page("Google did not return a verified email address."), status_code=400)

    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT id FROM users WHERE google_id=? OR lower(email)=? LIMIT 1",
            (google_id, email),
        )
        row = await cur.fetchone()
        if row:
            user_id = row["id"]
            await db.execute(
                "UPDATE users SET google_id=?, email=?, name=?, avatar=? WHERE id=?",
                (google_id, email, name, avatar, user_id),
            )
        else:
            user_id = short_id(12)
            await db.execute(
                "INSERT INTO users (id, google_id, email, name, avatar, plan, created_at) VALUES (?,?,?,?,?,'free',?)",
                (user_id, google_id, email, name, avatar, int(time.time())),
            )
        await db.commit()
    return await complete_main_login(user_id, name or email, flow)

class LocalEmailAuthRequest(BaseModel):
    email: str
    cli_code: str = ""
    plan: str = ""
    amount: str = ""
    next_path: str = "/play"

def local_email_auth_page(cli_code: str, next_path: str, plan: str, amount: str, notice: str = "") -> str:
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Email sign-in — Codexyy Auth v3.0.0</title><link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"><style>*{{box-sizing:border-box}}body{{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:#07070a;color:#e2e2ec;font-family:'DM Sans',sans-serif;background-image:radial-gradient(circle at 80% 0,#00d4ff20,transparent 35%),linear-gradient(#1a1a2638 1px,transparent 1px),linear-gradient(90deg,#1a1a2638 1px,transparent 1px);background-size:auto,52px 52px,52px 52px}}.card{{width:min(460px,100%);padding:42px;border:1px solid #252535;border-radius:18px;background:#0d0d12;box-shadow:0 30px 90px #0008}}.logo{{font:600 17px 'JetBrains Mono',monospace}}.logo b{{color:#00d4ff}}.version{{color:#3a3a52;font-size:9px}}.eyebrow{{display:block;margin-top:34px;color:#00d4ff;font:600 9px 'JetBrains Mono',monospace;letter-spacing:.13em;text-transform:uppercase}}h1{{margin:11px 0 13px;font:800 39px/1.02 'Syne',sans-serif;letter-spacing:-.05em}}p{{color:#7878a0;line-height:1.65}}label{{display:block;margin:25px 0 8px;color:#7878a0;font:600 10px 'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.08em}}input{{width:100%;height:49px;padding:0 14px;border:1px solid #252535;border-radius:10px;background:#09090e;color:#e2e2ec;font-size:14px}}button{{width:100%;margin-top:12px;min-height:48px;border:0;border-radius:10px;background:#00d4ff;color:#07070a;font:700 12px 'JetBrains Mono',monospace;cursor:pointer}}.notice{{margin-top:20px;padding:13px;border:1px solid #4effa844;border-radius:9px;background:#4effa80c;color:#4effa8;font:600 11px 'JetBrains Mono',monospace}}</style></head><body><main class="card"><div class="logo">codexyy<b>.</b> auth <span class="version">v3.0.0 · self-hosted</span></div><span class="eyebrow">Passwordless email</span><h1>Check your inbox<span style="color:#00d4ff">.</span></h1><p>Enter your email and this server will send a single-use link. It expires in 15 minutes.</p>{f'<div class="notice">{html.escape(notice)}</div>' if notice else ''}<form method="post" action="/auth/email/request"><input type="hidden" name="cli_code" value="{html.escape(cli_code[:128], quote=True)}"><input type="hidden" name="next_path" value="{html.escape(safe_next_path(next_path), quote=True)}"><input type="hidden" name="plan" value="{html.escape(plan, quote=True)}"><input type="hidden" name="amount" value="{html.escape(amount, quote=True)}"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required><button type="submit">Send one-time link &rarr;</button></form></main></body></html>"""

def local_email_message(access_url: str) -> tuple[str, str]:
    safe_url = html.escape(access_url, quote=True)
    body = f"""<!doctype html><html><body style="margin:0;background:#07070a;color:#e2e2ec;font-family:Arial,sans-serif"><div style="max-width:560px;margin:32px auto;padding:42px;border:1px solid #252535;border-radius:16px;background:#0d0d12"><div style="font:600 17px monospace">codexyy<span style="color:#00d4ff">.</span> auth <small style="color:#3a3a52">v3.0.0</small></div><h1 style="margin:34px 0 14px;font-size:38px">Sign in securely<span style="color:#00d4ff">.</span></h1><p style="color:#7878a0;line-height:1.7">This one-time link expires in 15 minutes and works once.</p><a href="{safe_url}" style="display:inline-block;margin-top:18px;padding:14px 22px;border-radius:10px;background:#00d4ff;color:#07070a;font:700 12px monospace;text-decoration:none">Review and sign in &rarr;</a><p style="margin-top:30px;padding-top:20px;border-top:1px solid #1a1a26;color:#7878a0;font-size:12px">If you did not request this, ignore the email.</p></div></body></html>"""
    return body, f"Open your one-time Codexyy sign-in link: {access_url}\n\nIt expires in 15 minutes and works once."

@app.get("/auth/email", response_class=HTMLResponse)
@app.get("/auth/codexyy", response_class=HTMLResponse)
async def auth_email_local(cli_code: str = "", plan: str = "", amount: str = "", next: str = "/play"):
    plan, amount = safe_plan(plan, amount)
    return HTMLResponse(local_email_auth_page(cli_code, next, plan, amount))

@app.post("/auth/email/request", response_class=HTMLResponse)
async def auth_email_local_request(request: Request):
    if not request_is_same_origin(request):
        raise HTTPException(403, "Invalid origin")
    form = await request.form()
    email = str(form.get("email") or "").strip().lower()
    cli_code = str(form.get("cli_code") or "")[:128]
    next_path = safe_next_path(str(form.get("next_path") or "/play"))
    plan, amount = safe_plan(str(form.get("plan") or ""), str(form.get("amount") or ""))
    if len(email) > 254 or re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) is None:
        return HTMLResponse(local_email_auth_page(cli_code, next_path, plan, amount, "Enter a valid email address."), status_code=400)
    now = int(time.time())
    source = request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")
    source_hash = hashlib.sha256(f"local-auth-v3:{source}".encode()).hexdigest()
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    async with aiosqlite.connect(DB) as db:
        async with db.execute("SELECT COUNT(*) FROM local_email_auth WHERE email=? AND created_at>=?", (email, now - 900)) as cur:
            recent = (await cur.fetchone())[0]
        if recent >= 5:
            return HTMLResponse(local_email_auth_page(cli_code, next_path, plan, amount, "Too many links requested. Wait 15 minutes."), status_code=429)
        await db.execute("UPDATE local_email_auth SET used=1 WHERE email=? AND used=0", (email,))
        await db.execute("INSERT INTO local_email_auth(token_hash,email,cli_code,plan,amount,next_path,request_ip_hash,created_at,expires_at,used) VALUES(?,?,?,?,?,?,?,?,?,0)", (token_hash, email, cli_code, plan, amount, next_path, source_hash, now, now + 900))
        await db.commit()
    access_url = f"{public_origin_for(request)}/auth/email/complete?token={urllib.parse.quote(raw_token)}"
    message_html, message_text = local_email_message(access_url)
    try:
        await asyncio.to_thread(send_email, email, "Your Codexyy sign-in link", message_html, message_text, "platform@codexyy.dev", "Codexyy Auth")
    except Exception:
        await enqueue_operation(
            "email",
            email_operation_payload(email, "Your Codexyy sign-in link", message_html, message_text, "platform@codexyy.dev", "Codexyy Auth"),
            delay=10,
        )
        return HTMLResponse(local_email_auth_page(cli_code, next_path, plan, amount, "Your email is queued and will be retried automatically."), status_code=202)
    return HTMLResponse(local_email_auth_page(cli_code, next_path, plan, amount, "A one-time link is on its way. Check spam or junk if needed."))

@app.get("/auth/email/complete", response_class=HTMLResponse)
async def auth_email_local_preview(token: str = ""):
    key = hashlib.sha256(token.encode()).hexdigest()
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT 1 FROM local_email_auth WHERE token_hash=? AND used=0 AND expires_at>?", (key, int(time.time())))
        valid = await cur.fetchone()
    if not valid:
        return HTMLResponse(error_page("This email link expired or was already used."), status_code=400)
    return HTMLResponse(f"""<!doctype html><html><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#07070a;color:#e2e2ec;font-family:Arial"><form method="post" action="/auth/email/complete" style="padding:42px;border:1px solid #252535;border-radius:16px;background:#0d0d12;text-align:center"><div style="font:600 17px monospace">codexyy<span style="color:#00d4ff">.</span> auth v3.0.0</div><h1>Link verified.</h1><p style="color:#7878a0">Finish signing in. This link will be consumed.</p><input type="hidden" name="token" value="{html.escape(token, quote=True)}"><button style="margin-top:18px;padding:14px 22px;border:0;border-radius:10px;background:#00d4ff;font-weight:700" type="submit">Sign in &rarr;</button></form></body></html>""")

@app.post("/auth/email/complete")
async def auth_email_local_complete(request: Request):
    if not request_is_same_origin(request):
        raise HTTPException(403, "Invalid origin")
    form = await request.form()
    key = hashlib.sha256(str(form.get("token") or "").encode()).hexdigest()
    now = int(time.time())
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("BEGIN IMMEDIATE")
        cur = await db.execute("SELECT * FROM local_email_auth WHERE token_hash=? AND used=0 AND expires_at>?", (key, now))
        link = await cur.fetchone()
        if not link:
            await db.rollback()
            return HTMLResponse(error_page("This email link expired or was already used."), status_code=400)
        await db.execute("UPDATE local_email_auth SET used=1 WHERE token_hash=?", (key,))
        email = link["email"]
        auth_id = "local:" + hashlib.sha256(email.encode()).hexdigest()
        cur = await db.execute("SELECT id,name FROM users WHERE auth_id=? OR lower(email)=? LIMIT 1", (auth_id, email))
        user = await cur.fetchone()
        name = (user["name"] if user else "") or email.split("@", 1)[0]
        if user:
            user_id = user["id"]
            await db.execute("UPDATE users SET auth_id=?,email=?,name=COALESCE(NULLIF(name,''),?) WHERE id=?", (auth_id, email, name, user_id))
        else:
            user_id = short_id(12)
            await db.execute("INSERT INTO users(id,google_id,auth_id,email,name,avatar,plan,created_at) VALUES(?,?,?,?,?,?,'free',?)", (user_id, auth_id, auth_id, email, name, "", now))
        await db.commit()
    return await complete_main_login(user_id, name, dict(link))

@app.get("/auth/codexyy/callback")
async def retired_cloudflare_auth_callback():
    return RedirectResponse("/auth/login", status_code=303)

# ─── Auth: CLI login flow ──────────────────────────────────────────────────────

@app.post("/auth/cli-code")
async def create_cli_code():
    code = make_token()[:16]
    now  = int(time.time())
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "INSERT INTO cli_codes VALUES (?,NULL,NULL,?,?)",
            (code, now, now + 300)   # 5 min expiry
        )
        await db.commit()
    return {
        "code": code,
        "url":  f"{BASE_URL}/auth/login?code={code}",
    }

@app.get("/auth/poll/{code}")
async def poll_cli_code(code: str):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        now = int(time.time())
        cur = await db.execute(
            "SELECT token, expires_at FROM cli_codes WHERE code=?", (code,)
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Unknown code")
        if now > row["expires_at"]:
            raise HTTPException(410, "Code expired")
        if not row["token"]:
            return {"status": "pending"}
        # Clean up
        await db.execute("DELETE FROM cli_codes WHERE code=?", (code,))
        await db.commit()
        return {"status": "ok", "token": row["token"]}

@app.get("/auth/login", response_class=HTMLResponse)
async def login_page(
    code: str = "",
    next: str = "/play",
    plan: str = "",
    amount: str = "",
):
    return HTMLResponse(login_html(code, next, plan, amount))

@app.get("/auth/me")
async def me(user=Depends(require_auth)):
    keys = ("id","email","name","avatar","plan","plan_amount","monthly_spend","spend_month",
            "stripe_customer_id","stripe_sub_id","custom_prompt","created_at")
    return {k: user.get(k) for k in keys}


@app.get("/healthz")
async def healthz():
    try:
        async with aiosqlite.connect(DB) as db:
            row = await (await db.execute("SELECT 1")).fetchone()
        if not row or row[0] != 1:
            raise RuntimeError("database check failed")
    except Exception:
        return JSONResponse(
            {"status": "unhealthy"},
            status_code=503,
            headers={"Cache-Control": "no-store"},
        )
    return JSONResponse({"status": "ok"}, headers={"Cache-Control": "no-store"})


@app.get("/api/status")
async def public_status():
    checks: dict[str, dict[str, str | int | float]] = {
        "backend": {"status": "operational", "detail": "API process is responding"},
    }
    try:
        async with aiosqlite.connect(DB) as db:
            integrity = await (await db.execute("PRAGMA quick_check")).fetchone()
        checks["database"] = {
            "status": "operational" if integrity and integrity[0] == "ok" else "degraded",
            "detail": "SQLite integrity check passed" if integrity and integrity[0] == "ok" else "Integrity check needs attention",
        }
    except Exception:
        checks["database"] = {"status": "outage", "detail": "Database check failed"}
    try:
        async with aiosqlite.connect(DB) as db:
            queue_rows = await (
                await db.execute(
                    "SELECT status,COUNT(*) FROM operation_jobs WHERE status IN ('pending','processing','failed') GROUP BY status"
                )
            ).fetchall()
        queue_counts = {str(status): int(count) for status, count in queue_rows}
        pending_jobs = queue_counts.get("pending", 0) + queue_counts.get("processing", 0)
        failed_jobs = queue_counts.get("failed", 0)
        queue_ok = failed_jobs == 0 and pending_jobs < 100
        checks["retry_queue"] = {
            "status": "operational" if queue_ok else "degraded",
            "detail": "Retry queue is healthy" if queue_ok else "Retry queue needs attention",
            "pending": pending_jobs,
            "failed": failed_jobs,
        }
    except Exception:
        checks["retry_queue"] = {"status": "degraded", "detail": "Retry queue could not be inspected"}
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            response = await client.get("http://127.0.0.1:3300/api/healthz")
        checks["git"] = {
            "status": "operational" if response.status_code == 200 else "degraded",
            "detail": "Repository service is responding" if response.status_code == 200 else "Repository service returned an error",
        }
    except Exception:
        checks["git"] = {"status": "outage", "detail": "Repository service is unavailable"}
    release_files = [
        "/var/www/codexyy/cli-dl/cxy-linux-amd64",
        "/var/www/codexyy/cli-dl/cxy-linux-arm64",
        "/var/www/codexyy/cli-dl/cxy-darwin-amd64",
        "/var/www/codexyy/cli-dl/cxy-darwin-arm64",
    ]
    releases_ready = all(os.path.getsize(path) > 1_000_000 for path in release_files if os.path.exists(path)) and all(os.path.exists(path) for path in release_files)
    checks["downloads"] = {
        "status": "operational" if releases_ready else "degraded",
        "detail": "All platform binaries are published" if releases_ready else "One or more release files are missing",
    }
    model_ready = bool(CF_ACCOUNT_ID and CF_API_TOKEN and OPENROUTER_API_KEY)
    checks["models"] = {
        "status": "operational" if model_ready else "degraded",
        "detail": "Free and Pro model routes are configured" if model_ready else "A model provider needs configuration",
    }
    billing_ready = bool(STRIPE_SECRET_KEY)
    checks["billing"] = {
        "status": "operational" if billing_ready else "degraded",
        "detail": "Subscription billing is configured" if billing_ready else "Subscription billing needs configuration",
    }
    open_providers = [name for name, state in provider_snapshot().items() if state["status"] == "open"]
    checks["provider_circuits"] = {
        "status": "degraded" if open_providers else "operational",
        "detail": "Provider cooldown active" if open_providers else "Provider circuits are closed",
        "open": len(open_providers),
    }
    try:
        backup_state_path = "/home/ubuntu/backups/codexyy/latest.json"
        with open(backup_state_path, "r", encoding="utf-8") as backup_handle:
            backup_state = json.load(backup_handle)
        backup_age = max(0, int(time.time()) - int(backup_state.get("created_at", 0)))
        backup_ok = backup_state.get("status") == "ok" and backup_state.get("restore_drill") == "passed" and backup_age < 172800
        checks["backups"] = {
            "status": "operational" if backup_ok else "degraded",
            "detail": "Encrypted backup and restore drill are current" if backup_ok else "Backup verification needs attention",
            "age_seconds": backup_age,
        }
    except Exception:
        checks["backups"] = {"status": "degraded", "detail": "Backup state is unavailable"}
    try:
        filesystem = os.statvfs("/home/ubuntu")
        total = filesystem.f_blocks * filesystem.f_frsize
        available = filesystem.f_bavail * filesystem.f_frsize
        used_percent = round((1 - (available / total)) * 100, 1) if total else 0.0
        available_gb = round(available / (1024 ** 3), 1)
        storage_status = (
            "outage" if used_percent >= 98 or available_gb < 5
            else "degraded" if used_percent >= 95 or available_gb < 20
            else "operational"
        )
        checks["storage"] = {
            "status": storage_status,
            "detail": "Storage capacity is healthy" if storage_status == "operational" else "Storage capacity needs attention",
            "used_percent": used_percent,
            "available_gb": available_gb,
        }
    except Exception:
        checks["storage"] = {"status": "degraded", "detail": "Storage capacity could not be checked"}
    states = {str(item["status"]) for item in checks.values()}
    overall = "outage" if "outage" in states else "degraded" if "degraded" in states else "operational"
    return JSONResponse(
        {"status": overall, "checked_at": int(time.time()), "uptime_seconds": int(time.time()) - PROCESS_STARTED_AT, "checks": checks},
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/internal/metrics")
async def internal_metrics(request: Request):
    source = request.headers.get("x-real-ip") or (request.client.host if request.client else "")
    if source not in {"127.0.0.1", "::1"}:
        raise HTTPException(403, "Local access only")
    async with _operations_lock:
        metrics = {
            route: {
                **values,
                "latency_ms_average": round(
                    float(values["latency_ms_total"]) / max(1, int(values["requests"])), 2
                ),
            }
            for route, values in _request_metrics.items()
        }
    async with aiosqlite.connect(DB) as db:
        queue_rows = await (
            await db.execute("SELECT status,COUNT(*) FROM operation_jobs GROUP BY status")
        ).fetchall()
    return {
        "started_at": PROCESS_STARTED_AT,
        "routes": metrics,
        "providers": provider_snapshot(),
        "operation_jobs": {str(status): int(count) for status, count in queue_rows},
    }

class ProductInterestRequest(BaseModel):
    product: str

PRODUCT_SLUGS = {
    "deploy", "teams", "review", "automate", "workspaces",
    "memory", "guard", "marketplace", "pulse", "one",
}

@app.post("/api/product-interest")
async def join_product_interest(
    body: ProductInterestRequest,
    request: Request,
    user=Depends(require_auth),
):
    if not request_is_same_origin(request):
        raise HTTPException(403, "Invalid origin")
    product = body.product.strip().lower()
    if product not in PRODUCT_SLUGS:
        raise HTTPException(400, "Unknown product")
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            """INSERT INTO product_interest (user_id, product, created_at)
               VALUES (?,?,?)
               ON CONFLICT (user_id, product) DO NOTHING""",
            (user["id"], product, int(time.time())),
        )
        await db.commit()
    return {"ok": True, "product": product}


@app.get("/api/product-interest")
async def product_interest_status(user=Depends(require_auth)):
    async with aiosqlite.connect(DB) as db:
        rows = await (await db.execute(
            "SELECT product,created_at FROM product_interest WHERE user_id=? ORDER BY created_at",
            (user["id"],),
        )).fetchall()
    joined = {row[0]: row[1] for row in rows}
    return {
        "products": [
            {
                "slug": slug,
                "joined": slug in joined,
                "joined_at": joined.get(slug),
                "availability": "preview",
            }
            for slug in sorted(PRODUCT_SLUGS)
        ]
    }

# ─── Cloudflare AI free tier proxy ────────────────────────────────────────────

import re as _re

def _extract_tool_call(text: str) -> dict | None:
    """Parse a JSON tool call that Qwen embeds as text instead of using the function-call API."""
    stripped = text.strip()
    # Case 1: entire response is {"name": ..., "arguments": ...}
    if stripped.startswith('{'):
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, dict) and "name" in parsed and "arguments" in parsed:
                return parsed
        except json.JSONDecodeError:
            pass
    # Case 2: JSON inside a ```json ... ``` code block (take the first match)
    for block in _re.findall(r'```(?:json)?\s*(\{[\s\S]+?\})\s*```', text):
        try:
            parsed = json.loads(block.strip())
            if isinstance(parsed, dict) and "name" in parsed and "arguments" in parsed:
                return parsed
        except json.JSONDecodeError:
            continue
    return None

def iso_week() -> str:
    t = time.gmtime()
    return f"{t.tm_year}-W{time.strftime('%V', t)}"

# Models available in the free tier via OpenRouter (server pays, cheap)
FREE_OPENROUTER_MODELS = {
    "openai/gpt-4o-mini",
    "openai/gpt-4.1-nano",
    "anthropic/claude-3-5-haiku",
    "anthropic/claude-haiku-4-5",
}

FREE_MODEL_CATALOG = [
    {"id": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "label": "Llama 3.3 70B", "tag": "default · fast + smart", "tier": "free", "context_window": 24000},
    {"id": "@cf/qwen/qwen2.5-coder-32b-instruct", "label": "Qwen 2.5 Coder 32B", "tag": "coding", "tier": "free", "context_window": 32000},
    {"id": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", "label": "DeepSeek R1 32B", "tag": "reasoning", "tier": "free", "context_window": 32000},
    {"id": "@cf/meta/llama-3.1-8b-instruct", "label": "Llama 3.1 8B", "tag": "fastest", "tier": "free", "context_window": 24000},
    {"id": "@cf/mistral/mistral-7b-instruct-v0.1", "label": "Mistral 7B", "tag": "lightweight", "tier": "free", "context_window": 24000},
    {"id": "openai/gpt-4o-mini", "label": "GPT-4o mini", "tag": "fast", "tier": "free", "context_window": 128000},
    {"id": "openai/gpt-4.1-nano", "label": "GPT-4.1 nano", "tag": "efficient", "tier": "free", "context_window": 1000000},
    {"id": "anthropic/claude-3-5-haiku", "label": "Claude 3.5 Haiku", "tag": "balanced", "tier": "free", "context_window": 200000},
    {"id": "anthropic/claude-haiku-4-5", "label": "Claude Haiku 4.5", "tag": "newest Haiku", "tier": "free", "context_window": 200000},
]

PRO_MODEL_CATALOG = [
    {"id": model_id, "label": model_id.split("/", 1)[1].replace("-", " ").title(), "tag": "Pro", "tier": "pro", "context_window": 128000, "input_usd_per_million": rates[0], "output_usd_per_million": rates[1]}
    for model_id, rates in MODEL_RATES_USD.items()
]


@app.get("/api/models")
async def hosted_model_catalog():
    return JSONResponse(
        {
            "models": FREE_MODEL_CATALOG + PRO_MODEL_CATALOG,
            "default": CF_MODEL,
            "free_weekly_messages": FREE_WEEKLY_LIMIT,
            "updated_at": "2026-08-05",
        },
        headers={"Cache-Control": "public, max-age=300"},
    )

@app.post("/api/free/v1/chat/completions")
async def free_chat(request: Request, user=Depends(require_auth)):
    week = iso_week()
    count = int(user.get("free_count") or 0)
    if user.get("free_week", "") != week:
        count = 0  # new week, reset

    if count >= FREE_WEEKLY_LIMIT:
        raise HTTPException(429, f"Free tier limit reached ({FREE_WEEKLY_LIMIT} messages/week). Add your own API key via /setup.")

    body = await request.json()
    model = body.get("model", CF_MODEL)
    user_id = user["id"]

    # Determine routing: @cf/ models → CF Workers AI, whitelisted → OpenRouter server key
    use_cf = model.startswith("@cf/")
    use_or = model in FREE_OPENROUTER_MODELS

    if use_cf and not provider_available("cloudflare_ai") and OPENROUTER_API_KEY:
        model = "openai/gpt-4o-mini"
        use_cf, use_or = False, True
    if use_or and not provider_available("openrouter"):
        raise HTTPException(503, "The free model provider is cooling down; retry shortly")

    if not use_cf and not use_or:
        raise HTTPException(400, f"Model '{model}' not available in free tier.")

    if use_cf and (not CF_ACCOUNT_ID or not CF_API_TOKEN):
        raise HTTPException(503, "Free tier CF not configured")
    if use_or and not OPENROUTER_API_KEY:
        raise HTTPException(503, "Free tier OpenRouter not configured")

    async def record_usage():
        async with aiosqlite.connect(DB) as db:
            await db.execute("UPDATE users SET free_count=?, free_week=? WHERE id=?",
                             (count + 1, week, user_id))
            await db.commit()

    async def stream_free_openrouter(fallback_model: str):
        fallback_body = dict(body)
        fallback_body["model"] = fallback_model
        fallback_body["stream"] = True
        fallback_headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://codexyy.dev",
            "X-Title": "codexyy",
        }
        async with httpx.AsyncClient(timeout=120) as client:
            try:
                async with client.stream(
                    "POST", "https://openrouter.ai/api/v1/chat/completions",
                    json=fallback_body, headers=fallback_headers,
                ) as response:
                    if response.status_code != 200:
                        await response.aread()
                        provider_failed("openrouter")
                        yield "data: {\"error\":{\"message\":\"The free model provider is temporarily unavailable.\"}}\n\ndata: [DONE]\n\n"
                        return
                    provider_succeeded("openrouter")
                    async for fallback_line in response.aiter_lines():
                        if fallback_line:
                            yield fallback_line + "\n"
                    yield "\n"
            except httpx.HTTPError:
                provider_failed("openrouter")
                yield "data: {\"error\":{\"message\":\"The free model provider is temporarily unavailable.\"}}\n\ndata: [DONE]\n\n"

    if use_cf:
        messages = body.get("messages", [])
        # CF doesn't support tool/system roles — remap them
        cf_messages = []
        for m in messages:
            role = m.get("role")
            if role == "system":
                continue
            elif role == "tool":
                cf_messages.append({"role": "user", "content": f"[Tool result]: {m.get('content', '')}"})
            elif role == "assistant" and m.get("tool_calls"):
                tc = m["tool_calls"][0]
                cf_messages.append({"role": "assistant",
                    "content": f"[Called {tc['function']['name']}({tc['function']['arguments']})]"})
            else:
                cf_messages.append(m)

        cf_url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/{model}"
        cf_headers = {"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"}
        cf_body: dict = {"messages": cf_messages, "max_tokens": 4096}
        if body.get("tools"):
            cf_body["tools"] = body["tools"]

        async def stream_cf():
            try:
                async with httpx.AsyncClient(timeout=90) as client:
                    resp = await client.post(cf_url, json=cf_body, headers=cf_headers)
            except httpx.HTTPError:
                resp = None

            chunk_id = f"chatcmpl-cf-{short_id(8)}"

            if resp is None or resp.status_code != 200:
                provider_failed("cloudflare_ai")
                if OPENROUTER_API_KEY and provider_available("openrouter"):
                    async for fallback_chunk in stream_free_openrouter("openai/gpt-4o-mini"):
                        yield fallback_chunk
                    await record_usage()
                    return
                status_code = resp.status_code if resp is not None else 503
                err_chunk = {"id": chunk_id, "object": "chat.completion.chunk", "model": model,
                             "choices": [{"index": 0, "delta": {"content": f"[model provider error {status_code}]"}, "finish_reason": "stop"}]}
                yield f"data: {json.dumps(err_chunk)}\n\ndata: [DONE]\n\n"
                return

            provider_succeeded("cloudflare_ai")
            result = resp.json().get("result", {})
            response = result.get("response")

            # CF may return a proper tool call dict, or a text string containing JSON
            tool_call = None
            if isinstance(response, dict) and "name" in response:
                tool_call = response
            elif isinstance(response, str):
                tool_call = _extract_tool_call(response)

            if tool_call:
                tc_name = tool_call.get("name", "")
                tc_args = tool_call.get("arguments", {})
                if isinstance(tc_args, str):
                    try: tc_args = json.loads(tc_args)
                    except: tc_args = {}
                tc_chunk = {
                    "id": chunk_id, "object": "chat.completion.chunk", "model": model,
                    "choices": [{"index": 0, "delta": {
                        "tool_calls": [{"index": 0, "id": f"call_{short_id(8)}", "type": "function",
                                        "function": {"name": tc_name, "arguments": json.dumps(tc_args)}}]
                    }, "finish_reason": None}]
                }
                yield f"data: {json.dumps(tc_chunk)}\n\n"
                done_chunk = {"id": chunk_id, "object": "chat.completion.chunk", "model": model,
                              "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]}
                yield f"data: {json.dumps(done_chunk)}\n\ndata: [DONE]\n\n"
            elif isinstance(response, str):
                words = response.split(" ")
                for i, word in enumerate(words):
                    token = word if i == 0 else " " + word
                    chunk = {"id": chunk_id, "object": "chat.completion.chunk", "model": model,
                             "choices": [{"index": 0, "delta": {"content": token}, "finish_reason": None}]}
                    yield f"data: {json.dumps(chunk)}\n\n"
                done_chunk = {"id": chunk_id, "object": "chat.completion.chunk", "model": model,
                              "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
                yield f"data: {json.dumps(done_chunk)}\n\ndata: [DONE]\n\n"
            else:
                yield "data: [DONE]\n\n"

            await record_usage()

        return StreamingResponse(stream_cf(), media_type="text/event-stream")

    else:
        # OpenRouter streaming proxy
        or_body = dict(body)
        or_body["stream"] = True
        or_headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://codexyy.dev",
            "X-Title": "codexyy",
        }

        async def stream_or():
            async with httpx.AsyncClient(timeout=120) as client:
                try:
                    async with client.stream(
                        "POST", "https://openrouter.ai/api/v1/chat/completions",
                        json=or_body, headers=or_headers,
                    ) as resp:
                        if resp.status_code != 200:
                            await resp.aread()
                            provider_failed("openrouter")
                            yield "data: {\"error\":{\"message\":\"The free model provider is temporarily unavailable.\"}}\n\ndata: [DONE]\n\n"
                            return
                        provider_succeeded("openrouter")
                        async for line in resp.aiter_lines():
                            if line:
                                yield line + "\n"
                        yield "\n"
                except httpx.HTTPError:
                    provider_failed("openrouter")
                    yield "data: {\"error\":{\"message\":\"The free model provider is temporarily unavailable.\"}}\n\ndata: [DONE]\n\n"
                    return
            await record_usage()

        return StreamingResponse(stream_or(), media_type="text/event-stream")


@app.get("/api/free/usage")
async def free_usage(user=Depends(require_auth)):
    week = iso_week()
    count = int(user.get("free_count") or 0)
    if user.get("free_week", "") != week:
        count = 0
    return {"used": count, "limit": FREE_WEEKLY_LIMIT, "remaining": max(0, FREE_WEEKLY_LIMIT - count), "week": week}


# ─── Stripe checkout & webhooks ───────────────────────────────────────────────

async def stripe_price_id(key: str) -> str:
    configured = STRIPE_PRICES.get(key, "")
    if configured:
        return configured
    lookup_key = STRIPE_PRICE_LOOKUPS.get(key, "")
    if not lookup_key:
        return ""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://api.stripe.com/v1/prices",
            auth=(STRIPE_SECRET_KEY, ""),
            params={"lookup_keys[]": lookup_key, "active": "true", "limit": 1},
        )
    if response.status_code != 200:
        return ""
    prices = response.json().get("data", [])
    return prices[0].get("id", "") if prices else ""


async def stripe_portal_url(customer_id: str) -> str:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.stripe.com/v1/billing_portal/sessions",
            auth=(STRIPE_SECRET_KEY, ""),
            data={"customer": customer_id, "return_url": f"{BASE_URL}/pro"},
        )
    if response.status_code != 200:
        raise HTTPException(502, "Could not open billing management. Please try again shortly.")
    return response.json()["url"]


@app.get("/api/stripe/checkout")
async def stripe_checkout(plan: str, amount: int = 15, user=Depends(require_auth)):
    if not STRIPE_SECRET_KEY:
        raise HTTPException(503, "Stripe not configured")

    # Existing subscribers manage their subscription instead of accidentally
    # creating a second one.
    if user.get("stripe_sub_id") and user.get("stripe_customer_id"):
        return RedirectResponse(await stripe_portal_url(user["stripe_customer_id"]), status_code=303)

    # Pick a configured ID or resolve the stable lookup key from Stripe.
    if plan == "pro":
        price_key = "pro"
    elif plan == "pro_max":
        amount = max(15, min(30, (amount // 5) * 5))  # snap to 15/20/25/30
        price_key = f"promax_{amount}"
    else:
        raise HTTPException(400, "Invalid plan")

    price_id = await stripe_price_id(price_key)
    if not price_id:
        raise HTTPException(503, "This plan is temporarily unavailable")

    # Create or retrieve Stripe customer
    customer_id = user.get("stripe_customer_id")
    async with httpx.AsyncClient() as client:
        if not customer_id:
            r = await client.post(
                "https://api.stripe.com/v1/customers",
                auth=(STRIPE_SECRET_KEY, ""),
                data={"email": user["email"], "name": user.get("name", ""), "metadata[codexyy_id]": user["id"]},
            )
            if r.status_code == 200:
                customer_id = r.json()["id"]
                async with aiosqlite.connect(DB) as db:
                    await db.execute("UPDATE users SET stripe_customer_id=? WHERE id=?", (customer_id, user["id"]))
                    await db.commit()

        metadata = {"codexyy_user_id": user["id"], "plan": plan, "amount": str(amount)}
        data = {
            "mode": "subscription",
            "customer": customer_id or "",
            "line_items[0][price]": price_id,
            "line_items[0][quantity]": "1",
            "success_url": f"{BASE_URL}/dashboard?subscribed=1",
            "cancel_url": f"{BASE_URL}/pro",
            "allow_promotion_codes": "true",
        }
        if not customer_id:
            data["customer_email"] = user["email"]
            del data["customer"]
        for k, v in metadata.items():
            data[f"metadata[{k}]"] = v
            data[f"subscription_data[metadata][{k}]"] = v

        r = await client.post(
            "https://api.stripe.com/v1/checkout/sessions",
            auth=(STRIPE_SECRET_KEY, ""),
            data=data,
        )
    if r.status_code != 200:
        raise HTTPException(500, f"Stripe error: {r.text}")

    return RedirectResponse(r.json()["url"], status_code=303)


@app.get("/api/stripe/portal")
async def stripe_portal(user=Depends(require_auth)):
    if not STRIPE_SECRET_KEY:
        raise HTTPException(503, "Stripe not configured")
    customer_id = user.get("stripe_customer_id")
    if not customer_id:
        raise HTTPException(400, "No billing account yet")
    return RedirectResponse(await stripe_portal_url(customer_id), status_code=303)


class StripePlanChange(BaseModel):
    plan: str
    amount: int = 15


@app.post("/api/stripe/change-plan")
async def stripe_change_plan(body: StripePlanChange, request: Request, user=Depends(require_auth)):
    if not request_is_same_origin(request):
        raise HTTPException(403, "Invalid origin")
    if not STRIPE_SECRET_KEY:
        raise HTTPException(503, "Stripe not configured")
    subscription_id = str(user.get("stripe_sub_id") or "")
    if not subscription_id.startswith("sub_"):
        raise HTTPException(400, "No active subscription")
    if body.plan == "pro":
        price_key, amount = "pro", 0
    elif body.plan == "pro_max":
        amount = max(15, min(30, (body.amount // 5) * 5))
        price_key = f"promax_{amount}"
    else:
        raise HTTPException(400, "Invalid plan")
    price_id = await stripe_price_id(price_key)
    if not price_id:
        raise HTTPException(503, "This plan is temporarily unavailable")
    async with httpx.AsyncClient(timeout=20.0) as client:
        current = await client.get(
            f"https://api.stripe.com/v1/subscriptions/{subscription_id}",
            auth=(STRIPE_SECRET_KEY, ""),
        )
        if current.status_code != 200:
            raise HTTPException(502, "Could not retrieve the current subscription")
        items = current.json().get("items", {}).get("data", [])
        if not items or not str(items[0].get("id") or "").startswith("si_"):
            raise HTTPException(502, "The subscription has no changeable item")
        update = await client.post(
            f"https://api.stripe.com/v1/subscriptions/{subscription_id}",
            auth=(STRIPE_SECRET_KEY, ""),
            data={
                "items[0][id]": items[0]["id"],
                "items[0][price]": price_id,
                "proration_behavior": "create_prorations",
                "metadata[plan]": body.plan,
                "metadata[amount]": str(amount),
            },
        )
    if update.status_code != 200:
        raise HTTPException(502, "Stripe could not change the subscription")
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "UPDATE users SET plan=?,plan_amount=? WHERE id=?",
            (body.plan, amount, user["id"]),
        )
        await db.execute(
            """INSERT INTO subscription_audit
               (id,user_id,stripe_subscription_id,local_plan,stripe_status,action,created_at)
               VALUES(?,?,?,?,?,?,?)""",
            (uuid.uuid4().hex, user["id"], subscription_id, user.get("plan", "free"), "active", f"change_to_{body.plan}", int(time.time())),
        )
        await db.commit()
    return {"ok": True, "plan": body.plan, "amount": amount, "proration": "create_prorations"}


@app.post("/api/stripe/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    if STRIPE_WEBHOOK_SECRET:
        sig = request.headers.get("stripe-signature", "")

        # Verify signature manually (HMAC-SHA256)
        import hmac, hashlib
        signature_parts = [part.split("=", 1) for part in sig.split(",") if "=" in part]
        ts = next((value for key, value in signature_parts if key == "t"), "")
        signatures = [value for key, value in signature_parts if key == "v1"]
        if not ts.isdigit() or abs(int(time.time()) - int(ts)) > 300:
            raise HTTPException(400, "Expired Stripe signature")
        signed = f"{ts}.{payload.decode()}"
        expected = hmac.new(STRIPE_WEBHOOK_SECRET.encode(), signed.encode(), hashlib.sha256).hexdigest()
        if not any(hmac.compare_digest(expected, signature) for signature in signatures):
            raise HTTPException(400, "Invalid signature")
        event = json.loads(payload)
    else:
        # Retrieve the event from Stripe and process that canonical copy, never
        # an unsigned request body.
        try:
            event_id = json.loads(payload).get("id", "")
        except Exception:
            event_id = ""
        if not event_id.startswith("evt_") or not STRIPE_SECRET_KEY:
            raise HTTPException(400, "Invalid Stripe event")
        async with httpx.AsyncClient() as client:
            verified = await client.get(
                f"https://api.stripe.com/v1/events/{event_id}",
                auth=(STRIPE_SECRET_KEY, ""),
            )
        if verified.status_code != 200:
            raise HTTPException(400, "Stripe event verification failed")
        event = verified.json()
    event_id = str(event.get("id") or "")
    etype = str(event.get("type") or "")
    if not event_id.startswith("evt_") or not etype:
        raise HTTPException(400, "Invalid Stripe event")

    async with aiosqlite.connect(DB) as db:
        reservation = await db.execute(
            """INSERT INTO stripe_webhook_events
               (event_id,event_type,received_at,status) VALUES(?,?,?,'processing')
               ON CONFLICT(event_id) DO NOTHING""",
            (event_id, etype, int(time.time())),
        )
        if reservation.rowcount != 1:
            return {"ok": True, "duplicate": True}
        if etype == "checkout.session.completed":
            session = event["data"]["object"]
            meta = session.get("metadata", {})
            uid = meta.get("codexyy_user_id")
            plan = meta.get("plan", "pro")
            amount = float(meta.get("amount", 10))
            sub_id = session.get("subscription", "")
            customer_id = session.get("customer", "")
            if uid:
                if plan == "pro_max":
                    await db.execute(
                        "UPDATE users SET plan='pro_max', plan_amount=?, stripe_sub_id=?, stripe_customer_id=? WHERE id=?",
                        (amount, sub_id, customer_id, uid)
                    )
                else:
                    await db.execute(
                        "UPDATE users SET plan='pro', stripe_sub_id=?, stripe_customer_id=? WHERE id=?",
                        (sub_id, customer_id, uid)
                    )

        elif etype in ("customer.subscription.deleted", "customer.subscription.paused"):
            sub = event["data"]["object"]
            sub_id = sub.get("id", "")
            if sub_id:
                await db.execute(
                    "UPDATE users SET plan='free', stripe_sub_id=NULL WHERE stripe_sub_id=?",
                    (sub_id,)
                )

        elif etype == "customer.subscription.updated":
            sub = event["data"]["object"]
            status = sub.get("status", "")
            sub_id = sub.get("id", "")
            if status in ("past_due", "unpaid", "canceled") and sub_id:
                await db.execute(
                    "UPDATE users SET plan='free' WHERE stripe_sub_id=?", (sub_id,)
                )
            elif status in ("active", "trialing") and sub_id:
                meta = sub.get("metadata", {})
                plan = meta.get("plan")
                if plan == "pro_max":
                    amount = max(15, min(30, int(float(meta.get("amount", 15)))))
                    await db.execute(
                        "UPDATE users SET plan='pro_max', plan_amount=? WHERE stripe_sub_id=?",
                        (amount, sub_id),
                    )
                elif plan == "pro":
                    await db.execute("UPDATE users SET plan='pro' WHERE stripe_sub_id=?", (sub_id,))

        await db.execute(
            "UPDATE stripe_webhook_events SET status='processed',processed_at=? WHERE event_id=?",
            (int(time.time()), event_id),
        )
        await db.commit()
    return {"ok": True}


# ─── Pro Max: custom system prompt ────────────────────────────────────────────

class PromptBody(BaseModel):
    prompt: str

@app.get("/api/user/settings")
async def get_settings(user=Depends(require_auth)):
    return {
        "custom_prompt": user.get("custom_prompt"),
        "plan": user.get("plan", "free"),
    }

@app.post("/api/user/settings")
async def save_settings(body: PromptBody, user=Depends(require_auth)):
    if user.get("plan") != "pro_max":
        raise HTTPException(403, "Custom system prompt requires Pro Max")
    prompt = body.prompt.strip()[:2000]
    async with aiosqlite.connect(DB) as db:
        await db.execute("UPDATE users SET custom_prompt=? WHERE id=?", (prompt or None, user["id"]))
        await db.commit()
    return {"ok": True}

# ─── OpenRouter proxy (Pro / Pro Max) ─────────────────────────────────────────

def usage_alert_message(name: str, threshold: int, used: float, limit: float) -> tuple[str, str, str]:
    safe_name = html.escape(name or "there")
    accent = "#ff6b35" if threshold >= 100 else "#ffb020" if threshold >= 80 else "#00d4ff"
    subject = "Your Codexyy model allowance is used" if threshold >= 100 else f"You’ve used {threshold}% of your Codexyy allowance"
    body = f"""<!doctype html><html><body style="margin:0;background:#07070a;color:#e2e2ec;font-family:Arial,sans-serif"><div style="max-width:560px;margin:32px auto;padding:42px;border:1px solid #252535;border-radius:16px;background:#0d0d12"><div style="font:600 17px monospace">codexyy<span style="color:#00d4ff">.</span></div><p style="margin:34px 0 8px;color:{accent};font:700 10px monospace;text-transform:uppercase">Usage update</p><h1 style="margin:0 0 16px;font-size:38px">{threshold}% used<span style="color:{accent}">.</span></h1><p style="color:#7878a0;line-height:1.7">Hi {safe_name} — your hosted-model usage is ${used:.2f} of a ${limit:.2f} monthly allowance.</p><div style="height:8px;margin:26px 0;border-radius:99px;background:#1a1a26;overflow:hidden"><div style="width:{min(100, threshold)}%;height:100%;background:{accent}"></div></div><a href="https://codexyy.dev/pro" style="display:inline-block;padding:13px 18px;border-radius:9px;background:{accent};color:#07070a;font:700 11px monospace;text-decoration:none">Review usage and plans &rarr;</a></div></body></html>"""
    text = f"Hi {name or 'there'},\n\nYou have used {threshold}% of your Codexyy hosted-model allowance (${used:.2f} of ${limit:.2f}).\n\nReview usage and plans: https://codexyy.dev/pro"
    return subject, body, text

@app.post("/api/v1/chat/completions")
async def chat_completions(request: Request, user=Depends(require_auth)):
    plan = user.get("plan", "free")
    if plan not in ("pro", "pro_max"):
        raise HTTPException(402, "Pro plan required. Subscribe at codexyy.dev/pro")
    if not OPENROUTER_API_KEY:
        raise HTTPException(503, "OpenRouter not configured")

    month = time.strftime("%Y-%m", time.gmtime())
    spend = float(user.get("monthly_spend") or 0)
    if user.get("spend_month", "") != month:
        spend = 0.0

    limit = get_spend_limit(user)
    if spend >= limit:
        aud = limit / 0.63
        raise HTTPException(429, f"Monthly spend limit reached (~${aud:.0f} AUD). Resets next month.")

    body = await request.json()
    model = body.get("model", "anthropic/claude-3.5-sonnet")
    if model not in MODEL_RATES_USD:
        raise HTTPException(400, "Model is not available in the Codexyy Pro catalog")
    if not provider_available("openrouter"):
        raise HTTPException(503, "The model provider is cooling down; retry shortly")
    body["stream"] = True
    body["stream_options"] = {"include_usage": True}
    provider_options = body.get("provider") if isinstance(body.get("provider"), dict) else {}
    body["provider"] = {**provider_options, "allow_fallbacks": True}

    or_headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://codexyy.dev",
        "X-Title": "codexyy",
    }

    usage_tracker: dict[str, int | str] = {"prompt_tokens": 0, "completion_tokens": 0, "model": model}
    user_id = user["id"]
    user_email = str(user.get("email") or "")
    user_name = str(user.get("name") or "")

    async def stream_and_track():
        fallback_model = "openai/gpt-4o-mini" if model != "openai/gpt-4o-mini" else "anthropic/claude-3.5-haiku"
        completed = False
        async with httpx.AsyncClient(timeout=120) as client:
            for active_model in (model, fallback_model):
                attempt_body = dict(body)
                attempt_body["model"] = active_model
                try:
                    async with client.stream(
                        "POST",
                        "https://openrouter.ai/api/v1/chat/completions",
                        json=attempt_body,
                        headers=or_headers,
                    ) as resp:
                        if resp.status_code != 200:
                            await resp.aread()
                            if resp.status_code == 429 or resp.status_code >= 500:
                                provider_failed("openrouter")
                                continue
                            provider_failed("openrouter")
                            break
                        provider_succeeded("openrouter")
                        usage_tracker["model"] = active_model
                        async for line in resp.aiter_lines():
                            if line.startswith("data: ") and line[6:] != "[DONE]":
                                try:
                                    chunk = json.loads(line[6:])
                                    if chunk.get("usage"):
                                        usage_tracker["prompt_tokens"] = int(chunk["usage"].get("prompt_tokens", 0))
                                        usage_tracker["completion_tokens"] = int(chunk["usage"].get("completion_tokens", 0))
                                except Exception:
                                    pass
                            if line:
                                yield line + "\n"
                        yield "\n"
                        completed = True
                        break
                except httpx.HTTPError:
                    provider_failed("openrouter")
                    continue
        if not completed:
            error_chunk = {
                "object": "chat.completion.chunk", "model": model,
                "choices": [{"index": 0, "delta": {"content": "The model provider is temporarily unavailable."}, "finish_reason": "stop"}],
            }
            yield f"data: {json.dumps(error_chunk)}\n\ndata: [DONE]\n\n"
            return

        cost = estimate_cost_usd(
            str(usage_tracker["model"]),
            int(usage_tracker["prompt_tokens"]),
            int(usage_tracker["completion_tokens"]),
        )
        alerts: list[tuple[int, float]] = []
        async with aiosqlite.connect(DB) as db:
            await db.execute(
                """UPDATE users SET monthly_spend=CASE WHEN spend_month=? THEN monthly_spend+? ELSE ? END,
                   spend_month=? WHERE id=?""",
                (month, cost, cost, month, user_id),
            )
            current = await (await db.execute("SELECT monthly_spend FROM users WHERE id=?", (user_id,))).fetchone()
            new_spend = float(current[0] if current else spend + cost)
            for threshold in (50, 80, 100):
                if limit > 0 and new_spend / limit * 100 >= threshold:
                    reservation = await db.execute(
                        """INSERT INTO usage_alerts(user_id,month,threshold,created_at,status)
                           VALUES(?,?,?,?,'pending') ON CONFLICT(user_id,month,threshold) DO NOTHING""",
                        (user_id, month, threshold, int(time.time())),
                    )
                    if reservation.rowcount == 1:
                        alerts.append((threshold, new_spend))
            await db.commit()
        for threshold, new_spend in alerts:
            subject, message_html, message_text = usage_alert_message(user_name, threshold, new_spend, limit)
            try:
                await asyncio.to_thread(
                    send_email, user_email, subject, message_html, message_text,
                    "platform@codexyy.dev", "Codexyy Usage",
                )
                async with aiosqlite.connect(DB) as db:
                    await db.execute(
                        "UPDATE usage_alerts SET status='sent' WHERE user_id=? AND month=? AND threshold=?",
                        (user_id, month, threshold),
                    )
                    await db.commit()
            except Exception:
                await enqueue_operation(
                    "email",
                    email_operation_payload(
                        user_email, subject, message_html, message_text,
                        "platform@codexyy.dev", "Codexyy Usage",
                    ),
                )
                async with aiosqlite.connect(DB) as db:
                    await db.execute(
                        "UPDATE usage_alerts SET status='queued' WHERE user_id=? AND month=? AND threshold=? AND status='pending'",
                        (user_id, month, threshold),
                    )
                    await db.commit()

    return StreamingResponse(stream_and_track(), media_type="text/event-stream")

@app.post("/auth/logout")
async def logout(request: Request):
    if not request_is_same_origin(request):
        raise HTTPException(403, "Invalid origin")
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token:
        token = request.cookies.get("cxy_token", "")
    if token:
        async with aiosqlite.connect(DB) as db:
            await db.execute("DELETE FROM sessions WHERE token=?", (token,))
            await db.commit()
    response = JSONResponse({"ok": True})
    response.delete_cookie(
        "cxy_token", path="/", secure=True, httponly=True, samesite="lax"
    )
    return response

# ─── HTML pages ───────────────────────────────────────────────────────────────

def login_html(code: str, next_path: str = "/play", plan: str = "", amount: str = "") -> str:
    plan, amount = safe_plan(plan, amount)
    query = {
        "cli_code": code[:128],
        "next": safe_next_path(next_path),
        "plan": plan,
        "amount": amount,
    }
    query = {key: value for key, value in query.items() if value}
    email_url = "/auth/email?" + urllib.parse.urlencode(query)
    google_url = "/auth/google?" + urllib.parse.urlencode(query)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="robots" content="noindex">
<title>Choose how to sign in — codexyy</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#07070a;color:#e2e2ec;font-family:'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:22px;background-image:radial-gradient(circle at 80% 0,rgba(0,212,255,.13),transparent 36%),linear-gradient(rgba(26,26,38,.28) 1px,transparent 1px),linear-gradient(90deg,rgba(26,26,38,.28) 1px,transparent 1px);background-size:auto,52px 52px,52px 52px}}
.card{{position:relative;background:rgba(13,13,18,.97);border:1px solid #252535;border-radius:18px;padding:42px;width:min(440px,100%);box-shadow:0 32px 90px rgba(0,0,0,.62)}}
.logo{{font:600 17px 'JetBrains Mono',monospace;color:#e2e2ec;margin-bottom:34px}}.logo span{{color:#00d4ff}}.logo .version{{margin-left:7px;color:#3a3a52;font-size:9px;font-weight:500}}
.eyebrow{{display:block;color:#00d4ff;font:600 9px 'JetBrains Mono',monospace;letter-spacing:.13em;text-transform:uppercase;margin-bottom:11px}}
h1{{font:800 38px/1.02 'Syne',sans-serif;letter-spacing:-.045em;margin-bottom:12px}}
.sub{{font-size:14px;color:#7878a0;margin-bottom:27px;line-height:1.65}}
.options{{display:grid;gap:11px}}
.provider{{display:flex;align-items:center;gap:14px;width:100%;min-height:58px;padding:10px 15px;border:1px solid #252535;border-radius:11px;background:#09090e;color:#e2e2ec;text-decoration:none;transition:border-color .15s,background .15s,transform .15s}}
.provider:hover{{border-color:#00d4ff;background:#0c1117;transform:translateY(-1px)}}
.provider:focus-visible,.back:focus-visible{{outline:3px solid rgba(0,212,255,.4);outline-offset:3px}}
.provider.primary{{border-color:rgba(0,212,255,.48);background:rgba(0,212,255,.08)}}
.icon{{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;background:#11111a;color:#00d4ff;font:700 15px 'JetBrains Mono',monospace;flex:0 0 auto}}
.copy{{display:grid;gap:3px}}.copy strong{{font:600 14px 'DM Sans',sans-serif}}.copy small{{color:#595976;font-size:11px}}
.arrow{{margin-left:auto;color:#00d4ff;font:600 14px 'JetBrains Mono',monospace}}
.note{{font-size:10px;color:#3a3a52;line-height:1.7;margin:24px 0 0;padding-top:20px;border-top:1px solid #1a1a26}}
.back{{display:inline-block;margin-top:16px;color:#7878a0;font:500 11px 'JetBrains Mono',monospace;text-decoration:none}}.back:hover{{color:#e2e2ec}}
@media(max-width:520px){{.card{{padding:30px 22px}}h1{{font-size:33px}}}}
</style>
</head>
<body>
<main class="card">
  <div class="logo">codexyy<span>.</span> account <small class="version">v3.0.0 · self-hosted</small></div>
  <span class="eyebrow">Choose a sign-in method</span>
  <h1>How do you want to continue?</h1>
  <p class="sub">{'Connect this browser to the cxy CLI.' if code else 'Both options open the same Codexyy account and return you exactly where you started.'}</p>
  <div class="options">
    <a href="{html.escape(email_url, quote=True)}" class="provider primary">
      <span class="icon">@</span><span class="copy"><strong>Continue with email</strong><small>Sign in or create a Codexyy account</small></span><span class="arrow">&rarr;</span>
    </a>
    <a href="{html.escape(google_url, quote=True)}" class="provider">
      <span class="icon"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M17.64 9.2a10.3 10.3 0 00-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" fill="#4285F4"/><path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26a5.4 5.4 0 01-8.07-2.84H.96v2.33A9 9 0 009 18z" fill="#34A853"/><path d="M3.97 10.72A5.41 5.41 0 013.69 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 000 9c0 1.45.35 2.82.96 4.05l3.01-2.33z" fill="#FBBC05"/><path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.96 4.95L3.97 7.28A5.36 5.36 0 019 3.58z" fill="#EA4335"/></svg></span><span class="copy"><strong>Continue with Google</strong><small>Use an existing Google account</small></span><span class="arrow">&rarr;</span>
    </a>
  </div>
  <p class="note">Codexyy never silently chooses a provider. Email verification and Google sign-in both create a secure 30-day Codexyy session.</p>
  <a class="back" href="{html.escape(safe_next_path(next_path), quote=True)}">&larr; Go back</a>
</main>
</body>
</html>"""

def cli_success_page(name: str) -> str:
    safe_name = html.escape(name)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Logged in - codexyy</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#07070a;color:#e2e2ec;font-family:'JetBrains Mono',monospace;display:flex;align-items:center;justify-content:center;min-height:100vh}}
body::before{{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 60% 50% at 50% 0%,rgba(78,255,168,.07),transparent 70%);pointer-events:none}}
.card{{background:#0e0e14;border:1px solid #252535;border-radius:20px;padding:48px 40px;width:360px;text-align:center;box-shadow:0 32px 80px rgba(0,0,0,.6)}}
.check{{font-size:48px;margin-bottom:20px}}
.logo{{font-family:'Syne',sans-serif;font-weight:800;font-size:22px;margin-bottom:24px}}
.logo span{{color:#4effa8}}
h2{{font-family:'Syne',sans-serif;font-size:18px;font-weight:700;color:#4effa8;margin-bottom:12px}}
p{{font-size:13px;color:#7878a0;line-height:1.6}}
</style>
</head>
<body>
<div class="card">
  <div class="check">&#10003;</div>
  <div class="logo">codexyy<span>.dev</span></div>
  <h2>You're logged in!</h2>
  <p>Hey {safe_name}. You can close this tab and go back to your terminal.</p>
</div>
</body>
</html>"""

def error_page(msg: str) -> str:
    safe_message = html.escape(str(msg))
    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Error - codexyy</title>
<style>body{{background:#07070a;color:#f87171;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}}</style>
</head><body><div><h2>Auth error</h2><p>{safe_message}</p><a href="/auth/login" style="color:#00d4ff">Choose another sign-in option</a></div></body></html>"""

# ─── Paste ─────────────────────────────────────────────────────────────────────

class WaitlistEntry(BaseModel):
    email: str

class SupportAccessEmailRequest(BaseModel):
    email: str
    access_url: str

SUPPORT_ACCESS_EMAILS = {
    "james.adams13@icloud.com",
    "heyaitsjames@icloud.com",
    "itsjtamc@gmail.com",
    "jta@codexyy.dev",
    "adamsjam@brightongrammar.vic.edu.au",
}

def valid_support_access_url(value: str) -> bool:
    try:
        parsed = urllib.parse.urlsplit(value)
        query = urllib.parse.parse_qs(parsed.query, strict_parsing=True)
        token = query.get("token", [])
        return (
            parsed.scheme == "https"
            and parsed.hostname == "auth.codexyy.dev"
            and parsed.port is None
            and parsed.username is None
            and parsed.password is None
            and parsed.path == "/support/access"
            and not parsed.fragment
            and set(query) == {"token"}
            and len(token) == 1
            and re.fullmatch(r"[A-Za-z0-9_-]{40,128}", token[0]) is not None
        )
    except Exception:
        return False

def support_access_email_html(access_url: str) -> str:
    safe_url = html.escape(access_url, quote=True)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07070a;color:#e2e2ec;font-family:'DM Sans','Segoe UI',Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07070a"><tr><td align="center" style="padding:32px 12px 44px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%"><tr><td style="padding:0 8px 20px;color:#e2e2ec;font:600 17px 'JetBrains Mono',monospace">codexyy<span style="color:#00d4ff">.</span> <span style="color:#3a3a52;font-size:10px">AUTH v3.0.0</span></td></tr><tr><td style="overflow:hidden;border:1px solid #252535;border-radius:16px;background:#0d0d12"><div style="height:4px;background:#00d4ff"></div><div style="padding:48px"><div style="display:inline-block;margin-bottom:22px;padding:6px 11px;border:1px solid #00d4ff42;border-radius:99px;color:#00d4ff;font:600 9px 'JetBrains Mono',monospace;letter-spacing:1.2px;text-transform:uppercase">Restricted support access</div><h1 style="margin:0 0 18px;color:#e2e2ec;font:800 42px/1.08 'Syne','Arial Black',sans-serif;letter-spacing:-2px">Open the support<br><span style="color:#00d4ff">dashboard.</span></h1><p style="margin:0 0 28px;color:#7878a0;font-size:16px;line-height:27px">Your one-time link expires in 15 minutes and works once.</p><a href="{safe_url}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#00d4ff;color:#07070a;font:700 12px 'JetBrains Mono',monospace;text-decoration:none">Review and open dashboard &rarr;</a><div style="height:1px;margin:32px 0;background:#1a1a26"></div><p style="margin:0;color:#7878a0;font-size:13px;line-height:22px">If you did not request this, ignore the message. No dashboard session will be created.</p></div></td></tr><tr><td style="padding:20px 8px;color:#3a3a52;font-size:11px;text-align:center">platform@codexyy.dev · one-time administrator access</td></tr></table></td></tr></table></body></html>"""

@app.post("/api/support/access-email", status_code=202)
async def send_support_access_email(body: SupportAccessEmailRequest, request: Request):
    email = body.email.strip().lower()
    if email not in SUPPORT_ACCESS_EMAILS or not valid_support_access_url(body.access_url):
        raise HTTPException(400, "Invalid support access request")
    now = int(time.time())
    source = request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")
    source_hash = hashlib.sha256(f"support-access-v3:{source}".encode()).hexdigest()
    log_id = uuid.uuid4().hex
    async with aiosqlite.connect(DB) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM support_access_email_log WHERE email=? AND created_at>=?",
            (email, now - 900),
        ) as cur:
            recent = (await cur.fetchone())[0]
        if recent >= 5:
            raise HTTPException(429, "Too many access emails requested")
        await db.execute(
            "INSERT INTO support_access_email_log(id,email,request_ip_hash,created_at,status) VALUES(?,?,?,?,?)",
            (log_id, email, source_hash, now, "pending"),
        )
        await db.commit()
    try:
        await asyncio.to_thread(
            send_email,
            email,
            "Your Codexyy support dashboard sign-in link",
            support_access_email_html(body.access_url),
            f"Open the Codexyy support dashboard: {body.access_url}\n\nThis link expires in 15 minutes and works once.",
            "platform@codexyy.dev",
            "Codexyy Support",
        )
    except Exception:
        async with aiosqlite.connect(DB) as db:
            await db.execute(
                "UPDATE support_access_email_log SET status='queued' WHERE id=?",
                (log_id,),
            )
            await db.commit()
        await enqueue_operation(
            "email",
            email_operation_payload(
                email,
                "Your Codexyy support dashboard sign-in link",
                support_access_email_html(body.access_url),
                f"Open the Codexyy support dashboard: {body.access_url}\n\nThis link expires in 15 minutes and works once.",
                "platform@codexyy.dev",
                "Codexyy Support",
            ),
            delay=10,
        )
        return {"ok": True, "queued": True}
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "UPDATE support_access_email_log SET status='sent' WHERE id=?",
            (log_id,),
        )
        await db.commit()
    return {"ok": True}

async def local_support_admin(request: Request):
    raw = request.cookies.get("cxy_support", "")
    if re.fullmatch(r"[A-Za-z0-9_-]{40,128}", raw):
        key, now = hashlib.sha256(raw.encode()).hexdigest(), int(time.time())
        async with aiosqlite.connect(DB) as db:
            cur = await db.execute("SELECT email FROM local_support_sessions WHERE token_hash=? AND expires_at>?", (key, now))
            row = await cur.fetchone()
        if row and row[0] in SUPPORT_ACCESS_EMAILS:
            return row[0]
    main_token = request.cookies.get("cxy_token", "")
    if main_token:
        user = await get_user_by_token(main_token)
        email = str((user or {}).get("email") or "").strip().lower()
        if email in SUPPORT_ACCESS_EMAILS:
            return email
    return None

def support_shell(content: str) -> str:
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Codexyy Support v3.0.0</title><style>*{{box-sizing:border-box}}body{{margin:0;background:#07070a;color:#e2e2ec;font-family:Arial,sans-serif;min-height:100vh;padding:30px}}main{{width:min(900px,100%);margin:auto}}.logo{{font:600 17px monospace;margin-bottom:30px}}.logo b{{color:#00d4ff}}.card{{padding:36px;border:1px solid #252535;border-radius:16px;background:#0d0d12;margin-bottom:18px}}h1{{font-size:38px;margin:10px 0}}p{{color:#7878a0;line-height:1.65}}label{{display:block;margin:16px 0 7px;color:#7878a0;font:600 10px monospace;text-transform:uppercase}}input,textarea,select{{width:100%;padding:13px;border:1px solid #252535;border-radius:9px;background:#09090e;color:#e2e2ec}}textarea{{min-height:180px}}button{{margin-top:16px;padding:13px 20px;border:0;border-radius:9px;background:#00d4ff;color:#07070a;font-weight:700;cursor:pointer}}.grid{{display:grid;grid-template-columns:1fr 1fr;gap:14px}}@media(max-width:650px){{.grid{{grid-template-columns:1fr}}}}</style></head><body><main><div class="logo">codexyy<b>.</b> support · v3.0.0 · self-hosted</div>{content}</main></body></html>"""

@app.get("/auth/support", response_class=HTMLResponse)
async def local_support_home(request: Request):
    admin = await local_support_admin(request)
    if not admin:
        return HTMLResponse(support_shell('<section class="card"><small>APPROVED TEAM ACCESS</small><h1>Open support.</h1><p>Sign in with an approved Codexyy account, or request a 15-minute one-time link.</p><a href="/auth/login?next=/auth/support"><button>Sign in with Codexyy &rarr;</button></a><form method="post" action="/auth/support/request"><label>Email-link fallback</label><input name="email" type="email" required autocomplete="email"><button>Send one-time link &rarr;</button></form></section>'))
    presets = [("Friendly reply","An update from Codexyy Support"),("Issue received","We’re looking into your Codexyy issue"),("Issue resolved","Your Codexyy issue has been resolved"),("Incident update","Service update from Codexyy"),("Billing assistance","Help with your Codexyy billing question"),("Refund confirmed","Your Codexyy refund has been processed"),("Account restored","Your Codexyy account access is restored"),("Feature request","We saved your Codexyy feature request"),("Onboarding help","Let’s get your Codexyy setup working"),("Personal thanks","Thank you from the Codexyy team")]
    options = ''.join(f'<option value="{html.escape(subject,quote=True)}">{html.escape(label)}</option>' for label,subject in presets)
    page = f'''<section class="card"><small>MANUAL EMAIL CONSOLE · signed in as {html.escape(admin)}</small><h1>Send something useful.</h1><form method="post" action="/auth/support/send"><div class="grid"><div><label>Recipient</label><input name="to" type="email" required></div><div><label>From</label><input name="from_email" type="email" value="platform@codexyy.dev" required></div></div><label>Template / subject</label><select name="subject">{options}</select><label>Message</label><textarea name="message" required></textarea><button>Send through Microsoft Graph &rarr;</button></form><form method="post" action="/auth/support/logout"><button style="background:#252535;color:#e2e2ec">Sign out</button></form></section>'''
    return HTMLResponse(support_shell(page))

@app.post("/auth/support/request", response_class=HTMLResponse)
async def local_support_request(request: Request):
    if not request_is_same_origin(request): raise HTTPException(403, "Invalid origin")
    form, now = await request.form(), int(time.time())
    email = str(form.get("email") or "").strip().lower()
    generic = support_shell('<section class="card"><h1>Check your inbox.</h1><p>If that address is approved, a one-time link is on its way.</p></section>')
    if email not in SUPPORT_ACCESS_EMAILS: return HTMLResponse(generic)
    raw, key = secrets.token_urlsafe(32), ""
    key = hashlib.sha256(raw.encode()).hexdigest()
    async with aiosqlite.connect(DB) as db:
        await db.execute("UPDATE local_support_links SET used=1 WHERE email=? AND used=0", (email,))
        await db.execute("INSERT INTO local_support_links VALUES(?,?,?,?,0)", (key,email,now,now+900)); await db.commit()
    url = f"{public_origin_for(request)}/auth/support/access?token={urllib.parse.quote(raw)}"
    try:
        await asyncio.to_thread(send_email,email,"Your Codexyy support dashboard sign-in link",support_access_email_html(url),f"Open support: {url}","platform@codexyy.dev","Codexyy Support")
    except Exception:
        await enqueue_operation(
            "email",
            email_operation_payload(email,"Your Codexyy support dashboard sign-in link",support_access_email_html(url),f"Open support: {url}","platform@codexyy.dev","Codexyy Support"),
            delay=10,
        )
    return HTMLResponse(generic)

@app.get("/auth/support/access", response_class=HTMLResponse)
async def local_support_access_preview(token: str = ""):
    key, now = hashlib.sha256(token.encode()).hexdigest(), int(time.time())
    async with aiosqlite.connect(DB) as db:
        cur=await db.execute("SELECT 1 FROM local_support_links WHERE token_hash=? AND used=0 AND expires_at>?",(key,now)); row=await cur.fetchone()
    if not row: return HTMLResponse(error_page("This support link expired or was used."),status_code=400)
    return HTMLResponse(support_shell(f'<section class="card"><h1>Link verified.</h1><form method="post" action="/auth/support/access"><input type="hidden" name="token" value="{html.escape(token,quote=True)}"><button>Open dashboard &rarr;</button></form></section>'))

@app.post("/auth/support/access")
async def local_support_access(request: Request):
    if not request_is_same_origin(request): raise HTTPException(403,"Invalid origin")
    form,now=await request.form(),int(time.time()); key=hashlib.sha256(str(form.get("token") or "").encode()).hexdigest()
    async with aiosqlite.connect(DB) as db:
        cur=await db.execute("SELECT email FROM local_support_links WHERE token_hash=? AND used=0 AND expires_at>?",(key,now)); row=await cur.fetchone()
        if not row: return HTMLResponse(error_page("This support link expired or was used."),status_code=400)
        await db.execute("UPDATE local_support_links SET used=1 WHERE token_hash=?",(key,)); raw=secrets.token_urlsafe(32)
        await db.execute("INSERT INTO local_support_sessions VALUES(?,?,?,?)",(hashlib.sha256(raw.encode()).hexdigest(),row[0],now,now+28800)); await db.commit()
    response=RedirectResponse("/auth/support",303); response.set_cookie("cxy_support",raw,max_age=28800,path="/auth/support",secure=True,httponly=True,samesite="strict"); return response

@app.post("/auth/support/send")
async def local_support_send(request: Request):
    if not request_is_same_origin(request): raise HTTPException(403,"Invalid origin")
    admin=await local_support_admin(request)
    if not admin: raise HTTPException(401,"Not authenticated")
    form=await request.form(); to=str(form.get("to") or "").strip().lower(); sender=str(form.get("from_email") or "").strip().lower(); subject=str(form.get("subject") or "").strip(); message=str(form.get("message") or "").strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+",to) or not sender.endswith("@codexyy.dev") or not subject or len(subject)>160 or not message or len(message)>20000: raise HTTPException(400,"Invalid email fields")
    audit=uuid.uuid4().hex
    async with aiosqlite.connect(DB) as db: await db.execute("INSERT INTO local_support_audit VALUES(?,?,?,?,?,?,?)",(audit,admin,sender,to,subject,int(time.time()),"pending")); await db.commit()
    body=f'<div style="background:#07070a;padding:32px;color:#e2e2ec;font-family:Arial"><div style="max-width:600px;margin:auto;padding:40px;border:1px solid #252535;border-radius:16px;background:#0d0d12"><b>codexyy<span style="color:#00d4ff">.</span> support</b><h1>{html.escape(subject)}</h1><p style="white-space:pre-wrap;color:#b0b0c2;line-height:1.7">{html.escape(message)}</p></div></div>'
    try:
        await asyncio.to_thread(send_email,to,subject,body,message,sender,"Codexyy Support")
    except Exception:
        await enqueue_operation(
            "email",
            email_operation_payload(to,subject,body,message,sender,"Codexyy Support"),
            delay=15,
        )
        async with aiosqlite.connect(DB) as db: await db.execute("UPDATE local_support_audit SET status='queued' WHERE id=?",(audit,)); await db.commit()
        return HTMLResponse(support_shell('<section class="card"><h1>Email queued.</h1><p>Microsoft Graph was temporarily unavailable. Delivery will retry automatically.</p><a href="/auth/support"><button>Back to dashboard</button></a></section>'),status_code=202)
    async with aiosqlite.connect(DB) as db: await db.execute("UPDATE local_support_audit SET status='sent' WHERE id=?",(audit,)); await db.commit()
    return RedirectResponse("/auth/support",303)

@app.post("/auth/support/logout")
async def local_support_logout(request: Request):
    if not request_is_same_origin(request):
        raise HTTPException(403, "Invalid origin")
    support_token = request.cookies.get("cxy_support", "")
    main_token = request.cookies.get("cxy_token", "")
    async with aiosqlite.connect(DB) as db:
        if re.fullmatch(r"[A-Za-z0-9_-]{40,128}", support_token):
            await db.execute(
                "DELETE FROM local_support_sessions WHERE token_hash=?",
                (hashlib.sha256(support_token.encode()).hexdigest(),),
            )
        if main_token:
            await db.execute("DELETE FROM sessions WHERE token=?", (main_token,))
        await db.commit()
    response = RedirectResponse("/auth/support", 303)
    response.delete_cookie("cxy_support", path="/auth/support", secure=True, httponly=True, samesite="strict")
    response.delete_cookie("cxy_token", path="/", secure=True, httponly=True, samesite="lax")
    return response

WAITLIST_EMAIL_HTML = """<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07070a;font-family:'DM Sans',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#07070a;padding:48px 0">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#0e0e14;border:1px solid #1a1a26;border-radius:16px;overflow:hidden">
      <tr><td style="padding:8px 32px;background:#141420;border-bottom:1px solid #1a1a26">
        <span style="font-family:'JetBrains Mono',monospace;font-size:14px;color:#e2e2ec">codexyy<span style="color:#00d4ff">.dev</span></span>
      </td></tr>
      <tr><td style="padding:40px 32px">
        <div style="display:inline-block;background:rgba(0,212,255,.07);border:1px solid rgba(0,212,255,.2);border-radius:100px;padding:4px 14px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#00d4ff;letter-spacing:.05em;margin-bottom:24px">You're on the list</div>
        <h1 style="font-size:28px;font-weight:800;color:#e2e2ec;margin:0 0 16px;letter-spacing:-1px;line-height:1.1">You're on the waitlist.</h1>
        <p style="font-size:15px;color:#7878a0;line-height:1.7;margin:0 0 24px">We're putting the finishing touches on <strong style="color:#e2e2ec">codexyy playground</strong> — a full-featured code runner with Monaco editor, 80+ languages, and instant shareable links.</p>
        <p style="font-size:15px;color:#7878a0;line-height:1.7;margin:0 0 32px">You'll be the first to know when it goes live. No spam, just one email when it's ready.</p>
        <table cellpadding="0" cellspacing="0"><tr><td style="background:#00d4ff;border-radius:9px">
          <a href="https://codexyy.dev" style="display:block;padding:13px 24px;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:#07070a;text-decoration:none">Visit codexyy.dev</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:20px 32px;border-top:1px solid #1a1a26">
        <p style="font-size:12px;color:#3a3a52;margin:0;font-family:'JetBrains Mono',monospace">beta@codexyy.dev — you signed up at codexyy.dev</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>"""

class BetaRequest(BaseModel):
    email: str

class BetaVerify(BaseModel):
    email: str
    code: str

BETA_CODE_EMAIL_HTML = """
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#07070a;font-family:'JetBrains Mono',monospace">
<div style="max-width:480px;margin:40px auto;padding:40px 32px;background:#0d0d16;border:1px solid #1a1a2e;border-radius:16px">
  <div style="font-size:22px;font-weight:700;color:#e2e2ec;margin:0 0 8px;letter-spacing:-0.5px">codexyy<span style="color:#00d4ff">.dev</span></div>
  <div style="font-size:11px;color:#4a4a6a;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:32px">playground beta</div>
  <p style="font-size:14px;color:#7878a0;line-height:1.7;margin:0 0 28px">Your verification code for beta access:</p>
  <div style="font-size:36px;font-weight:800;letter-spacing:10px;color:#00d4ff;text-align:center;padding:24px;background:#050510;border:1px solid rgba(0,212,255,0.2);border-radius:10px;margin-bottom:28px">{code}</div>
  <p style="font-size:13px;color:#4a4a6a;line-height:1.7;margin:0">Expires in 15 minutes. If you didn't request this, ignore it.</p>
  <div style="margin-top:32px;padding-top:24px;border-top:1px solid #1a1a2e;font-size:11px;color:#2a2a42">beta@codexyy.dev</div>
</div>
</body>
</html>
"""

@app.post("/api/beta/request")
async def beta_request(body: BetaRequest):
    email = body.email.strip().lower()
    if not email or "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(400, "Invalid email")
    code = str(random.randint(100000, 999999))
    now = int(time.time())
    async with aiosqlite.connect(DB) as db:
        await db.execute("DELETE FROM beta_codes WHERE email=?", (email,))
        await db.execute(
            "INSERT INTO beta_codes (email, code, created_at, expires_at) VALUES (?,?,?,?)",
            (email, code, now, now + 900)
        )
        await db.commit()
    try:
        await asyncio.to_thread(
            send_email,
            email,
            "Your codexyy beta code",
            BETA_CODE_EMAIL_HTML.replace("{code}", code),
            f"Your codexyy beta verification code: {code}\n\nExpires in 15 minutes.",
        )
    except Exception:
        await enqueue_operation(
            "email",
            email_operation_payload(email,"Your codexyy beta code",BETA_CODE_EMAIL_HTML.replace("{code}", code),f"Your codexyy beta verification code: {code}\n\nExpires in 15 minutes."),
            delay=10,
        )
        return {"ok": True, "queued": True}
    return {"ok": True, "queued": False}

@app.post("/api/beta/verify")
async def beta_verify(body: BetaVerify):
    email = body.email.strip().lower()
    now = int(time.time())
    async with aiosqlite.connect(DB) as db:
        async with db.execute(
            "SELECT code, expires_at, used FROM beta_codes WHERE email=? ORDER BY created_at DESC LIMIT 1",
            (email,)
        ) as cur:
            row = await cur.fetchone()
        if not row:
            raise HTTPException(400, "No code found — request a new one")
        stored_code, expires_at, used = row
        if used:
            raise HTTPException(400, "Code already used")
        if now > expires_at:
            raise HTTPException(400, "Code expired")
        if body.code.strip() != stored_code:
            raise HTTPException(400, "Wrong code")
        await db.execute("UPDATE beta_codes SET used=1 WHERE email=?", (email,))
        token = secrets.token_urlsafe(32)
        await db.execute(
            "INSERT OR REPLACE INTO beta_access (token, email, created_at) VALUES (?,?,?)",
            (token, email, now)
        )
        await db.commit()
    return {"ok": True, "token": token}

@app.get("/api/beta/check")
async def beta_check(request: Request):
    token = request.headers.get("x-beta-token", "")
    if not token:
        raise HTTPException(401, "No token")
    async with aiosqlite.connect(DB) as db:
        async with db.execute("SELECT email FROM beta_access WHERE token=?", (token,)) as cur:
            row = await cur.fetchone()
    if not row:
        raise HTTPException(401, "Invalid token")
    return {"ok": True, "email": row[0]}

@app.post("/api/waitlist")
async def join_waitlist(body: WaitlistEntry):
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "Invalid email")
    already_exists = False
    async with aiosqlite.connect(DB) as db:
        try:
            await db.execute("INSERT INTO waitlist VALUES (?,?)", (email, int(time.time())))
            await db.commit()
        except Exception:
            already_exists = True
    if not already_exists:
        try:
            await asyncio.to_thread(
                send_email,
                email,
                "You're on the codexyy playground waitlist",
                WAITLIST_EMAIL_HTML,
                "You're on the waitlist!\n\nWe'll email you the moment codexyy playground goes live.\n\n— platform@codexyy.dev",
            )
        except Exception:
            await enqueue_operation(
                "email",
                email_operation_payload(email,"You're on the codexyy playground waitlist",WAITLIST_EMAIL_HTML,"You're on the waitlist!\n\nWe'll email you the moment codexyy playground goes live.\n\n— platform@codexyy.dev"),
            )
    return {"ok": True}

class PasteCreate(BaseModel):
    content: str
    title: str = ""
    language: str = "plaintext"
    private: bool = False
    expires_hours: int = 0

@app.post("/api/paste")
async def create_paste(body: PasteCreate, user=Depends(require_auth)):
    pid = short_id()
    now = int(time.time())
    expires = now + body.expires_hours * 3600 if body.expires_hours else None
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "INSERT INTO pastes (id,title,content,language,created_at,expires_at,private,views,user_id) VALUES (?,?,?,?,?,?,?,?,?)",
            (pid, body.title, body.content, body.language, now, expires, int(body.private), 0, user["id"])
        )
        await db.commit()
    return {"id": pid, "url": f"https://codexyy.dev/play/{pid}"}

@app.get("/api/paste/{pid}")
async def get_paste(pid: str, request: Request):
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token:
        token = request.cookies.get("cxy_token", "")
    viewer = await get_user_by_token(token) if token else None

    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM pastes WHERE id=?", (pid,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Paste not found")
        now = int(time.time())
        if row["expires_at"] and now > row["expires_at"]:
            raise HTTPException(410, "Paste expired")
        await db.execute("UPDATE pastes SET views=views+1 WHERE id=?", (pid,))
        await db.commit()
        data = dict(row)
        data["is_owner"] = bool(viewer and row["user_id"] and viewer["id"] == row["user_id"])
        data["starred"] = False
        # Author info
        if row["user_id"]:
            ucur = await db.execute("SELECT name, avatar FROM users WHERE id=?", (row["user_id"],))
            urow = await ucur.fetchone()
            if urow:
                data["author_name"] = urow["name"]
                data["author_avatar"] = urow["avatar"]
        if viewer:
            scur = await db.execute(
                "SELECT 1 FROM paste_stars WHERE paste_id=? AND user_id=?", (pid, viewer["id"])
            )
            data["starred"] = bool(await scur.fetchone())
        return data

class PasteUpdate(BaseModel):
    content: str
    language: str = ""

@app.patch("/api/paste/{pid}")
async def update_paste(pid: str, body: PasteUpdate, user=Depends(require_auth)):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT user_id FROM pastes WHERE id=?", (pid,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Paste not found")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "Not the owner")
        fields = "content=?"
        params: list = [body.content]
        if body.language:
            fields += ", language=?"
            params.append(body.language)
        params.append(pid)
        await db.execute(f"UPDATE pastes SET {fields} WHERE id=?", params)
        await db.commit()
    return {"ok": True}

@app.post("/api/paste/{pid}/star")
async def star_paste(pid: str, user=Depends(require_auth)):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT id FROM pastes WHERE id=?", (pid,))
        if not await cur.fetchone():
            raise HTTPException(404, "Not found")
        try:
            await db.execute(
                "INSERT INTO paste_stars (paste_id, user_id, created_at) VALUES (?,?,?)",
                (pid, user["id"], int(time.time()))
            )
            await db.execute("UPDATE pastes SET star_count=star_count+1 WHERE id=?", (pid,))
            await db.commit()
            return {"starred": True}
        except Exception:
            # Already starred — unstar
            await db.execute("DELETE FROM paste_stars WHERE paste_id=? AND user_id=?", (pid, user["id"]))
            await db.execute("UPDATE pastes SET star_count=MAX(0,star_count-1) WHERE id=?", (pid,))
            await db.commit()
            return {"starred": False}

@app.post("/api/paste/{pid}/fork")
async def fork_paste(pid: str, user=Depends(require_auth)):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM pastes WHERE id=?", (pid,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        new_id = short_id(8)
        now = int(time.time())
        await db.execute(
            "INSERT INTO pastes (id,title,content,language,created_at,expires_at,private,views,user_id,star_count,fork_count) VALUES (?,?,?,?,?,?,0,0,?,0,0)",
            (new_id, f"Fork of {row['title'] or pid}", row["content"], row["language"], now, row["expires_at"], user["id"])
        )
        await db.execute("UPDATE pastes SET fork_count=fork_count+1 WHERE id=?", (pid,))
        await db.execute(
            "INSERT INTO paste_forks (id, parent_id, user_id, created_at) VALUES (?,?,?,?)",
            (new_id, pid, user["id"], now)
        )
        await db.commit()
    return {"id": new_id}

# ─── Repos ────────────────────────────────────────────────────────────────────

LANG_DEFAULTS: dict[str, str] = {
    "python":     'print("Hello, world!")\n',
    "javascript": 'console.log("Hello, world!")\n',
    "typescript": 'console.log("Hello, world!")\n',
    "go":         'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, world!")\n}\n',
    "rust":       'fn main() {\n    println!("Hello, world!");\n}\n',
    "c":          '#include <stdio.h>\nint main() {\n    printf("Hello, world!\\n");\n    return 0;\n}\n',
    "c++":        '#include <iostream>\nint main() {\n    std::cout << "Hello, world!\\n";\n    return 0;\n}\n',
    "java":       'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, world!");\n    }\n}\n',
    "ruby":       'puts "Hello, world!"\n',
    "php":        '<?php\necho "Hello, world!\\n";\n',
    "swift":      'print("Hello, world!")\n',
    "kotlin":     'fun main() { println("Hello, world!") }\n',
    "bash":       'echo "Hello, world!"\n',
    "lua":        'print("Hello, world!")\n',
    "r":          'cat("Hello, world!\\n")\n',
}
LANG_ENTRY: dict[str, str] = {
    "python": "main.py", "javascript": "main.js", "typescript": "main.ts",
    "go": "main.go", "rust": "main.rs", "c": "main.c", "c++": "main.cpp",
    "java": "Main.java", "ruby": "main.rb", "php": "main.php",
    "swift": "main.swift", "kotlin": "main.kt", "bash": "main.sh",
    "lua": "main.lua", "r": "main.r",
}

class RepoCreate(BaseModel):
    name: str
    description: str = ""
    language: str = "python"
    private: bool = False

class RepoUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    private: bool | None = None

class RepoFileSave(BaseModel):
    files: list[dict]
    message: str = ""          # commit message; blank -> auto-generated
    branch: str = ""           # blank -> repo default branch
    prune: bool = True         # delete paths absent from `files`

class BranchCreate(BaseModel):
    name: str
    from_branch: str = ""

# ─── Gitea-backed repo helpers ────────────────────────────────────────────────
# Git is the source of truth for file content. codexyy's `repos` row is the
# product metadata (display name, language, stars, forks, packages) and the
# pointer to the Gitea repo. `repo_files` is retained read-only as the
# pre-migration backup and is no longer written to.

async def repo_row(rid: str) -> dict:
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM repos WHERE id=?", (rid,))
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Repo not found")
    return dict(row)

async def repo_owned_by(rid: str, user: dict) -> dict:
    repo = await repo_row(rid)
    if repo["user_id"] != user["id"]:
        raise HTTPException(403, "Not owner")
    return repo

async def gitea_login_for(user: dict) -> str:
    """Gitea account for a codexyy user, provisioned on first use."""
    try:
        return await gitea.ensure_user(user)
    except gitea.GiteaError as e:
        raise HTTPException(502, f"git backend unavailable: {e.message}")

async def repo_owner_login(repo: dict) -> str:
    """Gitea owner login for a repo row, backfilling the cache column."""
    if repo.get("gitea_owner"):
        return repo["gitea_owner"]
    login = gitea.gitea_username(repo["user_id"])
    async with aiosqlite.connect(DB) as db:
        await db.execute("UPDATE repos SET gitea_owner=? WHERE id=?", (login, repo["id"]))
        await db.commit()
    return login

async def refresh_repo_stats(rid: str, login: str, branch: str) -> dict:
    """Re-cache file/commit counts after a write so listings stay cheap."""
    try:
        files = await gitea.list_tree(login, rid, branch)
        cs = await gitea.commits(login, rid, branch=branch, limit=1)
        n_files = len(files)
    except gitea.GiteaError:
        return {}
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT commit_count FROM repos WHERE id=?", (rid,))
        row = await cur.fetchone()
        prev = (row[0] if row else 0) or 0
        n_commits = prev + 1 if cs else prev
        await db.execute(
            "UPDATE repos SET file_count=?, commit_count=?, updated_at=? WHERE id=?",
            (n_files, n_commits, int(time.time()), rid))
        await db.commit()
    return {"file_count": n_files, "commit_count": n_commits}

def guard_gitea(e: Exception):
    if isinstance(e, gitea.GiteaError):
        if e.status == 404:
            raise HTTPException(404, "Not found in git backend")
        raise HTTPException(502, f"git backend: {e.message}")
    raise e

@app.post("/api/repos")
async def create_repo(body: RepoCreate, user=Depends(require_auth)):
    rid = short_id(10)
    now = int(time.time())
    name = body.name.strip()[:64]
    if not name:
        raise HTTPException(400, "Name required")
    entry = LANG_ENTRY.get(body.language, "main.py")
    content = LANG_DEFAULTS.get(body.language, f"# {name}\n")
    safe_name = re.sub(r'[^a-z0-9_\-]', '-', name.lower())
    scaffold: list[dict] = [{"path": entry, "content": content}]
    if body.language == "go":
        scaffold.append({"path": "go.mod", "content": f"module {safe_name}\n\ngo 1.21\n"})
    elif body.language in ("javascript", "typescript"):
        scaffold.append({"path": "package.json",
                         "content": f'{{"name":"{safe_name}","version":"1.0.0","main":"{entry}"}}\n'})
    scaffold.append({"path": "README.md",
                     "content": f"# {name}\n\n{body.description.strip()}\n"})

    login = await gitea_login_for(user)
    try:
        await gitea.create_repo(login, rid, description=body.description[:255],
                                private=body.private)
        await gitea.sync_files(login, rid, scaffold,
                               message=f"Add {body.language} project scaffold",
                               author_name=user.get("name") or login,
                               author_email=user.get("email", ""))
    except Exception as e:
        try: await gitea.delete_repo(login, rid)   # don't leak a half-made repo
        except Exception: pass
        guard_gitea(e)

    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "INSERT INTO repos (id,user_id,name,description,language,private,star_count,fork_count,created_at,updated_at,gitea_owner,default_branch,file_count,commit_count,migrated) "
            "VALUES (?,?,?,?,?,?,0,0,?,?,?,?,?,?,1)",
            (rid, user["id"], name, body.description[:256], body.language,
             int(body.private), now, now, login, gitea.DEFAULT_BRANCH,
             len(scaffold), 2)
        )
        await db.commit()
    return {"id": rid}

@app.get("/api/repos/mine")
async def my_repos(user=Depends(require_auth)):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT id,name,description,language,private,star_count,fork_count,"
            "created_at,updated_at,file_count,commit_count,default_branch "
            "FROM repos WHERE user_id=? ORDER BY updated_at DESC",
            (user["id"],)
        )
        return [dict(r) for r in await cur.fetchall()]

@app.get("/api/repos/public")
async def public_repos(limit: int = 30, q: str = ""):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        if q:
            like = f"%{q.strip()[:64]}%"
            cur = await db.execute("""
                SELECT r.id,r.name,r.description,r.language,r.star_count,r.fork_count,r.updated_at,
                       u.name as author_name, u.avatar as author_avatar
                FROM repos r LEFT JOIN users u ON r.user_id=u.id
                WHERE r.private=0 AND (r.name LIKE ? OR r.description LIKE ?)
                ORDER BY r.star_count DESC, r.updated_at DESC LIMIT ?
            """, (like, like, min(limit, 100)))
        else:
            cur = await db.execute("""
                SELECT r.id,r.name,r.description,r.language,r.star_count,r.fork_count,r.updated_at,
                       u.name as author_name, u.avatar as author_avatar
                FROM repos r LEFT JOIN users u ON r.user_id=u.id
                WHERE r.private=0 ORDER BY r.star_count DESC, r.updated_at DESC LIMIT ?
            """, (min(limit, 100),))
        return [dict(r) for r in await cur.fetchall()]

@app.get("/api/repos/{rid}")
async def get_repo(rid: str, request: Request, ref: str = ""):
    token = request.cookies.get("cxy_token", "")
    viewer = await get_user_by_token(token) if token else None
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM repos WHERE id=?", (rid,))
        repo = await cur.fetchone()
        if not repo:
            raise HTTPException(404, "Repo not found")
        repo = dict(repo)
        if repo["private"] and (not viewer or viewer["id"] != repo["user_id"]):
            raise HTTPException(403, "Private repo")
        ucur = await db.execute("SELECT name,avatar FROM users WHERE id=?", (repo["user_id"],))
        urow = await ucur.fetchone()
        repo["is_owner"] = bool(viewer and viewer["id"] == repo["user_id"])
        repo["author_name"] = urow["name"] if urow else None
        repo["author_avatar"] = urow["avatar"] if urow else None
        try: repo["packages"] = json.loads(repo.get("packages") or "[]")
        except Exception: repo["packages"] = []
        repo["starred"] = False
        if viewer:
            scur = await db.execute("SELECT 1 FROM repo_stars WHERE repo_id=? AND user_id=?", (rid, viewer["id"]))
            repo["starred"] = bool(await scur.fetchone())

    # File content comes from git, not the DB.
    login = await repo_owner_login(repo)
    branch = ref or repo.get("default_branch") or gitea.DEFAULT_BRANCH
    try:
        repo["files"] = await gitea.read_tree_with_content(login, rid, branch)
        repo["branches"] = await gitea.branches(login, rid)
        repo["commits"] = await gitea.commits(login, rid, branch=branch, limit=10)
    except gitea.GiteaError as e:
        if e.status == 404:
            # Row exists but git repo does not (pre-migration or deleted upstream).
            repo["files"], repo["branches"], repo["commits"] = [], [], []
            repo["git_missing"] = True
        else:
            raise HTTPException(502, f"git backend: {e.message}")
    repo["branch"] = branch
    return repo

@app.get("/api/repos/{rid}/file")
async def get_repo_file(rid: str, path: str, request: Request, ref: str = ""):
    """Single file at a given ref — used for lazy-loading large trees."""
    token = request.cookies.get("cxy_token", "")
    viewer = await get_user_by_token(token) if token else None
    repo = await repo_row(rid)
    if repo["private"] and (not viewer or viewer["id"] != repo["user_id"]):
        raise HTTPException(403, "Private repo")
    login = await repo_owner_login(repo)
    branch = ref or repo.get("default_branch") or gitea.DEFAULT_BRANCH
    try:
        return {"path": path, "ref": branch,
                "content": await gitea.read_file(login, rid, path, branch)}
    except Exception as e:
        guard_gitea(e)

@app.get("/api/repos/{rid}/commits")
async def repo_commits(rid: str, request: Request, ref: str = "",
                       page: int = 1, limit: int = 30):
    token = request.cookies.get("cxy_token", "")
    viewer = await get_user_by_token(token) if token else None
    repo = await repo_row(rid)
    if repo["private"] and (not viewer or viewer["id"] != repo["user_id"]):
        raise HTTPException(403, "Private repo")
    login = await repo_owner_login(repo)
    branch = ref or repo.get("default_branch") or gitea.DEFAULT_BRANCH
    try:
        return await gitea.commits(login, rid, branch=branch, page=page,
                                   limit=min(limit, 100))
    except Exception as e:
        guard_gitea(e)

@app.get("/api/repos/{rid}/commits/{sha}/diff")
async def repo_commit_diff(rid: str, sha: str, request: Request):
    token = request.cookies.get("cxy_token", "")
    viewer = await get_user_by_token(token) if token else None
    repo = await repo_row(rid)
    if repo["private"] and (not viewer or viewer["id"] != repo["user_id"]):
        raise HTTPException(403, "Private repo")
    login = await repo_owner_login(repo)
    if not re.fullmatch(r"[0-9a-fA-F]{6,40}", sha):
        raise HTTPException(400, "Bad sha")
    try:
        return {"sha": sha, "diff": await gitea.commit_diff(login, rid, sha)}
    except Exception as e:
        guard_gitea(e)

@app.get("/api/repos/{rid}/branches")
async def repo_branches(rid: str, request: Request):
    token = request.cookies.get("cxy_token", "")
    viewer = await get_user_by_token(token) if token else None
    repo = await repo_row(rid)
    if repo["private"] and (not viewer or viewer["id"] != repo["user_id"]):
        raise HTTPException(403, "Private repo")
    login = await repo_owner_login(repo)
    try:
        return await gitea.branches(login, rid)
    except Exception as e:
        guard_gitea(e)

@app.post("/api/repos/{rid}/branches")
async def repo_create_branch(rid: str, body: BranchCreate, user=Depends(require_auth)):
    repo = await repo_owned_by(rid, user)
    login = await repo_owner_login(repo)
    name = re.sub(r"[^A-Za-z0-9._/\-]", "-", body.name.strip())[:64]
    if not name:
        raise HTTPException(400, "Branch name required")
    src = body.from_branch or repo.get("default_branch") or gitea.DEFAULT_BRANCH
    try:
        await gitea.create_branch(login, rid, name, src)
    except Exception as e:
        guard_gitea(e)
    return {"name": name, "from": src}

@app.delete("/api/repos/{rid}/branches/{name:path}")
async def repo_delete_branch(rid: str, name: str, user=Depends(require_auth)):
    repo = await repo_owned_by(rid, user)
    login = await repo_owner_login(repo)
    if name == (repo.get("default_branch") or gitea.DEFAULT_BRANCH):
        raise HTTPException(400, "Cannot delete the default branch")
    try:
        await gitea.delete_branch(login, rid, name)
    except Exception as e:
        guard_gitea(e)
    return {"ok": True}

@app.patch("/api/repos/{rid}")
async def update_repo_meta(rid: str, body: RepoUpdate, user=Depends(require_auth)):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT user_id FROM repos WHERE id=?", (rid,))
        row = await cur.fetchone()
        if not row or row[0] != user["id"]:
            raise HTTPException(403, "Not owner")
        sets, params = [], []
        if body.name is not None:
            sets.append("name=?"); params.append(body.name[:64])
        if body.description is not None:
            sets.append("description=?"); params.append(body.description[:256])
        if body.private is not None:
            sets.append("private=?"); params.append(int(body.private))
        if sets:
            sets.append("updated_at=?"); params.append(int(time.time()))
            params.append(rid)
            await db.execute(f"UPDATE repos SET {','.join(sets)} WHERE id=?", params)
            await db.commit()
    # Mirror description/visibility onto the git repo (name stays the repo id).
    if body.description is not None or body.private is not None:
        repo = await repo_row(rid)
        login = await repo_owner_login(repo)
        try:
            await gitea.set_repo_meta(login, rid, description=body.description,
                                      private=body.private)
        except gitea.GiteaError:
            await enqueue_operation(
                "repo_metadata",
                {
                    "login": login,
                    "rid": rid,
                    "description": body.description,
                    "private": body.private,
                },
            )
    return {"ok": True}

@app.delete("/api/repos/{rid}")
async def delete_repo(rid: str, user=Depends(require_auth)):
    repo = await repo_owned_by(rid, user)
    login = await repo_owner_login(repo)
    try:
        await gitea.delete_repo(login, rid)
    except gitea.GiteaError as e:
        raise HTTPException(502, f"git backend: {e.message}")
    async with aiosqlite.connect(DB) as db:
        await db.execute("DELETE FROM repo_files WHERE repo_id=?", (rid,))
        await db.execute("DELETE FROM repo_stars WHERE repo_id=?", (rid,))
        await db.execute("DELETE FROM repos WHERE id=?", (rid,))
        await db.commit()
    return {"ok": True}

@app.put("/api/repos/{rid}/files")
async def save_repo_files(rid: str, body: RepoFileSave, user=Depends(require_auth)):
    """
    Save the editor buffer as one real git commit. Files that did not change
    produce no commit at all, so history stays meaningful.
    """
    repo = await repo_owned_by(rid, user)
    login = await repo_owner_login(repo)
    branch = body.branch or repo.get("default_branch") or gitea.DEFAULT_BRANCH

    clean = []
    for f in body.files[:200]:
        path = str(f.get("path", "")).strip().strip("/")[:200]
        if not path or ".." in path.split("/") or path.startswith(".git/"):
            continue
        clean.append({"path": path, "content": str(f.get("content", ""))[:500_000]})

    msg = (body.message or "").strip() or f"Update {len(clean)} file(s) from codexyy"
    try:
        res = await gitea.sync_files(login, rid, clean, message=msg, branch=branch,
                                     author_name=user.get("name") or login,
                                     author_email=user.get("email", ""),
                                     prune=body.prune)
    except Exception as e:
        if not isinstance(e, gitea.GiteaError) or e.status in (408, 429) or e.status >= 500:
            try:
                job_id = await enqueue_operation(
                    "repo_sync",
                    {
                        "login": login, "rid": rid, "files": clean, "message": msg,
                        "branch": branch, "author_name": user.get("name") or login,
                        "author_email": user.get("email", ""), "prune": body.prune,
                    },
                )
            except RuntimeError:
                guard_gitea(e)
            return JSONResponse({"ok": True, "queued": True, "job_id": job_id}, status_code=202)
        guard_gitea(e)

    stats = await refresh_repo_stats(rid, login, branch)
    commit = res.get("commit") or {}
    return {"ok": True, "changed": res.get("changed", 0),
            "commit": {"sha": commit.get("sha", ""),
                       "short_sha": (commit.get("sha") or "")[:7],
                       "message": msg} if commit else None,
            **stats}

PY_STDLIB = {
    "abc","argparse","array","ast","asyncio","base64","bisect","builtins","bz2",
    "calendar","collections","colorsys","concurrent","configparser","contextlib","copy","csv","ctypes",
    "dataclasses","datetime","decimal","difflib","dis","email","enum","errno",
    "fnmatch","fractions","functools","gc","getopt","glob","gzip","hashlib","heapq","hmac","html","http",
    "importlib","inspect","io","ipaddress","itertools","json","keyword","logging","math","mimetypes",
    "multiprocessing","numbers","operator","os","pathlib","pickle","pkgutil","platform","plistlib","posixpath",
    "pprint","queue","random","re","secrets","select","selectors","shutil","signal","site","socket",
    "socketserver","sqlite3","ssl","stat","statistics","string","struct","subprocess","sys","sysconfig",
    "tarfile","tempfile","textwrap","threading","time","timeit","token","tokenize","traceback","types",
    "typing","unicodedata","unittest","urllib","uuid","venv","warnings","weakref","wsgiref","xml","xmlrpc",
    "zipfile","zipimport","zlib","__future__","string","tkinter","turtle","wave",
}

PKG_NAME_MAP = {  # import name -> pip name
    "cv2": "opencv-python", "PIL": "pillow", "yaml": "pyyaml",
    "sklearn": "scikit-learn", "bs4": "beautifulsoup4", "Crypto": "pycryptodome",
    "skimage": "scikit-image", "serial": "pyserial",
}

class RepoPackages(BaseModel):
    packages: list[str]

@app.put("/api/repos/{rid}/packages")
async def set_repo_packages(rid: str, body: RepoPackages, user=Depends(require_auth)):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT user_id FROM repos WHERE id=?", (rid,))
        row = await cur.fetchone()
        if not row or row[0] != user["id"]:
            raise HTTPException(403, "Not owner")
        clean = [p.strip() for p in body.packages if p.strip() and re.match(r'^[a-zA-Z0-9_\-\.\[\]]+$', p.strip())][:30]
        await db.execute("UPDATE repos SET packages=?, updated_at=? WHERE id=?",
                         (json.dumps(clean), int(time.time()), rid))
        await db.commit()
    return {"packages": clean}

@app.post("/api/repos/{rid}/scan")
async def scan_repo_imports(rid: str, user=Depends(require_auth)):
    repo = await repo_owned_by(rid, user)
    login = await repo_owner_login(repo)
    branch = repo.get("default_branch") or gitea.DEFAULT_BRANCH
    try:
        files = await gitea.read_tree_with_content(login, rid, branch)
    except Exception as e:
        guard_gitea(e)
    found: set[str] = set()
    for f in files:
        if not f["path"].endswith(".py"):
            continue
        for m in re.finditer(r'(?:^|\n)\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)', f["content"]):
            mod = m.group(1)
            if mod in PY_STDLIB:
                continue
            found.add(PKG_NAME_MAP.get(mod, mod))
    return {"detected": sorted(found)}

@app.post("/api/repos/{rid}/star")
async def star_repo(rid: str, user=Depends(require_auth)):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT id FROM repos WHERE id=?", (rid,))
        if not await cur.fetchone():
            raise HTTPException(404, "Not found")
        try:
            await db.execute(
                "INSERT INTO repo_stars (repo_id, user_id, created_at) VALUES (?,?,?)",
                (rid, user["id"], int(time.time()))
            )
            await db.execute("UPDATE repos SET star_count=star_count+1 WHERE id=?", (rid,))
            await db.commit()
            return {"starred": True}
        except Exception:
            await db.execute("DELETE FROM repo_stars WHERE repo_id=? AND user_id=?", (rid, user["id"]))
            await db.execute("UPDATE repos SET star_count=MAX(0,star_count-1) WHERE id=?", (rid,))
            await db.commit()
            return {"starred": False}

@app.post("/api/repos/{rid}/fork")
async def fork_repo(rid: str, user=Depends(require_auth)):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM repos WHERE id=?", (rid,))
        repo = await cur.fetchone()
        if not repo:
            raise HTTPException(404, "Not found")
        if repo["private"] and repo["user_id"] != user["id"]:
            raise HTTPException(403, "Private repo")
        repo = dict(repo)

    new_id = short_id(10)
    now = int(time.time())
    src_login = await repo_owner_login(repo)
    dst_login = await gitea_login_for(user)

    # A real git fork: full history preserved, not a content copy.
    try:
        await gitea.fork_repo(src_login, rid, dst_login, new_id)
    except Exception as e:
        guard_gitea(e)

    branch = repo.get("default_branch") or gitea.DEFAULT_BRANCH
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "INSERT INTO repos (id,user_id,name,description,language,private,star_count,fork_count,created_at,updated_at,gitea_owner,default_branch,file_count,commit_count,migrated) "
            "VALUES (?,?,?,?,?,0,0,0,?,?,?,?,?,?,1)",
            (new_id, user["id"], f"Fork of {repo['name']}", repo["description"],
             repo["language"], now, now, dst_login, branch,
             repo.get("file_count") or 0, repo.get("commit_count") or 0)
        )
        await db.execute("UPDATE repos SET fork_count=fork_count+1 WHERE id=?", (rid,))
        await db.commit()
    return {"id": new_id}

@app.websocket("/ws/shell/{rid}")
async def ws_shell(ws: WebSocket, rid: str):
    await ws.accept()
    proc: asyncio.subprocess.Process | None = None
    tmpdir = f"/tmp/cxy_sh_{secrets.token_hex(6)}"
    try:
        token = ws.cookies.get("cxy_token", "")
        user = await get_user_by_token(token) if token else None
        if not user:
            await ws.send_json({"type": "stderr", "data": "auth required\n"})
            await ws.close(); return

        async with aiosqlite.connect(DB) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute("SELECT * FROM repos WHERE id=?", (rid,))
            row = await cur.fetchone()
            if not row or row["user_id"] != user["id"]:
                await ws.send_json({"type": "stderr", "data": "forbidden\n"})
                await ws.close(); return
            repo = dict(row)

        # Working tree is materialised from git, not from the DB.
        login = await repo_owner_login(repo)
        branch = repo.get("default_branch") or gitea.DEFAULT_BRANCH
        try:
            files = await gitea.read_tree_with_content(login, rid, branch)
        except gitea.GiteaError as e:
            await ws.send_json({"type": "stderr", "data": f"git backend: {e.message}\n"})
            await ws.close(); return

        # Set up tmpdir with all files
        mk = await asyncio.create_subprocess_exec("docker","exec","piston","mkdir","-p",tmpdir,
            stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL)
        await mk.wait()
        for f in files:
            fname = f["path"].strip("/")
            if not fname or ".." in fname: continue
            fpath = f"{tmpdir}/{fname}"
            fdir = fpath.rsplit("/",1)[0]
            if fdir != tmpdir:
                sub = await asyncio.create_subprocess_exec("docker","exec","piston","mkdir","-p",fdir,
                    stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL)
                await sub.wait()
            wp = await asyncio.create_subprocess_exec("docker","exec","-i","piston","sh","-c",f"cat > {shlex.quote(fpath)}",
                stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL)
            wp.stdin.write(f["content"].encode())
            wp.stdin.close()
            await wp.wait()

        # Spawn bash with merged stderr -> stdout for cleaner streaming
        proc = await asyncio.create_subprocess_exec(
            "docker","exec","-i","piston","bash","--noprofile","--norc","-i",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        proc.stdin.write(f"cd {tmpdir}\nexport PS1='\\n$ '\nclear\n".encode())
        await proc.stdin.drain()

        await ws.send_json({"type": "ready", "cwd": tmpdir})

        async def reader():
            while True:
                chunk = await proc.stdout.read(512)
                if not chunk: break
                try:
                    await ws.send_json({"type": "stdout", "data": chunk.decode("utf-8", errors="replace")})
                except Exception:
                    break

        async def writer():
            while True:
                try:
                    msg = await ws.receive_json()
                except Exception:
                    break
                if msg.get("type") == "stdin":
                    data = msg.get("data", "")
                    if proc.stdin and not proc.stdin.is_closing():
                        try:
                            proc.stdin.write(data.encode())
                            await proc.stdin.drain()
                        except Exception:
                            break
                elif msg.get("type") == "kill":
                    if proc.returncode is None:
                        proc.kill()
                    break

        await asyncio.wait(
            [asyncio.create_task(reader()), asyncio.create_task(writer())],
            return_when=asyncio.FIRST_COMPLETED,
        )
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try: await ws.send_json({"type": "stderr", "data": f"{e}\n"})
        except Exception: pass
    finally:
        if proc and proc.returncode is None:
            try: proc.kill()
            except Exception: pass
        await asyncio.create_subprocess_exec("docker","exec","piston","rm","-rf",tmpdir,
            stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL)

class GithubImport(BaseModel):
    url: str
    private: bool = False

@app.post("/api/repos/import")
async def import_github(body: GithubImport, user=Depends(require_auth)):
    m = re.match(r'(?:https?://)?(?:www\.)?github\.com/([^/]+)/([^/?#]+)', body.url.strip())
    if not m:
        raise HTTPException(400, "Invalid GitHub URL")
    owner, name = m.group(1), m.group(2).rstrip("/").removesuffix(".git")
    lang_map = {"c++": "c++", "javascript": "javascript", "typescript": "typescript",
                "python": "python", "go": "go", "rust": "rust", "c": "c",
                "java": "java", "ruby": "ruby", "php": "php", "swift": "swift",
                "kotlin": "kotlin", "shell": "bash", "lua": "lua", "r": "r"}

    # Metadata only — the content arrives via a real git clone below, so the
    # old 40-file / 200 KB ceiling and the binary-file skip list are both gone.
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        r = await client.get(f"https://api.github.com/repos/{owner}/{name}")
        if r.status_code != 200:
            raise HTTPException(400, f"GitHub API: {r.status_code}")
    meta = r.json()
    branch = meta.get("default_branch", "main")
    repo_lang = lang_map.get((meta.get("language") or "python").lower(), "python")

    rid = short_id(10)
    now = int(time.time())
    login = await gitea_login_for(user)
    try:
        await gitea.migrate(login, rid, f"https://github.com/{owner}/{name}.git",
                            description=(meta.get("description") or "")[:255],
                            private=body.private)
    except Exception as e:
        if not isinstance(e, gitea.GiteaError) or e.status in (408, 429) or e.status >= 500:
            async with aiosqlite.connect(DB) as db:
                await db.execute(
                    """INSERT INTO repos
                       (id,user_id,name,description,language,private,star_count,fork_count,
                        created_at,updated_at,gitea_owner,default_branch,file_count,commit_count,migrated)
                       VALUES (?,?,?,?,?,?,0,0,?,?,?,?,0,0,0)""",
                    (rid, user["id"], name[:64], (meta.get("description") or "")[:256],
                     repo_lang, int(body.private), now, now, login, branch),
                )
                await db.commit()
            job_id = await enqueue_operation(
                "github_import",
                {
                    "login": login, "rid": rid,
                    "clone_url": f"https://github.com/{owner}/{name}.git",
                    "description": (meta.get("description") or "")[:255],
                    "private": body.private, "branch": branch,
                },
            )
            return JSONResponse({"id": rid, "queued": True, "job_id": job_id}, status_code=202)
        guard_gitea(e)

    try:
        n_files = len(await gitea.list_tree(login, rid, branch))
    except gitea.GiteaError:
        branch = gitea.DEFAULT_BRANCH
        n_files = len(await gitea.list_tree(login, rid, branch))

    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "INSERT INTO repos (id,user_id,name,description,language,private,star_count,fork_count,created_at,updated_at,gitea_owner,default_branch,file_count,migrated) "
            "VALUES (?,?,?,?,?,?,0,0,?,?,?,?,?,1)",
            (rid, user["id"], name[:64], (meta.get("description") or "")[:256],
             repo_lang, int(body.private), now, now, login, branch, n_files)
        )
        await db.commit()
    return {"id": rid, "files": n_files, "branch": branch, "full_history": True}

@app.get("/api/pastes/mine")
async def my_pastes(user=Depends(require_auth)):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT id,title,language,created_at,views,star_count,fork_count,private FROM pastes WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
            (user["id"],)
        )
        return [dict(r) for r in await cur.fetchall()]

@app.delete("/api/paste/{pid}")
async def delete_paste_ep(pid: str, user=Depends(require_auth)):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT user_id FROM pastes WHERE id=?", (pid,))
        row = await cur.fetchone()
        if not row or row[0] != user["id"]:
            raise HTTPException(403, "Not owner")
        await db.execute("DELETE FROM pastes WHERE id=?", (pid,))
        await db.commit()
    return {"ok": True}

PYTHON_AUDIO_SHIM = r'''
import os, sys, base64, mimetypes, json
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")

def _emit(o):
    try:
        sys.stdout.write("\x00CXY_AUD:" + json.dumps(o) + "\n")
        sys.stdout.flush()
    except Exception: pass

class _M:
    @staticmethod
    def load(path):
        try:
            with open(path,"rb") as f: data = base64.b64encode(f.read()).decode("ascii")
            mime = mimetypes.guess_type(str(path))[0] or "audio/mpeg"
            _emit({"cmd":"load","mime":mime,"data":data})
        except Exception as e:
            sys.stderr.write("[cxy audio] " + str(e) + "\n")
    @staticmethod
    def play(*a,**k): _emit({"cmd":"play"})
    @staticmethod
    def stop():      _emit({"cmd":"stop"})
    @staticmethod
    def pause():     _emit({"cmd":"pause"})
    @staticmethod
    def unpause():   _emit({"cmd":"play"})
    @staticmethod
    def set_volume(v): _emit({"cmd":"vol","v":float(v)})
    @staticmethod
    def get_volume(): return 1.0
    @staticmethod
    def get_busy():  return False
    @staticmethod
    def get_pos():   return 0
    @staticmethod
    def queue(p):    _M.load(p)
    @staticmethod
    def fadeout(t):  _emit({"cmd":"stop"})
    @staticmethod
    def rewind():    pass

class _Ch:
    def play(self,*a,**k): pass
    def stop(self): pass
    def pause(self): pass
    def unpause(self): pass
    def set_volume(self,v): pass
    def get_volume(self): return 1.0
    def get_busy(self): return False
    def queue(self,s): pass

class _S:
    def __init__(self, src):
        self._data = None; self._mime = "audio/wav"
        try:
            if isinstance(src, (str, bytes, os.PathLike)):
                with open(src,"rb") as f: self._data = base64.b64encode(f.read()).decode("ascii")
                self._mime = mimetypes.guess_type(str(src))[0] or "audio/wav"
        except Exception as e:
            sys.stderr.write("[cxy audio] " + str(e) + "\n")
    def play(self,*a,**k):
        if self._data: _emit({"cmd":"sfx","mime":self._mime,"data":self._data})
        return _Ch()
    def stop(self): pass
    def set_volume(self,v): pass
    def get_volume(self): return 1.0
    def get_length(self): return 0.0
    def get_num_channels(self): return 0
    def get_raw(self): return b""

try:
    import pygame, pygame.mixer
    pygame.mixer.music = _M
    pygame.mixer.init = lambda *a,**k: None
    pygame.mixer.quit = lambda: None
    pygame.mixer.pre_init = lambda *a,**k: None
    pygame.mixer.get_init = lambda: (44100,-16,2)
    pygame.mixer.Sound = _S
    pygame.mixer.Channel = lambda *a: _Ch()
    pygame.mixer.set_num_channels = lambda n: None
    pygame.mixer.get_num_channels = lambda: 8
    pygame.mixer.find_channel = lambda *a,**k: _Ch()
    pygame.mixer.fadeout = lambda t: None
    pygame.mixer.stop = lambda: _emit({"cmd":"stop"})
    pygame.mixer.pause = lambda: _emit({"cmd":"pause"})
    pygame.mixer.unpause = lambda: _emit({"cmd":"play"})
except Exception: pass
'''

PISTON_URL = "http://127.0.0.1:2000"

# ─── Interactive execution via docker exec ────────────────────────────────────

RUNTIMES: dict = {
    "python":     {"file": "main.py",    "run": ["/piston/packages/python/3.12.0/bin/python3", "{{file}}"],   "pkg": ["/piston/packages/python/3.12.0/bin/pip3", "install", "--quiet"]},
    "javascript": {"file": "main.js",    "run": ["/piston/packages/node/20.11.1/bin/node", "{{file}}"],        "pkg": ["/piston/packages/node/20.11.1/bin/npm", "install", "-g"]},
    "typescript": {"file": "main.ts",    "run": ["/piston/packages/node/20.11.1/bin/npx", "ts-node", "{{file}}"], "pkg": ["/piston/packages/node/20.11.1/bin/npm", "install", "-g"]},
    "go":         {"file": "main.go",    "run": ["/piston/packages/go/1.16.2/go/bin/go", "run", "{{file}}"],   "pkg": None},
    "ruby":       {"file": "main.rb",    "run": ["/piston/packages/ruby/3.0.1/bin/ruby", "{{file}}"],          "pkg": ["/piston/packages/ruby/3.0.1/bin/gem", "install"]},
    "php":        {"file": "main.php",   "run": ["/piston/packages/php/8.2.3/bin/php", "{{file}}"],            "pkg": None},
    "bash":       {"file": "main.sh",    "run": ["/piston/packages/bash/5.2.0/bin/bash", "{{file}}"],          "pkg": None},
    "lua":        {"file": "main.lua",   "run": ["/piston/packages/lua/5.4.4/lua-5.4.4/src/lua", "{{file}}"], "pkg": None},
    "r":          {"file": "main.r",     "run": ["/piston/packages/rscript/4.1.1/bin/Rscript", "{{file}}"],   "pkg": None},
    "swift":      {"file": "main.swift", "run": ["/piston/packages/swift/5.3.3/bin/swift", "{{file}}"],        "pkg": None},
    "rust": {
        "file": "main.rs",
        "compile": [
            "/piston/packages/rust/1.68.2/rust-1.68.2-x86_64-unknown-linux-gnu/rustc/bin/rustc",
            "--sysroot", "/piston/packages/rust/1.68.2/rust-1.68.2-x86_64-unknown-linux-gnu/rust-std-x86_64-unknown-linux-gnu",
            "-o", "{{dir}}/main", "{{file}}"
        ],
        "run": ["{{dir}}/main"],
        "pkg": None,
    },
    "java": {
        "file": "Main.java",
        "compile": ["/piston/packages/java/15.0.2/bin/javac", "{{file}}"],
        "run": ["/piston/packages/java/15.0.2/bin/java", "-cp", "{{dir}}", "Main"],
        "pkg": None,
    },
    "c++": {
        "file": "main.cpp",
        "compile": ["/usr/bin/g++", "-o", "{{dir}}/main", "{{file}}"],
        "run": ["{{dir}}/main"],
        "pkg": None,
    },
    "c": {
        "file": "main.c",
        "compile": ["/usr/bin/gcc", "-o", "{{dir}}/main", "{{file}}"],
        "run": ["{{dir}}/main"],
        "pkg": None,
    },
    "kotlin": {
        "file": "main.kt",
        "compile": ["sh", "-c", "PATH=/piston/packages/java/15.0.2/bin:$PATH /piston/packages/kotlin/1.8.20/bin/kotlinc {{file}} -include-runtime -d {{dir}}/main.jar"],
        "run": ["/piston/packages/java/15.0.2/bin/java", "-jar", "{{dir}}/main.jar"],
        "pkg": None,
    },
}

def _resolve(cmd: list[str], tmpdir: str, filename: str) -> list[str]:
    filepath = f"{tmpdir}/{filename}"
    return [p.replace("{{file}}", filepath).replace("{{dir}}", tmpdir) for p in cmd]

async def _stream_proc(proc: asyncio.subprocess.Process, ws: WebSocket):
    """Read stdout+stderr concurrently and send to websocket."""
    async def read_stream(stream, kind):
        while True:
            chunk = await stream.read(8192)
            if not chunk:
                break
            await ws.send_json({"type": kind, "data": chunk.decode("utf-8", errors="replace")})
    tasks = [asyncio.create_task(read_stream(proc.stdout, "stdout")),
             asyncio.create_task(read_stream(proc.stderr, "stderr"))]
    await asyncio.gather(*tasks)

@app.websocket("/ws/run")
async def ws_run(ws: WebSocket):
    await ws.accept()
    proc: asyncio.subprocess.Process | None = None
    tmpdir = f"/tmp/cxy_{secrets.token_hex(8)}"
    try:
        init = await asyncio.wait_for(ws.receive_json(), timeout=10)
        language = init.get("language", "python")
        packages = init.get("packages", [])
        files_payload = init.get("files")  # multi-file: [{name, content}]
        if files_payload:
            code = ""
            entry_name = init.get("entry") or LANG_ENTRY.get(language, "main.py")
        else:
            code = init.get("code", "")
            entry_name = LANG_ENTRY.get(language, "main.py")
            files_payload = [{"name": entry_name, "content": code}]

        rt = RUNTIMES.get(language)
        if not rt:
            await ws.send_json({"type": "error", "data": f"Unsupported language: {language}"})
            return

        # Install packages first (fire-and-forget errors)
        if packages and rt.get("pkg"):
            for pkg in packages[:10]:
                pkg = pkg.strip()
                if not pkg or not re.match(r'^[a-zA-Z0-9_\-\.]+$', pkg):
                    continue
                cmd = rt["pkg"] + [pkg]
                p = await asyncio.create_subprocess_exec(
                    "docker", "exec", "piston", *cmd,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                )
                _, err = await asyncio.wait_for(p.communicate(), timeout=120)
                if p.returncode != 0:
                    await ws.send_json({"type": "stderr", "data": f"[pkg] failed to install {pkg}: {err.decode()[:200]}\n"})

        # Write source file(s) into container
        mkdir_proc = await asyncio.create_subprocess_exec(
            "docker", "exec", "piston", "mkdir", "-p", tmpdir,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
        )
        await mkdir_proc.wait()
        for fobj in files_payload:
            fname = str(fobj.get("name", "")).strip("/")
            if not fname or ".." in fname:
                continue
            fcontent = fobj.get("content", "")
            fpath = f"{tmpdir}/{fname}"
            fdir = fpath.rsplit("/", 1)[0]
            if fdir != tmpdir:
                sub_mkdir = await asyncio.create_subprocess_exec(
                    "docker", "exec", "piston", "mkdir", "-p", fdir,
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
                )
                await sub_mkdir.wait()
            wp = await asyncio.create_subprocess_exec(
                "docker", "exec", "-i", "piston", "sh", "-c", f"cat > {shlex.quote(fpath)}",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
            )
            wp.stdin.write(fcontent.encode())
            wp.stdin.close()
            await wp.wait()

        # Compile step if needed
        if "compile" in rt:
            compile_cmd = _resolve(rt["compile"], tmpdir, entry_name)
            cp = await asyncio.create_subprocess_exec(
                "docker", "exec", "piston", *compile_cmd,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            cout, cerr = await asyncio.wait_for(cp.communicate(), timeout=60)
            if cout:
                await ws.send_json({"type": "stdout", "data": cout.decode("utf-8", errors="replace")})
            if cerr:
                await ws.send_json({"type": "stderr", "data": cerr.decode("utf-8", errors="replace")})
            if cp.returncode != 0:
                await ws.send_json({"type": "exit", "code": cp.returncode})
                return

        # Run
        run_cmd = _resolve(rt["run"], tmpdir, entry_name)
        docker_args = ["docker", "exec", "-i"]
        if language == "python":
            shim_path = f"{tmpdir}/sitecustomize.py"
            shp = await asyncio.create_subprocess_exec(
                "docker", "exec", "-i", "piston", "sh", "-c", f"cat > {shlex.quote(shim_path)}",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            )
            shp.stdin.write(PYTHON_AUDIO_SHIM.encode())
            shp.stdin.close()
            await shp.wait()
            docker_args += ["-e", f"PYTHONPATH={tmpdir}"]
        docker_args += ["piston", *run_cmd]
        proc = await asyncio.create_subprocess_exec(
            *docker_args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await ws.send_json({"type": "started"})

        # Stream output while accepting stdin from client
        stream_task = asyncio.create_task(_stream_proc(proc, ws))

        async def recv_stdin():
            while proc.returncode is None:
                try:
                    msg = await asyncio.wait_for(ws.receive_json(), timeout=0.1)
                    if msg.get("type") == "stdin":
                        data = msg.get("data", "")
                        if proc.stdin and not proc.stdin.is_closing():
                            proc.stdin.write(data.encode())
                            await proc.stdin.drain()
                    elif msg.get("type") == "kill":
                        proc.kill()
                        break
                except asyncio.TimeoutError:
                    pass
                except Exception:
                    break

        stdin_task = asyncio.create_task(recv_stdin())

        done, pending = await asyncio.wait(
            [stream_task, asyncio.create_task(proc.wait())],
            timeout=600,
            return_when=asyncio.FIRST_COMPLETED,
        )

        stdin_task.cancel()
        if proc.returncode is None:
            proc.kill()
        await proc.wait()
        for t in pending:
            t.cancel()
        await asyncio.gather(stream_task, return_exceptions=True)

        await ws.send_json({"type": "exit", "code": proc.returncode})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await ws.send_json({"type": "error", "data": str(e)})
        except Exception:
            pass
    finally:
        if proc and proc.returncode is None:
            try:
                proc.kill()
            except Exception:
                pass
        await asyncio.create_subprocess_exec(
            "docker", "exec", "piston", "rm", "-rf", tmpdir,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
        )

@app.post("/api/packages/install")
async def install_package(request: Request):
    body = await request.json()
    language = body.get("language", "")
    package = body.get("package", "").strip()
    if not package or not re.match(r'^[a-zA-Z0-9_\-\.]+$', package):
        raise HTTPException(400, "Invalid package name")
    rt = RUNTIMES.get(language)
    if not rt or not rt.get("pkg"):
        raise HTTPException(400, f"Package manager not available for {language}")
    cmd = rt["pkg"] + [package]
    p = await asyncio.create_subprocess_exec(
        "docker", "exec", "piston", *cmd,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await asyncio.wait_for(p.communicate(), timeout=120)
    if p.returncode != 0:
        raise HTTPException(400, stderr.decode()[:500])
    return {"ok": True, "package": package}

class PistonRun(BaseModel):
    language: str
    version: str = "*"
    files: list
    stdin: str = ""
    args: list = []

@app.post("/api/piston/execute")
async def piston_execute(body: PistonRun):
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{PISTON_URL}/api/v2/execute",
            json={"language": body.language, "version": body.version,
                  "files": body.files, "stdin": body.stdin, "args": body.args}
        )
    return r.json()

@app.get("/api/piston/runtimes")
async def piston_runtimes():
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{PISTON_URL}/api/v2/runtimes")
    return r.json()

@app.get("/p/{pid}", response_class=PlainTextResponse)
async def raw_paste(pid: str):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT content, expires_at FROM pastes WHERE id=?", (pid,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404)
        if row["expires_at"] and int(time.time()) > row["expires_at"]:
            raise HTTPException(410)
        return row["content"]

# ─── Tools ─────────────────────────────────────────────────────────────────────

class ToolCreate(BaseModel):
    name: str
    description: str = ""
    script: str = ""
    github_url: str = ""
    author: str = "anonymous"

@app.get("/api/tools")
async def list_tools(q: str = "", limit: int = 50):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        if q:
            cur = await db.execute(
                "SELECT * FROM tools WHERE name LIKE ? OR description LIKE ? ORDER BY stars DESC LIMIT ?",
                (f"%{q}%", f"%{q}%", limit)
            )
        else:
            cur = await db.execute("SELECT * FROM tools ORDER BY stars DESC, created_at DESC LIMIT ?", (limit,))
        rows = await cur.fetchall()
        return [dict(r) for r in rows]

@app.post("/api/tools")
async def create_tool(body: ToolCreate):
    if not body.name.strip():
        raise HTTPException(400, "Name required")
    if not body.script and not body.github_url:
        raise HTTPException(400, "Either script or github_url required")
    slug = slugify(body.name)
    tid = short_id()
    now = int(time.time())
    async with aiosqlite.connect(DB) as db:
        base = slug; i = 2
        while True:
            cur = await db.execute("SELECT id FROM tools WHERE slug=?", (slug,))
            if not await cur.fetchone(): break
            slug = f"{base}-{i}"; i += 1
        await db.execute(
            "INSERT INTO tools VALUES (?,?,?,?,?,?,?,?,?)",
            (tid, slug, body.name, body.description, body.script, body.github_url, body.author, 0, now)
        )
        await db.commit()
    return {"id": tid, "slug": slug, "install": f"curl codexyy.dev/t/{slug} | sh"}

@app.get("/api/tools/{slug}")
async def get_tool(slug: str):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM tools WHERE slug=?", (slug,))
        row = await cur.fetchone()
        if not row: raise HTTPException(404)
        return dict(row)

@app.post("/api/tools/{slug}/star")
async def star_tool(slug: str):
    async with aiosqlite.connect(DB) as db:
        await db.execute("UPDATE tools SET stars=stars+1 WHERE slug=?", (slug,))
        await db.commit()
    return {"ok": True}

@app.get("/t/{slug}", response_class=PlainTextResponse)
async def install_tool(slug: str):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT script, github_url FROM tools WHERE slug=?", (slug,))
        row = await cur.fetchone()
        if not row: raise HTTPException(404, f"Tool '{slug}' not found")
        if row["script"]: return row["script"]
        if row["github_url"]: return f"#!/bin/sh\ncurl -fsSL {row['github_url']} | sh\n"
        raise HTTPException(404)

# ─── cx OpenAPI Schema ──────────────────────────────────────────────────────────

@app.get("/openaischema")
async def openai_schema():
    return CX_OPENAPI_SCHEMA

# ─── cx Info Page ───────────────────────────────────────────────────────────────

CX_INFO = r"""
# cx Language — Complete Reference

## What is cx?

cx is a minimalist, clean programming language designed for clarity and simplicity. It runs on a tree-walk interpreter written in Python. cx programs can be executed locally via the `cx` CLI, or remotely via the cx GPT integration (`cx gpt`) which lets AI agents write and run cx code on a user's machine through a secure relay.

## Installation

```bash
curl codexyy.dev/cx | sh
```

This installs the `cx` command to `~/.local/bin/cx`. Make sure `~/.local/bin` is in your PATH.

## CLI Commands

| Command | Description |
|---------|-------------|
| `cx run <file.cx>` | Execute a .cx file |
| `cx repl` | Start an interactive REPL |
| `cx gpt` | Start a GPT relay session — connects to codexyy.dev and gets a session code that an AI agent can use to run cx code on your machine |
| `cx version` | Print the cx version |

## The `cx gpt` Workflow

When a user runs `cx gpt`, three things happen:

1. A session is created on codexyy.dev and a short code (e.g. `a7x9k2`) is generated
2. The CLI connects to the server via WebSocket and waits for incoming code
3. The session code is shared with an AI agent (ChatGPT, etc.)

The AI agent then uses the cx API endpoints to:
- Create, read, edit, and list `.cx` files in a `cxgpt/` directory on the user's machine
- Execute cx code on the user's machine and get the output back

When the user runs `cx gpt`, a `cxgpt/` directory is created in their current working directory. This is the workspace where all cx files are stored. The AI can create, read, edit, and list files in this directory.

## API Endpoints for AI Agents

All endpoints are at `https://codexyy.dev/api/cx/` and accept POST with JSON bodies.

### Create Session

```
POST /api/cx/session
{ "code": "optional-existing-code" }
→ { "code": "a7x9k2", "url": "https://codexyy.dev/cx/a7x9k2", "status": "waiting" }
```

### Check Status

```
POST /api/cx/status
{ "code": "a7x9k2" }
→ { "connected": true, "url": "https://codexyy.dev/cx/a7x9k2" }
```

### Run Code

```
POST /api/cx/run
{ "code": "a7x9k2", "source": "print(\"hello world\")" }
→ { "output": "hello world\n", "error": null, "exit_code": 0 }
```

### List Files

```
POST /api/cx/files
{ "code": "a7x9k2" }
→ { "files": [{ "path": "main.cx", "size": 128, "modified": "2026-05-02T12:00:00Z" }] }
```

### Read File

```
POST /api/cx/read
{ "code": "a7x9k2", "path": "main.cx" }
→ { "path": "main.cx", "content": "print(\"hello\")\n", "lines": 1 }
```

### Write File

```
POST /api/cx/write
{ "code": "a7x9k2", "path": "hello.cx", "content": "print(\"hello\")\n" }
→ { "path": "hello.cx", "ok": true }
```

### Edit File

```
POST /api/cx/edit
{ "code": "a7x9k2", "path": "hello.cx", "old": "hello", "new": "world" }
→ { "path": "hello.cx", "ok": true, "replacements": 1 }
```

## AI Agent Best Practices

1. **Always check status first**: After creating a session, call `cxStatus` to confirm the user has connected their machine before attempting to write files or run code.

2. **Write files, then run them**: Prefer writing `.cx` files to the `cxgpt/` directory using `cxWrite`, then executing them with `cxRun` using `source: "run(\"cxgpt/main.cx\")"`. This gives the user visibility into what code is being created and run on their machine.

3. **Use `cxEdit` for small changes**: If a file already exists and you just need to fix a bug or add a feature, use `cxEdit` with targeted `old`/`new` strings instead of overwriting the whole file.

4. **Read before editing**: Always call `cxRead` before making edits so you can see the current state of the file and make accurate replacements.

5. **Handle errors gracefully**: If `cxRun` returns a non-null `error` field, read the error message, fix the code, and try again.

6. **File paths are relative to `cxgpt/`**: When referring to files, use paths like `main.cx`, `utils.cx`, etc. The `cxgpt/` prefix is implied — do not include it in the path.

## Language Syntax

### Comments

```
# This is a comment
x = 1 # inline comments work too
```

### Variables and Assignment

```
name = "world"
count = 42
pi = 3.14159
active = true
nothing = nil

# Reassignment
count = count + 1
```

Variables are dynamically typed. You do not declare types. A variable is created when you first assign a value to it. Reassigning a variable changes its value.

### Data Types

| Type | Example | Description |
|------|---------|-------------|
| `nil` | `nil` | Null / none value |
| `bool` | `true`, `false` | Boolean values |
| `num` | `42`, `3.14`, `0.5` | Numbers (integers and floats are unified) |
| `str` | `"hello"`, `"hi {name}"` | Strings with optional interpolation |
| `list` | `[1, 2, 3]` | Mutable ordered sequences |
| `dict` | `{ "key": "value" }` | Mutable key-value maps |
| `fn` | `fn add(a, b) { ... }` | First-class functions |

### Strings and String Interpolation

Strings are enclosed in double quotes. Single quotes are NOT supported for strings.

```
greeting = "hello"
print("You said: {greeting}")            # basic interpolation
print("2 + 2 = {2 + 2}")                # expressions in interpolation
print("{count} item{s}")                 # s is treated as identifier lookup
print("Escaped brace: \{not interpolated\}") # escape braces with backslash
```

Any expression inside `{...}` within a string is evaluated. If the expression is just a variable name, its value is inserted. If it's a more complex expression, it's evaluated and the result is converted to a string.

### Arithmetic Operators

```
a + b       # addition
a - b       # subtraction
a * b       # multiplication
a / b       # division (always returns a number, may be float)
a % b       # modulo (remainder)
-a          # negation
```

### Comparison Operators

```
a == b      # equal
a != b      # not equal
a < b       # less than
a > b       # greater than
a <= b      # less than or equal
a >= b      # greater than or equal
```

### Logical Operators

```
a and b     # logical AND (short-circuit)
a or b      # logical OR (short-circuit)
not a       # logical NOT
```

### Bitwise Operators

Not supported in v1. Use `run_bash` or math operations instead.

### Conditionals

```
if x > 10 {
  print("big")
} elif x > 5 {
  print("medium")
} else {
  print("small")
}
```

- `if` is required
- `elif` is optional and can appear multiple times
- `else` is optional and must come last
- Braces `{ }` are required around the body

### While Loops

```
x = 10
while x > 0 {
  print(x)
  x = x - 1
}
```

### For Loops

Iterate over a list:

```
items = ["apple", "banana", "cherry"]
for item in items {
  print(item)
}
```

Iterate over a range:

```
for i in range(10) {
  print(i)         # prints 0 through 9
}

for i in range(5, 10) {
  print(i)         # prints 5 through 9
}
```

Iterate over dict keys:

```
config = { "name": "cx", "version": 1 }
for key in keys(config) {
  print("{key} = {config[key]}")
}
```

### Break and Continue

```
for i in range(100) {
  if i % 2 == 0 {
    continue    # skip even numbers
  }
  if i > 20 {
    break       # stop the loop
  }
  print(i)
}
```

- `break` exits the loop immediately
- `continue` skips to the next iteration
- Both work in `for` and `while` loops

### Functions

```
fn greet(name) {
  print("Hello, {name}!")
}

greet("world")    # Hello, world!
```

Functions with default parameters:

```
fn greet(name = "world") {
  print("Hello, {name}!")
}

greet()           # Hello, world!
greet("cx")       # Hello, cx!
```

Functions with return values:

```
fn add(a, b) {
  return a + b
}

result = add(3, 4)    # 7
```

Functions are first-class values — they can be stored in variables, passed as arguments, and returned from other functions:

```
fn make_adder(n) {
  fn add(x) {
    return x + n
  }
  return add
}

add5 = make_adder(5)
print(add5(10))       # 15
```

### Closures

Functions capture variables from their enclosing scope:

```
fn counter() {
  count = 0
  fn inc() {
    count = count + 1
    return count
  }
  return inc
}

c = counter()
print(c())    # 1
print(c())    # 2
print(c())    # 3
```

### Lists

```
# Creating lists
fruits = ["apple", "banana", "cherry"]

# Accessing elements (0-indexed)
print(fruits[0])       # apple
print(fruits[2])       # cherry

# Modifying elements
fruits[1] = "blueberry"

# Built-in list operations
push(fruits, "date")   # append to end: ["apple", "blueberry", "cherry", "date"]
pop(fruits)            # remove & return last: "date", fruits is now ["apple", "blueberry", "cherry"]
len(fruits)            # 3

# Negative indexing
print(fruits[-1])      # cherry (last element)
```

### Dicts

```
# Creating dicts
person = { "name": "Alice", "age": 30 }

# Accessing values
print(person["name"])       # Alice

# Setting values
person["email"] = "alice@example.com"

# Built-in operations
keys(person)                 # ["name", "age", "email"]
len(person)                  # 3
has(person, "name")          # true
has(person, "phone")         # false
```

### Indexing

Both lists and dicts support bracket indexing:

```
items = [10, 20, 30]
print(items[0])       # 10
print(items[-1])      # 30

config = { "host": "localhost", "port": 8080 }
print(config["host"])  # localhost
```

### Built-in Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `print` | `print(...)` | Print values to stdout, space-separated, with trailing newline |
| `input` | `input(prompt?)` | Read a line from stdin. Optional prompt string. |
| `len` | `len(x)` | Return length of a string, list, or dict |
| `type` | `type(x)` | Return the type name as a string: `"num"`, `"str"`, `"bool"`, `"list"`, `"dict"`, `"nil"`, `"fn"` |
| `str` | `str(x)` | Convert any value to a string representation |
| `num` | `num(x)` | Convert a string to a number. Returns `nil` if conversion fails. |
| `range` | `range(end)` or `range(start, end)` | Generate a list of numbers from start (default 0) to end (exclusive) |
| `push` | `push(list, value)` | Append a value to a list. Modifies the list in place. Returns nil. |
| `pop` | `pop(list)` | Remove and return the last element of a list. Modifies the list in place. |
| `keys` | `keys(dict)` | Return a list of all keys in the dict |
| `has` | `has(dict, key)` | Return true if the dict contains the key, false otherwise |
| `abs` | `abs(x)` | Return the absolute value of a number |
| `max` | `max(a, b)` | Return the larger of two numbers |
| `min` | `min(a, b)` | Return the smaller of two numbers |
| `floor` | `floor(x)` | Round down to the nearest integer |
| `ceil` | `ceil(x)` | Round up to the nearest integer |
| `sqrt` | `sqrt(x)` | Return the square root of a number |
| `random` | `random()` | Return a random number between 0 and 1 |
| `upper` | `upper(s)` | Convert a string to uppercase |
| `lower` | `lower(s)` | Convert a string to lowercase |
| `trim` | `trim(s)` | Remove leading and trailing whitespace |
| `split` | `split(s, sep)` | Split a string by separator, returns a list |
| `join` | `join(list, sep)` | Join a list of strings with a separator |
| `replace` | `replace(s, old, new)` | Replace all occurrences of old with new in a string |
| `starts_with` | `starts_with(s, prefix)` | Check if a string starts with a prefix |
| `ends_with` | `ends_with(s, suffix)` | Check if a string ends with a suffix |
| `slice` | `slice(s, start, end)` | Slice a string or list (like Python slicing) |

### Truthiness

The following values are falsy:
- `nil`
- `false`
- `0`
- `""` (empty string)
- `[]` (empty list)
- `{}` (empty dict)

Everything else is truthy.

### Operator Precedence (highest to lowest)

1. `()` grouping, `[]` indexing, function calls
2. Unary: `-`, `not`
3. `*`, `/`, `%`
4. `+`, `-`
5. `<`, `>`, `<=`, `>=`
6. `==`, `!=`
7. `and`
8. `or`

### Scope Rules

cx uses lexical scoping. Variables are looked up in the current scope first, then in enclosing scopes (closures). A function body creates a new scope. `if`, `for`, and `while` blocks do NOT create new scopes — variables assigned inside them are visible outside.

```
x = 10
if true {
  x = 20      # modifies the outer x
  y = 30      # creates y in the outer scope
}
print(x)      # 20
print(y)      # 30
```

```
fn outer() {
  x = 10
  fn inner() {
    return x    # captures x from outer's scope
  }
  return inner
}
f = outer()
print(f())    # 10
```

### Error Handling

cx does not have try/catch in v1. Runtime errors will print an error message with the line number and halt execution. Common errors:

- `Undefined variable 'x'` — using a variable that doesn't exist
- `Undefined function 'foo'` — calling a function that doesn't exist
- `Type error` — using an operator on incompatible types (e.g. `"hello" + 5`)
- `Division by zero` — attempting to divide by zero
- `Index out of bounds` — accessing a list index that doesn't exist
- `Not callable` — trying to call a non-function value
- `Wrong number of arguments` — calling a function with the wrong arity

### The `cxgpt/` Workspace

When a user runs `cx gpt`, a `cxgpt/` directory is created in their current working directory. This is the workspace where the AI writes and manages cx files.

File operations via the API are scoped to this directory:
- `path` parameters are relative to `cxgpt/` — e.g. `path: "main.cx"` refers to `cxgpt/main.cx`
- Paths must not contain `..` or start with `/` (security restriction)
- Only `.cx` files can be created and edited
- The AI can create subdirectories: `path: "lib/utils.cx"` → `cxgpt/lib/utils.cx`

### Example Programs

#### Hello World

```
print("Hello, world!")
```

#### Fibonacci

```
fn fib(n) {
  if n <= 1 {
    return n
  }
  return fib(n - 1) + fib(n - 2)
}

for i in range(12) {
  print("fib({i}) = {fib(i)}")
}
```

#### FizzBuzz

```
for i in range(1, 101) {
  if i % 15 == 0 {
    print("fizzbuzz")
  } elif i % 3 == 0 {
    print("fizz")
  } elif i % 5 == 0 {
    print("buzz")
  } else {
    print(str(i))
  }
}
```

#### Interactive Input

```
name = input("What is your name? ")
print("Hello, {name}!")

age = num(input("How old are you? "))
if age >= 18 {
  print("You are an adult.")
} else {
  print("You are {age} years young.")
}
```

#### List Operations

```
nums = [5, 3, 8, 1, 9, 2, 7, 4, 6]

# Bubble sort
sorted = []
while len(nums) > 0 {
  smallest = nums[0]
  for n in nums {
    if n < smallest {
      smallest = n
    }
  }
  push(sorted, smallest)
  # Remove smallest from nums
  new_nums = []
  found = false
  for n in nums {
    if n == smallest and not found {
      found = true
    } else {
      push(new_nums, n)
    }
  }
  nums = new_nums
}

print("Sorted: {sorted}")
```

#### String Processing

```
text = "Hello, World!"
print(upper(text))        # HELLO, WORLD!
print(lower(text))        # hello, world!
print(trim("  hi  "))     # hi
print(split("a,b,c", ","))  # [a, b, c]
print(join(["x", "y", "z"], "-"))  # x-y-z
print(replace(text, "World", "cx"))  # Hello, cx!
```

#### Dict as Record

```
person = {
  "name": "Alice",
  "age": 30,
  "hobbies": ["coding", "reading"]
}

print("{person['name']} is {person['age']}")

for hobby in person["hobbies"] {
  print("  - {hobby}")
}

person["city"] = "Sydney"
has(person, "city")     # true
has(person, "email")    # false
```

#### Multi-file Project (in cxgpt/)

`cxgpt/utils.cx`:
```
fn greet(name) {
  return "Hello, {name}!"
}

fn square(x) {
  return x * x
}
```

`cxgpt/main.cx`:
```
# When using cx gpt, the AI agent writes multiple files
# and runs them together via the API

name = "cx"
print(greet(name))
print("2 squared = {square(2)}")
```

### Running cx Code via the API

When using `cxRun`, you can either:

1. **Inline code** — Pass the source directly:
   ```json
   { "code": "a7x9k2", "source": "print(\"hello\")" }
   ```

2. **Run a file** — Pass a reference to a file in the cxgpt/ workspace:
   ```json
   { "code": "a7x9k2", "source": "run(\"cxgpt/main.cx\")" }
   ```
   Note: the `run()` function is automatically available in the cx gpt context and executes a file relative to the cxgpt/ directory.

### Limitations (v1)

- **No classes or structs** — use dicts for structured data
- **No module imports** — single-file programs only (unless using `run()` in cx gpt context)
- **No exception handling** — runtime errors halt execution
- **No async/concurrency** — synchronous execution only
- **No regex** — use string functions like `replace`, `split`, `starts_with`, `ends_with`
- **No file I/O** — files are managed through the cx gpt API, not within the language itself
- **No standard library** — only the built-in functions listed above
- **Single-line comments only** — `#` comments, no `/* */` block comments
- **Strings use double quotes only** — no single-quoted strings
"""

@app.get("/cxdocsweb")
async def cx_docs_web():
    with open("/var/www/codexyy/cxdocsweb.html", "r") as f:
        return HTMLResponse(f.read())

@app.get("/cxinfo")
async def cx_info():
    return PlainTextResponse(CX_INFO)

# ─── Relay ─────────────────────────────────────────────────────────────────────

relay_sessions: dict = {}

@app.post("/api/session/create")
async def create_relay_session():
    sid = short_id()
    relay_sessions[sid] = {"cli": None, "browsers": [], "cwd": None}
    return {"session_id": sid}

CX_INTERPRETER_PATH = os.path.join(os.path.dirname(__file__), "..", "cx", "cx.py")
CX_INSTALL_SCRIPT = os.path.join(os.path.dirname(__file__), "..", "cx", "install.sh")
CX_EXAMPLES_DIR = os.path.join(os.path.dirname(__file__), "..", "cx", "examples")

cx_sessions: dict = {}

@app.get("/cx")
async def cx_landing(request: Request):
    if os.path.isfile(CX_INSTALL_SCRIPT):
        with open(CX_INSTALL_SCRIPT, "r") as f:
            return PlainTextResponse(f.read(), media_type="text/x-shellscript")
    raise HTTPException(404, "Install script not found")

@app.get("/cx/cx.py")
async def cx_download():
    if os.path.isfile(CX_INTERPRETER_PATH):
        with open(CX_INTERPRETER_PATH, "r") as f:
            return PlainTextResponse(f.read(), media_type="text/x-python")
    raise HTTPException(404, "cx interpreter not found")

@app.get("/cx/examples/{filename}")
async def cx_example(filename: str):
    filepath = os.path.join(CX_EXAMPLES_DIR, filename)
    if os.path.isfile(filepath) and not ".." in filename:
        with open(filepath, "r") as f:
            return PlainTextResponse(f.read(), media_type="text/plain")
    raise HTTPException(404, "Example not found")

@app.get("/cx/{code}")
async def cx_session_page(code: str):
    if len(code) != 8 or not all(c in string.ascii_lowercase + string.digits for c in code):
        raise HTTPException(404, "Invalid session code")
    return HTMLResponse(CX_SESSION_PAGE.format(code=code, base_url=BASE_URL))

@app.post("/api/cx/session")
async def cx_create_session():
    code = short_id(8)
    cx_sessions[code] = {"ws": None, "queue": {}, "id_counter": 0}
    return {"code": code, "url": f"{BASE_URL}/cx/{code}", "status": "waiting"}

@app.post("/api/cx/status")
async def cx_status(request: Request):
    body = await request.json()
    code = body.get("code", "")
    session = cx_sessions.get(code)
    if not session:
        raise HTTPException(404, "Session not found")
    return {"connected": session["ws"] is not None, "url": f"{BASE_URL}/cx/{code}"}

@app.post("/api/cx/run")
async def cx_run(request: Request):
    body = await request.json()
    code = body.get("code", "")
    source = body.get("source", "")
    session = cx_sessions.get(code)
    if not session:
        raise HTTPException(404, "Session not found")
    if not session["ws"]:
        raise HTTPException(503, "No connected client")
    mid = str(session["id_counter"] + 1)
    session["id_counter"] += 1
    future = asyncio.get_event_loop().create_future()
    session["queue"][mid] = future
    await session["ws"].send_text(json.dumps({"type": "cx_run", "id": mid, "source": source}))
    try:
        result = await asyncio.wait_for(future, timeout=30)
        return result
    except asyncio.TimeoutError:
        session["queue"].pop(mid, None)
        raise HTTPException(504, "Execution timed out")

@app.post("/api/cx/files")
async def cx_files(request: Request):
    body = await request.json()
    code = body.get("code", "")
    return await _cx_relay(code, "cx_files", {})

@app.post("/api/cx/read")
async def cx_read(request: Request):
    body = await request.json()
    return await _cx_relay(body.get("code", ""), "cx_read", {"path": body.get("path", "")})

@app.post("/api/cx/write")
async def cx_write(request: Request):
    body = await request.json()
    return await _cx_relay(body.get("code", ""), "cx_write", {"path": body.get("path", ""), "content": body.get("content", "")})

@app.post("/api/cx/edit")
async def cx_edit(request: Request):
    body = await request.json()
    return await _cx_relay(body.get("code", ""), "cx_edit", {"path": body.get("path", ""), "old": body.get("old", ""), "new": body.get("new", "")})

async def _cx_relay(code, mtype, payload):
    session = cx_sessions.get(code)
    if not session:
        raise HTTPException(404, "Session not found")
    if not session["ws"]:
        raise HTTPException(503, "No connected client")
    mid = str(session["id_counter"] + 1)
    session["id_counter"] += 1
    future = asyncio.get_event_loop().create_future()
    session["queue"][mid] = future
    msg = {"type": mtype, "id": mid, **payload}
    await session["ws"].send_text(json.dumps(msg))
    try:
        result = await asyncio.wait_for(future, timeout=30)
        return result
    except asyncio.TimeoutError:
        session["queue"].pop(mid, None)
        raise HTTPException(504, "Request timed out")

CX_LANDING_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>cx — a minimalist programming language</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
:root{{--bg:#07070a;--bg2:#0e0e14;--bg3:#141420;--accent:#4effa8;--text:#e2e2ec;--t2:#7878a0;--t3:#3a3a52;--border:#1a1a26;--b2:#252535;--mono:'JetBrains Mono',monospace;--display:'Syne',sans-serif}}
body{{background:var(--bg);color:var(--text);font-family:var(--mono);line-height:1.7;min-height:100vh}}
body::before{{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 60% 50% at 50% 0%,rgba(78,255,168,.07),transparent 70%);pointer-events:none}}
.container{{max-width:720px;margin:0 auto;padding:80px 24px 120px}}
h1{{font-family:var(--display);font-weight:800;font-size:48px;letter-spacing:-2px;margin-bottom:8px}}
h1 span{{color:var(--accent)}}
.sub{{font-size:16px;color:var(--t2);margin-bottom:40px}}
.section{{margin-top:48px}}
h2{{font-family:var(--display);font-weight:700;font-size:24px;color:var(--text);margin-bottom:16px;letter-spacing:-.5px}}
p,li{{font-size:14px;color:var(--t2);margin-bottom:10px}}
ul{{padding-left:20px}}
code{{background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:2px 7px;font-size:13px;color:var(--accent)}}
pre{{background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:18px 20px;overflow-x:auto;margin:16px 0;font-size:13px;line-height:1.7;color:var(--text)}}
.kw{{color:#569cd6}}.fn{{color:#4effa8}}.str{{color:#ce9178}}.cm{{color:var(--t3)}}
.install{{display:inline-flex;align-items:center;background:var(--bg3);border:1px solid var(--b2);border-radius:10px;overflow:hidden;margin:16px 0}}
.install-cmd{{padding:12px 18px;font-size:13px;color:var(--t2)}}.install-cmd::before{{content:'$ ';color:var(--accent)}}
.install-copy{{background:none;border:none;border-left:1px solid var(--b2);padding:12px 14px;cursor:pointer;color:var(--t3);transition:color .15s}}.install-copy:hover{{color:var(--text)}}
.links{{display:flex;gap:24px;margin-top:40px;padding-top:24px;border-top:1px solid var(--border)}}
.links a{{color:var(--t2);font-size:13px;transition:color .2s}}.links a:hover{{color:var(--accent)}}
.grid{{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}}
.card{{background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:20px;transition:border-color .2s}}.card:hover{{border-color:var(--b2)}}
.card h3{{font-size:14px;color:var(--text);margin-bottom:6px}}.card p{{font-size:12px;margin-bottom:0}}
@media(max-width:600px){{.grid{{grid-template-columns:1fr}}}}
</style>
</head>
<body>
<div class="container">
  <h1><span>cx</span></h1>
  <p class="sub">a minimalist, clean programming language</p>

  <div class="install">
    <span class="install-cmd">curl codexyy.dev/cx | sh</span>
    <button class="install-copy" onclick="navigator.clipboard.writeText('curl codexyy.dev/cx | sh')">&#x2398;</button>
  </div>

  <div class="grid">
    <div class="card"><h3>Minimal syntax</h3><p>Braces, no semicolons, no types. Just the essentials.</p></div>
    <div class="card"><h3>String interpolation</h3><p><code>"hello {"name"}"</code> — expressions inside braces.</p></div>
    <div class="card"><h3>First-class functions</h3><p>Closures, default params, and return values.</p></div>
    <div class="card"><h3>cx gpt</h3><p>Let AI agents write and run code on your machine.</p></div>
  </div>

  <div class="section">
    <h2>Quick start</h2>
<pre><span class="cm"># hello.cx</span>
name = <span class="str">"world"</span>
<span class="fn">print</span>(<span class="str">"Hello, {"name"}!"</span>)

<span class="kw">fn</span> add(a, b) {
  <span class="kw">return</span> a + b
}
<span class="fn">print</span>(add(<span class="str">3</span>, <span class="str">4</span>))  <span class="cm"># 7</span></pre>
    <pre>$ <span class="fn">cx</span> run hello.cx
Hello, world!
7</pre>
  </div>

  <div class="section">
    <h2>cx gpt</h2>
    <p>Run <code>cx gpt</code> to get a session code. Share it with an AI agent, and it can write and run cx code on your machine remotely.</p>
    <pre>$ <span class="fn">cx</span> gpt
  Session code: <span class="fn">a7x9k2</span>
  Share with AI: https://codexyy.dev/cx/a7x9k2
  Workspace: /home/user/cxgpt/</pre>
  </div>

  <div class="links">
    <a href="/cxinfo">Language Reference</a>
    <a href="/openaischema">OpenAPI Schema</a>
    <a href="/">codexyy.dev</a>
  </div>
</div>
</body>
</html>"""

CX_SESSION_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>cx session — {code}</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
:root{{--bg:#07070a;--bg2:#0e0e14;--bg3:#141420;--accent:#4effa8;--text:#e2e2ec;--t2:#7878a0;--t3:#3a3a52;--border:#1a1a26;--b2:#252535;--mono:'JetBrains Mono',monospace;--display:'Syne',sans-serif}}
body{{background:var(--bg);color:var(--text);font-family:var(--mono);line-height:1.7;min-height:100vh;display:flex;flex-direction:column}}
body::before{{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 60% 50% at 50% 0%,rgba(78,255,168,.07),transparent 70%);pointer-events:none}}
.bar{{height:48px;background:var(--bg3);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 16px;gap:12px;flex-shrink:0;z-index:10}}
.bar-logo{{font-family:var(--display);font-size:15px;font-weight:800}}.bar-logo span{{color:var(--accent)}}
.bar-code{{font-size:12px;color:var(--t3);margin-left:auto}}
.dot{{width:6px;height:6px;border-radius:50%;margin-right:6px}}
.dot-wait{{background:var(--t3)}}.dot-live{{background:var(--accent);box-shadow:0 0 8px var(--accent);animation:pulse 2s infinite}}
@keyframes pulse{{0%,100%{{opacity:1}}50%{{opacity:.4}}}}
.layout{{flex:1;display:grid;grid-template-columns:1fr 1fr;overflow:hidden}}
.panel{{display:flex;flex-direction:column;border-right:1px solid var(--border)}}
.panel:last-child{{border-right:none}}
.panel-head{{padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);border-bottom:1px solid var(--border);flex-shrink:0}}
.editor{{flex:1;overflow:auto}}
#code{{width:100%;height:100%;background:transparent;border:none;outline:none;color:var(--text);font-family:var(--mono);font-size:13px;line-height:1.7;padding:16px;resize:none;caret-color:var(--accent)}}
.output{{flex:1;overflow-y:auto;padding:12px 14px;font-size:13px;line-height:1.7}}
.output-line{{white-space:pre-wrap;word-break:break-all}}
.out{{color:var(--text)}}.err{{color:#f87171}}.sys{{color:var(--t3)}}
.btn-row{{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--border);flex-shrink:0}}
.btn{{font-family:var(--mono);font-size:12px;font-weight:700;padding:8px 16px;border-radius:7px;border:none;cursor:pointer;transition:opacity .2s}}
.btn-run{{background:var(--accent);color:#07070a}}.btn-run:hover{{opacity:.85}}.btn-run:disabled{{opacity:.4;cursor:not-allowed}}
.btn-clear{{background:var(--bg3);color:var(--t2);border:1px solid var(--border)}}.btn-clear:hover{{color:var(--text)}}
.status{{padding:8px 14px;font-size:11px;color:var(--t3);border-bottom:1px solid var(--border)}}
@media(max-width:700px){{.layout{{grid-template-columns:1fr;grid-template-rows:1fr 1fr}}}}
</style>
</head>
<body>
<div class="bar">
  <span class="bar-logo">cx<span>.dev</span></span>
  <span class="dot dot-wait" id="dot"></span>
  <span id="statusText" style="font-size:12px;color:var(--t3)">connecting...</span>
  <span class="bar-code" id="barCode">{code}</span>
</div>
<div class="layout">
  <div class="panel">
    <div class="panel-head">Code Editor</div>
    <div class="editor"><textarea id="code" spellcheck="false" placeholder='print("Hello, world!")'># Try cx here!
print("Hello, world!")

for i in range(5) {
  print("  {i}...")
}</textarea></div>
    <div class="btn-row">
      <button class="btn btn-run" id="runBtn" onclick="runCode()">Run</button>
      <button class="btn btn-clear" onclick="document.getElementById('code').value=''">Clear</button>
    </div>
  </div>
  <div class="panel">
    <div class="panel-head">Output</div>
    <div class="status" id="statusBar">Ready</div>
    <div class="output" id="output"></div>
  </div>
</div>
<script>
const code = '{code}';
const output = document.getElementById('output');
const statusBar = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');
const dot = document.getElementById('dot');
const codeEl = document.getElementById('code');
const runBtn = document.getElementById('runBtn');

function appendOutput(text, cls) {{
  const div = document.createElement('div');
  div.className = 'output-line ' + cls;
  div.textContent = text;
  output.appendChild(div);
  output.scrollTop = output.scrollHeight;
}}

async function runCode() {{
  const source = codeEl.value;
  runBtn.disabled = true;
  statusBar.textContent = 'Running...';
  appendOutput('$ cx run', 'sys');
  try {{
    const res = await fetch('{base_url}/api/cx/run', {{
      method: 'POST',
      headers: {{'Content-Type': 'application/json'}},
      body: JSON.stringify({{code, source}})
    }});
    const data = await res.json();
    if (data.output) data.output.split('\\n').forEach(l => appendOutput(l, 'out'));
    if (data.error) appendOutput('Error: ' + data.error, 'err');
  }} catch(e) {{
    appendOutput('Error: ' + e.message, 'err');
  }}
  runBtn.disabled = false;
  statusBar.textContent = 'Done';
}}

// Check status
fetch('{base_url}/api/cx/status', {{
  method: 'POST',
  headers: {{'Content-Type': 'application/json'}},
  body: JSON.stringify({{code}})
}}).then(r => r.json()).then(d => {{
  if (d.connected) {{
    dot.className = 'dot dot-live';
    statusText.textContent = 'connected';
  }} else {{
    statusText.textContent = 'waiting for connection';
  }}
}}).catch(() => {{
  statusText.textContent = 'offline';
}});
</script>
</body>
</html>"""

@app.websocket("/relay/{session_id}")
async def relay(ws: WebSocket, session_id: str, client_type: str = Query("browser")):
    await ws.accept()
    if client_type == "cx":
        # cx gpt client — store in cx_sessions
        if session_id not in cx_sessions:
            cx_sessions[session_id] = {"ws": None, "queue": {}, "id_counter": 0}
        cx_sessions[session_id]["ws"] = ws
        try:
            while True:
                data = await ws.receive_text()
                msg = json.loads(data)
                mid = msg.get("id", "")
                if mid and mid in cx_sessions[session_id]["queue"]:
                    # Remove future and set result
                    future = cx_sessions[session_id]["queue"].pop(mid)
                    if not future.done():
                        # Build response based on message type
                        if msg.get("type") == "cx_result":
                            result = {
                                "output": msg.get("output", ""),
                                "error": msg.get("error"),
                                "exit_code": msg.get("exit_code", 0),
                            }
                            # Include extra fields for files/read/write/edit
                            for k in ("files", "path", "content", "lines", "ok", "replacements"):
                                if k in msg:
                                    result[k] = msg[k]
                            if msg.get("error") and not result.get("error"):
                                result["error"] = msg["error"]
                            future.set_result(result)
                        else:
                            future.set_result(msg)
        except WebSocketDisconnect:
            cx_sessions[session_id]["ws"] = None
        return

    if session_id not in relay_sessions:
        relay_sessions[session_id] = {"cli": None, "browsers": [], "cwd": None}
    session = relay_sessions[session_id]
    if client_type == "cli":
        session["cli"] = ws
        for b in session["browsers"]:
            try: await b.send_json({"type": "cli.connected"})
            except: pass
    else:
        session["browsers"].append(ws)
        if session["cli"]:
            await ws.send_json({"type": "cli.connected", "cwd": session["cwd"]})
    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            if client_type == "cli":
                if msg.get("type") == "info":
                    session["cwd"] = msg.get("cwd")
                dead = []
                for b in session["browsers"]:
                    try: await b.send_text(data)
                    except: dead.append(b)
                for d in dead: session["browsers"].remove(d)
            else:
                if session["cli"]:
                    try: await session["cli"].send_text(data)
                    except:
                        session["cli"] = None
                        await ws.send_json({"type": "cli.disconnected"})
    except WebSocketDisconnect:
        if client_type == "cli":
            session["cli"] = None
            for b in session["browsers"]:
                try: await b.send_json({"type": "cli.disconnected"})
                except: pass
        else:
            if ws in session["browsers"]:
                session["browsers"].remove(ws)
