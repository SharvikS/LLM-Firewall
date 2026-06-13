package auth

import (
	"testing"
	"time"
)

func TestRoleLevels(t *testing.T) {
	if !RoleAdmin.AtLeast(RoleViewer) {
		t.Fatal("admin should outrank viewer")
	}
	if RoleViewer.AtLeast(RoleSecurity) {
		t.Fatal("viewer should not meet security")
	}
	if RoleCompliance.AtLeast(RoleSecurity) {
		t.Fatal("compliance should not meet security")
	}
	if Role("bogus").Valid() {
		t.Fatal("unknown role must be invalid")
	}
}

func TestPasswordHashRoundTrip(t *testing.T) {
	hash, err := HashPassword("s3cret-passw0rd")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if !CheckPassword(hash, "s3cret-passw0rd") {
		t.Fatal("correct password rejected")
	}
	if CheckPassword(hash, "wrong") {
		t.Fatal("wrong password accepted")
	}
}

func TestJWTIssueVerify(t *testing.T) {
	iss := NewIssuer("test-secret", time.Hour)
	now := time.Unix(1_700_000_000, 0)
	tok, err := iss.Issue("user-123", "a@b.com", RoleSecurity, now)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	claims, err := iss.Verify(tok, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.Sub != "user-123" || claims.Email != "a@b.com" || claims.Role != RoleSecurity {
		t.Fatalf("claims mismatch: %+v", claims)
	}
}

func TestJWTExpiry(t *testing.T) {
	iss := NewIssuer("test-secret", time.Hour)
	now := time.Unix(1_700_000_000, 0)
	tok, _ := iss.Issue("u", "a@b.com", RoleViewer, now)
	if _, err := iss.Verify(tok, now.Add(2*time.Hour)); err != ErrExpiredToken {
		t.Fatalf("expected ErrExpiredToken, got %v", err)
	}
}

func TestJWTTamperedSignatureRejected(t *testing.T) {
	iss := NewIssuer("test-secret", time.Hour)
	now := time.Unix(1_700_000_000, 0)
	tok, _ := iss.Issue("u", "a@b.com", RoleAdmin, now)
	// Forge with a different secret → signature must not verify.
	forged := NewIssuer("attacker-secret", time.Hour)
	if _, err := forged.Verify(tok, now.Add(time.Minute)); err != ErrBadSignature {
		t.Fatalf("expected ErrBadSignature, got %v", err)
	}
}

func TestOIDCDisabledByDefault(t *testing.T) {
	if (OIDCConfig{}).Enabled() {
		t.Fatal("empty OIDC config must be disabled")
	}
	full := OIDCConfig{Issuer: "https://idp", ClientID: "c", ClientSecret: "s", RedirectURL: "https://gw/cb"}
	if !full.Enabled() {
		t.Fatal("fully-configured OIDC should be enabled")
	}
}
