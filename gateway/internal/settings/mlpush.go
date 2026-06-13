package settings

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
)

// MLConfigURLFromEmbedding derives the ML engine's runtime-config endpoint from
// the embedding URL (same host/port). e.g.
// "http://ml_engine:8001/embed" → "http://ml_engine:8001/config".
// Returns "" when embeddingURL is empty so the push becomes a no-op.
func MLConfigURLFromEmbedding(embeddingURL string) string {
	if embeddingURL == "" {
		return ""
	}
	if i := strings.LastIndex(embeddingURL, "/"); i >= 0 {
		return embeddingURL[:i] + "/config"
	}
	return embeddingURL + "/config"
}

// mlConfig is the ML-relevant projection of Settings sent to the Python engine.
type mlConfig struct {
	PIIRedactionEnabled    bool            `json:"pii_redaction_enabled"`
	ToxicityEnabled        bool            `json:"toxicity_enabled"`
	ToxicityBlockThreshold float64         `json:"toxicity_block_threshold"`
	CodeLeakBlock          bool            `json:"code_leak_block"`
	PIIEntities            map[string]bool `json:"pii_entities"`
}

// NewMLPusher returns an ApplyFunc that POSTs the ML-relevant settings to the
// engine's /config endpoint. Best-effort and fail-open: a push failure is logged
// but never blocks a settings change (the engine keeps its previous values).
func NewMLPusher(configURL string) ApplyFunc {
	client := &http.Client{Timeout: 3 * time.Second}
	return func(s Settings) {
		if configURL == "" {
			return
		}
		body, err := json.Marshal(mlConfig{
			PIIRedactionEnabled:    s.PIIRedactionEnabled,
			ToxicityEnabled:        s.ToxicityEnabled,
			ToxicityBlockThreshold: s.ToxicityBlockThreshold,
			CodeLeakBlock:          s.CodeLeakBlock,
			PIIEntities:            s.PIIEntities,
		})
		if err != nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, configURL, bytes.NewReader(body))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			logger.Get().Warn("ML config push failed — engine keeps previous values",
				slog.String("url", configURL), slog.String("error", err.Error()))
			return
		}
		resp.Body.Close()
		if resp.StatusCode >= 300 {
			logger.Get().Warn("ML config push rejected",
				slog.String("url", configURL), slog.Int("status", resp.StatusCode))
			return
		}
		logger.Get().Info("ML runtime config pushed", slog.String("url", configURL))
	}
}
