"""Tests for the runtime governance config plane (no heavy ML deps)."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analyzer import runtime_config


def test_defaults_present():
    cfg = runtime_config.get()
    assert "toxicity_enabled" in cfg
    assert "pii_entities" in cfg
    assert isinstance(cfg["pii_entities"], dict)


def test_update_merges_and_clamps():
    out = runtime_config.update({"toxicity_block_threshold": 5.0, "code_leak_block": True})
    assert out["toxicity_block_threshold"] == 1.0  # clamped to [0,1]
    assert out["code_leak_block"] is True
    # untouched key keeps its value
    assert "toxicity_enabled" in out


def test_pii_entity_toggle_reflected_in_allowlist():
    runtime_config.update({"pii_entities": {"US_SSN": False, "EMAIL_ADDRESS": True}})
    allow = runtime_config.enabled_pii_entities()
    assert "US_SSN" not in allow
    assert "EMAIL_ADDRESS" in allow


def test_unknown_keys_ignored():
    before = runtime_config.get()
    out = runtime_config.update({"totally_unknown": 123})
    assert "totally_unknown" not in out
    assert out["toxicity_enabled"] == before["toxicity_enabled"]


def test_get_returns_copy():
    cfg = runtime_config.get()
    cfg["pii_entities"]["US_SSN"] = "tampered"
    # mutating the returned copy must not affect internal state
    assert runtime_config.get()["pii_entities"].get("US_SSN") in (True, False)
