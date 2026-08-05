// Copyright 2026 codexyy. All rights reserved.
// SPDX-License-Identifier: MIT

package cmd

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/urfave/cli/v3"

	"codexyy.dev/cxy/modules/codexyy"
	"codexyy.dev/cxy/modules/print"
)

// CmdLogin signs in via the browser device-code flow.
var CmdLogin = cli.Command{
	Name:        "login",
	Usage:       "Sign in to codexyy",
	Description: "Opens your browser to confirm the sign-in, then stores the token locally.",
	Action:      runLogin,
	Flags: []cli.Flag{
		&cli.StringFlag{
			Name:    "url",
			Aliases: []string{"u"},
			Usage:   "codexyy instance to sign in to",
			Value:   codexyy.DefaultURL,
		},
		&cli.StringFlag{
			Name:    "name",
			Aliases: []string{"n"},
			Usage:   "name for this login (defaults to the instance host)",
		},
		&cli.StringFlag{
			Name:  "token",
			Usage: "use an existing token instead of the browser flow",
		},
		&cli.BoolFlag{
			Name:  "no-browser",
			Usage: "print the URL instead of opening a browser",
		},
	},
}

func runLogin(ctx context.Context, cmd *cli.Command) error {
	instance := strings.TrimRight(cmd.String("url"), "/")
	name := cmd.String("name")
	if name == "" {
		name = strings.TrimPrefix(strings.TrimPrefix(instance, "https://"), "http://")
		name = strings.Split(name, "/")[0]
	}

	client := codexyy.NewClient(instance, "")
	token := cmd.String("token")

	if token == "" {
		dc, err := client.StartLogin()
		if err != nil {
			return fmt.Errorf("could not start login: %w", err)
		}

		fmt.Printf("\n  Confirm this sign-in in your browser:\n\n    %s\n\n", dc.URL)
		if !cmd.Bool("no-browser") {
			_ = openBrowser(dc.URL)
		}
		fmt.Print("  Waiting for confirmation")

		deadline := time.Now().Add(5 * time.Minute)
		for time.Now().Before(deadline) {
			time.Sleep(2 * time.Second)
			fmt.Print(".")
			t, err := client.PollLogin(dc.Code)
			if err != nil {
				// 410 means the code expired; anything else is fatal too.
				fmt.Println()
				return fmt.Errorf("login failed: %w", err)
			}
			if t != "" {
				token = t
				break
			}
		}
		fmt.Println()
		if token == "" {
			return fmt.Errorf("timed out waiting for confirmation")
		}
	}

	client.Token = token
	user, err := client.Whoami()
	if err != nil {
		return fmt.Errorf("token was rejected: %w", err)
	}

	cfg, err := codexyy.LoadConfig()
	if err != nil {
		return err
	}
	login := &codexyy.Login{
		Name: name, URL: instance, Token: token,
		User: user.Name, Email: user.Email,
	}
	cfg.Add(login)
	if err := cfg.Save(); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(defaultAgentDir(), "bin", "opencode")); err == nil {
		if err := writeAgentConfig(defaultAgentDir(), login); err != nil {
			fmt.Printf("  Warning: could not sync agent models: %v\n", err)
		}
	}

	fmt.Printf("  Signed in as %s <%s> on %s\n", user.Name, user.Email, instance)
	fmt.Printf("  Saved to %s\n\n", codexyy.ConfigPath())
	return nil
}

// CmdLogout removes a stored login.
var CmdLogout = cli.Command{
	Name:      "logout",
	Usage:     "Remove a stored login",
	ArgsUsage: "[login-name]",
	Action:    runLogout,
}

func runLogout(ctx context.Context, cmd *cli.Command) error {
	cfg, err := codexyy.LoadConfig()
	if err != nil {
		return err
	}
	name := cmd.Args().First()
	if name == "" {
		if l := cfg.Get(""); l != nil {
			name = l.Name
		}
	}
	if name == "" || !cfg.Remove(name) {
		return fmt.Errorf("no login named %q", name)
	}
	if err := cfg.Save(); err != nil {
		return err
	}
	fmt.Printf("  Removed login %q\n", name)
	return nil
}

// CmdWhoami shows the active account.
var CmdWhoami = cli.Command{
	Name:   "whoami",
	Usage:  "Show the account cxy is signed in as",
	Action: runWhoami,
	Flags:  []cli.Flag{loginFlag, outputFlag},
}

func runWhoami(ctx context.Context, cmd *cli.Command) error {
	client, login, err := clientFor(cmd)
	if err != nil {
		return err
	}
	user, err := client.Whoami()
	if err != nil {
		return friendlyAuthError(err)
	}
	return print.Table(
		[]string{"NAME", "EMAIL", "PLAN", "INSTANCE"},
		[][]string{{user.Name, user.Email, user.Plan, login.URL}},
		cmd.String("output"),
	)
}

func openBrowser(url string) error {
	var c *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		c = exec.Command("open", url)
	case "windows":
		c = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		c = exec.Command("xdg-open", url)
	}
	return c.Start()
}
