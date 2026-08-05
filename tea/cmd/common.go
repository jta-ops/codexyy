// Copyright 2026 codexyy. All rights reserved.
// SPDX-License-Identifier: MIT

package cmd

import (
	"fmt"
	"strings"

	"github.com/urfave/cli/v3"

	"codexyy.dev/cxy/modules/codexyy"
)

var loginFlag = &cli.StringFlag{
	Name:    "login",
	Aliases: []string{"l"},
	Usage:   "Use a specific saved login",
}

var outputFlag = &cli.StringFlag{
	Name:    "output",
	Aliases: []string{"o"},
	Usage:   "Output format (table, simple, csv, tsv, yaml, json)",
}

var branchFlag = &cli.StringFlag{
	Name:    "branch",
	Aliases: []string{"b"},
	Usage:   "Branch to operate on (default: the repo's default branch)",
}

// clientFor builds an API client from the saved config.
func clientFor(cmd *cli.Command) (*codexyy.Client, *codexyy.Login, error) {
	cfg, err := codexyy.LoadConfig()
	if err != nil {
		return nil, nil, err
	}
	name := cmd.String("login")
	l := cfg.Get(name)
	if l == nil {
		if name != "" {
			return nil, nil, fmt.Errorf("no login named %q — run 'cxy login'", name)
		}
		return nil, nil, fmt.Errorf("not signed in — run 'cxy login'")
	}
	return codexyy.NewClient(l.URL, l.Token), l, nil
}

// friendlyAuthError turns a 401/403 into an actionable message.
func friendlyAuthError(err error) error {
	if codexyy.IsUnauthorized(err) {
		return fmt.Errorf("your session has expired — run 'cxy login' again")
	}
	return err
}

// resolveRepo accepts a repo id or a name and returns the id.
//
// Ids are opaque 10-character strings, so a bare name is far friendlier. Names
// are not unique in codexyy, so an ambiguous name is reported rather than
// guessed at.
func resolveRepo(client *codexyy.Client, ref string) (string, error) {
	if ref == "" {
		return "", fmt.Errorf("a repository is required")
	}

	// Fast path: treat it as an id first.
	if _, err := client.GetRepo(ref, ""); err == nil {
		return ref, nil
	} else if !codexyy.IsNotFound(err) && !codexyy.IsUnauthorized(err) {
		return "", err
	}

	repos, err := client.ListRepos()
	if err != nil {
		return "", friendlyAuthError(err)
	}

	var exact []*codexyy.Repo
	for _, r := range repos {
		if strings.EqualFold(r.Name, ref) {
			exact = append(exact, r)
		}
	}
	switch len(exact) {
	case 1:
		return exact[0].ID, nil
	case 0:
		return "", fmt.Errorf("no repository %q — try 'cxy repos ls'", ref)
	default:
		var ids []string
		for _, r := range exact {
			ids = append(ids, r.ID)
		}
		return "", fmt.Errorf("%q is ambiguous (%s) — use the id",
			ref, strings.Join(ids, ", "))
	}
}

// repoAndRest resolves the first argument as a repo, returning remaining args.
func repoAndRest(cmd *cli.Command) (*codexyy.Client, string, []string, error) {
	client, _, err := clientFor(cmd)
	if err != nil {
		return nil, "", nil, err
	}
	args := cmd.Args().Slice()
	if len(args) == 0 {
		return nil, "", nil, fmt.Errorf("a repository is required")
	}
	id, err := resolveRepo(client, args[0])
	if err != nil {
		return nil, "", nil, err
	}
	return client, id, args[1:], nil
}
