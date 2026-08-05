// Copyright 2026 codexyy. All rights reserved.
// SPDX-License-Identifier: MIT

package codexyy

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// Login is one saved account, so a user can hold logins for the hosted
// instance and a self-hosted one at the same time.
type Login struct {
	Name  string `yaml:"name"`
	URL   string `yaml:"url"`
	Token string `yaml:"token"`
	User  string `yaml:"user,omitempty"`
	Email string `yaml:"email,omitempty"`
}

// Config is the on-disk CLI configuration.
type Config struct {
	Default string   `yaml:"default,omitempty"`
	Logins  []*Login `yaml:"logins"`
}

// ConfigPath returns the config file location, honouring XDG.
func ConfigPath() string {
	if p := os.Getenv("CXY_CONFIG"); p != "" {
		return p
	}
	dir := os.Getenv("XDG_CONFIG_HOME")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			home = "."
		}
		dir = filepath.Join(home, ".config")
	}
	return filepath.Join(dir, "codexyy", "cli.yml")
}

// LoadConfig reads the config, returning an empty one if absent.
func LoadConfig() (*Config, error) {
	c := &Config{}
	data, err := os.ReadFile(ConfigPath())
	if os.IsNotExist(err) {
		return c, nil
	}
	if err != nil {
		return nil, err
	}
	if err := yaml.Unmarshal(data, c); err != nil {
		return nil, fmt.Errorf("config %s is corrupt: %w", ConfigPath(), err)
	}
	return c, nil
}

// Save writes the config with 0600 permissions — it holds bearer tokens.
func (c *Config) Save() error {
	p := ConfigPath()
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	data, err := yaml.Marshal(c)
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o600)
}

// Get returns a login by name, or the default when name is empty.
func (c *Config) Get(name string) *Login {
	if len(c.Logins) == 0 {
		return nil
	}
	if name == "" {
		name = c.Default
	}
	if name == "" {
		return c.Logins[0]
	}
	for _, l := range c.Logins {
		if l.Name == name {
			return l
		}
	}
	return nil
}

// Add stores a login, replacing any existing one with the same name, and makes
// it the default when it is the only one.
func (c *Config) Add(l *Login) {
	for i, existing := range c.Logins {
		if existing.Name == l.Name {
			c.Logins[i] = l
			return
		}
	}
	c.Logins = append(c.Logins, l)
	if c.Default == "" {
		c.Default = l.Name
	}
}

// Remove deletes a login by name, reporting whether it existed.
func (c *Config) Remove(name string) bool {
	for i, l := range c.Logins {
		if l.Name == name {
			c.Logins = append(c.Logins[:i], c.Logins[i+1:]...)
			if c.Default == name {
				c.Default = ""
				if len(c.Logins) > 0 {
					c.Default = c.Logins[0].Name
				}
			}
			return true
		}
	}
	return false
}
