// Copyright 2026 codexyy. All rights reserved.
// SPDX-License-Identifier: MIT

package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/urfave/cli/v3"

	"codexyy.dev/cxy/modules/codexyy"
	"codexyy.dev/cxy/modules/print"
)

// skipDirs are never uploaded: they are build output or local state, and
// pushing them would blow past the API's file limits for no benefit.
var skipDirs = map[string]bool{
	".git": true, "node_modules": true, "__pycache__": true, ".venv": true,
	"venv": true, "dist": true, "build": true, ".next": true, "target": true,
	".idea": true, ".vscode": true, ".mypy_cache": true, ".pytest_cache": true,
}

const maxPushBytes = 500_000

// CmdPull downloads a repository into a local directory.
var CmdPull = cli.Command{
	Name:      "pull",
	Aliases:   []string{"clone", "download"},
	Usage:     "Download a repository into a local directory",
	ArgsUsage: "<repo> [directory]",
	Description: "Writes every file of the repository at the given branch into a " +
		"local directory, creating it if needed. Existing files are overwritten.",
	Action: runPull,
	Flags: []cli.Flag{
		loginFlag, branchFlag,
		&cli.BoolFlag{Name: "force", Aliases: []string{"f"}, Usage: "Overwrite a non-empty directory"},
	},
}

func runPull(ctx context.Context, cmd *cli.Command) error {
	client, id, rest, err := repoAndRest(cmd)
	if err != nil {
		return err
	}
	repo, err := client.GetRepo(id, cmd.String("branch"))
	if err != nil {
		return friendlyAuthError(err)
	}

	dir := repo.Name
	if len(rest) > 0 && rest[0] != "" {
		dir = rest[0]
	}
	dir = filepath.Clean(dir)

	if entries, err := os.ReadDir(dir); err == nil && len(entries) > 0 && !cmd.Bool("force") {
		return fmt.Errorf("%s is not empty — pass --force to overwrite", dir)
	}
	written, err := writeRepoFiles(dir, repo.Files)
	if err != nil {
		return err
	}

	fmt.Printf("  Pulled %s (%s) → %s\n", repo.Name, repo.Branch, dir)
	fmt.Printf("  %d file(s)\n", written)
	return nil
}

// writeRepoFiles materializes an API repository tree without allowing a file
// path supplied by the server to escape the chosen workspace.
func writeRepoFiles(dir string, files []codexyy.File) (int, error) {
	dir = filepath.Clean(dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return 0, err
	}
	written := 0
	for _, f := range files {
		if f.Truncated {
			fmt.Printf("  skipped %s (too large to fetch)\n", f.Path)
			continue
		}
		// Defend against a malicious path escaping the target directory.
		dest := filepath.Join(dir, filepath.FromSlash(f.Path))
		if !strings.HasPrefix(dest, filepath.Clean(dir)+string(os.PathSeparator)) {
			fmt.Printf("  skipped %s (unsafe path)\n", f.Path)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return written, err
		}
		if err := os.WriteFile(dest, []byte(f.Content), 0o644); err != nil {
			return written, err
		}
		written++
	}
	return written, nil
}

// CmdPush commits a local directory back to a repository.
var CmdPush = cli.Command{
	Name:      "push",
	Aliases:   []string{"commit"},
	Usage:     "Commit a local directory back to a repository",
	ArgsUsage: "<repo> [directory]",
	Description: "Uploads the directory as a single commit. Files deleted locally " +
		"are deleted in the repository too, unless --no-prune is given.",
	Action: runPush,
	Flags: []cli.Flag{
		loginFlag, branchFlag,
		&cli.StringFlag{Name: "message", Aliases: []string{"m"}, Usage: "Commit message"},
		&cli.BoolFlag{Name: "no-prune", Usage: "Keep remote files that no longer exist locally"},
		&cli.BoolFlag{Name: "dry-run", Aliases: []string{"n"}, Usage: "Show what would be pushed and stop"},
		&cli.BoolFlag{Name: "yes", Aliases: []string{"y"}, Usage: "Approve the displayed push plan"},
	},
}

func collectFiles(dir string) ([]codexyy.File, error) {
	var out []codexyy.File
	root := filepath.Clean(dir)

	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if path != root && skipDirs[info.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if info.Size() > maxPushBytes {
			fmt.Printf("  skipped %s (%d bytes, over the %d limit)\n",
				path, info.Size(), maxPushBytes)
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		lowerName := strings.ToLower(info.Name())
		if lowerName == ".env" || strings.HasPrefix(lowerName, ".env.") ||
			strings.HasSuffix(lowerName, ".pem") || strings.HasSuffix(lowerName, ".p12") ||
			strings.HasSuffix(lowerName, ".pfx") || strings.Contains(string(data), "-----BEGIN PRIVATE KEY-----") {
			fmt.Printf("  skipped %s (possible credential file)\n", path)
			return nil
		}
		// Binary files cannot round-trip through the JSON text API.
		if !isProbablyText(data) {
			fmt.Printf("  skipped %s (binary)\n", path)
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		out = append(out, codexyy.File{
			Path:    filepath.ToSlash(rel),
			Content: string(data),
		})
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, err
}

func isProbablyText(b []byte) bool {
	n := len(b)
	if n > 8000 {
		n = 8000
	}
	for _, c := range b[:n] {
		if c == 0 {
			return false
		}
	}
	return true
}

func runPush(ctx context.Context, cmd *cli.Command) error {
	client, id, rest, err := repoAndRest(cmd)
	if err != nil {
		return err
	}
	dir := "."
	if len(rest) > 0 && rest[0] != "" {
		dir = rest[0]
	}
	if ok, err := dirExists(dir); err != nil || !ok {
		return fmt.Errorf("%s is not a directory", dir)
	}

	files, err := collectFiles(dir)
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return fmt.Errorf("no pushable files found in %s", dir)
	}

	remote, err := client.GetRepo(id, cmd.String("branch"))
	if err != nil {
		return friendlyAuthError(err)
	}
	remoteFiles := make(map[string]string, len(remote.Files))
	for _, file := range remote.Files {
		remoteFiles[file.Path] = file.Content
	}
	localFiles := make(map[string]string, len(files))
	var changes []string
	for _, file := range files {
		localFiles[file.Path] = file.Content
		old, exists := remoteFiles[file.Path]
		if !exists {
			changes = append(changes, fmt.Sprintf("+ %s (%d bytes)", file.Path, len(file.Content)))
		} else if old != file.Content {
			changes = append(changes, fmt.Sprintf("~ %s (%d → %d bytes)", file.Path, len(old), len(file.Content)))
		}
	}
	if !cmd.Bool("no-prune") {
		for path, old := range remoteFiles {
			if _, exists := localFiles[path]; !exists {
				changes = append(changes, fmt.Sprintf("- %s (%d bytes)", path, len(old)))
			}
		}
	}
	sort.Strings(changes)
	if len(changes) == 0 {
		fmt.Println("  Nothing to commit — the repository already matches this directory.")
		return nil
	}
	fmt.Printf("  Push plan for %s (%s):\n", remote.Name, remote.Branch)
	for _, change := range changes {
		fmt.Printf("    %s\n", change)
	}
	if cmd.Bool("dry-run") {
		fmt.Printf("\n  Dry run only — %d change(s), nothing uploaded.\n", len(changes))
		return nil
	}
	if !cmd.Bool("yes") {
		return fmt.Errorf("approval required — review the plan, then rerun with --yes")
	}

	msg := cmd.String("message")
	if msg == "" {
		msg = fmt.Sprintf("Update %d file(s) from cxy", len(files))
	}

	res, err := client.Push(id, files, msg, cmd.String("branch"), !cmd.Bool("no-prune"))
	if err != nil {
		return friendlyAuthError(err)
	}
	if res.Commit == nil || res.Changed == 0 {
		fmt.Println("  Nothing to commit — the repository already matches this directory.")
		return nil
	}
	fmt.Printf("  [%s] %s\n", res.Commit.ShortSHA, res.Commit.Message)
	fmt.Printf("  %d change(s), %d file(s) now tracked\n", res.Changed, res.FileCount)
	return nil
}

func dirExists(p string) (bool, error) {
	fi, err := os.Stat(p)
	if err != nil {
		return false, err
	}
	return fi.IsDir(), nil
}

// CmdCat prints one file to stdout.
var CmdCat = cli.Command{
	Name:      "cat",
	Usage:     "Print a file from a repository",
	ArgsUsage: "<repo> <path>",
	Action:    runCat,
	Flags:     []cli.Flag{loginFlag, branchFlag},
}

func runCat(ctx context.Context, cmd *cli.Command) error {
	client, id, rest, err := repoAndRest(cmd)
	if err != nil {
		return err
	}
	if len(rest) == 0 {
		return fmt.Errorf("a file path is required: cxy cat <repo> <path>")
	}
	content, err := client.GetFile(id, rest[0], cmd.String("branch"))
	if err != nil {
		if codexyy.IsNotFound(err) {
			return fmt.Errorf("no such file: %s", rest[0])
		}
		return friendlyAuthError(err)
	}
	fmt.Print(content)
	return nil
}

// CmdLog shows commit history.
var CmdLog = cli.Command{
	Name:      "log",
	Aliases:   []string{"history"},
	Usage:     "Show commit history",
	ArgsUsage: "<repo>",
	Action:    runLog,
	Flags: []cli.Flag{
		loginFlag, outputFlag, branchFlag,
		&cli.IntFlag{Name: "limit", Aliases: []string{"lm"}, Value: 30, Usage: "Number of commits"},
	},
}

func runLog(ctx context.Context, cmd *cli.Command) error {
	client, id, _, err := repoAndRest(cmd)
	if err != nil {
		return err
	}
	commits, err := client.Commits(id, cmd.String("branch"), cmd.Int("limit"))
	if err != nil {
		return friendlyAuthError(err)
	}
	if len(commits) == 0 {
		fmt.Println("  No commits yet.")
		return nil
	}
	rows := make([][]string, 0, len(commits))
	for _, c := range commits {
		rows = append(rows, []string{
			c.ShortSHA,
			strings.SplitN(c.Message, "\n", 2)[0],
			c.Author,
			"+" + strconv.Itoa(c.Additions) + "/-" + strconv.Itoa(c.Deletions),
			shortDate(c.Date),
		})
	}
	return print.Table(
		[]string{"SHA", "MESSAGE", "AUTHOR", "CHANGES", "DATE"},
		rows, cmd.String("output"))
}

func shortDate(iso string) string {
	if len(iso) >= 16 {
		return strings.Replace(iso[:16], "T", " ", 1)
	}
	return iso
}

// CmdDiff shows what a commit changed.
var CmdDiff = cli.Command{
	Name:      "diff",
	Aliases:   []string{"show"},
	Usage:     "Show the changes made by a commit",
	ArgsUsage: "<repo> <sha>",
	Action:    runDiff,
	Flags: []cli.Flag{
		loginFlag,
		&cli.BoolFlag{Name: "no-color", Usage: "Disable coloured output"},
	},
}

func runDiff(ctx context.Context, cmd *cli.Command) error {
	client, id, rest, err := repoAndRest(cmd)
	if err != nil {
		return err
	}
	sha := ""
	if len(rest) > 0 {
		sha = rest[0]
	}
	if sha == "" {
		// Default to the newest commit, which is what people usually want.
		commits, err := client.Commits(id, "", 1)
		if err != nil {
			return friendlyAuthError(err)
		}
		if len(commits) == 0 {
			return fmt.Errorf("no commits yet")
		}
		sha = commits[0].SHA
	}
	diff, err := client.Diff(id, sha)
	if err != nil {
		return friendlyAuthError(err)
	}
	if cmd.Bool("no-color") || os.Getenv("NO_COLOR") != "" {
		fmt.Print(diff)
		return nil
	}
	for _, line := range strings.Split(diff, "\n") {
		switch {
		case strings.HasPrefix(line, "+++"), strings.HasPrefix(line, "---"),
			strings.HasPrefix(line, "diff "), strings.HasPrefix(line, "index "):
			fmt.Printf("\033[90m%s\033[0m\n", line)
		case strings.HasPrefix(line, "@@"):
			fmt.Printf("\033[36m%s\033[0m\n", line)
		case strings.HasPrefix(line, "+"):
			fmt.Printf("\033[32m%s\033[0m\n", line)
		case strings.HasPrefix(line, "-"):
			fmt.Printf("\033[31m%s\033[0m\n", line)
		default:
			fmt.Println(line)
		}
	}
	return nil
}

// CmdBranches manages branches.
var CmdBranches = cli.Command{
	Name:      "branches",
	Aliases:   []string{"branch"},
	Usage:     "List and manage branches",
	ArgsUsage: "<repo>",
	Action:    runBranchList,
	Flags:     []cli.Flag{loginFlag, outputFlag},
	Commands: []*cli.Command{
		{
			Name:      "list",
			Aliases:   []string{"ls"},
			Usage:     "List branches",
			ArgsUsage: "<repo>",
			Action:    runBranchList,
			Flags:     []cli.Flag{loginFlag, outputFlag},
		},
		{
			Name:      "create",
			Aliases:   []string{"new"},
			Usage:     "Create a branch",
			ArgsUsage: "<repo> <name>",
			Action:    runBranchCreate,
			Flags:     []cli.Flag{loginFlag, &cli.StringFlag{Name: "from", Usage: "Branch to fork from"}},
		},
		{
			Name:      "delete",
			Aliases:   []string{"rm"},
			Usage:     "Delete a branch",
			ArgsUsage: "<repo> <name>",
			Action:    runBranchDelete,
			Flags:     []cli.Flag{loginFlag},
		},
	},
}

func runBranchList(ctx context.Context, cmd *cli.Command) error {
	client, id, _, err := repoAndRest(cmd)
	if err != nil {
		return err
	}
	repo, err := client.GetRepo(id, "")
	if err != nil {
		return friendlyAuthError(err)
	}
	branches, err := client.Branches(id)
	if err != nil {
		return friendlyAuthError(err)
	}
	rows := make([][]string, 0, len(branches))
	for _, b := range branches {
		marker := ""
		if b.Name == repo.Branch {
			marker = "*"
		}
		sha := b.SHA
		if len(sha) > 7 {
			sha = sha[:7]
		}
		rows = append(rows, []string{marker, b.Name, sha})
	}
	return print.Table([]string{"", "NAME", "SHA"}, rows, cmd.String("output"))
}

func runBranchCreate(ctx context.Context, cmd *cli.Command) error {
	client, id, rest, err := repoAndRest(cmd)
	if err != nil {
		return err
	}
	if len(rest) == 0 {
		return fmt.Errorf("a branch name is required")
	}
	if err := client.CreateBranch(id, rest[0], cmd.String("from")); err != nil {
		return friendlyAuthError(err)
	}
	fmt.Printf("  Created branch %s\n", rest[0])
	return nil
}

func runBranchDelete(ctx context.Context, cmd *cli.Command) error {
	client, id, rest, err := repoAndRest(cmd)
	if err != nil {
		return err
	}
	if len(rest) == 0 {
		return fmt.Errorf("a branch name is required")
	}
	if err := client.DeleteBranch(id, rest[0]); err != nil {
		return friendlyAuthError(err)
	}
	fmt.Printf("  Deleted branch %s\n", rest[0])
	return nil
}

// CmdOpen opens a repository in the browser.
var CmdOpen = cli.Command{
	Name:      "open",
	Usage:     "Open a repository in your browser",
	ArgsUsage: "<repo>",
	Action:    runOpen,
	Flags:     []cli.Flag{loginFlag},
}

func runOpen(ctx context.Context, cmd *cli.Command) error {
	client, login, err := clientFor(cmd)
	if err != nil {
		return err
	}
	target := login.URL
	if ref := cmd.Args().First(); ref != "" {
		id, err := resolveRepo(client, ref)
		if err != nil {
			return err
		}
		target = fmt.Sprintf("%s/repo/%s", login.URL, id)
	}
	fmt.Printf("  %s\n", target)
	return openBrowser(target)
}
