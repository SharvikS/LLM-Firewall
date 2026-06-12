"""Tests for the opt-in OTel telemetry module — must be a safe no-op by default."""

import contextlib
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analyzer import telemetry


def test_init_disabled_without_endpoint(monkeypatch):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    assert telemetry.init() is False


def test_span_is_noop_when_disabled():
    ctx = telemetry.span("anything")
    assert isinstance(ctx, contextlib.nullcontext)
    with ctx:
        pass  # must not raise


def test_server_interceptors_empty_when_disabled():
    assert telemetry.server_interceptors() == []


def test_analyze_pipeline_unaffected_by_disabled_tracing():
    # The span wrapper must be transparent: code inside runs exactly once.
    ran = []
    with telemetry.span("InjectionDetector.detect"):
        ran.append(1)
    assert ran == [1]
