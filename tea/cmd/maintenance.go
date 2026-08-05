// Copyright 2026 codexyy. All rights reserved.
// SPDX-License-Identifier: MIT

package cmd

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/urfave/cli/v3"

	"codexyy.dev/cxy/modules/codexyy"
	"codexyy.dev/cxy/modules/version"
)

var CmdDoctor = cli.Command{
	Name:   "doctor",
	Usage:  "Check CLI, account, agent, release, and API health",
	Action: runDoctor,
}

var CmdUpdate = cli.Command{
	Name:  "update",
	Usage: "Download and verify the latest cxy release",
	Flags: []cli.Flag{
		&cli.BoolFlag{Name: "check", Usage: "Check release availability without replacing cxy"},
	},
	Action: runUpdate,
}

func cliPlatform() (string, error) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		return "", fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}
	arch := runtime.GOARCH
	if arch != "amd64" && arch != "arm64" {
		return "", fmt.Errorf("unsupported architecture: %s", arch)
	}
	return runtime.GOOS + "-" + arch, nil
}

func doctorLine(ok bool, label, detail string) {
	mark, color := "✗", "\033[31m"
	if ok {
		mark, color = "✓", "\033[32m"
	}
	fmt.Printf("  %s%s\033[0m %-14s %s\n", color, mark, label, detail)
}

func runDoctor(_ context.Context, _ *cli.Command) error {
	fmt.Printf("\n  \033[1m\033[36mcxy doctor\033[0m\n\n")
	failures := 0
	platform, err := cliPlatform()
	platformDetail := platform
	if err != nil {
		platformDetail = err.Error()
	}
	doctorLine(err == nil, "platform", platformDetail)
	if err != nil {
		failures++
	}
	self, selfErr := os.Executable()
	doctorLine(selfErr == nil, "cli", map[bool]string{true: self, false: "executable unavailable"}[selfErr == nil])
	if selfErr != nil {
		failures++
	}
	pathOK := selfErr == nil && onPath(filepath.Dir(self))
	doctorLine(pathOK, "PATH", map[bool]string{true: "cxy directory is available", false: "add the cxy directory to PATH"}[pathOK])

	client := &http.Client{Timeout: 8 * time.Second}
	response, apiErr := client.Get("https://codexyy.dev/healthz")
	apiOK := apiErr == nil && response.StatusCode == http.StatusOK
	if response != nil {
		response.Body.Close()
	}
	doctorLine(apiOK, "API", map[bool]string{true: "codexyy.dev is healthy", false: "health check failed"}[apiOK])
	if !apiOK {
		failures++
	}

	releaseOK := false
	if err == nil {
		request, _ := http.NewRequest(http.MethodHead, "https://codexyy.dev/cli-dl/cxy-"+platform+".sha256", nil)
		if releaseResponse, releaseErr := client.Do(request); releaseErr == nil {
			releaseOK = releaseResponse.StatusCode == http.StatusOK
			releaseResponse.Body.Close()
		}
	}
	doctorLine(releaseOK, "release", map[bool]string{true: "SHA-256 checksum is published", false: "release checksum unavailable"}[releaseOK])
	if !releaseOK {
		failures++
	}

	config, configErr := codexyy.LoadConfig()
	var login *codexyy.Login
	if configErr == nil && config != nil {
		login = config.Get("")
	}
	authOK := configErr == nil && login != nil
	authDetail := "not signed in (run cxy login)"
	if authOK {
		if user, whoErr := codexyy.NewClient(login.URL, login.Token).Whoami(); whoErr == nil {
			authDetail = user.Email
		} else {
			authOK = false
			authDetail = "session expired (run cxy login)"
		}
	}
	doctorLine(authOK, "account", authDetail)

	agentDir := defaultAgentDir()
	agentPath := filepath.Join(agentDir, "bin", "opencode")
	_, agentErr := os.Stat(agentPath)
	doctorLine(agentErr == nil, "agent", map[bool]string{true: agentPath, false: "not installed (optional)"}[agentErr == nil])
	if agentErr == nil {
		engineVersion, readErr := os.ReadFile(filepath.Join(agentDir, "ENGINE_VERSION"))
		compatible := readErr == nil && strings.TrimSpace(string(engineVersion)) == agentEngineVersion
		detail := "engine " + strings.TrimSpace(string(engineVersion)) + " is compatible"
		if !compatible {
			detail = "run cxy install ai --force to align CLI and agent versions"
			failures++
		}
		doctorLine(compatible, "compatibility", detail)
	}

	if failures > 0 {
		fmt.Printf("\n  %d required check(s) need attention.\n\n", failures)
		return fmt.Errorf("doctor found %d required problem(s)", failures)
	}
	fmt.Printf("\n  \033[32mAll required checks passed.\033[0m\n\n")
	return nil
}

func runUpdate(_ context.Context, cmd *cli.Command) error {
	platform, err := cliPlatform()
	if err != nil {
		return err
	}
	url := "https://codexyy.dev/cli-dl/cxy-" + platform
	if cmd.Bool("check") {
		latestResponse, latestErr := (&http.Client{Timeout: 15 * time.Second}).Get("https://codexyy.dev/cli-dl/latest")
		latest := "unknown"
		if latestErr == nil {
			defer latestResponse.Body.Close()
			if latestResponse.StatusCode == http.StatusOK {
				content, _ := io.ReadAll(io.LimitReader(latestResponse.Body, 80))
				latest = strings.TrimSpace(string(content))
			}
		}
		request, _ := http.NewRequest(http.MethodHead, url+".sha256", nil)
		response, err := (&http.Client{Timeout: 15 * time.Second}).Do(request)
		if err != nil {
			return err
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return fmt.Errorf("release is unavailable (%d)", response.StatusCode)
		}
		fmt.Printf("  current %s · latest %s · verified release available for %s\n", version.Format(), latest, platform)
		return nil
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	self, err = filepath.EvalSymlinks(self)
	if err != nil {
		return err
	}
	temp := filepath.Join(filepath.Dir(self), ".cxy-update-"+fmt.Sprint(os.Getpid()))
	if err := download(url, temp, "cxy"); err != nil {
		return err
	}
	defer os.Remove(temp)
	if err := verifyDownload(url, temp); err != nil {
		return err
	}
	if err := os.Chmod(temp, 0o755); err != nil {
		return err
	}
	backup := self + ".previous"
	if err := os.Rename(self, backup); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "permission") {
			return fmt.Errorf("cannot update %s; rerun the curl installer for this system location", self)
		}
		return err
	}
	if err := os.Rename(temp, self); err != nil {
		_ = os.Rename(backup, self)
		return err
	}
	_ = os.Remove(backup)
	fmt.Printf("  \033[32m✓\033[0m updated and SHA-256 verified: %s\n", self)
	return nil
}
