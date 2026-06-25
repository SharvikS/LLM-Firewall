//go:build enterprise

// TITAN Enterprise — commercial license (see LICENSE-ENTERPRISE.md), not MIT.
//
// OIDC single sign-on for the control plane. This is a commercial feature; the
// community build links a stub (oidc_community.go) whose OIDCConfig is never
// Enabled() and whose flow methods report that SSO requires TITAN Enterprise.
package auth

import (
	"context"
	"crypto"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// OIDCConfig configures the optional SSO login flow. Disabled unless Issuer and
// the client credentials are all set.
type OIDCConfig struct {
	Issuer               string
	ClientID             string
	ClientSecret         string
	RedirectURL          string // gateway callback, e.g. https://gw/admin/v1/auth/oidc/callback
	DefaultRole          Role   // role assigned to first-time SSO users
	RequireVerifiedEmail bool
	RoleGroups           map[Role][]string // IdP groups that map first-time users to TITAN roles
}

// Enabled reports whether SSO is fully configured.
func (c OIDCConfig) Enabled() bool {
	return c.Issuer != "" && c.ClientID != "" && c.ClientSecret != "" && c.RedirectURL != ""
}

// oidcDiscovery is the subset of the provider metadata we use.
type oidcDiscovery struct {
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	UserinfoEndpoint      string `json:"userinfo_endpoint"`
	JWKSURI               string `json:"jwks_uri"`
	Issuer                string `json:"issuer"`
}

// OIDCIdentity is the validated identity returned by an OIDC provider.
type OIDCIdentity struct {
	Subject       string
	Email         string
	EmailVerified bool
	Groups        []string
	Role          Role
}

// OIDCClient performs the authorization-code flow against a standard provider.
// State is a signed, expiring HMAC token (no server-side session storage needed).
type OIDCClient struct {
	cfg        OIDCConfig
	httpClient *http.Client
	stateKey   []byte

	mu       sync.Mutex
	jwks     map[string]*rsa.PublicKey
	jwksTill time.Time
}

// NewOIDCClient builds a client; stateSecret signs the CSRF state parameter.
func NewOIDCClient(cfg OIDCConfig, stateSecret string) *OIDCClient {
	return &OIDCClient{
		cfg:        cfg,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		stateKey:   []byte(stateSecret),
	}
}

func (c *OIDCClient) discover(ctx context.Context) (*oidcDiscovery, error) {
	wellKnown := strings.TrimRight(c.cfg.Issuer, "/") + "/.well-known/openid-configuration"
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, wellKnown, nil)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oidc discovery: status %d", resp.StatusCode)
	}
	var d oidcDiscovery
	if err := json.NewDecoder(resp.Body).Decode(&d); err != nil {
		return nil, err
	}
	if d.Issuer == "" {
		d.Issuer = strings.TrimRight(c.cfg.Issuer, "/")
	}
	return &d, nil
}

// AuthCodeURL returns the provider URL to redirect the browser to, plus the
// signed state value to round-trip.
func (c *OIDCClient) AuthCodeURL(ctx context.Context, now time.Time) (string, error) {
	d, err := c.discover(ctx)
	if err != nil {
		return "", err
	}
	state, nonce, err := c.signState(now)
	if err != nil {
		return "", err
	}
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", c.cfg.ClientID)
	q.Set("redirect_uri", c.cfg.RedirectURL)
	q.Set("scope", "openid email profile")
	q.Set("state", state)
	q.Set("nonce", nonce)
	return d.AuthorizationEndpoint + "?" + q.Encode(), nil
}

// Exchange validates state, swaps the code for tokens, verifies the id_token,
// and returns the authenticated identity.
func (c *OIDCClient) Exchange(ctx context.Context, code, state string, now time.Time) (*OIDCIdentity, error) {
	nonce, ok := c.verifyState(state, now)
	if !ok {
		return nil, errors.New("invalid or expired oidc state")
	}
	d, err := c.discover(ctx)
	if err != nil {
		return nil, err
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", c.cfg.RedirectURL)
	form.Set("client_id", c.cfg.ClientID)
	form.Set("client_secret", c.cfg.ClientSecret)

	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, d.TokenEndpoint, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oidc token exchange: status %d", resp.StatusCode)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		IDToken     string `json:"id_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return nil, err
	}
	if tok.IDToken == "" {
		return nil, errors.New("oidc token response missing id_token")
	}

	identity, err := c.verifyIDToken(ctx, d, tok.IDToken, nonce, now)
	if err != nil {
		return nil, err
	}
	if identity.Email == "" {
		email, err := c.fetchUserinfoEmail(ctx, d.UserinfoEndpoint, tok.AccessToken)
		if err != nil {
			return nil, err
		}
		identity.Email = email
		identity.EmailVerified = true
	}
	if c.cfg.RequireVerifiedEmail && !identity.EmailVerified {
		return nil, errors.New("oidc email is not verified")
	}
	identity.Email = strings.TrimSpace(strings.ToLower(identity.Email))
	if identity.Email == "" || !strings.Contains(identity.Email, "@") {
		return nil, errors.New("oidc identity has no usable email")
	}
	identity.Role = c.roleForGroups(identity.Groups)
	return identity, nil
}

func (c *OIDCClient) fetchUserinfoEmail(ctx context.Context, endpoint, accessToken string) (string, error) {
	if endpoint == "" {
		return "", errors.New("no email claim and no userinfo endpoint")
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("oidc userinfo: status %d", resp.StatusCode)
	}
	var ui struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&ui); err != nil {
		return "", err
	}
	if ui.Email == "" {
		return "", errors.New("userinfo returned no email")
	}
	return ui.Email, nil
}

type oidcTokenHeader struct {
	Alg string `json:"alg"`
	Kid string `json:"kid"`
	Typ string `json:"typ"`
}

type oidcClaims struct {
	Iss           string `json:"iss"`
	Sub           string `json:"sub"`
	Aud           any    `json:"aud"`
	Exp           int64  `json:"exp"`
	Iat           int64  `json:"iat"`
	Nonce         string `json:"nonce"`
	Email         string `json:"email"`
	EmailVerified *bool  `json:"email_verified"`
	Groups        any    `json:"groups"`
}

func (c *OIDCClient) verifyIDToken(ctx context.Context, d *oidcDiscovery, idToken, nonce string, now time.Time) (*OIDCIdentity, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return nil, errors.New("malformed id_token")
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, errors.New("malformed id_token header")
	}
	var header oidcTokenHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, errors.New("malformed id_token header")
	}
	if header.Alg != "RS256" {
		return nil, fmt.Errorf("unsupported id_token alg %q", header.Alg)
	}
	key, err := c.jwk(ctx, d.JWKSURI, header.Kid, now)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, errors.New("malformed id_token signature")
	}
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, hash[:], sig); err != nil {
		return nil, errors.New("bad id_token signature")
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("malformed id_token payload")
	}
	var claims oidcClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, errors.New("malformed id_token claims")
	}
	if claims.Iss != d.Issuer {
		return nil, errors.New("id_token issuer mismatch")
	}
	if !audienceContains(claims.Aud, c.cfg.ClientID) {
		return nil, errors.New("id_token audience mismatch")
	}
	if claims.Exp == 0 || now.Unix() >= claims.Exp {
		return nil, errors.New("id_token expired")
	}
	if claims.Nonce != nonce {
		return nil, errors.New("id_token nonce mismatch")
	}
	if claims.Sub == "" {
		return nil, errors.New("id_token missing subject")
	}
	// Some enterprise IdPs omit email_verified for managed directories. Treat an
	// absent claim as acceptable; when the provider does send it, enforce it.
	verified := true
	if claims.EmailVerified != nil {
		verified = *claims.EmailVerified
	}
	return &OIDCIdentity{
		Subject:       claims.Sub,
		Email:         claims.Email,
		EmailVerified: verified,
		Groups:        stringList(claims.Groups),
	}, nil
}

func audienceContains(aud any, clientID string) bool {
	switch v := aud.(type) {
	case string:
		return v == clientID
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok && s == clientID {
				return true
			}
		}
	}
	return false
}

func stringList(v any) []string {
	switch vv := v.(type) {
	case []any:
		out := make([]string, 0, len(vv))
		for _, item := range vv {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		return out
	case []string:
		return vv
	case string:
		if vv == "" {
			return nil
		}
		return []string{vv}
	default:
		return nil
	}
}

func (c *OIDCClient) roleForGroups(groups []string) Role {
	role := c.cfg.DefaultRole
	if !role.Valid() {
		role = RoleViewer
	}
	groupSet := map[string]struct{}{}
	for _, g := range groups {
		groupSet[strings.ToLower(strings.TrimSpace(g))] = struct{}{}
	}
	for _, candidate := range []Role{RoleAdmin, RoleSecurity, RoleCompliance, RoleViewer} {
		for _, g := range c.cfg.RoleGroups[candidate] {
			if _, ok := groupSet[strings.ToLower(strings.TrimSpace(g))]; ok {
				return candidate
			}
		}
	}
	return role
}

type jwkSet struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	Kty string `json:"kty"`
	Use string `json:"use"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

func (c *OIDCClient) jwk(ctx context.Context, jwksURI, kid string, now time.Time) (*rsa.PublicKey, error) {
	if jwksURI == "" {
		return nil, errors.New("oidc discovery missing jwks_uri")
	}
	c.mu.Lock()
	if now.Before(c.jwksTill) {
		if key := c.jwks[kid]; key != nil {
			c.mu.Unlock()
			return key, nil
		}
	}
	c.mu.Unlock()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, jwksURI, nil)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oidc jwks: status %d", resp.StatusCode)
	}
	var set jwkSet
	if err := json.NewDecoder(resp.Body).Decode(&set); err != nil {
		return nil, err
	}
	keys := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, raw := range set.Keys {
		if raw.Kty != "RSA" || raw.N == "" || raw.E == "" {
			continue
		}
		nBytes, err := base64.RawURLEncoding.DecodeString(raw.N)
		if err != nil {
			continue
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(raw.E)
		if err != nil {
			continue
		}
		e := 0
		for _, b := range eBytes {
			e = e<<8 + int(b)
		}
		if e == 0 {
			continue
		}
		keys[raw.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(nBytes), E: e}
	}
	c.mu.Lock()
	c.jwks = keys
	c.jwksTill = now.Add(5 * time.Minute)
	key := c.jwks[kid]
	c.mu.Unlock()
	if key == nil {
		return nil, errors.New("id_token signing key not found")
	}
	return key, nil
}

// signState produces "exp.signature" so the callback can verify integrity and
// freshness without server-side storage.
func (c *OIDCClient) signState(now time.Time) (string, string, error) {
	nonceBytes := make([]byte, 24)
	if _, err := rand.Read(nonceBytes); err != nil {
		return "", "", err
	}
	nonce := base64.RawURLEncoding.EncodeToString(nonceBytes)
	exp := strconv.FormatInt(now.Add(10*time.Minute).Unix(), 10)
	msg := exp + "." + nonce
	return msg + "." + c.stateMAC(msg), nonce, nil
}

func (c *OIDCClient) verifyState(state string, now time.Time) (string, bool) {
	parts := strings.Split(state, ".")
	if len(parts) != 3 {
		return "", false
	}
	msg := parts[0] + "." + parts[1]
	if !hmac.Equal([]byte(parts[2]), []byte(c.stateMAC(msg))) {
		return "", false
	}
	exp, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return "", false
	}
	return parts[1], now.Unix() < exp
}

func (c *OIDCClient) stateMAC(msg string) string {
	mac := hmac.New(sha256.New, c.stateKey)
	mac.Write([]byte(msg))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
