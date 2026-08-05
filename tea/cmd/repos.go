// Copyright 2026 codexyy. All rights reserved.
// SPDX-License-Identifier: MIT

package cmd

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/urfave/cli/v3"

	"codexyy.dev/cxy/modules/codexyy"
	"codexyy.dev/cxy/modules/print"
)

// CmdRepos groups repository management.
var CmdRepos = cli.Command{
	Name:    "repos",
	Aliases: []string{"repo"},
	Usage:   "Manage your codexyy repositories",
	Action:  runReposList,
	Flags:   []cli.Flag{loginFlag, outputFlag},
	Commands: []*cli.Command{
		{
			Name:    "list",
			Aliases: []string{"ls"},
			Usage:   "List your repositories",
			Action:  runReposList,
			Flags:   []cli.Flag{loginFlag, outputFlag},
		},
		{
			Name:      "create",
			Aliases:   []string{"new"},
			Usage:     "Create a repository",
			ArgsUsage: "<name>",
			Action:    runRepoCreate,
			Flags: []cli.Flag{
				loginFlag, outputFlag,
				&cli.StringFlag{Name: "description", Aliases: []string{"d"}, Usage: "Repository description"},
				&cli.StringFlag{Name: "language", Aliases: []string{"L"}, Value: "python", Usage: "Language scaffold to generate"},
				&cli.BoolFlag{Name: "private", Aliases: []string{"p"}, Usage: "Make the repository private"},
			},
		},
		{
			Name:      "delete",
			Aliases:   []string{"rm"},
			Usage:     "Delete a repository and its history",
			ArgsUsage: "<repo>",
			Action:    runRepoDelete,
			Flags: []cli.Flag{
				loginFlag,
				&cli.BoolFlag{Name: "yes", Aliases: []string{"y"}, Usage: "Skip the confirmation prompt"},
			},
		},
		{
			Name:      "explore",
			Aliases:   []string{"search"},
			Usage:     "Browse public repositories",
			ArgsUsage: "[query]",
			Action:    runReposExplore,
			Flags: []cli.Flag{
				loginFlag, outputFlag,
				&cli.StringFlag{Name: "query", Aliases: []string{"q"}, Usage: "Search term"},
				&cli.IntFlag{Name: "limit", Aliases: []string{"lm"}, Value: 30, Usage: "Maximum results"},
			},
		},
		{
			Name:      "star",
			Usage:     "Star or unstar a repository",
			ArgsUsage: "<repo>",
			Action:    runRepoStar,
			Flags:     []cli.Flag{loginFlag},
		},
		{
			Name:      "fork",
			Usage:     "Fork a repository, preserving its history",
			ArgsUsage: "<repo>",
			Action:    runRepoFork,
			Flags:     []cli.Flag{loginFlag},
		},
		{
			Name:      "import",
			Usage:     "Import a GitHub repository with full history",
			ArgsUsage: "<github-url>",
			Action:    runRepoImport,
			Flags: []cli.Flag{
				loginFlag,
				&cli.BoolFlag{Name: "private", Aliases: []string{"p"}, Usage: "Make the imported repository private"},
			},
		},
		{
			Name:      "info",
			Aliases:   []string{"show"},
			Usage:     "Show details for one repository",
			ArgsUsage: "<repo>",
			Action:    runRepoInfo,
			Flags:     []cli.Flag{loginFlag, outputFlag, branchFlag},
		},
	},
}

func vis(private codexyy.Bool) string {
	if private {
		return "private"
	}
	return "public"
}

func ago(unix int64) string {
	if unix == 0 {
		return ""
	}
	d := time.Since(time.Unix(unix, 0))
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd ago", int(d.Hours()/24))
	}
}

func runReposList(ctx context.Context, cmd *cli.Command) error {
	client, _, err := clientFor(cmd)
	if err != nil {
		return err
	}
	repos, err := client.ListRepos()
	if err != nil {
		return friendlyAuthError(err)
	}
	if len(repos) == 0 {
		fmt.Println("  No repositories yet — create one with 'cxy repos create <name>'")
		return nil
	}
	rows := make([][]string, 0, len(repos))
	for _, r := range repos {
		rows = append(rows, []string{
			r.ID, r.Name, r.Language, vis(r.Private),
			strconv.Itoa(r.FileCount), strconv.Itoa(r.CommitCount),
			strconv.Itoa(r.StarCount), ago(r.UpdatedAt),
		})
	}
	return print.Table(
		[]string{"ID", "NAME", "LANGUAGE", "VISIBILITY", "FILES", "COMMITS", "STARS", "UPDATED"},
		rows, cmd.String("output"))
}

func runReposExplore(ctx context.Context, cmd *cli.Command) error {
	client, _, err := clientFor(cmd)
	if err != nil {
		return err
	}
	q := cmd.String("query")
	if q == "" {
		q = cmd.Args().First()
	}
	repos, err := client.ExploreRepos(q, cmd.Int("limit"))
	if err != nil {
		return friendlyAuthError(err)
	}
	if len(repos) == 0 {
		fmt.Println("  No public repositories matched.")
		return nil
	}
	rows := make([][]string, 0, len(repos))
	for _, r := range repos {
		rows = append(rows, []string{
			r.ID, r.Name, r.AuthorName, r.Language,
			strconv.Itoa(r.StarCount), strconv.Itoa(r.ForkCount), ago(r.UpdatedAt),
		})
	}
	return print.Table(
		[]string{"ID", "NAME", "AUTHOR", "LANGUAGE", "STARS", "FORKS", "UPDATED"},
		rows, cmd.String("output"))
}

func runRepoCreate(ctx context.Context, cmd *cli.Command) error {
	client, _, err := clientFor(cmd)
	if err != nil {
		return err
	}
	name := cmd.Args().First()
	if name == "" {
		return fmt.Errorf("a name is required: cxy repos create <name>")
	}
	r, err := client.CreateRepo(name, cmd.String("description"),
		cmd.String("language"), cmd.Bool("private"))
	if err != nil {
		return friendlyAuthError(err)
	}
	fmt.Printf("  Created %s (%s, %s)\n", r.Name, r.ID, vis(r.Private))
	fmt.Printf("  Open it:  cxy pull %s ./%s\n", r.ID, name)
	return nil
}

func runRepoDelete(ctx context.Context, cmd *cli.Command) error {
	client, id, _, err := repoAndRest(cmd)
	if err != nil {
		return err
	}
	repo, err := client.GetRepo(id, "")
	if err != nil {
		return friendlyAuthError(err)
	}
	if !cmd.Bool("yes") {
		fmt.Printf("  Delete %q (%s) and all its git history? This cannot be undone.\n", repo.Name, id)
		fmt.Print("  Type the repository name to confirm: ")
		var answer string
		_, _ = fmt.Scanln(&answer)
		if answer != repo.Name {
			return fmt.Errorf("aborted")
		}
	}
	if err := client.DeleteRepo(id); err != nil {
		return friendlyAuthError(err)
	}
	fmt.Printf("  Deleted %s\n", repo.Name)
	return nil
}

func runRepoStar(ctx context.Context, cmd *cli.Command) error {
	client, id, _, err := repoAndRest(cmd)
	if err != nil {
		return err
	}
	starred, err := client.StarRepo(id)
	if err != nil {
		return friendlyAuthError(err)
	}
	if starred {
		fmt.Printf("  Starred %s\n", id)
	} else {
		fmt.Printf("  Unstarred %s\n", id)
	}
	return nil
}

func runRepoFork(ctx context.Context, cmd *cli.Command) error {
	client, id, _, err := repoAndRest(cmd)
	if err != nil {
		return err
	}
	newID, err := client.ForkRepo(id)
	if err != nil {
		return friendlyAuthError(err)
	}
	fmt.Printf("  Forked to %s (full history preserved)\n", newID)
	return nil
}

func runRepoImport(ctx context.Context, cmd *cli.Command) error {
	client, _, err := clientFor(cmd)
	if err != nil {
		return err
	}
	url := cmd.Args().First()
	if url == "" {
		return fmt.Errorf("a GitHub URL is required")
	}
	fmt.Printf("  Cloning %s …\n", url)
	r, err := client.ImportRepo(url, cmd.Bool("private"))
	if err != nil {
		return friendlyAuthError(err)
	}
	fmt.Printf("  Imported as %s — %d file(s) on %s\n", r.ID, r.FileCount, r.Branch)
	return nil
}

func runRepoInfo(ctx context.Context, cmd *cli.Command) error {
	client, id, _, err := repoAndRest(cmd)
	if err != nil {
		return err
	}
	r, err := client.GetRepo(id, cmd.String("branch"))
	if err != nil {
		return friendlyAuthError(err)
	}
	names := make([]string, 0, len(r.Branches))
	for _, b := range r.Branches {
		names = append(names, b.Name)
	}
	rows := [][]string{
		{"id", r.ID},
		{"name", r.Name},
		{"description", r.Description},
		{"language", r.Language},
		{"visibility", vis(r.Private)},
		{"branch", r.Branch},
		{"branches", strings.Join(names, ", ")},
		{"files", strconv.Itoa(len(r.Files))},
		{"stars", strconv.Itoa(r.StarCount)},
		{"forks", strconv.Itoa(r.ForkCount)},
		{"owner", boolWord(r.IsOwner, "you", r.AuthorName)},
	}
	if r.GitMissing {
		rows = append(rows, []string{"warning", "no git repository backing this entry"})
	}
	return print.Table([]string{"FIELD", "VALUE"}, rows, cmd.String("output"))
}

func boolWord(b codexyy.Bool, yes, no string) string {
	if b {
		return yes
	}
	if no == "" {
		return "—"
	}
	return no
}

