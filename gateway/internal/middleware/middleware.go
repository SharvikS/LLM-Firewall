package middleware

import (
	"log/slog"
	"net/http"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
)

// StructuredLogger replaces Chi's default logger with a JSON slog line per
// request. Fields: method, path, status, latency_ms, bytes, request_id.
func StructuredLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := chimiddleware.NewWrapResponseWriter(w, r.ProtoMajor)

		next.ServeHTTP(ww, r)

		logger.Get().Info("request",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.String("request_id", chimiddleware.GetReqID(r.Context())),
			slog.String("remote_addr", r.RemoteAddr),
			slog.Int("status", ww.Status()),
			slog.Int("bytes", ww.BytesWritten()),
			slog.Int64("latency_ms", time.Since(start).Milliseconds()),
		)
	})
}

// MaxBodySize wraps every request body with an io.LimitedReader. The actual
// 413 response is written by the proxy when the read fails, keeping this
// middleware thin and reusable.
func MaxBodySize(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			next.ServeHTTP(w, r)
		})
	}
}

// SecurityHeaders sets conservative response headers and is applied globally
// before any handler runs.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}
