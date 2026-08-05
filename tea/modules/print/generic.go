// Copyright 2026 codexyy. All rights reserved.
// SPDX-License-Identifier: MIT

package print

// Table renders headers and rows in any supported output format
// (table, simple, csv, tsv, yaml, json).
//
// Upstream tea exposed the table printer only through per-entity helpers
// (PrintIssue, PrintPull …), all of which were tied to the Gitea SDK. codexyy
// has its own entities, so this is the one generic entry point.
func Table(headers []string, rows [][]string, output string) error {
	t := tableWithHeader(headers...)
	for _, r := range rows {
		t.addRowSlice(r)
	}
	return t.print(output)
}

// SortedTable is Table with a stable sort applied to one column first.
func SortedTable(headers []string, rows [][]string, output string, column uint, desc bool) error {
	t := tableWithHeader(headers...)
	for _, r := range rows {
		t.addRowSlice(r)
	}
	t.sort(column, desc)
	return t.print(output)
}
