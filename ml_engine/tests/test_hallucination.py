"""Tests for the response-side groundedness / hallucination gate.

Groundedness scoring is a TITAN Enterprise feature, so this whole module is
skipped unless TITAN_EDITION=enterprise (the detector is absent / disabled in an
open-core checkout).

The NLI model is optional and large, so these tests exercise the *contract* —
fail-open behaviour, config gating, and verdict shaping — without requiring a
model download. The one model-dependent assertion is skipped when the NLI
pipeline isn't available, mirroring the toxicity test's approach.
"""

import os

import pytest

if os.getenv("TITAN_EDITION", "community").strip().lower() != "enterprise":
    pytest.skip(
        "groundedness scoring is a TITAN Enterprise feature "
        "(set TITAN_EDITION=enterprise to run)",
        allow_module_level=True,
    )

from analyzer import runtime_config
from analyzer.hallucination_detector import HallucinationDetector, GroundednessResult
from analyzer.server import AnalyzerServicer


@pytest.fixture(scope="module")
def servicer():
    return AnalyzerServicer()


@pytest.fixture(autouse=True)
def _reset_config():
    # Each test sets the knobs it needs; restore defaults afterwards.
    before = runtime_config.get()
    yield
    runtime_config.update({
        "hallucination_enabled": before["hallucination_enabled"],
        "hallucination_block": before["hallucination_block"],
        "hallucination_block_threshold": before["hallucination_block_threshold"],
    })


# ── detector fail-open contract ───────────────────────────────────────────────

def test_disabled_detector_returns_unchecked():
    det = HallucinationDetector()
    det.enabled = False
    r = det.score("the sky is blue", "the sky is green")
    assert r.checked is False and r.grounded is True and r.risk == 0.0


def test_no_context_is_unchecked():
    det = HallucinationDetector()
    det.enabled = True  # but no model needed: empty context short-circuits first
    r = det.score("", "Paris is the capital of France.")
    assert r.checked is False and r.grounded is True


def test_empty_response_is_unchecked():
    det = HallucinationDetector()
    det.enabled = True
    r = det.score("some grounding context here", "")
    assert r.checked is False and r.grounded is True


# ── verdict shaping (server.scan_groundedness) ────────────────────────────────

def test_verdict_allow_when_gate_disabled(servicer):
    runtime_config.update({"hallucination_enabled": False})
    v = servicer.scan_groundedness("ctx", "claim")
    assert v["decision"] == "allow" and v["category"] == "hallucination"
    assert v["checked"] is False


def test_verdict_allow_when_unchecked(servicer, monkeypatch):
    # Gate on, but the detector reports unchecked (e.g. no model) → must fail open.
    runtime_config.update({"hallucination_enabled": True})
    monkeypatch.setattr(servicer._hallucination, "score",
                        lambda c, r: GroundednessResult(grounded=True, risk=0.0, checked=False))
    v = servicer.scan_groundedness("ctx", "unverifiable claim")
    assert v["decision"] == "allow" and v["risk"] == 0.0


def test_verdict_flag_on_low_groundedness(servicer, monkeypatch):
    runtime_config.update({"hallucination_enabled": True, "hallucination_block": False})
    monkeypatch.setattr(servicer._hallucination, "score",
                        lambda c, r: GroundednessResult(
                            grounded=False, risk=0.8, checked=True,
                            unsupported=["fabricated sentence."], sentences_checked=5))
    v = servicer.scan_groundedness("the doc says X", "totally unrelated answer.")
    assert v["decision"] == "flag"          # flag, not block, by default
    assert v["risk"] == 80.0 and v["unsupported"]


def test_verdict_block_when_block_mode_on(servicer, monkeypatch):
    runtime_config.update({"hallucination_enabled": True, "hallucination_block": True})
    monkeypatch.setattr(servicer._hallucination, "score",
                        lambda c, r: GroundednessResult(
                            grounded=False, risk=0.9, checked=True,
                            unsupported=["x."], sentences_checked=3))
    v = servicer.scan_groundedness("ctx", "ungrounded.")
    assert v["decision"] == "block"


def test_verdict_allow_when_grounded(servicer, monkeypatch):
    runtime_config.update({"hallucination_enabled": True})
    monkeypatch.setattr(servicer._hallucination, "score",
                        lambda c, r: GroundednessResult(
                            grounded=True, risk=0.1, checked=True, sentences_checked=4))
    v = servicer.scan_groundedness("ctx supports it", "well grounded answer.")
    assert v["decision"] == "allow"
