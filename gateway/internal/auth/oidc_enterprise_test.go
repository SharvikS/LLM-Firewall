//go:build enterprise

package auth

import (
	"strings"
	"testing"
	"time"
)

func TestOIDCEnabledWhenFullyConfigured(t *testing.T) {
	full := OIDCConfig{Issuer: "https://idp", ClientID: "c", ClientSecret: "s", RedirectURL: "https://gw/cb"}
	if !full.Enabled() {
		t.Fatal("fully-configured OIDC should be enabled in the enterprise build")
	}
}

func TestOIDCStateCarriesNonceAndExpires(t *testing.T) {
	c := NewOIDCClient(OIDCConfig{}, "test-secret")
	now := time.Unix(1700000000, 0)
	state, nonce, err := c.signState(now)
	if err != nil {
		t.Fatal(err)
	}
	if nonce == "" || !strings.Contains(state, nonce) {
		t.Fatalf("state should carry a nonce, state=%q nonce=%q", state, nonce)
	}
	got, ok := c.verifyState(state, now.Add(9*time.Minute))
	if !ok || got != nonce {
		t.Fatalf("verifyState before expiry = (%q,%v), want (%q,true)", got, ok, nonce)
	}
	if _, ok := c.verifyState(state, now.Add(11*time.Minute)); ok {
		t.Fatal("state should expire after 10 minutes")
	}
}

func TestOIDCRoleForGroups(t *testing.T) {
	c := NewOIDCClient(OIDCConfig{
		DefaultRole: RoleViewer,
		RoleGroups: map[Role][]string{
			RoleAdmin:      {"titan-admins"},
			RoleSecurity:   {"titan-security"},
			RoleCompliance: {"titan-compliance"},
		},
	}, "test-secret")
	if got := c.roleForGroups([]string{"devs", "titan-security"}); got != RoleSecurity {
		t.Fatalf("roleForGroups security = %q, want %q", got, RoleSecurity)
	}
	if got := c.roleForGroups([]string{"none"}); got != RoleViewer {
		t.Fatalf("roleForGroups default = %q, want %q", got, RoleViewer)
	}
}
