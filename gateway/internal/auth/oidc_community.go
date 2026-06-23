//go:build !enterprise

// Community (open-core, MIT) OIDC stub. The types and methods exist so the
// control plane compiles and the login UI can ask "is SSO enabled?" (always no),
// but no SSO flow is available. OIDC single sign-on is a commercial feature
// (oidc.go, built with `-tags enterprise`).
package auth

import (
	"context"
	"errors"
	"time"
)

// errSSOEnterprise is returned by every OIDC flow method in the community build.
var errSSOEnterprise = errors.New("OIDC single sign-on is a TITAN Enterprise feature")

// OIDCConfig mirrors the enterprise config shape so main.go can build it from
// env unconditionally.
type OIDCConfig struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURL  string
	DefaultRole  Role
}

// Enabled always reports false in the community build — SSO is never available.
func (c OIDCConfig) Enabled() bool { return false }

// OIDCClient is a non-functional stub in the community build.
type OIDCClient struct{}

// NewOIDCClient returns a stub client; it is never constructed in practice
// because OIDCConfig.Enabled() is always false in the community build.
func NewOIDCClient(_ OIDCConfig, _ string) *OIDCClient { return &OIDCClient{} }

// AuthCodeURL reports that SSO requires TITAN Enterprise.
func (c *OIDCClient) AuthCodeURL(_ context.Context, _ time.Time) (string, error) {
	return "", errSSOEnterprise
}

// Exchange reports that SSO requires TITAN Enterprise.
func (c *OIDCClient) Exchange(_ context.Context, _ string, _ string, _ time.Time) (string, error) {
	return "", errSSOEnterprise
}
