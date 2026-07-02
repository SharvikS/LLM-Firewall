package store

import (
	"context"
	"testing"
	"time"

	"github.com/sharvik/llm-firewall/gateway/internal/auth"
)

func TestSSOExchangeCodeIsOneTime(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	hash, err := auth.HashPassword("password123")
	if err != nil {
		t.Fatal(err)
	}
	user, err := st.CreateUser(ctx, "sso-user@titan.local", hash, "viewer", "local")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := st.CreateSSOExchangeCode(ctx, "one-time-code", user.ID, user.Email, user.Role, time.Minute); err != nil {
		t.Fatalf("CreateSSOExchangeCode: %v", err)
	}

	first, err := st.ConsumeSSOExchangeCode(ctx, "one-time-code")
	if err != nil {
		t.Fatalf("first consume: %v", err)
	}
	if first == nil || first.UserID != user.ID || first.Email != user.Email || first.Role != user.Role {
		t.Fatalf("first consume = %+v; want user identity", first)
	}
	second, err := st.ConsumeSSOExchangeCode(ctx, "one-time-code")
	if err != nil {
		t.Fatalf("second consume: %v", err)
	}
	if second != nil {
		t.Fatalf("second consume = %+v; want nil", second)
	}
}

func TestSSOExchangeCodeExpires(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	hash, err := auth.HashPassword("password123")
	if err != nil {
		t.Fatal(err)
	}
	user, err := st.CreateUser(ctx, "expired-sso@titan.local", hash, "viewer", "local")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := st.CreateSSOExchangeCode(ctx, "expired-code", user.ID, user.Email, user.Role, -time.Second); err != nil {
		t.Fatalf("CreateSSOExchangeCode: %v", err)
	}
	got, err := st.ConsumeSSOExchangeCode(ctx, "expired-code")
	if err != nil {
		t.Fatalf("consume expired: %v", err)
	}
	if got != nil {
		t.Fatalf("expired code returned %+v; want nil", got)
	}
}
