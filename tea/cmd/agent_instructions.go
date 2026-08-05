// Copyright 2026 codexyy. All rights reserved.
// SPDX-License-Identifier: MIT

package cmd

// agentInstructions is written to the agent's config directory as AGENTS.md.
// The engine loads it into every session, so the model knows the cxy CLI exists
// and how to use it without the user explaining it each time.
//
// Written with indented code blocks rather than fenced ones so the whole
// document fits in a Go raw string literal without backtick gymnastics.
const agentInstructions = `# codexyy

You are running inside codexyy. The user's repositories live on codexyy and are
reachable from this machine through the **cxy** command line tool, which is
already installed and signed in.

## Automatic codexyy workflow

The cxy executable and the user's saved login are already available in this
environment. Do not ask the user to install cxy, paste an access token, download
a zip, or manually upload files when cxy can do the work.

When the user refers to one of their codexyy repositories, a repository name or
id, or asks what they have hosted on codexyy:

1. Run "cxy repos ls -o json" when you need to identify the repository.
2. Run "cxy task start <repo> <short-task-name> -o json" before editing. This
   creates a unique branch and isolated workspace; use the returned directory.
3. Run "cxy checkpoint create <directory> --name before-edit" before editing,
   then work in that task workspace with the normal local tools.
4. Run relevant checks and inspect the diff.
5. Run "cxy push <repo> <directory> --dry-run" and show the visible push plan.
6. Only after the user approves that exact plan, run
   "cxy push <repo> <directory> --yes -m 'specific message'".

Use cxy directly and recover from ordinary command errors yourself. Ask the
user only when a destructive choice, missing authorization, or ambiguous
repository genuinely requires their decision.

## cxy — the codexyy CLI

Repositories are addressed by **id** (for example j2d2re15qa) or by **name**
when that name is unambiguous among the user's repos. Every listing command
accepts "-o json" for machine-readable output — prefer that when you need to
parse results rather than show them.

### Working with a repository

    cxy repos ls                          list the user's repositories
    cxy repos ls -o json                  same, as JSON
    cxy repos info <repo>                 details: branch, files, visibility
    cxy task start <repo> <task> -o json dedicated branch + isolated workspace
    cxy task ls -o json                   list isolated task workspaces
    cxy checkpoint create ./dir -n before snapshot the entire working tree
    cxy checkpoint ls                     list snapshots available to /undo
    cxy checkpoint restore <id> ./dir     preview a repository-wide restore
    cxy checkpoint restore <id> ./dir -y  approve that restore plan
    cxy pull <repo> ./dir                 download without task isolation
    cxy push <repo> ./dir -m "message" -n preview the exact push plan
    cxy push <repo> ./dir -m "message" -y approve and commit that plan
    cxy push <repo> ./dir -n              dry run: show what would be pushed
    cxy cat <repo> <path>                 print one file to stdout

"cxy push" uploads the directory as ONE real git commit. Files deleted locally
are deleted in the repository too, unless you pass "--no-prune". It already
skips node_modules, .git, __pycache__, venv, dist, binaries, and files over
500 KB. If nothing changed, it makes no commit at all.

### History and branches

    cxy log <repo>                        commit history with +/- stats
    cxy diff <repo> [sha]                 what a commit changed (latest by default)
    cxy branches <repo>                   list branches
    cxy branches create <repo> <name>     new branch
    cxy branches rm <repo> <name>         delete a branch

### Creating, sharing, importing

    cxy repos create <name> -L python     new repository with a language scaffold
    cxy repos explore [query]             browse public repositories
    cxy repos fork <repo>                 fork, preserving full history
    cxy repos import <github-url>         import a GitHub repo with full history
    cxy repos rm <repo>                   delete (asks for confirmation)
    cxy open <repo>                       open it in the user's browser

### Account

    cxy whoami                            who the user is signed in as
    cxy login                             sign in (opens a browser)

## When to reach for cxy

- The user mentions **their codexyy repository**, or names a repo or id:
  use "cxy pull" to bring it local, edit the files, then "cxy push".
- The user asks **what they have**: "cxy repos ls".
- The user asks about **history or a past change**: "cxy log" and "cxy diff".
- The user wants work **saved to codexyy**: "cxy push" with a commit message
  that describes what actually changed, not a generic one.

Ordinary local work does not need cxy — it is only for repositories hosted on
codexyy. Files in the current directory are plain files; edit them directly with
your normal tools.

Always run a push with "-n" first, show the user the plan, and wait for approval
before repeating it with "--yes". Never push files the user did not intend to
publish, such as credentials or .env files.
`
