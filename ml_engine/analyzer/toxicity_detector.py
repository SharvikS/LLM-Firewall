"""
Toxicity & Sentiment Detector — two-layer classification, same shape as the
injection detector.

Layer 1 — Heuristic (fast path, ~0ms):
  Curated lexicon of hate / harassment / threat / self-harm / sexual-violence
  terms. A match yields a category and a confidence floor without touching the
  ML layer. This always works, with no model download.

Layer 2 — Transformer (optional, ~10-50ms):
  HuggingFace `unitary/toxic-bert` multi-label classifier, loaded at startup if
  `transformers` + `torch` are installed. Produces per-category probabilities
  (toxic, severe_toxic, obscene, threat, insult, identity_hate). If the model
  can't be fetched the heuristic layer carries detection on its own, exactly
  like the injection detector's TF-IDF fallback.

The gate is configurable:
  TOXICITY_ENABLED         — "true"/"false" (default true)
  TOXICITY_BLOCK_THRESHOLD — 0.0-1.0 score above which the request is BLOCKed
                             (default 0.85)

The detector never raises; on any internal failure it returns a clean result so
the firewall fails open on this gate, matching the rest of the ML engine.
"""

import logging
import os
import re
from dataclasses import dataclass, field

logger = logging.getLogger("toxicity_detector")

_DEFAULT_BLOCK_THRESHOLD = float(os.getenv("TOXICITY_BLOCK_THRESHOLD", "0.85"))
_ENABLED = os.getenv("TOXICITY_ENABLED", "true").lower() in ("true", "1")

# Transformer label → coarse category. unitary/toxic-bert emits these six labels.
_HF_LABEL_CATEGORY = {
    "toxic": "toxicity",
    "severe_toxic": "severe_toxicity",
    "obscene": "obscenity",
    "threat": "threat",
    "insult": "insult",
    "identity_hate": "identity_hate",
}


# ---------------------------------------------------------------------------
# Heuristic layer — lexicon scan
# ---------------------------------------------------------------------------
# Each entry is (pattern, category, confidence). Patterns are intentionally
# conservative: they target unambiguous threats / hate / self-harm signals so
# the heuristic floor rarely fires on benign prompts. The transformer layer
# catches the long tail of subtler toxicity.

_HEURISTIC_SIGNATURES: list[tuple[re.Pattern, str, float]] = [
    # explicit threats of violence
    (re.compile(r"\b(i('|\s+a)?m\s+going\s+to|i\s+will|gonna)\s+(kill|murder|hurt|stab|shoot|beat)\s+(you|him|her|them)\b", re.I), "threat", 0.95),
    (re.compile(r"\b(kill|murder|harm)\s+(yourself|themselves|all\s+of\s+(you|them))\b", re.I), "threat", 0.93),
    # self-harm / suicide solicitation
    (re.compile(r"\b(how\s+(to|do\s+i)|best\s+way\s+to)\s+(kill\s+myself|commit\s+suicide|end\s+my\s+life)\b", re.I), "self_harm", 0.96),
    # identity-based hate (slur scaffolding, not enumerating slurs here)
    (re.compile(r"\b(all|those)\s+\w+\s+(should\s+(die|be\s+killed)|are\s+(subhuman|vermin|animals))\b", re.I), "identity_hate", 0.92),
    (re.compile(r"\b(gas|exterminate|cleanse)\s+(the|all)\s+\w+", re.I), "identity_hate", 0.9),
    # sexual violence
    (re.compile(r"\b(how\s+to|best\s+way\s+to)\s+(rape|assault|molest)\b", re.I), "sexual_violence", 0.95),
    # harassment / severe insults directed at a person
    (re.compile(r"\byou('|\s+a)?re\s+(a\s+)?(worthless|pathetic|disgusting)\s+(piece\s+of\s+\w+|human|person)\b", re.I), "harassment", 0.82),
]


@dataclass
class ToxicityResult:
    is_toxic: bool
    score: float                       # 0.0-1.0, max category probability
    category: str                      # dominant category, "none" when clean
    categories: list[str] = field(default_factory=list)
    description: str = ""

    @property
    def should_block(self) -> bool:
        return self.is_toxic and self.score >= _DEFAULT_BLOCK_THRESHOLD


_CLEAN = ToxicityResult(is_toxic=False, score=0.0, category="none", description="No toxicity detected")


class ToxicityDetector:
    """Heuristic lexicon + optional HuggingFace `toxic-bert`."""

    def __init__(self) -> None:
        self.enabled = _ENABLED
        self.block_threshold = _DEFAULT_BLOCK_THRESHOLD
        self._hf_pipe = None

        if not self.enabled:
            logger.info("ToxicityDetector disabled via TOXICITY_ENABLED=false")
            return

        try:
            from transformers import pipeline as hf_pipeline  # noqa: PLC0415
            self._hf_pipe = hf_pipeline(
                "text-classification",
                model="unitary/toxic-bert",
                device=-1,           # CPU inference; set device=0 for GPU
                truncation=True,
                max_length=512,
                top_k=None,          # return all label scores (multi-label)
            )
            logger.info("ToxicityDetector Layer 2: HuggingFace model loaded — unitary/toxic-bert")
        except Exception as exc:
            logger.warning(
                "Toxicity transformer unavailable (%s) — Layer 2 disabled, "
                "heuristic lexicon remains active", exc,
            )

    def detect(self, text: str) -> ToxicityResult:
        if not self.enabled or not text or not text.strip():
            return _CLEAN

        # --- Layer 1: heuristic fast path ---
        for pattern, category, confidence in _HEURISTIC_SIGNATURES:
            if pattern.search(text):
                logger.warning("Heuristic toxicity match — category=%s confidence=%.2f", category, confidence)
                return ToxicityResult(
                    is_toxic=True,
                    score=confidence,
                    category=category,
                    categories=[category],
                    description=f"Matched toxicity lexicon: {category}",
                )

        # --- Layer 2: transformer ---
        if self._hf_pipe is not None:
            try:
                return self._classify_with_transformer(text)
            except Exception as exc:  # never let the model take down the gate
                logger.warning("Toxicity transformer inference failed (%s) — returning clean", exc)
                return _CLEAN

        return _CLEAN

    def _classify_with_transformer(self, text: str) -> ToxicityResult:
        # top_k=None returns a list of {label, score} dicts (sometimes nested).
        raw = self._hf_pipe(text[:512])
        scores = raw[0] if raw and isinstance(raw[0], list) else raw

        flagged: list[tuple[str, float]] = []
        top_label, top_score = "none", 0.0
        for item in scores:
            label = str(item.get("label", "")).lower()
            score = float(item.get("score", 0.0))
            category = _HF_LABEL_CATEGORY.get(label, label)
            if score > top_score:
                top_label, top_score = category, score
            if score >= 0.5:
                flagged.append((category, score))

        if top_score >= self.block_threshold or flagged:
            categories = sorted({c for c, _ in flagged}) or [top_label]
            logger.warning("Transformer toxicity — top=%s score=%.3f categories=%s", top_label, top_score, categories)
            return ToxicityResult(
                is_toxic=True,
                score=top_score,
                category=top_label,
                categories=categories,
                description=f"Toxicity classifier flagged: {', '.join(categories)} ({top_score:.0%})",
            )

        return _CLEAN
