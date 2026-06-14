// Package analyzer wraps the gRPC AnalyzerService client.
// The Go Gateway calls Analyze() synchronously on every inbound request,
// before the cache lookup, so governance is never bypassed by a cache hit.
package analyzer

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log/slog"
	"net"
	"os"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"

	pb "github.com/sharvik/llm-firewall/gateway/internal/analyzerpb/analyzer/v1"
	"github.com/sharvik/llm-firewall/gateway/internal/logger"
)

// Action mirrors the proto enum for use in Go code without importing the
// generated package at every call site.
type Action int32

const (
	ActionAllow Action = 0
	ActionBlock Action = 1
	ActionMask  Action = 2
)

// Result is a decoded AnalysisResult from the Python gRPC service.
type Result struct {
	Action       Action
	RiskScore    float32
	PIIDetected  bool
	MaskedPrompt string // non-empty when Action == ActionMask
	Reason       string
}

// Client is a thin, fail-open wrapper around the gRPC AnalyzerServiceClient.
// If the ML engine is unavailable the client returns an ALLOW result with a
// zero risk score and logs a warning — the intelligence plane being down must
// never take the data plane with it.
type Client struct {
	conn    *grpc.ClientConn
	stub    pb.AnalyzerServiceClient
	timeout time.Duration
}

// New dials the gRPC server at addr.  The connection is lazy — if the server
// is not yet up, the first RPC will fail and return a fail-open result.
//
// TLS modes (set ANALYZER_TLS_ENABLED=true and run scripts/gen-certs.sh):
//   - one-way TLS: certFile is the CA (or self-signed server cert) the client
//     trusts; the channel is encrypted and the server identity verified.
//   - mutual TLS: additionally set clientCertFile/clientKeyFile and the client
//     presents its certificate, so the server can authenticate the gateway too.
//
// The default is plaintext so existing local deployments are unaffected.
func New(addr string, timeout time.Duration, tlsEnabled bool, certFile, clientCertFile, clientKeyFile string) (*Client, error) {
	var cred grpc.DialOption
	if tlsEnabled {
		caPEM, err := os.ReadFile(certFile)
		if err != nil {
			return nil, fmt.Errorf("analyzer: read CA/cert %q: %w", certFile, err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caPEM) {
			return nil, fmt.Errorf("analyzer: no certificates parsed from %q", certFile)
		}
		host := addr
		if h, _, splitErr := net.SplitHostPort(addr); splitErr == nil {
			host = h
		}
		tlsCfg := &tls.Config{RootCAs: pool, ServerName: host, MinVersion: tls.VersionTLS12}

		mtls := clientCertFile != "" && clientKeyFile != ""
		if mtls {
			pair, err := tls.LoadX509KeyPair(clientCertFile, clientKeyFile)
			if err != nil {
				return nil, fmt.Errorf("analyzer: load client cert/key: %w", err)
			}
			tlsCfg.Certificates = []tls.Certificate{pair}
		}
		cred = grpc.WithTransportCredentials(credentials.NewTLS(tlsCfg))
		logger.Get().Info("analyzer gRPC using TLS",
			slog.String("addr", addr),
			slog.String("server_name", host),
			slog.Bool("mutual", mtls),
		)
	} else {
		cred = grpc.WithTransportCredentials(insecure.NewCredentials())
		logger.Get().Warn("analyzer gRPC using plaintext — set ANALYZER_TLS_ENABLED=true to encrypt the channel",
			slog.String("addr", addr),
		)
	}

	// The OTel stats handler injects the W3C trace context into outgoing gRPC
	// metadata so ML-engine spans join the gateway's trace. With tracing
	// disabled the global provider is a no-op and this adds no overhead.
	conn, err := grpc.NewClient(addr, cred,
		grpc.WithStatsHandler(otelgrpc.NewClientHandler()))
	if err != nil {
		return nil, fmt.Errorf("analyzer: dial %q: %w", addr, err)
	}
	return &Client{
		conn:    conn,
		stub:    pb.NewAnalyzerServiceClient(conn),
		timeout: timeout,
	}, nil
}

// Analyze calls AnalyzePrompt on the Python ML engine.
// On any error (nil client, timeout, network, engine crash) it returns a safe
// ALLOW result and logs a WARN — fail-open is the correct behaviour for a
// performance proxy.
func (c *Client) Analyze(ctx context.Context, reqID, tenantID, promptBody string) Result {
	if c == nil {
		// Guard here too: reading c.timeout below would nil-deref on a nil client.
		logger.Get().Warn("analyzer client is nil — failing open", slog.String("request_id", reqID))
		return Result{Action: ActionAllow, RiskScore: 0}
	}
	return c.AnalyzeWithTimeout(ctx, reqID, tenantID, promptBody, c.timeout)
}

// AnalyzeWithTimeout is Analyze with an explicit per-call deadline. Response-side
// output scanning uses a longer budget than the tight inline-request timeout,
// because scanning generated text runs the full (transformer-backed) pipeline.
func (c *Client) AnalyzeWithTimeout(ctx context.Context, reqID, tenantID, promptBody string, timeout time.Duration) Result {
	if c == nil {
		logger.Get().Warn("analyzer client is nil — failing open", slog.String("request_id", reqID))
		return Result{Action: ActionAllow, RiskScore: 0}
	}
	rctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	resp, err := c.stub.AnalyzePrompt(rctx, &pb.PromptRequest{
		RequestId: reqID,
		TenantId:  tenantID,
		Prompt:    promptBody,
	})
	if err != nil {
		logger.Get().Warn("analyzer unavailable — failing open",
			slog.String("request_id", reqID),
			slog.String("error", err.Error()),
		)
		return Result{Action: ActionAllow, RiskScore: 0}
	}

	return Result{
		Action:       Action(resp.Action),
		RiskScore:    resp.RiskScore,
		PIIDetected:  resp.PiiDetected,
		MaskedPrompt: resp.MaskedPrompt,
		Reason:       resp.Reason,
	}
}

func (c *Client) Close() {
	if c.conn != nil {
		c.conn.Close()
		logger.Get().Info("analyzer gRPC connection closed")
	}
}
