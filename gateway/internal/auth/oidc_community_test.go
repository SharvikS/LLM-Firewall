//go:build !enterprise

package auth

import "testing"

func TestOIDCAlwaysDisabledInCommunity(t *testing.T) {
	full := OIDCConfig{Issuer: "https://idp", ClientID: "c", ClientSecret: "s", RedirectURL: "https://gw/cb"}
	if full.Enabled() {
		t.Fatal("OIDC must never be enabled in the community build — it is an enterprise feature")
	}
}
