package cache

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
)

const (
	qdrantCollection = "titan_response_cache"
	embeddingDims    = 384 // all-MiniLM-L6-v2 output dimension
)

// SemanticCache stores LLM responses in Qdrant indexed by the vector
// embedding of the request text.  It returns a cached response when cosine
// similarity between the incoming request's embedding and a stored vector
// exceeds the configured threshold.
//
// The embedding is fetched from an HTTP service (the Python ML engine's
// /embed endpoint).  All network calls are best-effort: any error causes a
// transparent cache miss so the request continues normally.
type SemanticCache struct {
	qdrantURL    string
	embeddingURL string
	threshold    float64
	client       *http.Client
}

// qdrantSearchResponse is the minimal shape of a Qdrant /points/search reply.
type qdrantSearchResponse struct {
	Result []struct {
		Score   float64 `json:"score"`
		Payload struct {
			StatusCode int               `json:"status_code"`
			Headers    map[string]string `json:"headers"`
			Body       string            `json:"body"` // base64-encoded
		} `json:"payload"`
	} `json:"result"`
}

// NewSemanticCache creates a SemanticCache and ensures the Qdrant collection
// exists.  Returns nil if QdrantURL is empty or if the collection cannot be
// initialised (so the proxy treats it as disabled without panicking).
func NewSemanticCache(qdrantURL, embeddingURL string, threshold float64) *SemanticCache {
	if qdrantURL == "" {
		return nil
	}
	sc := &SemanticCache{
		qdrantURL:    qdrantURL,
		embeddingURL: embeddingURL,
		threshold:    threshold,
		client:       &http.Client{Timeout: 2 * time.Second},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := sc.ensureCollection(ctx); err != nil {
		logger.Get().Warn("Qdrant semantic cache init failed — disabled",
			slog.String("error", err.Error()),
			slog.String("qdrant_url", qdrantURL),
		)
		return nil
	}
	logger.Get().Info("semantic cache ready",
		slog.String("qdrant", qdrantURL),
		slog.Float64("threshold", threshold),
	)
	return sc
}

// Get looks up the nearest cached response for the given request body.
// Returns (entry, true) on a semantic hit, (nil, false) on a miss or error.
func (sc *SemanticCache) Get(ctx context.Context, body []byte) (*Entry, bool) {
	text := extractText(body)
	if text == "" {
		return nil, false
	}
	vector, err := sc.embed(ctx, text)
	if err != nil {
		logger.Get().Debug("semantic cache embed error — treating as miss",
			slog.String("error", err.Error()))
		return nil, false
	}

	payload := map[string]interface{}{
		"vector":          vector,
		"limit":           1,
		"with_payload":    true,
		"score_threshold": sc.threshold,
	}
	data, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/collections/%s/points/search", sc.qdrantURL, qdrantCollection)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return nil, false
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := sc.client.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()

	var result qdrantSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil || len(result.Result) == 0 {
		return nil, false
	}

	hit := result.Result[0]
	bodyBytes, err := base64.StdEncoding.DecodeString(hit.Payload.Body)
	if err != nil {
		return nil, false
	}
	return &Entry{
		StatusCode: hit.Payload.StatusCode,
		Headers:    hit.Payload.Headers,
		Body:       bodyBytes,
	}, true
}

// Set stores a response in Qdrant indexed by the vector embedding of the
// request body.  Errors are silently discarded — a missed write is preferable
// to blocking the response path.
func (sc *SemanticCache) Set(ctx context.Context, body []byte, statusCode int, headers map[string]string, respBody []byte) {
	text := extractText(body)
	if text == "" {
		return
	}
	// Use a short timeout; the caller already delivered the response.
	setCtx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()

	vector, err := sc.embed(setCtx, text)
	if err != nil {
		return
	}

	// Deterministic UUID v5 from the request body — prevents duplicate points
	// for identical requests.
	pointID := uuid.NewSHA1(uuid.NameSpaceDNS, body).String()

	payload := map[string]interface{}{
		"points": []map[string]interface{}{
			{
				"id":     pointID,
				"vector": vector,
				"payload": map[string]interface{}{
					"status_code": statusCode,
					"headers":     headers,
					"body":        base64.StdEncoding.EncodeToString(respBody),
				},
			},
		},
	}
	data, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/collections/%s/points", sc.qdrantURL, qdrantCollection)
	req, err := http.NewRequestWithContext(setCtx, http.MethodPut, url, bytes.NewReader(data))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := sc.client.Do(req)
	if err != nil {
		logger.Get().Debug("qdrant upsert failed", slog.String("error", err.Error()))
		return
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body) //nolint:errcheck
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

func (sc *SemanticCache) ensureCollection(ctx context.Context) error {
	payload := map[string]interface{}{
		"vectors": map[string]interface{}{
			"size":     embeddingDims,
			"distance": "Cosine",
		},
	}
	data, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/collections/%s", sc.qdrantURL, qdrantCollection)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := sc.client.Do(req)
	if err != nil {
		return fmt.Errorf("qdrant unreachable at %s: %w", sc.qdrantURL, err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body) //nolint:errcheck
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("qdrant collection init returned HTTP %d", resp.StatusCode)
	}
	return nil
}

type embeddingResponse struct {
	Embedding []float64 `json:"embedding"`
}

func (sc *SemanticCache) embed(ctx context.Context, text string) ([]float64, error) {
	body, _ := json.Marshal(map[string]string{"text": text})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sc.embeddingURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := sc.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embedding service unreachable: %w", err)
	}
	defer resp.Body.Close()
	var result embeddingResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if len(result.Embedding) == 0 {
		return nil, fmt.Errorf("embedding service returned empty vector")
	}
	return result.Embedding, nil
}

// extractText pulls the human-readable prompt text out of an OpenAI-format
// request body so the embedding model operates on natural language, not JSON.
func extractText(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var req struct {
		Messages []struct {
			Content string `json:"content"`
		} `json:"messages"`
		Prompt string `json:"prompt"` // text completions API
	}
	if err := json.Unmarshal(body, &req); err != nil {
		// Not JSON — embed raw (truncated to 512 chars)
		if len(body) > 512 {
			return string(body[:512])
		}
		return string(body)
	}
	if len(req.Messages) > 0 {
		parts := make([]string, 0, len(req.Messages))
		for _, m := range req.Messages {
			if m.Content != "" {
				parts = append(parts, m.Content)
			}
		}
		return strings.Join(parts, "\n")
	}
	return req.Prompt
}
