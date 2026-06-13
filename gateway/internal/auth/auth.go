// Package auth provides control-plane authentication for the dashboard:
// bcrypt password hashing, a dependency-free HS256 JWT for sessions, and a
// four-tier role model used for RBAC on the admin API.
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Role is a control-plane authorization level. Higher Level() = more privilege.
type Role string

const (
	RoleViewer     Role = "viewer"     // read-only: dashboards, audit, settings (GET)
	RoleCompliance Role = "compliance" // + compliance reports/exports
	RoleSecurity   Role = "security"   // + edit settings, policies, tenants
	RoleAdmin      Role = "admin"      // + API keys, user management
)

// Level maps a role to a comparable privilege level (0 = unknown/invalid).
func (r Role) Level() int {
	switch r {
	case RoleAdmin:
		return 4
	case RoleSecurity:
		return 3
	case RoleCompliance:
		return 2
	case RoleViewer:
		return 1
	default:
		return 0
	}
}

// Valid reports whether r is a known role.
func (r Role) Valid() bool { return r.Level() > 0 }

// AtLeast reports whether r meets or exceeds the required role.
func (r Role) AtLeast(required Role) bool { return r.Level() >= required.Level() }

// ── Password hashing ──────────────────────────────────────────────────────────

// HashPassword returns a bcrypt hash at the default cost.
func HashPassword(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	return string(b), err
}

// CheckPassword reports whether plain matches the stored bcrypt hash.
func CheckPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}

// ── HS256 JWT (no external dependency) ────────────────────────────────────────

// Claims is the session token payload.
type Claims struct {
	Sub   string `json:"sub"`   // user id
	Email string `json:"email"`
	Role  Role   `json:"role"`
	Iat   int64  `json:"iat"`
	Exp   int64  `json:"exp"`
}

var (
	ErrMalformedToken = errors.New("malformed token")
	ErrBadSignature   = errors.New("bad token signature")
	ErrExpiredToken   = errors.New("token expired")
)

type jwtHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
}

// Issuer signs and verifies session tokens with a shared HMAC secret.
type Issuer struct {
	secret []byte
	ttl    time.Duration
}

// NewIssuer creates a token issuer. ttl is the session lifetime.
func NewIssuer(secret string, ttl time.Duration) *Issuer {
	return &Issuer{secret: []byte(secret), ttl: ttl}
}

// Issue mints a signed JWT for the given identity. now is injected for testability.
func (i *Issuer) Issue(userID, email string, role Role, now time.Time) (string, error) {
	header, _ := json.Marshal(jwtHeader{Alg: "HS256", Typ: "JWT"})
	claims, err := json.Marshal(Claims{
		Sub:   userID,
		Email: email,
		Role:  role,
		Iat:   now.Unix(),
		Exp:   now.Add(i.ttl).Unix(),
	})
	if err != nil {
		return "", err
	}
	signingInput := b64(header) + "." + b64(claims)
	sig := i.sign(signingInput)
	return signingInput + "." + sig, nil
}

// Verify checks the signature and expiry and returns the claims. now is injected
// for testability.
func (i *Issuer) Verify(token string, now time.Time) (*Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, ErrMalformedToken
	}
	signingInput := parts[0] + "." + parts[1]
	expected := i.sign(signingInput)
	// Constant-time signature comparison.
	if subtle.ConstantTimeCompare([]byte(expected), []byte(parts[2])) != 1 {
		return nil, ErrBadSignature
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, ErrMalformedToken
	}
	var c Claims
	if err := json.Unmarshal(payload, &c); err != nil {
		return nil, ErrMalformedToken
	}
	if now.Unix() >= c.Exp {
		return nil, ErrExpiredToken
	}
	if !c.Role.Valid() {
		return nil, ErrMalformedToken
	}
	return &c, nil
}

func (i *Issuer) sign(input string) string {
	mac := hmac.New(sha256.New, i.secret)
	mac.Write([]byte(input))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
