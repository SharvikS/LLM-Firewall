// Package analyzer wraps the gRPC AnalyzerService client.
// The Go Gateway calls Analyze() synchronously on every inbound request,
// before the cache lookup, so governance is never bypassed by a cache hit.
package analyzer

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"google.golang.org/grpc"
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
func New(addr string, timeout time.Duration) (*Client, error) {
	conn, err := grpc.NewClient(addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return nil, fmt.Errorf("analyzer: dial %q: %w", addr, err)
	}
	logger.Get().Info("analyzer gRPC client connected", slog.String("addr", addr))
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
		logger.Get().Warn("analyzer client is nil — failing open", slog.String("request_id", reqID))
		return Result{Action: ActionAllow, RiskScore: 0}
	}
	rctx, cancel := context.WithTimeout(ctx, c.timeout)
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
