// Copyright 2026 codexyy. All rights reserved.
// SPDX-License-Identifier: MIT

package cmd

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/urfave/cli/v3"
)

type taskWorkspace struct {
	ID        string `json:"id"`
	RepoID    string `json:"repo_id"`
	RepoName  string `json:"repo_name"`
	Task      string `json:"task"`
	Branch    string `json:"branch"`
	Directory string `json:"directory"`
	CreatedAt string `json:"created_at"`
}

var CmdTask = cli.Command{
	Name: "task", Usage: "Create and manage isolated agent task workspaces",
	Commands: []*cli.Command{
		{Name: "start", Usage: "Create a dedicated branch and workspace", ArgsUsage: "<repo> <task>", Action: runTaskStart,
			Flags: []cli.Flag{loginFlag, &cli.StringFlag{Name: "from", Usage: "Branch to fork from"}, &cli.StringFlag{Name: "directory", Aliases: []string{"d"}, Usage: "Workspace directory"}, outputFlag}},
		{Name: "list", Aliases: []string{"ls"}, Usage: "List local task workspaces", Action: runTaskList, Flags: []cli.Flag{outputFlag}},
	},
}

func stateDir() string {
	if base := os.Getenv("XDG_STATE_HOME"); base != "" {
		return filepath.Join(base, "codexyy")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".codexyy-state")
	}
	return filepath.Join(home, ".local", "state", "codexyy")
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

func safeSlug(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.Trim(nonSlug.ReplaceAllString(value, "-"), "-")
	if len(value) > 36 {
		value = strings.Trim(value[:36], "-")
	}
	if value == "" {
		return "task"
	}
	return value
}

func randomID() (string, error) {
	b := make([]byte, 3)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func taskRegistryPath() string { return filepath.Join(stateDir(), "tasks.json") }

func loadTasks() ([]taskWorkspace, error) {
	data, err := os.ReadFile(taskRegistryPath())
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var tasks []taskWorkspace
	if err := json.Unmarshal(data, &tasks); err != nil {
		return nil, fmt.Errorf("task registry is corrupt: %w", err)
	}
	return tasks, nil
}

func saveTasks(tasks []taskWorkspace) error {
	path := taskRegistryPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(tasks, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

func runTaskStart(_ context.Context, cmd *cli.Command) error {
	client, id, rest, err := repoAndRest(cmd)
	if err != nil {
		return err
	}
	if len(rest) == 0 || strings.TrimSpace(rest[0]) == "" {
		return fmt.Errorf("a task name is required")
	}
	repo, err := client.GetRepo(id, "")
	if err != nil {
		return friendlyAuthError(err)
	}
	random, err := randomID()
	if err != nil {
		return err
	}
	taskName := strings.TrimSpace(strings.Join(rest, " "))
	branch := fmt.Sprintf("agent/%s-%s", safeSlug(taskName), random)
	if err := client.CreateBranch(id, branch, cmd.String("from")); err != nil {
		return friendlyAuthError(err)
	}

	workspaceID := safeSlug(repo.Name) + "-" + safeSlug(taskName) + "-" + random
	dir := cmd.String("directory")
	if dir == "" {
		dir = filepath.Join(stateDir(), "workspaces", workspaceID)
	}
	dir, err = filepath.Abs(filepath.Clean(dir))
	if err != nil {
		return err
	}
	if entries, readErr := os.ReadDir(dir); readErr == nil && len(entries) > 0 {
		return fmt.Errorf("%s is not empty; choose another --directory", dir)
	}
	branched, err := client.GetRepo(id, branch)
	if err != nil {
		_ = client.DeleteBranch(id, branch)
		return friendlyAuthError(err)
	}
	if _, err := writeRepoFiles(dir, branched.Files); err != nil {
		_ = client.DeleteBranch(id, branch)
		return err
	}

	workspace := taskWorkspace{ID: workspaceID, RepoID: id, RepoName: repo.Name, Task: taskName, Branch: branch, Directory: dir, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	tasks, err := loadTasks()
	if err != nil {
		return err
	}
	if err := saveTasks(append(tasks, workspace)); err != nil {
		return err
	}
	if cmd.String("output") == "json" {
		return json.NewEncoder(cmd.Writer).Encode(workspace)
	}
	fmt.Printf("  Created isolated task workspace\n")
	fmt.Printf("  branch     %s\n  directory  %s\n", branch, dir)
	fmt.Printf("\n  Work there, then preview with:\n  cxy push %s %s --branch %s --dry-run\n", repo.Name, dir, branch)
	return nil
}

func runTaskList(_ context.Context, cmd *cli.Command) error {
	tasks, err := loadTasks()
	if err != nil {
		return err
	}
	sort.Slice(tasks, func(i, j int) bool { return tasks[i].CreatedAt > tasks[j].CreatedAt })
	if cmd.String("output") == "json" {
		return json.NewEncoder(cmd.Writer).Encode(tasks)
	}
	if len(tasks) == 0 {
		fmt.Println("  No task workspaces yet.")
		return nil
	}
	for _, task := range tasks {
		fmt.Printf("  %-24s %-34s %s\n", task.RepoName, task.Branch, task.Directory)
	}
	return nil
}
