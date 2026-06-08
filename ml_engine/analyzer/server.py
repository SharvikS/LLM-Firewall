"""
gRPC server — AnalyzerService implementation.

Start with:
  python -m analyzer.server          (default port 50051)
  GRPC_PORT=50052 python -m analyzer.server
"""

import json
import logging
import os
import signal
import sys
from concurrent import futures

import grpc

# Adjust sys.path so generated stubs resolve correctly when run as __main__
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from analyzer.v1 import analyzer_pb2, analyzer_pb2_grpc
from analyzer.injection_detector import InjectionDetector
from analyzer.pii_scanner import PIIScanner, PIIResult
from analyzer import embed

logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("grpc_server")

_ACTION_ALLOW = analyzer_pb2.Action.Value("ALLOW")
_ACTION_BLOCK = analyzer_pb2.Action.Value("BLOCK")
_ACTION_MASK  = analyzer_pb2.Action.Value("MASK")


def _extract_prompt(raw_prompt: str) -> str:
    """
    The Go gateway sends the full serialized JSON request body as the prompt
    field.  Extract the human-readable text from the 'messages' array so our
    classifiers operate on plain text, not JSON.
    Falls back to the raw string if parsing fails.
    """
    try:
        body = json.loads(raw_prompt)
        messages = body.get("messages", [])
        parts = [m.get("content", "") for m in messages if isinstance(m.get("content"), str)]
        return "\n".join(parts) if parts else raw_prompt
    except (json.JSONDecodeError, TypeError):
        return raw_prompt


class AnalyzerServicer(analyzer_pb2_grpc.AnalyzerServiceServicer):
    def __init__(self) -> None:
        logger.info("Initialising analyzers…")
        self._pii = PIIScanner()
        self._injection = InjectionDetector()
        logger.info("AnalyzerService ready")

    def AnalyzePrompt(
        self,
        request: analyzer_pb2.PromptRequest,
        context: grpc.ServicerContext,
    ) -> analyzer_pb2.AnalysisResult:
        prompt_text = _extract_prompt(request.prompt)
        threats = []

        # --- Injection / Jailbreak detection ---
        inj = self._injection.detect(prompt_text)
        if inj.is_injection:
            threats.append(
                analyzer_pb2.ThreatDetail(
                    type=inj.threat_type,
                    confidence=inj.confidence,
                    description=inj.description,
                )
            )
            logger.warning(
                "BLOCK request_id=%s tenant=%s threat=%s risk=%.1f",
                request.request_id, request.tenant_id,
                inj.threat_type, inj.risk_score,
            )
            return analyzer_pb2.AnalysisResult(
                request_id=request.request_id,
                action=_ACTION_BLOCK,
                risk_score=inj.risk_score,
                pii_detected=False,
                masked_prompt="",
                threats=threats,
                reason=inj.description,
            )

        # --- PII scanning — each message scanned individually to preserve context ---
        pii, masked_body = _scan_and_mask_body(request.prompt, self._pii)
        risk = inj.risk_score  # base risk from injection confidence

        if pii.pii_detected:
            risk = max(risk, 35.0)  # PII presence raises floor to 35
            threats.append(
                analyzer_pb2.ThreatDetail(
                    type="PII",
                    confidence=0.9,
                    description=f"PII entities detected: {', '.join(pii.entities_found)}",
                )
            )

            logger.info(
                "MASK request_id=%s tenant=%s entities=%s",
                request.request_id, request.tenant_id, pii.entities_found,
            )
            return analyzer_pb2.AnalysisResult(
                request_id=request.request_id,
                action=_ACTION_MASK,
                risk_score=risk,
                pii_detected=True,
                masked_prompt=masked_body,
                threats=threats,
                reason=f"PII masked: {', '.join(pii.entities_found)}",
            )

        logger.info(
            "ALLOW request_id=%s tenant=%s risk=%.1f",
            request.request_id, request.tenant_id, risk,
        )
        return analyzer_pb2.AnalysisResult(
            request_id=request.request_id,
            action=_ACTION_ALLOW,
            risk_score=risk,
            pii_detected=False,
            masked_prompt="",
            threats=threats,
            reason="Request is clean",
        )


def _scan_and_mask_body(raw_body: str, pii_scanner: PIIScanner) -> tuple[PIIResult, str]:
    """
    Scan every message in the JSON body individually for PII and replace
    each message's content in-place.  Returns (aggregate PIIResult, masked body).

    Scanning per-message rather than on the concatenated text preserves
    conversation structure: masking only touches the messages that actually
    contain PII and never corrupts earlier turns.
    """
    try:
        body = json.loads(raw_body)
    except (json.JSONDecodeError, TypeError):
        result = pii_scanner.scan(raw_body)
        masked = result.masked_text if result.pii_detected else raw_body
        return result, masked

    messages = body.get("messages", [])
    if not messages:
        result = pii_scanner.scan(raw_body)
        masked = result.masked_text if result.pii_detected else raw_body
        return result, masked

    all_entities: list[str] = []
    any_pii = False

    for msg in messages:
        content = msg.get("content")
        if not isinstance(content, str):
            continue
        result = pii_scanner.scan(content)
        if result.pii_detected:
            msg["content"] = result.masked_text
            all_entities.extend(result.entities_found)
            any_pii = True

    if any_pii:
        masked_body = json.dumps(body)
        aggregate = PIIResult(
            pii_detected=True,
            masked_text=masked_body,
            entities_found=sorted(set(all_entities)),
        )
        return aggregate, masked_body

    return PIIResult(pii_detected=False, masked_text=raw_body, entities_found=[]), raw_body


def serve() -> None:
    # Start embedding HTTP server alongside gRPC (no-op if sentence-transformers absent)
    embed.start()

    port = os.getenv("GRPC_PORT", "50051")
    workers = int(os.getenv("GRPC_WORKERS", "4"))
    tls_enabled = os.getenv("GRPC_TLS_ENABLED", "false").lower() in ("true", "1")

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=workers))
    analyzer_pb2_grpc.add_AnalyzerServiceServicer_to_server(
        AnalyzerServicer(), server
    )

    if tls_enabled:
        cert_file = os.getenv("GRPC_TLS_CERT", "/etc/certs/tls.crt")
        key_file  = os.getenv("GRPC_TLS_KEY",  "/etc/certs/tls.key")
        try:
            with open(cert_file, "rb") as f:
                cert_chain = f.read()
            with open(key_file, "rb") as f:
                private_key = f.read()
            server_creds = grpc.ssl_server_credentials([(private_key, cert_chain)])
            server.add_secure_port(f"[::]:{port}", server_creds)
            logger.info("gRPC AnalyzerService TLS enabled on port %s (cert=%s)", port, cert_file)
        except Exception as exc:
            logger.critical(
                "Failed to load TLS credentials (%s) — refusing to start on plaintext. "
                "Fix GRPC_TLS_CERT / GRPC_TLS_KEY before retrying.", exc
            )
            sys.exit(1)
    else:
        server.add_insecure_port(f"[::]:{port}")
        logger.warning(
            "gRPC AnalyzerService listening on plaintext port %s — "
            "set GRPC_TLS_ENABLED=true to enable mTLS", port
        )

    server.start()
    logger.info("gRPC AnalyzerService started on port %s (tls=%s)", port, tls_enabled)

    def _shutdown(sig, _frame):
        logger.info("Shutting down gRPC server (signal %s)…", sig)
        server.stop(grace=5)
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
