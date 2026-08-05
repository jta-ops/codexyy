#!/usr/bin/env python3
"""
One-shot migration: codexyy `repo_files` rows -> real Gitea repositories.

Idempotent. Repos already marked migrated=1 are skipped, so it is safe to
re-run after a partial failure. `repo_files` is never deleted — it stays as
the pre-migration backup.

    GITEA_TOKEN=... python3 migrate_to_gitea.py [--dry-run]
"""

import asyncio
import sys

import aiosqlite

import gitea

DB = "/home/ubuntu/codexyy/data.db"
DRY = "--dry-run" in sys.argv


async def main():
    version = await gitea.ping()
    if not version:
        print("FATAL: Gitea unreachable at", gitea.GITEA_URL)
        return 1
    print(f"Gitea {version} at {gitea.GITEA_URL}")
    if DRY:
        print("--- DRY RUN, nothing will be written ---")

    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        repos = [dict(r) for r in await (await db.execute(
            "SELECT * FROM repos ORDER BY created_at")).fetchall()]
        users = {u["id"]: dict(u) for u in await (await db.execute(
            "SELECT * FROM users")).fetchall()}

    ok = skipped = failed = 0
    for repo in repos:
        rid, name = repo["id"], repo["name"]
        if repo.get("migrated"):
            print(f"  = {rid} {name!r}: already migrated")
            skipped += 1
            continue

        user = users.get(repo["user_id"])
        if not user:
            print(f"  ! {rid} {name!r}: orphaned (user {repo['user_id']} gone)")
            failed += 1
            continue

        async with aiosqlite.connect(DB) as db:
            db.row_factory = aiosqlite.Row
            files = [dict(f) for f in await (await db.execute(
                "SELECT path,content FROM repo_files WHERE repo_id=? ORDER BY path",
                (rid,))).fetchall()]

        print(f"  > {rid} {name!r}: {len(files)} file(s), owner={user.get('email')}")
        if DRY:
            for f in files:
                print(f"        {f['path']} ({len(f['content'])}b)")
            continue

        try:
            login = await gitea.ensure_user(user)

            # Fresh start if a previous run left a partial repo behind.
            try:
                await gitea.get_repo(login, rid)
                await gitea.delete_repo(login, rid)
                print("        (removed partial repo from an earlier run)")
            except gitea.GiteaError:
                pass

            await gitea.create_repo(login, rid,
                                    description=repo.get("description") or "",
                                    private=bool(repo.get("private")))

            desired = [{"path": f["path"], "content": f["content"]} for f in files]
            if not desired:
                desired = [{"path": "README.md",
                            "content": f"# {name}\n\n{repo.get('description') or ''}\n"}]

            res = await gitea.sync_files(
                login, rid, desired,
                message="Import from codexyy (pre-git storage)",
                author_name=user.get("name") or login,
                author_email=user.get("email", ""))

            n_files = len(await gitea.list_tree(login, rid))
            n_commits = len(await gitea.commits(login, rid, limit=50))

            async with aiosqlite.connect(DB) as db:
                await db.execute(
                    "UPDATE repos SET gitea_owner=?, default_branch=?, file_count=?, "
                    "commit_count=?, migrated=1 WHERE id=?",
                    (login, gitea.DEFAULT_BRANCH, n_files, n_commits, rid))
                await db.commit()

            print(f"        -> {login}/{rid}: {n_files} file(s), "
                  f"{n_commits} commit(s), {res['changed']} change(s)")
            ok += 1
        except Exception as e:
            print(f"        FAILED: {e}")
            failed += 1

    print(f"\nmigrated={ok} skipped={skipped} failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
