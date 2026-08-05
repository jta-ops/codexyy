// Copyright 2026 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package httputil

import (
	"crypto/tls"
	"fmt"
	"net/http"
	"runtime"

	"codexyy.dev/cxy/modules/version"
)

// UserAgent returns the standard User-Agent string for cxy.
func UserAgent() string {
	return fmt.Sprintf("cxy/%s (%s/%s)", version.Version, runtime.GOOS, runtime.GOARCH)
}

// WrapTransport returns cxy's standard HTTP transport: an *http.Transport
// preset with cxy's connection / response-header timeouts (see timeoutTransport)
// and decorated to add the User-Agent header on every request. The supplied
// tlsConfig is attached as-is (nil is fine); callers use it for insecure /
// skip-verify logins. This is the single entry point for building a cxy HTTP
// client transport, so the timeouts can't be accidentally omitted.
func WrapTransport(tlsConfig *tls.Config) http.RoundTripper {
	return &userAgentTransport{base: timeoutTransport(tlsConfig)}
}

type userAgentTransport struct {
	base http.RoundTripper
}

func (t *userAgentTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	// Set the UA at the transport so every client built from WrapTransport
	// identifies itself, without each call site having to remember.
	req.Header.Set("User-Agent", UserAgent())
	return t.base.RoundTrip(req)
}
