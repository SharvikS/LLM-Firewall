"""
OpenTelemetry tracing for the ML engine — opt-in and fail-safe.

Mirrors the Go gateway's telemetry package: tracing activates only when
OTEL_EXPORTER_OTLP_ENDPOINT is set AND the opentelemetry packages are
installed. In every other case the public API degrades to no-ops, so the
analyzer never pays a cost (or crashes) because of missing observability
infrastructure.

Public API:
    init()        — call once at startup, before the gRPC server is built.
    server_interceptors() — list of grpc interceptors (empty when disabled).
    span(name)    — context manager wrapping a local span (nullcontext when
                    disabled). Used to time PII/injection/toxicity scans.
"""

import logging
import os
from contextlib import contextmanager, nullcontext

logger = logging.getLogger("telemetry")

_tracer = None
_enabled = False


def init() -> bool:
    """Initialise the global tracer provider. Returns True when tracing is live."""
    global _tracer, _enabled

    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if not endpoint:
        logger.info("OTEL_EXPORTER_OTLP_ENDPOINT unset — tracing disabled")
        return False

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError as exc:
        logger.warning("opentelemetry packages missing (%s) — tracing disabled", exc)
        return False

    try:
        service = os.getenv("OTEL_SERVICE_NAME", "titan-ml-engine")
        provider = TracerProvider(
            resource=Resource.create({"service.name": service})
        )
        # OTLPSpanExporter appends /v1/traces itself when given a bare endpoint.
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
        trace.set_tracer_provider(provider)
        _tracer = trace.get_tracer("titan.ml_engine")
        _enabled = True
        logger.info("OpenTelemetry tracing enabled (service=%s endpoint=%s)", service, endpoint)
        return True
    except Exception as exc:  # observability must never take the service down
        logger.warning("OTel init failed (%s) — tracing disabled", exc)
        return False


def server_interceptors() -> list:
    """gRPC server interceptors that extract the inbound W3C trace context."""
    if not _enabled:
        return []
    try:
        from opentelemetry.instrumentation.grpc import server_interceptor

        return [server_interceptor()]
    except ImportError:
        return []


def span(name: str):
    """Context manager for a local span; nullcontext when tracing is off."""
    if _tracer is None:
        return nullcontext()
    return _tracer.start_as_current_span(name)
