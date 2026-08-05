// Copyright 2026 codexyy. All rights reserved.
// SPDX-License-Identifier: MIT

package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"codexyy.dev/cxy/modules/codexyy"
)

func TestWriteAgentConfigAddsHostedModels(t *testing.T) {
	dir := t.TempDir()
	login := &codexyy.Login{URL: "https://codexyy.dev", Token: "test-token"}
	if err := writeAgentConfig(dir, login); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(dir, "xdg", "config", "opencode", "opencode.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	if config["model"] != "codexyy/@cf/meta/llama-3.3-70b-instruct-fp8-fast" {
		t.Fatalf("unexpected default model: %v", config["model"])
	}
	providers := config["provider"].(map[string]any)
	free := providers["codexyy"].(map[string]any)
	pro := providers["codexyy-pro"].(map[string]any)
	if got := len(free["models"].(map[string]any)); got != 9 {
		t.Fatalf("expected 9 hosted models, got %d", got)
	}
	if got := len(pro["models"].(map[string]any)); got != 7 {
		t.Fatalf("expected 7 Pro models, got %d", got)
	}
	if got := free["options"].(map[string]any)["apiKey"]; got != "test-token" {
		t.Fatalf("expected synchronized token, got %v", got)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("expected config mode 0600, got %04o", info.Mode().Perm())
	}
}
