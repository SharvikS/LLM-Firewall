package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// OIDCConfig configures the optional SSO login flow. Disabled unless Issuer and
// the client credentials are all set.
type OIDCConfig struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURL  string // gateway callback, e.g. https://gw/admin/v1/auth/oidc/callback
	DefaultRole  Role   // role assigned to first-time SSO users
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
}

// OIDCClient performs the authorization-code flow against a standard provider.
// State is a signed, expiring HMAC token (no server-side session storage needed).
type OIDCClient struct {
	cfg        OIDCConfig
	httpClient *http.Client
	stateKey   []byte
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
	return &d, nil
}

// AuthCodeURL returns the provider URL to redirect the browser to, plus the
// signed state value to round-trip.
func (c *OIDCClient) AuthCodeURL(ctx context.Context, now time.Time) (string, error) {
	d, err := c.discover(ctx)
	if err != nil {
		return "", err
	}
	state := c.signState(now)
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", c.cfg.ClientID)
	q.Set("redirect_uri", c.cfg.RedirectURL)
	q.Set("scope", "openid email profile")
	q.Set("state", state)
	return d.AuthorizationEndpoint + "?" + q.Encode(), nil
}

// Exchange validates state, swaps the code for tokens, and returns the user email.
func (c *OIDCClient) Exchange(ctx context.Context, code, state string, now time.Time) (string, error) {
	if !c.verifyState(state, now) {
		return "", errors.New("invalid or expired oidc state")
	}
	d, err := c.discover(ctx)
	if err != nil {
		return "", err
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
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("oidc token exchange: status %d", resp.StatusCode)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		IDToken     string `json:"id_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return "", err
	}

	// Prefer the id_token email claim; fall back to the userinfo endpoint.
	if email := emailFromIDToken(tok.IDToken); email != "" {
		return email, nil
	}
	return c.fetchUserinfoEmail(ctx, d.UserinfoEndpoint, tok.AccessToken)
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

// emailFromIDToken decodes the (unverified-signature) id_token payload for its
// email claim. The token came directly from the provider's token endpoint over
// TLS in response to our authenticated request, so the channel is trusted; we
// use the claim only to identify the already-authenticated user.
func emailFromIDToken(idToken string) string {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims struct {
		Email string `json:"email"`
	}
	if json.Unmarshal(payload, &claims) != nil {
		return ""
	}
	return claims.Email
}

// signState produces "exp.signature" so the callback can verify integrity and
// freshness without server-side storage.
func (c *OIDCClient) signState(now time.Time) string {
	exp := strconv.FormatInt(now.Add(10*time.Minute).Unix(), 10)
	return exp + "." + c.stateMAC(exp)
}

func (c *OIDCClient) verifyState(state string, now time.Time) bool {
	parts := strings.SplitN(state, ".", 2)
	if len(parts) != 2 {
		return false
	}
	if !hmac.Equal([]byte(parts[1]), []byte(c.stateMAC(parts[0]))) {
		return false
	}
	exp, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return false
	}
	return now.Unix() < exp
}

func (c *OIDCClient) stateMAC(msg string) string {
	mac := hmac.New(sha256.New, c.stateKey)
	mac.Write([]byte(msg))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
