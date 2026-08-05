// Copyright 2026 codexyy. All rights reserved.
// SPDX-License-Identifier: MIT

// Package codexyy is the API client for codexyy.dev.
//
// It deliberately does not speak to Gitea directly: the Gitea instance backing
// codexyy is bound to loopback and is never reachable from a user's machine.
// Everything goes through codexyy's REST API, which owns auth, permissions and
// billing, and proxies git operations to Gitea server-side.
package codexyy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"codexyy.dev/cxy/modules/httputil"
)

// DefaultURL is the hosted instance.
const DefaultURL = "https://codexyy.dev"

// Client is an authenticated codexyy API client.
type Client struct {
	URL   string
	Token string
	HTTP  *http.Client
}

// NewClient returns a client for the given instance. Token may be empty for
// endpoints that permit anonymous access (public repos, explore).
func NewClient(instanceURL, token string) *Client {
	if instanceURL == "" {
		instanceURL = DefaultURL
	}
	return &Client{
		URL:   strings.TrimRight(instanceURL, "/"),
		Token: token,
		HTTP: &http.Client{
			Timeout:   60 * time.Second,
			Transport: httputil.WrapTransport(nil),
		},
	}
}

// APIError is a non-2xx response from codexyy.
type APIError struct {
	Status int
	Detail string
}

func (e *APIError) Error() string {
	if e.Detail == "" {
		return fmt.Sprintf("codexyy: HTTP %d", e.Status)
	}
	return fmt.Sprintf("codexyy: %s (HTTP %d)", e.Detail, e.Status)
}

// IsNotFound reports whether err is a 404 from the API.
func IsNotFound(err error) bool {
	ae, ok := err.(*APIError)
	return ok && ae.Status == http.StatusNotFound
}

// IsUnauthorized reports whether err means the token is missing or stale.
func IsUnauthorized(err error) bool {
	ae, ok := err.(*APIError)
	return ok && (ae.Status == http.StatusUnauthorized || ae.Status == http.StatusForbidden)
}

func (c *Client) do(method, path string, body, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}

	req, err := http.NewRequest(method, c.URL+path, rdr)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	if c.Token != "" {
		// The API authenticates web and CLI clients off the same cookie.
		req.AddCookie(&http.Cookie{Name: "cxy_token", Value: c.Token})
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	res, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("could not reach %s: %w", c.URL, err)
	}
	defer res.Body.Close()

	data, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 400 {
		detail := strings.TrimSpace(string(data))
		var wrap struct {
			Detail any `json:"detail"`
		}
		if json.Unmarshal(data, &wrap) == nil && wrap.Detail != nil {
			detail = fmt.Sprint(wrap.Detail)
		}
		if len(detail) > 300 {
			detail = detail[:300]
		}
		return &APIError{Status: res.StatusCode, Detail: detail}
	}
	if out == nil || len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}

// ─── types ────────────────────────────────────────────────────────────────────

// Bool tolerates booleans that arrive as JSON numbers.
//
// codexyy stores flags like `private` as SQLite INTEGERs, so the API returns
// 0/1 for rows read straight from the database but true/false for values
// computed in Python. Both must decode.
type Bool bool

// UnmarshalJSON accepts true/false, 0/1, and null.
func (b *Bool) UnmarshalJSON(data []byte) error {
	s := strings.TrimSpace(string(data))
	switch s {
	case "true", "1":
		*b = true
	case "false", "0", "null", `""`:
		*b = false
	default:
		var n float64
		if err := json.Unmarshal(data, &n); err == nil {
			*b = n != 0
			return nil
		}
		return fmt.Errorf("cannot read %s as a boolean", s)
	}
	return nil
}

// Value returns the plain Go bool.
func (b Bool) Value() bool { return bool(b) }

// User is the signed-in account.
type User struct {
	ID     string `json:"id"`
	Email  string `json:"email"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
	Plan   string `json:"plan"`
}

// Repo is a codexyy repository. Content lives in git server-side.
type Repo struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Language     string   `json:"language"`
	Private      Bool     `json:"private"`
	StarCount    int      `json:"star_count"`
	ForkCount    int      `json:"fork_count"`
	CreatedAt    int64    `json:"created_at"`
	UpdatedAt    int64    `json:"updated_at"`
	FileCount    int      `json:"file_count"`
	CommitCount  int      `json:"commit_count"`
	Branch       string   `json:"branch"`
	DefaultBranch string  `json:"default_branch"`
	IsOwner      Bool     `json:"is_owner"`
	Starred      Bool     `json:"starred"`
	AuthorName   string   `json:"author_name"`
	Packages     []string `json:"packages"`
	Files        []File   `json:"files"`
	Branches     []Branch `json:"branches"`
	Commits      []Commit `json:"commits"`
	GitMissing   Bool     `json:"git_missing"`
}

// File is one blob in the tree.
type File struct {
	Path      string `json:"path"`
	Content   string `json:"content"`
	SHA       string `json:"sha"`
	Truncated Bool   `json:"truncated"`
}

// Branch is a git branch.
type Branch struct {
	Name      string `json:"name"`
	SHA       string `json:"sha"`
	Protected Bool   `json:"protected"`
}

// Commit is one entry of history.
type Commit struct {
	SHA       string `json:"sha"`
	ShortSHA  string `json:"short_sha"`
	Message   string `json:"message"`
	Author    string `json:"author_name"`
	Email     string `json:"author_email"`
	Date      string `json:"date"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

// ─── auth ─────────────────────────────────────────────────────────────────────

// Whoami returns the account the token belongs to.
func (c *Client) Whoami() (*User, error) {
	u := &User{}
	return u, c.do("GET", "/auth/me", nil, u)
}

// DeviceCode starts the browser login flow.
type DeviceCode struct {
	Code string `json:"code"`
	URL  string `json:"url"`
}

// StartLogin requests a device code to be confirmed in a browser.
func (c *Client) StartLogin() (*DeviceCode, error) {
	d := &DeviceCode{}
	return d, c.do("POST", "/auth/cli-code", nil, d)
}

// PollLogin checks whether the device code has been confirmed. It returns an
// empty token with no error while the request is still pending.
func (c *Client) PollLogin(code string) (token string, err error) {
	var out struct {
		Status string `json:"status"`
		Token  string `json:"token"`
	}
	if err := c.do("GET", "/auth/poll/"+url.PathEscape(code), nil, &out); err != nil {
		return "", err
	}
	if out.Status != "ok" {
		return "", nil
	}
	return out.Token, nil
}

// ─── repos ────────────────────────────────────────────────────────────────────

// ListRepos returns the signed-in user's repositories.
func (c *Client) ListRepos() ([]*Repo, error) {
	var out []*Repo
	return out, c.do("GET", "/api/repos/mine", nil, &out)
}

// ExploreRepos returns public repositories, optionally filtered by query.
func (c *Client) ExploreRepos(q string, limit int) ([]*Repo, error) {
	if limit <= 0 {
		limit = 30
	}
	p := fmt.Sprintf("/api/repos/public?limit=%d", limit)
	if q != "" {
		p += "&q=" + url.QueryEscape(q)
	}
	var out []*Repo
	return out, c.do("GET", p, nil, &out)
}

// GetRepo fetches a repo including its file tree at ref (blank = default branch).
func (c *Client) GetRepo(id, ref string) (*Repo, error) {
	p := "/api/repos/" + url.PathEscape(id)
	if ref != "" {
		p += "?ref=" + url.QueryEscape(ref)
	}
	r := &Repo{}
	return r, c.do("GET", p, nil, r)
}

// CreateRepo makes a new repo with a language scaffold.
func (c *Client) CreateRepo(name, description, language string, private bool) (*Repo, error) {
	body := map[string]any{
		"name": name, "description": description,
		"language": language, "private": private,
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := c.do("POST", "/api/repos", body, &out); err != nil {
		return nil, err
	}
	return &Repo{ID: out.ID, Name: name, Language: language, Private: Bool(private)}, nil
}

// DeleteRepo removes a repo and its git history. Irreversible.
func (c *Client) DeleteRepo(id string) error {
	return c.do("DELETE", "/api/repos/"+url.PathEscape(id), nil, nil)
}

// UpdateRepo changes metadata. Nil fields are left untouched.
func (c *Client) UpdateRepo(id string, name, description *string, private *bool) error {
	body := map[string]any{}
	if name != nil {
		body["name"] = *name
	}
	if description != nil {
		body["description"] = *description
	}
	if private != nil {
		body["private"] = *private
	}
	return c.do("PATCH", "/api/repos/"+url.PathEscape(id), body, nil)
}

// StarRepo toggles the star and returns the new state.
func (c *Client) StarRepo(id string) (starred bool, err error) {
	var out struct {
		Starred Bool `json:"starred"`
	}
	err = c.do("POST", "/api/repos/"+url.PathEscape(id)+"/star", nil, &out)
	return bool(out.Starred), err
}

// ForkRepo creates a git fork owned by the caller.
func (c *Client) ForkRepo(id string) (newID string, err error) {
	var out struct {
		ID string `json:"id"`
	}
	err = c.do("POST", "/api/repos/"+url.PathEscape(id)+"/fork", nil, &out)
	return out.ID, err
}

// ImportRepo clones a GitHub repository, preserving full history.
func (c *Client) ImportRepo(githubURL string, private bool) (*Repo, error) {
	var out struct {
		ID     string `json:"id"`
		Files  int    `json:"files"`
		Branch string `json:"branch"`
	}
	body := map[string]any{"url": githubURL, "private": private}
	if err := c.do("POST", "/api/repos/import", body, &out); err != nil {
		return nil, err
	}
	return &Repo{ID: out.ID, FileCount: out.Files, Branch: out.Branch}, nil
}

// ─── files & history ──────────────────────────────────────────────────────────

// GetFile reads one file at ref.
func (c *Client) GetFile(id, path, ref string) (string, error) {
	p := fmt.Sprintf("/api/repos/%s/file?path=%s",
		url.PathEscape(id), url.QueryEscape(path))
	if ref != "" {
		p += "&ref=" + url.QueryEscape(ref)
	}
	var out struct {
		Content string `json:"content"`
	}
	return out.Content, c.do("GET", p, nil, &out)
}

// CommitResult describes the commit produced by Push.
type CommitResult struct {
	OK      bool `json:"ok"`
	Changed int  `json:"changed"`
	Commit  *struct {
		SHA      string `json:"sha"`
		ShortSHA string `json:"short_sha"`
		Message  string `json:"message"`
	} `json:"commit"`
	FileCount   int `json:"file_count"`
	CommitCount int `json:"commit_count"`
}

// Push writes the given tree as a single commit. With prune, paths absent from
// files are deleted, making the remote match exactly.
func (c *Client) Push(id string, files []File, message, branch string, prune bool) (*CommitResult, error) {
	payload := make([]map[string]string, 0, len(files))
	for _, f := range files {
		payload = append(payload, map[string]string{"path": f.Path, "content": f.Content})
	}
	body := map[string]any{
		"files": payload, "message": message, "branch": branch, "prune": prune,
	}
	out := &CommitResult{}
	return out, c.do("PUT", "/api/repos/"+url.PathEscape(id)+"/files", body, out)
}

// Commits returns history for a branch.
func (c *Client) Commits(id, ref string, limit int) ([]*Commit, error) {
	if limit <= 0 {
		limit = 30
	}
	p := fmt.Sprintf("/api/repos/%s/commits?limit=%d", url.PathEscape(id), limit)
	if ref != "" {
		p += "&ref=" + url.QueryEscape(ref)
	}
	var out []*Commit
	return out, c.do("GET", p, nil, &out)
}

// Diff returns the unified diff of a single commit.
func (c *Client) Diff(id, sha string) (string, error) {
	var out struct {
		Diff string `json:"diff"`
	}
	err := c.do("GET", fmt.Sprintf("/api/repos/%s/commits/%s/diff",
		url.PathEscape(id), url.PathEscape(sha)), nil, &out)
	return out.Diff, err
}

// ─── branches ─────────────────────────────────────────────────────────────────

// Branches lists branches.
func (c *Client) Branches(id string) ([]*Branch, error) {
	var out []*Branch
	return out, c.do("GET", "/api/repos/"+url.PathEscape(id)+"/branches", nil, &out)
}

// CreateBranch branches off from, or the default branch when from is empty.
func (c *Client) CreateBranch(id, name, from string) error {
	body := map[string]any{"name": name, "from_branch": from}
	return c.do("POST", "/api/repos/"+url.PathEscape(id)+"/branches", body, nil)
}

// DeleteBranch removes a branch. The default branch cannot be deleted.
func (c *Client) DeleteBranch(id, name string) error {
	return c.do("DELETE", "/api/repos/"+url.PathEscape(id)+"/branches/"+name, nil, nil)
}
