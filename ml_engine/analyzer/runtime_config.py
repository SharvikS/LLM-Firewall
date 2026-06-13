"""
Runtime configuration plane for the ML engine.

Holds the dashboard-tunable governance knobs (toxicity, code-leak, PII) in a
thread-safe singleton. The gateway pushes the current values to POST /config on
the embedding HTTP server whenever an operator changes settings; the analyzer
reads them per-request. Defaults are seeded from the same env vars the detectors
use so behaviour is identical until something is changed from the control plane.
"""

import logging
import os
import threading

logger = logging.getLogger("runtime_config")

_DEFAULT_PII_ENTITIES = {
    "US_SSN": True,
    "EMAIL_ADDRESS": True,
    "CREDIT_CARD": True,
    "PHONE_NUMBER": True,
    "PERSON": True,
    "IP_ADDRESS": True,
    "US_PASSPORT": False,
    "IBAN_CODE": True,
}


def _env_bool(key: str, default: bool) -> bool:
    return os.getenv(key, str(default)).lower() in ("true", "1", "yes")


_lock = threading.Lock()
_config = {
    "pii_redaction_enabled": _env_bool("PII_REDACTION_ENABLED", True),
    "toxicity_enabled": _env_bool("TOXICITY_ENABLED", True),
    "toxicity_block_threshold": float(os.getenv("TOXICITY_BLOCK_THRESHOLD", "0.85")),
    "code_leak_block": _env_bool("CODE_LEAK_BLOCK", False),
    "pii_entities": dict(_DEFAULT_PII_ENTITIES),
}

# Keys we accept from a push, with coercion. Unknown keys are ignored so a newer
# gateway can't corrupt the document.
_COERCE = {
    "pii_redaction_enabled": bool,
    "toxicity_enabled": bool,
    "toxicity_block_threshold": float,
    "code_leak_block": bool,
}


def get() -> dict:
    """Return a deep-ish copy of the current config (safe to read/iterate)."""
    with _lock:
        cfg = dict(_config)
        cfg["pii_entities"] = dict(_config["pii_entities"])
        return cfg


def update(patch: dict) -> dict:
    """Merge a patch from the control plane. Returns the new full config."""
    with _lock:
        for key, coerce in _COERCE.items():
            if key in patch and patch[key] is not None:
                try:
                    _config[key] = coerce(patch[key])
                except (TypeError, ValueError):
                    logger.warning("runtime_config: bad value for %s: %r", key, patch[key])
        ents = patch.get("pii_entities")
        if isinstance(ents, dict):
            merged = dict(_config["pii_entities"])
            for name, on in ents.items():
                merged[str(name)] = bool(on)
            _config["pii_entities"] = merged
        # threshold sanity
        t = _config["toxicity_block_threshold"]
        _config["toxicity_block_threshold"] = max(0.0, min(1.0, t))
        out = dict(_config)
        out["pii_entities"] = dict(_config["pii_entities"])
    logger.info(
        "runtime_config updated — toxicity=%s thr=%.2f code_leak_block=%s pii=%s",
        out["toxicity_enabled"], out["toxicity_block_threshold"],
        out["code_leak_block"], out["pii_redaction_enabled"],
    )
    return out


def enabled_pii_entities() -> list[str]:
    """Return the entity names currently toggled on (for Presidio restriction)."""
    with _lock:
        return [name for name, on in _config["pii_entities"].items() if on]
