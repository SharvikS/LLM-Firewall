// Package telemetry wires OpenTelemetry distributed tracing for the gateway.
// It is entirely opt-in: when OTEL_EXPORTER_OTLP_ENDPOINT is unset, Setup is
// a no-op and the HTTP middleware passes requests through untouched.
package telemetry

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
)

// Setup initialises the global tracer provider when an OTLP endpoint is
// configured. It returns a shutdown function (always non-nil) that flushes
// pending spans, and whether tracing is active.
//
// Standard OTel env vars are honoured by the exporter itself:
//
//	OTEL_EXPORTER_OTLP_ENDPOINT   e.g. http://otel-collector:4318
//	OTEL_EXPORTER_OTLP_HEADERS    e.g. authorization=Bearer <token>
//	OTEL_SERVICE_NAME             overrides the default "titan-gateway"
func Setup(ctx context.Context) (shutdown func(context.Context) error, enabled bool) {
	noop := func(context.Context) error { return nil }

	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		return noop, false
	}

	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		logger.Get().Warn("otel: exporter init failed — tracing disabled",
			slog.String("error", err.Error()))
		return noop, false
	}

	serviceName := os.Getenv("OTEL_SERVICE_NAME")
	if serviceName == "" {
		serviceName = "titan-gateway"
	}

	res, err := resource.Merge(resource.Default(), resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceName(serviceName),
	))
	if err != nil {
		res = resource.Default()
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter, sdktrace.WithBatchTimeout(5*time.Second)),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{}, propagation.Baggage{},
	))

	logger.Get().Info("otel: tracing enabled",
		slog.String("endpoint", endpoint),
		slog.String("service", serviceName),
	)
	return tp.Shutdown, true
}

// Middleware wraps an http.Handler with OTel server spans (one span per
// request, named after the method + route). When tracing is disabled the
// handler is returned unchanged so there is zero overhead.
func Middleware(enabled bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if !enabled {
			return next
		}
		return otelhttp.NewHandler(next, "gateway",
			otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
				return r.Method + " " + r.URL.Path
			}),
		)
	}
}
