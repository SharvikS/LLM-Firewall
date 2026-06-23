"""
TITAN Enterprise — commercial license (see LICENSE-ENTERPRISE.md), not MIT.

Groundedness / Hallucination Detector — response-side factuality gate.

Unlike the prompt-side detectors (injection, toxicity, PII, secrets) this one
scores an *assistant response* against the *context the request provided*
(system instructions, retrieved/RAG documents, the user's own source text). It
answers a narrow, checkable question: **is each claim in the response actually
supported by the supplied context?** Sentences that the context neither entails
nor mentions are flagged as potential hallucinations.

Approach — Natural Language Inference (NLI), local & offline:
  The response is split into sentences. Each sentence is run as the *hypothesis*
  against the context as the *premise* through a HuggingFace NLI model
  (entailment / neutral / contradiction). A sentence counts as UNSUPPORTED when
  its entailment probability is low (optionally with a high contradiction
  probability marking an outright conflict). The groundedness risk is the
  fraction of response sentences that are unsupported.

Deliberate scope & fail-open contract (matches the rest of the engine):
  * With **no context**, groundedness is undecidable here, so we return
    `checked=False` and a clean (grounded) result — we never fabricate a finding.
  * If the NLI model can't be loaded (offline, `transformers`/`torch` absent),
    we also return clean+unchecked. The detector NEVER raises and NEVER blocks on
    its own internal failure — a missing model must not start blocking real
    answers.

Config (via runtime_config / env, dashboard-tunable):
  HALLUCINATION_ENABLED          — "true"/"false" (default false; opt-in, heavier)
  HALLUCINATION_BLOCK_THRESHOLD  — 0.0-1.0 unsupported-fraction above which the
                                   response is flagged (default 0.5)
"""

import logging
import os
import re
from dataclasses import dataclass, field

logger = logging.getLogger("hallucination_detector")

_DEFAULT_BLOCK_THRESHOLD = float(os.getenv("HALLUCINATION_BLOCK_THRESHOLD", "0.5"))
_ENABLED = os.getenv("HALLUCINATION_ENABLED", "false").lower() in ("true", "1")

# Default NLI checkpoint. Small DeBERTa-v3 cross-encoder: 3-way (entailment /
# neutral / contradiction), CPU-friendly, no system binary. Override with
# HALLUCINATION_MODEL for a larger/more accurate model.
_MODEL = os.getenv("HALLUCINATION_MODEL", "cross-encoder/nli-deberta-v3-small")

# An entailment probability at or above this means the context supports the
# sentence. Below it the sentence is "unsupported" (a hallucination candidate).
_ENTAIL_SUPPORT = float(os.getenv("HALLUCINATION_ENTAIL_MIN", "0.5"))

# Sentences shorter than this (after trim) are skipped — greetings, "Sure!",
# list bullets and punctuation fragments carry no checkable claim.
_MIN_SENTENCE_CHARS = 16

# Cap how many sentences we score per response so one huge answer can't stall the
# worker; the leading sentences carry the substantive claims.
_MAX_SENTENCES = int(os.getenv("HALLUCINATION_MAX_SENTENCES", "40"))

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])")


@dataclass
class GroundednessResult:
    grounded: bool                     # did the response stay within the context?
    risk: float                        # 0.0-1.0 — fraction of unsupported sentences
    checked: bool                      # was a real NLI check actually run?
    unsupported: list[str] = field(default_factory=list)  # the flagged sentences
    sentences_checked: int = 0
    description: str = ""


# Clean sentinel: returned whenever we can't (or needn't) make a judgement, so
# the caller fails OPEN — an unchecked response is never treated as a finding.
_CLEAN_UNCHECKED = GroundednessResult(
    grounded=True, risk=0.0, checked=False,
    description="No context supplied — groundedness not evaluated",
)


def _split_sentences(text: str) -> list[str]:
    parts = _SENTENCE_SPLIT.split(text.strip())
    out = [s.strip() for s in parts if len(s.strip()) >= _MIN_SENTENCE_CHARS]
    return out[:_MAX_SENTENCES]


class HallucinationDetector:
    """NLI-based groundedness check of a response against its provided context."""

    def __init__(self) -> None:
        self.enabled = _ENABLED
        self.block_threshold = _DEFAULT_BLOCK_THRESHOLD
        self._pipe = None

        if not self.enabled:
            logger.info("HallucinationDetector disabled via HALLUCINATION_ENABLED=false")
            return

        self._load_model()

    def _load_model(self) -> None:
        try:
            from transformers import pipeline as hf_pipeline  # noqa: PLC0415
            # text-classification over a (premise, hypothesis) pair gives the
            # 3-way NLI distribution. top_k=None returns all label scores.
            self._pipe = hf_pipeline(
                "text-classification",
                model=_MODEL,
                device=-1,          # CPU inference
                truncation=True,
                max_length=512,
                top_k=None,
            )
            logger.info("HallucinationDetector: NLI model loaded — %s", _MODEL)
        except Exception as exc:
            logger.warning(
                "Hallucination NLI model unavailable (%s) — groundedness checks "
                "will pass through unchecked (fail-open)", exc,
            )
            self._pipe = None

    def score(self, context: str, response: str) -> GroundednessResult:
        """Score how well `response` is grounded in `context`.

        Fails OPEN on every undecidable/failure path: no context, no model, empty
        response, or any inference error all return a clean, unchecked result.
        """
        if not self.enabled or self._pipe is None:
            return _CLEAN_UNCHECKED
        if not context or not context.strip() or not response or not response.strip():
            return _CLEAN_UNCHECKED

        sentences = _split_sentences(response)
        if not sentences:
            return _CLEAN_UNCHECKED

        premise = context.strip()[:4000]  # bound the premise fed to the tokenizer
        try:
            unsupported = [s for s in sentences if not self._is_supported(premise, s)]
        except Exception as exc:  # never let the model take down the gate
            logger.warning("Hallucination NLI inference failed (%s) — passing unchecked", exc)
            return _CLEAN_UNCHECKED

        checked = len(sentences)
        risk = len(unsupported) / checked if checked else 0.0
        grounded = risk < self.block_threshold
        if not grounded:
            logger.warning(
                "Groundedness LOW — risk=%.2f (%d/%d sentences unsupported)",
                risk, len(unsupported), checked,
            )
        return GroundednessResult(
            grounded=grounded,
            risk=risk,
            checked=True,
            unsupported=unsupported,
            sentences_checked=checked,
            description=(
                f"{len(unsupported)}/{checked} response sentences not supported "
                f"by the provided context"
            ),
        )

    def _is_supported(self, premise: str, hypothesis: str) -> bool:
        # Pair input: the pipeline accepts {"text": premise, "text_pair": hypothesis}
        # and returns the NLI label distribution for that pair.
        raw = self._pipe({"text": premise, "text_pair": hypothesis})
        scores = raw[0] if raw and isinstance(raw[0], list) else raw
        entail = 0.0
        for item in scores:
            label = str(item.get("label", "")).lower()
            if label in ("entailment", "entail"):
                entail = float(item.get("score", 0.0))
                break
        return entail >= _ENTAIL_SUPPORT
