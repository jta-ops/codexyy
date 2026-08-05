// Copyright 2020 The Gitea Authors. All rights reserved.
// Copyright 2026 codexyy. All rights reserved.
// SPDX-License-Identifier: MIT

// Package cmd defines the cxy command tree.
package cmd // import "codexyy.dev/cxy"

import (
	"fmt"

	"github.com/urfave/cli/v3"

	"codexyy.dev/cxy/modules/version"
)

// App creates and returns the cxy command with all subcommands set.
// Separated from main so docs can be generated for it.
func App() *cli.Command {
	// make parsing `cxy --version` easier, by printing /just/ the version
	cli.VersionPrinter = func(c *cli.Command) { fmt.Fprintln(c.Writer, c.Version) }

	return &cli.Command{
		Name:               "cxy",
		Usage:              "command line tool for codexyy",
		Description:        appDescription,
		CustomHelpTemplate: helpTemplate,
		Version:            version.Format(),
		Commands: []*cli.Command{
			&CmdLogin,
			&CmdLogout,
			&CmdWhoami,

			&CmdRepos,
			&CmdBranches,

			&CmdPull,
			&CmdPush,
			&CmdTask,
			&CmdCheckpoint,
			&CmdCat,
			&CmdLog,
			&CmdDiff,

			&CmdOpen,
			&CmdInstall,
			&CmdUninstall,
			&CmdDoctor,
			&CmdUpdate,
			&CmdGenerateManPage,
		},
		EnableShellCompletion: true,
	}
}

var appDescription = `cxy is the command line client for codexyy.

It talks to the codexyy API, so your repositories, history and branches are the
same ones you see in the web playground — cxy just gets you there without a
browser.

Repositories are addressed by id (e.g. j2d2re15qa) or by name when that name is
unambiguous among your repos. Configuration lives in
$XDG_CONFIG_HOME/codexyy/cli.yml and is readable only by you.
`

var helpTemplate = fmt.Sprintf("\033[1m%s\033[0m", `
   {{.Name}}{{if .Usage}} - {{.Usage}}{{end}}`) + `
   {{if .Version}}{{if not .HideVersion}}version {{.Version}}{{end}}{{end}}

 USAGE
   {{if .UsageText}}{{.UsageText}}{{else}}{{.HelpName}}{{if .Commands}} command [subcommand] [command options]{{end}} {{if .ArgsUsage}}{{.ArgsUsage}}{{else}}[arguments...]{{end}}{{end}}{{if .Description}}

 DESCRIPTION
   {{.Description | nindent 3 | trim}}{{end}}{{if .VisibleCommands}}

 COMMANDS{{range .VisibleCategories}}{{if .Name}}

 {{.Name}}:{{range .VisibleCommands}}
   {{join .Names ", "}}{{"\t"}}{{"\t"}}{{.Usage}}{{end}}{{else}}{{range .VisibleCommands}}
   {{join .Names ", "}}{{"\t"}}{{"\t"}}{{.Usage}}{{end}}{{end}}{{end}}{{end}}{{if .VisibleFlags}}

 OPTIONS
   {{range $index, $option := .VisibleFlags}}{{if $index}}
   {{end}}{{$option}}{{end}}{{end}}

 EXAMPLES
   cxy login                           # sign in with your codexyy account
   cxy repos ls                        # list your repositories
   cxy repos explore --query lyrics    # search public repos

   cxy pull lyrics-thingy ./lyrics     # download a repo into a local directory
   cxy push lyrics-thingy ./lyrics -m "fix timing"   # commit local changes back

   cxy log lyrics-thingy               # commit history
   cxy diff lyrics-thingy c039e87      # show what one commit changed
   cxy cat lyrics-thingy lyrics.py     # print a file to stdout

   cxy repos import https://github.com/user/project   # clone GitHub into codexyy

 ABOUT
   cxy is codexyy's CLI, built on Gitea's "tea" client (MIT).
   codexyy: https://codexyy.dev — tea: https://gitea.com/gitea/tea
`
