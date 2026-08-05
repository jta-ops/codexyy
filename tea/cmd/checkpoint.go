// Copyright 2026 codexyy. All rights reserved.
// SPDX-License-Identifier: MIT

package cmd

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/urfave/cli/v3"
)

type checkpointManifest struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Source    string `json:"source"`
	CreatedAt string `json:"created_at"`
	Files     int    `json:"files"`
	SHA256    string `json:"sha256"`
}

var CmdCheckpoint = cli.Command{
	Name: "checkpoint", Aliases: []string{"undo"}, Usage: "Snapshot or restore an entire working tree",
	Commands: []*cli.Command{
		{Name: "create", Aliases: []string{"save"}, Usage: "Create a repository-wide checkpoint", ArgsUsage: "[directory]", Action: runCheckpointCreate, Flags: []cli.Flag{&cli.StringFlag{Name: "name", Aliases: []string{"n"}}}},
		{Name: "list", Aliases: []string{"ls"}, Usage: "List repository-wide checkpoints", Action: runCheckpointList, Flags: []cli.Flag{outputFlag}},
		{Name: "restore", Usage: "Preview or restore a checkpoint", ArgsUsage: "<checkpoint-id> [directory]", Action: runCheckpointRestore, Flags: []cli.Flag{&cli.BoolFlag{Name: "yes", Aliases: []string{"y"}, Usage: "Approve the displayed restore plan"}}},
	},
}

func checkpointDir() string { return filepath.Join(stateDir(), "checkpoints") }

func safeCheckpointRoot(path string) (string, error) {
	abs, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return "", err
	}
	home, _ := os.UserHomeDir()
	if abs == string(filepath.Separator) || (home != "" && abs == filepath.Clean(home)) {
		return "", fmt.Errorf("refusing to checkpoint or restore broad directory %s", abs)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%s is not a directory", abs)
	}
	return abs, nil
}

func checkpointFiles(root string) ([]string, error) {
	var files []string
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
		name := strings.ToLower(info.Name())
		if name == ".env" || strings.HasPrefix(name, ".env.") || strings.HasSuffix(name, ".pem") || strings.HasSuffix(name, ".p12") || strings.HasSuffix(name, ".pfx") {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files = append(files, filepath.ToSlash(rel))
		return nil
	})
	sort.Strings(files)
	return files, err
}

func runCheckpointCreate(_ context.Context, cmd *cli.Command) error {
	dir := cmd.Args().First()
	if dir == "" {
		dir = "."
	}
	root, err := safeCheckpointRoot(dir)
	if err != nil {
		return err
	}
	files, err := checkpointFiles(root)
	if err != nil {
		return err
	}
	random, err := randomID()
	if err != nil {
		return err
	}
	id := time.Now().UTC().Format("20060102-150405") + "-" + random
	if err := os.MkdirAll(checkpointDir(), 0o700); err != nil {
		return err
	}
	archivePath := filepath.Join(checkpointDir(), id+".zip")
	out, err := os.OpenFile(archivePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(out)
	for _, rel := range files {
		data, readErr := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
		if readErr != nil {
			zw.Close()
			out.Close()
			return readErr
		}
		entry, createErr := zw.Create(rel)
		if createErr != nil {
			zw.Close()
			out.Close()
			return createErr
		}
		if _, writeErr := entry.Write(data); writeErr != nil {
			zw.Close()
			out.Close()
			return writeErr
		}
	}
	if err := zw.Close(); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	data, err := os.ReadFile(archivePath)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(data)
	manifest := checkpointManifest{ID: id, Name: strings.TrimSpace(cmd.String("name")), Source: root, CreatedAt: time.Now().UTC().Format(time.RFC3339), Files: len(files), SHA256: hex.EncodeToString(sum[:])}
	meta, _ := json.MarshalIndent(manifest, "", "  ")
	if err := os.WriteFile(filepath.Join(checkpointDir(), id+".json"), append(meta, '\n'), 0o600); err != nil {
		return err
	}
	fmt.Printf("  Checkpoint %s saved (%d files)\n", id, len(files))
	return nil
}

func checkpointManifests() ([]checkpointManifest, error) {
	entries, err := os.ReadDir(checkpointDir())
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []checkpointManifest
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(checkpointDir(), entry.Name()))
		if err != nil {
			return nil, err
		}
		var item checkpointManifest
		if json.Unmarshal(data, &item) == nil {
			out = append(out, item)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out, nil
}

func runCheckpointList(_ context.Context, cmd *cli.Command) error {
	items, err := checkpointManifests()
	if err != nil {
		return err
	}
	if cmd.String("output") == "json" {
		return json.NewEncoder(cmd.Writer).Encode(items)
	}
	if len(items) == 0 {
		fmt.Println("  No checkpoints yet.")
		return nil
	}
	for _, item := range items {
		fmt.Printf("  %s  %-18s %4d files  %s\n", item.ID, item.Name, item.Files, item.Source)
	}
	return nil
}

func runCheckpointRestore(_ context.Context, cmd *cli.Command) error {
	args := cmd.Args().Slice()
	if len(args) == 0 {
		return fmt.Errorf("a checkpoint id is required")
	}
	id := filepath.Base(args[0])
	if id != args[0] {
		return fmt.Errorf("invalid checkpoint id")
	}
	metaData, err := os.ReadFile(filepath.Join(checkpointDir(), id+".json"))
	if err != nil {
		return fmt.Errorf("checkpoint %s not found", id)
	}
	var manifest checkpointManifest
	if err := json.Unmarshal(metaData, &manifest); err != nil {
		return err
	}
	target := manifest.Source
	if len(args) > 1 {
		target = args[1]
	}
	root, err := safeCheckpointRoot(target)
	if err != nil {
		return err
	}
	archivePath := filepath.Join(checkpointDir(), id+".zip")
	archiveData, err := os.ReadFile(archivePath)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(archiveData)
	if hex.EncodeToString(sum[:]) != manifest.SHA256 {
		return fmt.Errorf("checkpoint checksum mismatch")
	}
	zr, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer zr.Close()
	wanted := map[string]bool{}
	for _, f := range zr.File {
		wanted[f.Name] = true
	}
	current, err := checkpointFiles(root)
	if err != nil {
		return err
	}
	deletes := 0
	for _, rel := range current {
		if !wanted[rel] {
			deletes++
		}
	}
	fmt.Printf("  Restore plan for %s\n    write %d checkpoint file(s)\n    remove %d post-checkpoint file(s)\n", root, len(zr.File), deletes)
	if !cmd.Bool("yes") {
		return fmt.Errorf("approval required — review the plan, then rerun with --yes")
	}
	for _, rel := range current {
		if !wanted[rel] {
			if err := os.Remove(filepath.Join(root, filepath.FromSlash(rel))); err != nil {
				return err
			}
		}
	}
	for _, f := range zr.File {
		dest := filepath.Join(root, filepath.FromSlash(f.Name))
		if !strings.HasPrefix(dest, root+string(os.PathSeparator)) {
			return fmt.Errorf("unsafe checkpoint path %s", f.Name)
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		src, err := f.Open()
		if err != nil {
			return err
		}
		dst, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
		if err != nil {
			src.Close()
			return err
		}
		_, copyErr := io.Copy(dst, src)
		src.Close()
		dst.Close()
		if copyErr != nil {
			return copyErr
		}
	}
	fmt.Printf("  Restored checkpoint %s\n", id)
	return nil
}
