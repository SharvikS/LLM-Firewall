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
from analyzer.pii_scanner import PIIScanner

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

        # --- PII scanning ---
        pii = self._pii.scan(prompt_text)
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

            # Rebuild the full JSON body with the masked prompt so the gateway
            # can forward it in place of the original without breaking structure.
            masked_body = _rebuild_body(request.prompt, pii.masked_text)

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


def _rebuild_body(original_body: str, masked_text: str) -> str:
    """
    Replace the concatenated message content in the original JSON body with
    the Presidio-masked version.  Falls back to the masked_text string if the
    body is not parseable JSON.
    """
    try:
        body = json.loads(original_body)
        messages = body.get("messages", [])
        if not messages:
            return masked_text

        # Simple strategy: put the entire masked text into the last user message.
        # A more sophisticated approach would diff each message individually.
        for msg in reversed(messages):
            if msg.get("role") == "user":
                msg["content"] = masked_text
                break
        return json.dumps(body)
    except (json.JSONDecodeError, TypeError):
        return masked_text


def serve() -> None:
    port = os.getenv("GRPC_PORT", "50051")
    workers = int(os.getenv("GRPC_WORKERS", "4"))

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=workers))
    analyzer_pb2_grpc.add_AnalyzerServiceServicer_to_server(
        AnalyzerServicer(), server
    )
    server.add_insecure_port(f"[::]:{port}")
    server.start()
    logger.info("gRPC AnalyzerService listening on port %s", port)

    def _shutdown(sig, _frame):
        logger.info("Shutting down gRPC server (signal %s)…", sig)
        server.stop(grace=5)
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
