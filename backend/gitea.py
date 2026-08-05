"""
gitea.py — codexyy's git backend.

Gitea 1.27.1 runs headless on 127.0.0.1:3300 and owns all repository content:
real git objects, commits, branches, diffs. codexyy's own SQLite keeps only the
social/product metadata (stars, forks, language, packages, public listing) and
the mapping from codexyy user -> Gitea user.

Every call is made with the admin token plus a `Sudo:` header, so Gitea performs
the action *as* the codexyy user without codexyy ever storing per-user Gitea
passwords or tokens. Commits are therefore correctly attributed.

Naming contract:
  codexyy user  id  u_abc123   -> gitea user  cxy-u-abc123
  codexyy repo  id  r_xyz789   -> gitea repo  <gitea_user>/r_xyz789
The Gitea repo name is the immutable codexyy repo id; the human-facing display
name lives in codexyy's `repos.name` so renames never touch git.
"""

import base64
import os
import re
import time

import httpx

GITEA_URL = os.environ.get("GITEA_URL", "http://127.0.0.1:3300")
GITEA_TOKEN = os.environ.get("GITEA_TOKEN", "")
API = f"{GITEA_URL}/api/v1"

DEFAULT_BRANCH = "main"
TIMEOUT = 30.0


class GiteaError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(f"gitea {status}: {message}")


# ─── low-level ────────────────────────────────────────────────────────────────

def _headers(sudo: str | None = None) -> dict:
    h = {
        "Authorization": f"token {GITEA_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if sudo:
        h["Sudo"] = sudo
    return h


async def _req(method: str, path: str, *, sudo: str | None = None,
               json: dict | None = None, params: dict | None = None,
               raw: bool = False):
    """One Gitea API call. Returns parsed JSON, or bytes when raw=True."""
    if not GITEA_TOKEN:
        raise GiteaError(503, "GITEA_TOKEN not configured")
    url = f"{API}{path}"
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.request(method, url, headers=_headers(sudo),
                                 json=json, params=params)
    if r.status_code == 404:
        raise GiteaError(404, "not found")
    if r.status_code >= 400:
        detail = r.text[:400]
        try:
            detail = r.json().get("message", detail)
        except Exception:
            pass
        raise GiteaError(r.status_code, detail)
    if raw:
        return r.content
    if not r.content:
        return None
    try:
        return r.json()
    except Exception:
        return None


async def ping() -> str | None:
    """Returns the Gitea version, or None if unreachable."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{API}/version")
        return r.json().get("version") if r.status_code == 200 else None
    except Exception:
        return None


# ─── identity mapping ─────────────────────────────────────────────────────────

def gitea_username(codexyy_user_id: str) -> str:
    """Deterministic, collision-free Gitea login for a codexyy user id."""
    slug = re.sub(r"[^a-zA-Z0-9]", "-", codexyy_user_id).strip("-").lower()
    return f"cxy-{slug}"[:38]


async def ensure_user(codexyy_user: dict) -> str:
    """
    Idempotently provision the Gitea account backing a codexyy user.
    Returns the Gitea username. Safe to call on every request.
    """
    login = gitea_username(codexyy_user["id"])
    try:
        await _req("GET", f"/users/{login}")
        return login
    except GiteaError as e:
        if e.status != 404:
            raise

    await _req("POST", "/admin/users", json={
        "username": login,
        "email": f"{login}@noreply.codexyy.dev",
        "full_name": (codexyy_user.get("name") or login)[:100],
        # Password is never used: all access is via admin token + Sudo.
        "password": base64.urlsafe_b64encode(os.urandom(30)).decode(),
        "must_change_password": False,
        "send_notify": False,
    })
    return login


# ─── repositories ─────────────────────────────────────────────────────────────

async def create_repo(login: str, repo_id: str, *, description: str = "",
                      private: bool = False, gitignores: str = "",
                      readme: str = "Default") -> dict:
    """Create an initialised repo (so HEAD exists and commits can be made)."""
    return await _req("POST", "/user/repos", sudo=login, json={
        "name": repo_id,
        "description": description[:255],
        "private": bool(private),
        "auto_init": True,
        "default_branch": DEFAULT_BRANCH,
        "gitignores": gitignores,
        "readme": readme,
    })


async def delete_repo(login: str, repo_id: str) -> None:
    try:
        await _req("DELETE", f"/repos/{login}/{repo_id}", sudo=login)
    except GiteaError as e:
        if e.status != 404:
            raise


async def get_repo(login: str, repo_id: str) -> dict:
    return await _req("GET", f"/repos/{login}/{repo_id}", sudo=login)


async def set_repo_meta(login: str, repo_id: str, *, description: str | None = None,
                        private: bool | None = None) -> None:
    body: dict = {}
    if description is not None:
        body["description"] = description[:255]
    if private is not None:
        body["private"] = bool(private)
    if body:
        await _req("PATCH", f"/repos/{login}/{repo_id}", sudo=login, json=body)


# ─── file tree & contents ─────────────────────────────────────────────────────

async def list_tree(login: str, repo_id: str, ref: str = DEFAULT_BRANCH) -> list[dict]:
    """
    Flat list of every blob in the tree: [{path, sha, size, type}].
    Returns [] for an empty repo rather than raising.
    """
    try:
        data = await _req("GET", f"/repos/{login}/{repo_id}/git/trees/{ref}",
                          sudo=login, params={"recursive": "1", "per_page": 1000})
    except GiteaError as e:
        if e.status in (404, 409):   # empty repo / no such ref
            return []
        raise
    return [
        {"path": t["path"], "sha": t["sha"], "size": t.get("size", 0), "type": "file"}
        for t in (data.get("tree") or []) if t.get("type") == "blob"
    ]


async def read_file(login: str, repo_id: str, path: str,
                    ref: str = DEFAULT_BRANCH) -> str:
    """File contents as text. Binary files come back as '' rather than raising."""
    raw = await _req("GET", f"/repos/{login}/{repo_id}/raw/{path.lstrip('/')}",
                     sudo=login, params={"ref": ref}, raw=True)
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return ""


async def read_tree_with_content(login: str, repo_id: str, ref: str = DEFAULT_BRANCH,
                                 max_files: int = 200,
                                 max_bytes: int = 400_000) -> list[dict]:
    """
    The whole repo as [{path, content}] — the shape codexyy's editor expects.
    Oversized and binary blobs are listed with empty content and truncated=True.
    """
    out = []
    for entry in (await list_tree(login, repo_id, ref))[:max_files]:
        if entry["size"] > max_bytes:
            out.append({"path": entry["path"], "content": "",
                        "sha": entry["sha"], "truncated": True})
            continue
        out.append({
            "path": entry["path"],
            "content": await read_file(login, repo_id, entry["path"], ref),
            "sha": entry["sha"],
            "truncated": False,
        })
    return out


async def commit_files(login: str, repo_id: str, changes: list[dict], *,
                       message: str, branch: str = DEFAULT_BRANCH,
                       author_name: str = "", author_email: str = "") -> dict:
    """
    Apply a batch of file operations as ONE real git commit.

    changes: [{operation: create|update|delete, path, content?, sha?}]
    `content` is plain text; base64 encoding is handled here.
    """
    files = []
    for c in changes:
        op = c.get("operation", "update")
        item: dict = {"operation": op, "path": c["path"].lstrip("/")}
        if op != "delete":
            item["content"] = base64.b64encode(
                str(c.get("content", "")).encode("utf-8")
            ).decode("ascii")
        if c.get("sha"):
            item["sha"] = c["sha"]
        if c.get("from_path"):
            item["from_path"] = c["from_path"]
        files.append(item)

    if not files:
        return {"skipped": True}

    ident = {"name": author_name or login,
             "email": author_email or f"{login}@noreply.codexyy.dev"}
    return await _req("POST", f"/repos/{login}/{repo_id}/contents",
                      sudo=login, json={
                          "files": files,
                          "message": message[:2000] or "update",
                          "branch": branch,
                          "author": ident,
                          "committer": ident,
                      })


async def sync_files(login: str, repo_id: str, desired: list[dict], *,
                     message: str, branch: str = DEFAULT_BRANCH,
                     author_name: str = "", author_email: str = "",
                     prune: bool = True) -> dict:
    """
    Make the branch match `desired` ([{path, content}]) in a single commit:
    creates new paths, updates changed ones, deletes the rest when prune=True.
    Unchanged files are left out entirely so no empty commits are produced.
    """
    existing = {e["path"]: e for e in await list_tree(login, repo_id, branch)}
    changes: list[dict] = []

    for f in desired:
        path = str(f.get("path", "")).strip().lstrip("/")
        if not path or ".." in path.split("/"):
            continue
        content = str(f.get("content", ""))
        if path in existing:
            current = await read_file(login, repo_id, path, branch)
            if current != content:
                changes.append({"operation": "update", "path": path,
                                "content": content, "sha": existing[path]["sha"]})
        else:
            changes.append({"operation": "create", "path": path, "content": content})

    if prune:
        wanted = {str(f.get("path", "")).strip().lstrip("/") for f in desired}
        for path, entry in existing.items():
            if path not in wanted:
                changes.append({"operation": "delete", "path": path,
                                "sha": entry["sha"]})

    if not changes:
        return {"changed": 0, "commit": None}

    res = await commit_files(login, repo_id, changes, message=message,
                             branch=branch, author_name=author_name,
                             author_email=author_email)
    return {"changed": len(changes), "commit": (res or {}).get("commit")}


# ─── history, branches, diffs ─────────────────────────────────────────────────

async def commits(login: str, repo_id: str, *, branch: str = DEFAULT_BRANCH,
                  page: int = 1, limit: int = 30) -> list[dict]:
    try:
        data = await _req("GET", f"/repos/{login}/{repo_id}/commits", sudo=login,
                          params={"sha": branch, "page": page, "limit": limit,
                                  "stat": "true"})
    except GiteaError as e:
        if e.status in (404, 409):
            return []
        raise
    out = []
    for c in data or []:
        commit = c.get("commit") or {}
        author = commit.get("author") or {}
        stats = c.get("stats") or {}
        out.append({
            "sha": c.get("sha", ""),
            "short_sha": (c.get("sha") or "")[:7],
            "message": (commit.get("message") or "").strip(),
            "author_name": author.get("name", ""),
            "author_email": author.get("email", ""),
            "date": author.get("date", ""),
            "avatar": (c.get("author") or {}).get("avatar_url", ""),
            "additions": stats.get("additions", 0),
            "deletions": stats.get("deletions", 0),
        })
    return out


async def branches(login: str, repo_id: str) -> list[dict]:
    try:
        data = await _req("GET", f"/repos/{login}/{repo_id}/branches", sudo=login)
    except GiteaError as e:
        if e.status in (404, 409):
            return []
        raise
    return [{"name": b["name"],
             "sha": (b.get("commit") or {}).get("id", ""),
             "protected": b.get("protected", False)} for b in data or []]


async def create_branch(login: str, repo_id: str, name: str,
                        from_branch: str = DEFAULT_BRANCH) -> dict:
    return await _req("POST", f"/repos/{login}/{repo_id}/branches", sudo=login,
                      json={"new_branch_name": name, "old_branch_name": from_branch})


async def delete_branch(login: str, repo_id: str, name: str) -> None:
    await _req("DELETE", f"/repos/{login}/{repo_id}/branches/{name}", sudo=login)


async def commit_diff(login: str, repo_id: str, sha: str) -> str:
    """Unified diff for a single commit, as text."""
    raw = await _req("GET", f"/repos/{login}/{repo_id}/git/commits/{sha}.diff",
                     sudo=login, raw=True)
    return raw.decode("utf-8", errors="replace")


# ─── import / fork ────────────────────────────────────────────────────────────

async def migrate(login: str, repo_id: str, clone_url: str, *,
                  description: str = "", private: bool = False,
                  mirror: bool = False) -> dict:
    """Full-history clone of an external repo (GitHub, GitLab, any git URL)."""
    return await _req("POST", "/repos/migrate", sudo=login, json={
        "clone_addr": clone_url,
        "repo_name": repo_id,
        "repo_owner": login,
        "description": description[:255],
        "private": bool(private),
        "mirror": bool(mirror),
        "service": "git",
        "wiki": False, "issues": False, "pull_requests": False,
        "releases": False, "milestones": False, "labels": False,
    })


async def fork_repo(src_login: str, src_repo_id: str, dst_login: str,
                    new_repo_id: str) -> dict:
    """Real git fork — preserves full history, unlike a content copy."""
    return await _req("POST", f"/repos/{src_login}/{src_repo_id}/forks",
                      sudo=dst_login, json={"name": new_repo_id})


async def repo_size(login: str, repo_id: str) -> int:
    try:
        return (await get_repo(login, repo_id)).get("size", 0) * 1024
    except GiteaError:
        return 0
