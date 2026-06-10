"""
Secret & Source-Code Leak Scanner.

Two responsibilities, both aimed at stopping proprietary material from leaving
the perimeter inside an LLM prompt:

  1. Credential detection (always masked):
     Hardcoded secrets — cloud keys, provider API keys, private keys, tokens,
     DB connection strings. Each match is replaced in-place with a `<SECRET:…>`
     tag, exactly like the PII scanner replaces entities. The prompt keeps its
     shape so the model still understands the request, minus the live secret.

  2. Source-code leak signal (flag, optionally block):
     A heuristic that estimates how much of the prompt is source code (fenced
     blocks, language keywords, file-path/copyright headers). Large pastes of
     internal code are a common, silent exfiltration path. By default this only
     raises a flag + risk; set CODE_LEAK_BLOCK=true to BLOCK instead.

Design mirrors `pii_scanner.PIIResult` so the gRPC server can compose secret
masking into the same per-message pass it already runs for PII.
"""

import logging
import math
import os
import re
from dataclasses import dataclass, field

logger = logging.getLogger("secret_scanner")

_CODE_LEAK_BLOCK = os.getenv("CODE_LEAK_BLOCK", "false").lower() in ("true", "1")
# Minimum number of code-signal lines before a prompt is treated as a code leak.
_CODE_LEAK_MIN_LINES = int(os.getenv("CODE_LEAK_MIN_LINES", "8"))


# ---------------------------------------------------------------------------
# Credential signatures — (label, pattern). Order matters: more specific
# provider patterns come before the generic assignment catch-all so a GitHub
# token is tagged GITHUB_TOKEN, not GENERIC_SECRET.
# ---------------------------------------------------------------------------

_SECRET_SIGNATURES: list[tuple[str, re.Pattern]] = [
    ("PRIVATE_KEY", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----")),
    ("AWS_ACCESS_KEY", re.compile(r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[A-Z0-9]{16}\b")),
    ("AWS_SECRET_KEY", re.compile(r"(?i)aws_secret_access_key\s*[=:]\s*[\"']?([A-Za-z0-9/+=]{40})[\"']?")),
    ("GITHUB_TOKEN", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b")),
    ("GITLAB_TOKEN", re.compile(r"\bglpat-[A-Za-z0-9_-]{20}\b")),
    ("SLACK_TOKEN", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("GOOGLE_API_KEY", re.compile(r"\bAIza[A-Za-z0-9_-]{35}\b")),
    ("STRIPE_KEY", re.compile(r"\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b")),
    ("ANTHROPIC_KEY", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b")),
    ("OPENAI_KEY", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
    ("DB_CONNECTION_STRING", re.compile(r"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)://[^\s:@/]+:[^\s:@/]+@[^\s/]+")),
    ("PRIVATE_KEY_ASSIGNMENT", re.compile(r"(?i)\b(?:secret|passwd|password|api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[=:]\s*[\"']([^\"'\s]{8,})[\"']")),
]

# Source-code signal heuristics — lines matching these suggest real code.
_CODE_SIGNALS: list[re.Pattern] = [
    re.compile(r"^\s*(?:def|class|func|public|private|protected|static|import|from|package|#include|using|module|fn|impl)\b"),
    re.compile(r"^\s*(?:if|for|while|switch|return|try|catch|except|elif|else)\b.*[:{(]"),
    re.compile(r"[;{}]\s*$"),
    re.compile(r"^\s*(?://|#|/\*|\*).*"),                      # comments
    re.compile(r"=>|::|->|<\w+>|\)\s*\{"),                      # operators / generics
    re.compile(r"(?i)\b(?:copyright|proprietary|confidential|all rights reserved)\b"),
]

_CODE_FENCE = re.compile(r"```")


@dataclass
class SecretResult:
    secrets_detected: bool
    masked_text: str                          # equals original when nothing fired
    entities_found: list[str] = field(default_factory=list)  # e.g. ["AWS_ACCESS_KEY"]
    code_leak: bool = False                   # large source-code paste detected
    code_confidence: float = 0.0              # 0.0-1.0


class SecretScanner:
    """Regex credential masking + heuristic source-code-leak detection."""

    def __init__(self) -> None:
        self.code_leak_block = _CODE_LEAK_BLOCK
        logger.info(
            "SecretScanner initialised — %d credential signatures, code_leak_block=%s",
            len(_SECRET_SIGNATURES), self.code_leak_block,
        )

    def scan(self, text: str) -> SecretResult:
        if not text or not text.strip():
            return SecretResult(secrets_detected=False, masked_text=text)

        masked = text
        found: list[str] = []
        for label, pattern in _SECRET_SIGNATURES:
            if pattern.search(masked):
                masked = pattern.sub(f"<SECRET:{label}>", masked)
                found.append(label)

        code_leak, code_conf = self._detect_code_leak(text)

        if found:
            logger.warning("Secrets masked — entities=%s", sorted(set(found)))
        if code_leak:
            logger.warning("Source-code leak signal — confidence=%.2f", code_conf)

        return SecretResult(
            secrets_detected=bool(found),
            masked_text=masked,
            entities_found=sorted(set(found)),
            code_leak=code_leak,
            code_confidence=code_conf,
        )

    def _detect_code_leak(self, text: str) -> tuple[bool, float]:
        """
        Estimate whether the prompt contains a substantial source-code paste.

        Strong signal: fenced code blocks. Otherwise, count lines that match any
        code signal and require an absolute floor (_CODE_LEAK_MIN_LINES) AND a
        density floor (>35% of non-blank lines) so a prose prompt that happens to
        mention `return` once doesn't trip it.
        """
        lines = [ln for ln in text.splitlines() if ln.strip()]
        if len(lines) < _CODE_LEAK_MIN_LINES:
            # Still allow a clearly fenced block of any size to register.
            if len(_CODE_FENCE.findall(text)) >= 2 and len(lines) >= 4:
                return True, 0.7
            return False, 0.0

        signal_lines = sum(
            1 for ln in lines if any(p.search(ln) for p in _CODE_SIGNALS)
        )
        density = signal_lines / len(lines)
        fenced = len(_CODE_FENCE.findall(text)) >= 2

        if fenced and signal_lines >= 3:
            return True, min(1.0, 0.6 + density * 0.4)
        # len(lines) >= _CODE_LEAK_MIN_LINES is already guaranteed above; require a
        # code-line density floor plus a small absolute floor of signal lines.
        if density >= 0.35 and signal_lines >= 4:
            # Confidence scales with density, amplified by a log of size.
            conf = min(1.0, density * (1.0 + math.log10(max(10, len(lines)) / 10.0)))
            return True, round(conf, 2)
        return False, 0.0
