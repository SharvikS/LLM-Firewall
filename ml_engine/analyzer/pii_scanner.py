"""
PII Scanner — wraps Microsoft Presidio to detect and anonymize personally
identifiable information in LLM prompt text before it reaches the upstream.

Entity coverage (Presidio built-in recognizers, pattern-based, no spaCy NER
required for high-confidence matches):
  CREDIT_CARD, CRYPTO, EMAIL_ADDRESS, IBAN_CODE, IP_ADDRESS, NRP,
  LOCATION, PERSON, PHONE_NUMBER, US_SSN, US_BANK_NUMBER, US_DRIVER_LICENSE,
  US_ITIN, US_PASSPORT, UK_NHS, SG_NRIC_FIN

spaCy's en_core_web_sm model is used for PERSON/LOCATION NER on top of those.
"""

import logging
from dataclasses import dataclass
from typing import Optional

from presidio_analyzer import AnalyzerEngine
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

logger = logging.getLogger("pii_scanner")

# Entities we treat as sensitive. Extend as compliance requirements grow.
SENSITIVE_ENTITIES = [
    "CREDIT_CARD",
    "EMAIL_ADDRESS",
    "IBAN_CODE",
    "IP_ADDRESS",
    "PERSON",
    "PHONE_NUMBER",
    "US_SSN",
    "US_BANK_NUMBER",
    "US_DRIVER_LICENSE",
    "US_ITIN",
    "US_PASSPORT",
]


@dataclass
class PIIResult:
    pii_detected: bool
    masked_text: str           # equals original if pii_detected is False
    entities_found: list[str]  # e.g. ["EMAIL_ADDRESS", "US_SSN"]


class PIIScanner:
    """
    Thin wrapper around Presidio AnalyzerEngine + AnonymizerEngine.
    The anonymizer replaces every detected entity with a type tag, e.g.:
      "My email is bob@example.com" → "My email is <EMAIL_ADDRESS>"
    This preserves prompt semantics while eliminating the raw PII value.
    """

    def __init__(self) -> None:
        nlp_cfg = {
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
        }
        provider = NlpEngineProvider(nlp_configuration=nlp_cfg)
        nlp_engine = provider.create_engine()

        self._analyzer = AnalyzerEngine(
            nlp_engine=nlp_engine,
            supported_languages=["en"],
        )
        self._anonymizer = AnonymizerEngine()

        # Replace each entity with its type tag rather than a generic "[REDACTED]"
        # so the LLM still understands the structure of the prompt.
        self._operators = {
            entity: OperatorConfig("replace", {"new_value": f"<{entity}>"})
            for entity in SENSITIVE_ENTITIES
        }
        logger.info("PIIScanner initialised with %d entity types", len(SENSITIVE_ENTITIES))

    def scan(self, text: str, entities: Optional[list[str]] = None) -> PIIResult:
        if not text or not text.strip():
            return PIIResult(pii_detected=False, masked_text=text, entities_found=[])

        # Restrict to the operator-enabled allowlist (Data Privacy tab) when one
        # is supplied; otherwise scan for every supported entity. An empty
        # allowlist means every recognizer was disabled → nothing to scan.
        if entities is None:
            scan_entities = SENSITIVE_ENTITIES
        else:
            scan_entities = [e for e in SENSITIVE_ENTITIES if e in entities]
        if not scan_entities:
            return PIIResult(pii_detected=False, masked_text=text, entities_found=[])

        results = self._analyzer.analyze(
            text=text,
            entities=scan_entities,
            language="en",
            score_threshold=0.6,  # only flag high-confidence detections
        )

        if not results:
            return PIIResult(pii_detected=False, masked_text=text, entities_found=[])

        masked = self._anonymizer.anonymize(
            text=text,
            analyzer_results=results,
            operators=self._operators,
        )

        entity_types = sorted({r.entity_type for r in results})
        logger.warning(
            "PII detected — entities=%s request_length=%d",
            entity_types, len(text),
        )
        return PIIResult(
            pii_detected=True,
            masked_text=masked.text,
            entities_found=entity_types,
        )
