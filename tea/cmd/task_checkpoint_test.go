// Copyright 2026 codexyy. All rights reserved.
// SPDX-License-Identifier: MIT

package cmd

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSafeSlug(t *testing.T) {
	if got := safeSlug(" Fix Login / OAuth!!! "); got != "fix-login-oauth" {
		t.Fatalf("safeSlug() = %q", got)
	}
	if got := safeSlug("***"); got != "task" {
		t.Fatalf("empty safeSlug() = %q", got)
	}
}

func TestTaskRegistryPermissions(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	tasks := []taskWorkspace{{ID: "one", RepoName: "repo", Branch: "agent/task-one"}}
	if err := saveTasks(tasks); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(taskRegistryPath())
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("registry mode = %o", info.Mode().Perm())
	}
	loaded, err := loadTasks()
	if err != nil || len(loaded) != 1 || loaded[0].Branch != tasks[0].Branch {
		t.Fatalf("loaded tasks = %#v, %v", loaded, err)
	}
}

func TestCheckpointRestoreIsRepositoryWide(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "kept.txt"), []byte("before"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := App().Run(context.Background(), []string{"cxy", "checkpoint", "create", root, "--name", "before"}); err != nil {
		t.Fatal(err)
	}
	items, err := checkpointManifests()
	if err != nil || len(items) != 1 {
		t.Fatalf("manifests = %#v, %v", items, err)
	}
	if items[0].Files != 1 {
		t.Fatalf("checkpoint included secret file: %d files", items[0].Files)
	}
	if err := os.WriteFile(filepath.Join(root, "kept.txt"), []byte("after"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "added.txt"), []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	err = App().Run(context.Background(), []string{"cxy", "checkpoint", "restore", items[0].ID, root})
	if err == nil || !strings.Contains(err.Error(), "approval required") {
		t.Fatalf("restore preview error = %v", err)
	}
	if err := App().Run(context.Background(), []string{"cxy", "checkpoint", "restore", items[0].ID, root, "--yes"}); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(filepath.Join(root, "kept.txt"))
	if string(data) != "before" {
		t.Fatalf("restored content = %q", data)
	}
	if _, err := os.Stat(filepath.Join(root, "added.txt")); !os.IsNotExist(err) {
		t.Fatalf("post-checkpoint file was not removed: %v", err)
	}
	secret, _ := os.ReadFile(filepath.Join(root, ".env"))
	if string(secret) != "secret" {
		t.Fatalf("excluded secret was changed")
	}
}
