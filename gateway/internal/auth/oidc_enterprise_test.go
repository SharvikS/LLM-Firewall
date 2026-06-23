//go:build enterprise

package auth

import "testing"

func TestOIDCEnabledWhenFullyConfigured(t *testing.T) {
	full := OIDCConfig{Issuer: "https://idp", ClientID: "c", ClientSecret: "s", RedirectURL: "https://gw/cb"}
	if !full.Enabled() {
		t.Fatal("fully-configured OIDC should be enabled in the enterprise build")
	}
}
