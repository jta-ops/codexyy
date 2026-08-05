// Copyright 2026 codexyy. All rights reserved.
// SPDX-License-Identifier: MIT

package cmd

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/urfave/cli/v3"

	"codexyy.dev/cxy/modules/codexyy"
)

// The agent runs entirely on the user's machine: the engine, the models, and
// the files it edits never leave it. codexyy hosts the downloadable binary and
// the account it signs in to.
const (
	agentEngineVersion = "1.0.0"
	engineReleaseBase  = "https://codexyy.dev/agent-dl"
)

// CmdInstall groups local installation commands.
var CmdInstall = cli.Command{
	Name:  "install",
	Usage: "Install codexyy components on this machine",
	Commands: []*cli.Command{
		{
			Name:        "ai",
			Aliases:     []string{"agent"},
			Usage:       "Install the codexyy AI agent",
			Description: "Downloads the branded agent, prepares an isolated workspace, then installs the `codexyy` command.",
			Action:      runInstallAI,
			Flags: []cli.Flag{
				loginFlag,
				&cli.StringFlag{
					Name:  "dir",
					Usage: "Where to install",
					Value: defaultAgentDir(),
				},
				&cli.IntFlag{
					Name:    "port",
					Aliases: []string{"p"},
					Usage:   "Default port for the agent UI",
					Value:   4610,
				},
				&cli.StringFlag{
					Name:  "host",
					Usage: "Default bind mode: localhost or all",
					Value: "localhost",
				},
				&cli.BoolFlag{
					Name:  "no-login",
					Usage: "Skip signing in to codexyy",
				},
				&cli.BoolFlag{
					Name:  "force",
					Usage: "Reinstall even if already present",
				},
				&cli.BoolFlag{
					Name:  "dry-run",
					Usage: "Show downloads and file changes without installing",
				},
				&cli.StringFlag{
					Name:  "engine-archive",
					Usage: "Install from a local verified engine archive (offline bundles)",
				},
				&cli.StringFlag{
					Name:  "engine-sha256",
					Usage: "Expected SHA-256 for --engine-archive",
				},
			},
		},
	},
}

// CmdUninstall groups local removal commands.
var CmdUninstall = cli.Command{
	Name:   "uninstall",
	Usage:  "Uninstall codexyy components from this machine",
	Action: runUninstallAll,
	Flags: []cli.Flag{
		&cli.BoolFlag{Name: "all", Usage: "Remove the AI agent, CLI configuration, and this cxy binary"},
		&cli.BoolFlag{Name: "yes", Usage: "Confirm the complete removal"},
		&cli.BoolFlag{Name: "dry-run", Usage: "Show exactly what complete removal would delete"},
		&cli.StringFlag{Name: "dir", Usage: "Where the agent is installed", Value: defaultAgentDir()},
	},
	Commands: []*cli.Command{
		{
			Name:    "ai",
			Aliases: []string{"agent"},
			Usage:   "Uninstall the codexyy AI agent",
			Action:  runUninstallAI,
			Flags: []cli.Flag{
				&cli.StringFlag{
					Name:  "dir",
					Usage: "Where the agent is installed",
					Value: defaultAgentDir(),
				},
			},
		},
	},
}

func runUninstallAll(ctx context.Context, cmd *cli.Command) error {
	if !cmd.Bool("all") {
		return fmt.Errorf("choose a component, or use 'cxy uninstall --all --dry-run'")
	}
	if cmd.Bool("dry-run") {
		self, _ := os.Executable()
		fmt.Printf("  Complete uninstall plan (nothing removed):\n")
		fmt.Printf("    agent  %s\n", filepath.Clean(cmd.String("dir")))
		fmt.Printf("    config %s\n", codexyy.ConfigPath())
		if self != "" {
			fmt.Printf("    cli    %s\n", self)
		}
		return nil
	}
	if !cmd.Bool("yes") {
		return fmt.Errorf("complete removal requires --yes (preview first with --dry-run)")
	}
	if err := runUninstallAI(ctx, cmd); err != nil {
		return err
	}
	configPath := codexyy.ConfigPath()
	if err := os.Remove(configPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("could not remove CLI configuration: %w", err)
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	self, err = filepath.EvalSymlinks(self)
	if err != nil {
		return err
	}
	if err := os.Remove(self); err != nil {
		return fmt.Errorf("agent and configuration were removed, but cxy could not remove %s: %w", self, err)
	}
	fmt.Printf("  \033[32m✓\033[0m removed cxy and its local configuration\n")
	return nil
}

func defaultAgentDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".codexyy/agent"
	}
	return filepath.Join(home, ".codexyy", "agent")
}

// enginePlatform maps Go's platform names onto the engine's release assets.
func enginePlatform() (string, error) {
	var os_, arch string
	switch runtime.GOOS {
	case "linux":
		os_ = "linux"
	case "darwin":
		os_ = "darwin"
	default:
		return "", fmt.Errorf("unsupported operating system: %s (Linux and macOS are supported)", runtime.GOOS)
	}
	switch runtime.GOARCH {
	case "amd64":
		arch = "x64"
	case "arm64":
		arch = "arm64"
	default:
		return "", fmt.Errorf("unsupported architecture: %s (amd64 and arm64 are supported)", runtime.GOARCH)
	}
	return fmt.Sprintf("%s-%s", os_, arch), nil
}

func step(n int, total int, msg string) {
	fmt.Printf("  \033[2m[%d/%d]\033[0m %s\n", n, total, msg)
}

func done(msg string) { fmt.Printf("  \033[32m✓\033[0m %s\n", msg) }

// download fetches url into dest, reporting progress on a single line.
func download(url, dest, label string) error {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "cxy")
	res, err := (&http.Client{Timeout: 15 * time.Minute}).Do(req)
	if err != nil {
		return fmt.Errorf("could not reach %s: %w", url, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed (%d): %s", res.StatusCode, url)
	}

	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()

	total := res.ContentLength
	var written int64
	buf := make([]byte, 256*1024)
	last := time.Now()
	for {
		n, rerr := res.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				return werr
			}
			written += int64(n)
			if time.Since(last) > 120*time.Millisecond {
				if total > 0 {
					fmt.Printf("\r  \033[2m%s %d%%\033[0m", label, written*100/total)
				} else {
					fmt.Printf("\r  \033[2m%s %d MB\033[0m", label, written/(1<<20))
				}
				last = time.Now()
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	fmt.Print("\r\033[K")
	return nil
}

func verifyDownload(url, path string) error {
	req, err := http.NewRequest("GET", url+".sha256", nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "cxy")
	res, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("could not download release checksum: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("release checksum unavailable (%d)", res.StatusCode)
	}
	content, err := io.ReadAll(io.LimitReader(res.Body, 4096))
	if err != nil {
		return err
	}
	fields := strings.Fields(string(content))
	if len(fields) == 0 || len(fields[0]) != 64 {
		return fmt.Errorf("release checksum is invalid")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	actual := fmt.Sprintf("%x", hash.Sum(nil))
	if !strings.EqualFold(actual, fields[0]) {
		return fmt.Errorf("release checksum mismatch: download was not installed")
	}
	return nil
}

func verifyExpectedChecksum(path, expected string) error {
	expected = strings.TrimSpace(expected)
	if len(expected) != 64 {
		return fmt.Errorf("local engine checksum is invalid")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	actual := fmt.Sprintf("%x", hash.Sum(nil))
	if !strings.EqualFold(actual, expected) {
		return fmt.Errorf("local engine checksum mismatch")
	}
	return nil
}

func copyFile(source, destination string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(destination)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// extractTarGz unpacks a .tar.gz into dir, refusing any entry that would
// escape it.
func extractTarGz(src, dir string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()

	root := filepath.Clean(dir)
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		target := filepath.Join(root, filepath.Clean("/"+h.Name))
		if target != root && !strings.HasPrefix(target, root+string(os.PathSeparator)) {
			continue // path traversal attempt
		}
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, os.FileMode(h.Mode)&0o777)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return err
			}
			out.Close()
		}
	}
}

func runInstallAI(ctx context.Context, cmd *cli.Command) error {
	platform, err := enginePlatform()
	if err != nil {
		return err
	}

	dir := cmd.String("dir")
	if strings.HasPrefix(dir, "~/") {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, dir[2:])
	}
	dir, err = filepath.Abs(dir)
	if err != nil {
		return err
	}

	fmt.Printf("\n  \033[1m\033[36mcodexyy\033[0m\033[1m agent\033[0m  \033[2m· %s\033[0m\n\n", platform)
	engineURL := fmt.Sprintf("%s/engine-%s-%s.tar.gz", engineReleaseBase, agentEngineVersion, platform)
	localEngine := cmd.String("engine-archive")
	localChecksum := cmd.String("engine-sha256")
	if (localEngine == "") != (localChecksum == "") {
		return fmt.Errorf("--engine-archive and --engine-sha256 must be used together")
	}
	if cmd.Bool("dry-run") {
		fmt.Printf("  \033[1mdry run\033[0m — no files will be changed\n\n")
		if localEngine != "" {
			fmt.Printf("  archive   \033[2m%s\033[0m\n", localEngine)
			fmt.Printf("  verify    \033[2mlocal SHA-256\033[0m\n")
		} else {
			fmt.Printf("  download  \033[2m%s\033[0m\n", engineURL)
			fmt.Printf("  verify    \033[2m%s.sha256\033[0m\n", engineURL)
		}
		fmt.Printf("  install   \033[2m%s\033[0m\n", dir)
		fmt.Printf("  launcher  \033[2mcodexyy\033[0m\n")
		if !cmd.Bool("no-login") {
			fmt.Printf("  sign in   \033[2mdevice-code flow\033[0m\n")
		}
		fmt.Println()
		return nil
	}

	binPath := filepath.Join(dir, "bin", "opencode")
	if _, err := os.Stat(binPath); err == nil && !cmd.Bool("force") {
		fmt.Printf("  Already installed at \033[2m%s\033[0m\n", dir)
		fmt.Printf("  \033[2mreinstall with:  cxy install ai --force\033[0m\n\n")
		return nil
	}

	total := 3
	if !cmd.Bool("no-login") {
		total = 4
	}

	// 1 — engine
	step(1, total, "downloading agent engine")
	tmpEngine := filepath.Join(os.TempDir(), fmt.Sprintf("cxy-engine-%d.tar.gz", os.Getpid()))
	defer os.Remove(tmpEngine)
	if localEngine != "" {
		if err := copyFile(localEngine, tmpEngine); err != nil {
			return fmt.Errorf("could not read local engine archive: %w", err)
		}
		if err := verifyExpectedChecksum(tmpEngine, localChecksum); err != nil {
			return err
		}
	} else {
		if err := download(engineURL, tmpEngine, "engine"); err != nil {
			return err
		}
		if err := verifyDownload(engineURL, tmpEngine); err != nil {
			return err
		}
	}
	if err := extractTarGz(tmpEngine, filepath.Join(dir, "bin")); err != nil {
		return fmt.Errorf("could not unpack the engine: %w", err)
	}
	if err := os.Chmod(binPath, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "ENGINE_VERSION"), []byte(agentEngineVersion+"\n"), 0o644); err != nil {
		return err
	}
	done("engine")

	// 2 — isolate. The user may already run their own opencode; this install
	// must never read or write its config, data, or sessions.
	step(2, total, "preparing workspace")
	for _, sub := range []string{"xdg/data", "xdg/config", "xdg/cache", "xdg/state", "tmp"} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o755); err != nil {
			return err
		}
	}
	login := savedAgentLogin(cmd.String("login"))
	if err := writeAgentConfig(dir, login); err != nil {
		return err
	}
	if err := writeAgentInstructions(dir); err != nil {
		return err
	}
	if err := installAgentCXY(dir); err != nil {
		return err
	}
	done("workspace")

	// 3 — the `codexyy` command
	step(3, total, "installing the codexyy command")
	launcher, err := writeLauncher(dir, cmd.Int("port"), cmd.String("host"), codexyy.ConfigPath())
	if err != nil {
		return err
	}
	done(fmt.Sprintf("codexyy  \033[2m%s\033[0m", launcher))

	// 4 — sign in
	if !cmd.Bool("no-login") {
		step(4, total, "signing in to codexyy")
		if err := ensureLoggedIn(ctx, cmd); err != nil {
			fmt.Printf("  \033[33m!\033[0m %v\n", err)
			fmt.Printf("  \033[2msign in later with:  cxy login\033[0m\n")
		} else if login := savedAgentLogin(cmd.String("login")); login != nil {
			if err := writeAgentConfig(dir, login); err != nil {
				return err
			}
		}
	}

	name := filepath.Base(launcher)
	fmt.Printf("\n  \033[1mrun it\033[0m\n\n")
	fmt.Printf("    \033[36m%s\033[0m%s  \033[2mterminal interface\033[0m\n", name, strings.Repeat(" ", max(2, 20-len(name))))
	fmt.Printf("    \033[36m%s web\033[0m%s  \033[2mbrowser interface\033[0m\n\n", name, strings.Repeat(" ", max(2, 16-len(name))))

	if !onPath(filepath.Dir(launcher)) {
		fmt.Printf("  \033[2m%s is not on your PATH. Add:\033[0m\n", filepath.Dir(launcher))
		fmt.Printf("    export PATH=\"%s:$PATH\"\n\n", filepath.Dir(launcher))
	}
	return nil
}

// isOurLauncher reports whether a file is a launcher we previously wrote, so
// reinstalling replaces it rather than sidestepping to another name.
func isOurLauncher(path string) bool {
	head := make([]byte, 128)
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	n, _ := f.Read(head)
	return strings.Contains(string(head[:n]), "codexyy agent — runs entirely on this machine")
}

func onPath(dir string) bool {
	for _, p := range filepath.SplitList(os.Getenv("PATH")) {
		if p == dir {
			return true
		}
	}
	return false
}

// writeAgentConfig sets safe first-run defaults and registers every hosted
// codexyy model without overwriting unrelated user configuration.
func writeAgentConfig(dir string, login *codexyy.Login) error {
	cfgDir := filepath.Join(dir, "xdg", "config", "opencode")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		return err
	}
	cfg := filepath.Join(cfgDir, "opencode.json")
	config := map[string]any{
		"$schema": "https://opencode.ai/config.json",
		"theme":   "codexyy",
		"model":   "codexyy/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
	}
	data, err := os.ReadFile(cfg)
	if err == nil {
		if json.Unmarshal(data, &config) != nil {
			return nil // don't clobber a config the user may have edited by hand
		}
		if _, ok := config["theme"]; !ok {
			config["theme"] = "codexyy"
		}
		if model, ok := config["model"].(string); !ok || model == "opencode/big-pickle" {
			config["model"] = "codexyy/@cf/meta/llama-3.3-70b-instruct-fp8-fast"
		}
	} else if !os.IsNotExist(err) {
		return err
	}

	baseURL := codexyy.DefaultURL
	token := ""
	if login != nil {
		baseURL = strings.TrimRight(login.URL, "/")
		token = login.Token
	}
	configureHostedProvider(config, "codexyy", "codexyy Hosted", baseURL+"/api/free/v1", token, map[string]string{
		"@cf/meta/llama-3.3-70b-instruct-fp8-fast":     "Llama 3.3 70B · balanced",
		"@cf/qwen/qwen2.5-coder-32b-instruct":          "Qwen 2.5 Coder 32B · coding",
		"@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": "DeepSeek R1 32B · reasoning",
		"@cf/meta/llama-3.1-8b-instruct":               "Llama 3.1 8B · fast",
		"@cf/mistral/mistral-7b-instruct-v0.1":         "Mistral 7B · fast",
		"openai/gpt-4o-mini":                           "GPT-4o mini · low cost",
		"openai/gpt-4.1-nano":                          "GPT-4.1 nano · fastest",
		"anthropic/claude-3-5-haiku":                   "Claude 3.5 Haiku · coding",
		"anthropic/claude-haiku-4-5":                   "Claude Haiku 4.5 · balanced",
	})
	configureHostedProvider(config, "codexyy-pro", "codexyy Pro", baseURL+"/api/v1", token, map[string]string{
		"anthropic/claude-3.5-sonnet": "Claude 3.5 Sonnet · best for coding",
		"anthropic/claude-3.5-haiku":  "Claude 3.5 Haiku · fast coding",
		"anthropic/claude-3-opus":     "Claude 3 Opus · deep reasoning",
		"openai/gpt-4o":               "GPT-4o · balanced multimodal",
		"openai/gpt-4o-mini":          "GPT-4o mini · lowest cost",
		"google/gemini-flash-1.5":     "Gemini Flash 1.5 · long context",
		"deepseek/deepseek-r1":        "DeepSeek R1 · reasoning",
	})

	instruction := filepath.Join(cfgDir, "CODEXYY.md")
	instructions, _ := config["instructions"].([]any)
	found := false
	for _, item := range instructions {
		if item == instruction {
			found = true
			break
		}
	}
	if !found {
		config["instructions"] = append(instructions, instruction)
	}

	data, err = json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(cfg, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Chmod(cfg, 0o600)
}

func configureHostedProvider(
	config map[string]any,
	id string,
	name string,
	baseURL string,
	token string,
	models map[string]string,
) {
	providers, _ := config["provider"].(map[string]any)
	if providers == nil {
		providers = map[string]any{}
		config["provider"] = providers
	}
	provider, _ := providers[id].(map[string]any)
	if provider == nil {
		provider = map[string]any{}
		providers[id] = provider
	}
	provider["name"] = name
	provider["npm"] = "@ai-sdk/openai-compatible"

	options, _ := provider["options"].(map[string]any)
	if options == nil {
		options = map[string]any{}
	}
	options["baseURL"] = baseURL
	if token != "" {
		options["apiKey"] = token
	}
	provider["options"] = options

	configuredModels, _ := provider["models"].(map[string]any)
	if configuredModels == nil {
		configuredModels = map[string]any{}
	}
	for modelID, modelName := range models {
		configuredModels[modelID] = map[string]any{"name": modelName}
	}
	provider["models"] = configuredModels
}

// writeAgentInstructions refreshes a managed instruction file on every
// install. opencode.json includes it explicitly, so users may keep their own
// AGENTS.md without cxy overwriting it.
func writeAgentInstructions(dir string) error {
	cfgDir := filepath.Join(dir, "xdg", "config", "opencode")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(cfgDir, "CODEXYY.md"), []byte(agentInstructions), 0o644)
}

func savedAgentLogin(name string) *codexyy.Login {
	config, err := codexyy.LoadConfig()
	if err != nil {
		return nil
	}
	return config.Get(name)
}

func installAgentCXY(dir string) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	target := filepath.Join(dir, "bin", "cxy")
	if filepath.Clean(self) == filepath.Clean(target) {
		return nil
	}
	if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.Symlink(self, target); err != nil {
		return fmt.Errorf("could not make cxy available to the agent: %w", err)
	}
	return nil
}

const launcherTemplate = `#!/bin/sh
# codexyy agent — runs entirely on this machine.
#
#   codexyy              terminal interface
#   codexyy --web        browser interface
#   codexyy --web --port 8080 --host all
#
# Generated by 'cxy install ai'. Safe to re-run.
set -eu

ROOT=%s
PORT=%d
HOST=%s
CXY_CONFIG_PATH=%s

# Isolation: keeps this agent away from any other opencode install on the
# machine — its own config, data, cache, state and temp directories.
export XDG_DATA_HOME="$ROOT/xdg/data"
export XDG_CONFIG_HOME="$ROOT/xdg/config"
export XDG_CACHE_HOME="$ROOT/xdg/cache"
export XDG_STATE_HOME="$ROOT/xdg/state"
export TMPDIR="$ROOT/tmp"
export OPENCODE_DISABLE_AUTOUPDATE=1
export CXY_CONFIG="$CXY_CONFIG_PATH"
export PATH="$ROOT/bin:$PATH"

WEB=0
case "${1:-}" in
  web|--web) WEB=1; shift ;;
esac

if [ "$WEB" = "0" ]; then
  # Terminal interface — the engine's own TUI, themed as codexyy.
  exec "$ROOT/bin/opencode" "$@"
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --port)       PORT="$2"; shift 2 ;;
    --port=*)     PORT="${1#*=}"; shift ;;
    --expose)     HOST="$2"; shift 2 ;;
    --expose=*)   HOST="${1#*=}"; shift ;;
    --host)       HOST="$2"; shift 2 ;;
    --host=*)     HOST="${1#*=}"; shift ;;
    -h|--help)
      printf '\n  \033[1m\033[36mcodexyy\033[0m\033[1m agent\033[0m\n\n'
      printf '  \033[1musage\033[0m\n'
      printf '    codexyy                      terminal interface\n'
      printf '    codexyy web                  browser interface\n'
      printf '    codexyy web --port 8080      choose the port\n'
      printf '    codexyy web --expose all     reachable from your network\n\n'
      exit 0 ;;
    --)            shift; break ;;
    *)             echo "unknown web option: $1" >&2; exit 2 ;;
  esac
done

case "$PORT" in
  ''|*[!0-9]*) echo "invalid port: $PORT (use a number from 1 to 65535)" >&2; exit 2 ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "invalid port: $PORT (use a number from 1 to 65535)" >&2
  exit 2
fi

case "$HOST" in
  all|any|public|0.0.0.0) BIND=0.0.0.0 ;;
  *)                      BIND=127.0.0.1 ;;
esac

if [ "$BIND" = "0.0.0.0" ] && [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  PASSWORD_FILE="$ROOT/xdg/config/opencode/server-password"
  if [ ! -s "$PASSWORD_FILE" ]; then
    umask 077
    if command -v openssl >/dev/null 2>&1; then
      openssl rand -base64 24 | tr -d '\n' > "$PASSWORD_FILE"
    else
      od -An -N24 -tx1 /dev/urandom | tr -d ' \n' > "$PASSWORD_FILE"
    fi
    chmod 600 "$PASSWORD_FILE"
  fi
  OPENCODE_SERVER_PASSWORD=$(cat "$PASSWORD_FILE")
  export OPENCODE_SERVER_PASSWORD
fi

printf '\n  \033[1m\033[36mcodexyy\033[0m\033[1m agent\033[0m\n\n'
printf '  open  \033[36mhttp://localhost:%%s\033[0m\n\n' "$PORT"
if [ "$BIND" = "0.0.0.0" ]; then
  printf '  network  \033[36mhttp://<this-machine-ip>:%%s\033[0m\n' "$PORT"
  printf '  auth     \033[32mpassword required\033[0m\n'
  printf '  password \033[36m%%s\033[0m\n\n' "$OPENCODE_SERVER_PASSWORD"
fi

# The branded browser app is embedded in the engine, so one server owns both
# the UI and API on the requested port.
exec "$ROOT/bin/opencode" serve --hostname "$BIND" --port "$PORT" "$@"
`

func writeLauncher(dir string, port int, host string, cxyConfigPath string) (string, error) {
	body := fmt.Sprintf(launcherTemplate, shellQuote(dir), port, shellQuote(host), shellQuote(cxyConfigPath))

	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	// Prefer a directory the user already has on PATH.
	candidates := []string{filepath.Join(home, ".local", "bin"), "/usr/local/bin", filepath.Join(dir, "bin")}
	var target string
	for _, c := range candidates {
		if err := os.MkdirAll(c, 0o755); err != nil {
			continue
		}
		probe := filepath.Join(c, ".cxy-write-probe")
		if f, err := os.Create(probe); err == nil {
			f.Close()
			os.Remove(probe)
			target = c
			break
		}
	}
	if target == "" {
		target = filepath.Join(dir, "bin")
	}

	// The user wants `codexyy` to be this agent, so take the name — but never
	// write *through* a symlink (that silently overwrites whatever it points
	// at), and never destroy an existing real file.
	path := filepath.Join(target, "codexyy")
	if info, err := os.Lstat(path); err == nil && !isOurLauncher(path) {
		if info.Mode()&os.ModeSymlink != 0 {
			dest, _ := os.Readlink(path)
			if err := os.Remove(path); err != nil {
				return "", fmt.Errorf("could not replace %s: %w", path, err)
			}
			fmt.Printf("  \033[2mreplaced a symlink that pointed at %s (target left in place)\033[0m\n", dest)
		} else {
			backup := path + ".bak"
			if err := os.Rename(path, backup); err != nil {
				return "", fmt.Errorf("could not move the existing %s aside: %w", path, err)
			}
			fmt.Printf("  \033[2mmoved the previous codexyy to %s\033[0m\n", backup)
		}
	}

	// Write via a temp file + rename so a partial write can never leave a
	// broken command behind.
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(body), 0o755); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return "", err
	}
	return path, nil
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func runUninstallAI(_ context.Context, cmd *cli.Command) error {
	dir := cmd.String("dir")
	if strings.HasPrefix(dir, "~/") {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, dir[2:])
	}
	dir, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	if dir == filepath.Clean(string(os.PathSeparator)) || dir == filepath.Clean(home) {
		return fmt.Errorf("refusing to uninstall from unsafe directory %s", dir)
	}
	if _, err := os.Stat(filepath.Join(dir, "bin", "opencode")); os.IsNotExist(err) {
		fmt.Printf("\n  codexyy agent is not installed at \033[2m%s\033[0m\n\n", dir)
		return nil
	} else if err != nil {
		return err
	}

	for _, path := range []string{
		filepath.Join(home, ".local", "bin", "codexyy"),
		"/usr/local/bin/codexyy",
		filepath.Join(dir, "bin", "codexyy"),
	} {
		if !isOurLauncher(path) {
			continue
		}
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("could not remove %s: %w", path, err)
		}
		if _, err := os.Lstat(path + ".bak"); err == nil {
			if err := os.Rename(path+".bak", path); err != nil {
				return fmt.Errorf("removed the agent but could not restore %s: %w", path, err)
			}
		}
	}
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("could not remove %s: %w", dir, err)
	}
	fmt.Printf("\n  \033[32m✓\033[0m uninstalled codexyy agent from \033[2m%s\033[0m\n\n", dir)
	return nil
}

// ensureLoggedIn reuses the existing device-code flow rather than inventing a
// second way to authenticate.
func ensureLoggedIn(ctx context.Context, cmd *cli.Command) error {
	cfg, err := codexyy.LoadConfig()
	if err == nil {
		if l := cfg.Get(cmd.String("login")); l != nil {
			client := codexyy.NewClient(l.URL, l.Token)
			if user, err := client.Whoami(); err == nil {
				done(fmt.Sprintf("signed in as %s \033[2m<%s>\033[0m", user.Name, user.Email))
				return nil
			}
		}
	}
	self, err := os.Executable()
	if err != nil {
		return fmt.Errorf("not signed in")
	}
	run := exec.CommandContext(ctx, self, "login")
	run.Stdin, run.Stdout, run.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := run.Run(); err != nil {
		return fmt.Errorf("sign-in did not complete")
	}
	return nil
}
