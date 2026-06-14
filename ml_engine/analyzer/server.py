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
from dataclasses import dataclass

import grpc

# Adjust sys.path so generated stubs resolve correctly when run as __main__
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from analyzer.v1 import analyzer_pb2, analyzer_pb2_grpc
from analyzer.injection_detector import InjectionDetector
from analyzer.pii_scanner import PIIScanner, PIIResult
from analyzer.toxicity_detector import ToxicityDetector
from analyzer.secret_scanner import SecretScanner
from analyzer import embed
from analyzer import runtime_config
from analyzer import telemetry

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
        self._toxicity = ToxicityDetector()
        self._secrets = SecretScanner()
        logger.info("AnalyzerService ready")

    def AnalyzePrompt(
        self,
        request: analyzer_pb2.PromptRequest,
        context: grpc.ServicerContext,
    ) -> analyzer_pb2.AnalysisResult:
        prompt_text = _extract_prompt(request.prompt)
        threats = []

        # Live governance config pushed from the dashboard control plane.
        rc = runtime_config.get()

        # --- Injection / Jailbreak detection ---
        with telemetry.span("InjectionDetector.detect"):
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

        # --- Toxicity / sentiment detection (BLOCK gate) ---
        # Enablement and block threshold are dashboard-tunable at runtime.
        if rc["toxicity_enabled"]:
            with telemetry.span("ToxicityDetector.detect"):
                tox = self._toxicity.detect(prompt_text)
        else:
            tox = self._toxicity.detect("")  # returns the clean sentinel
        tox_block = (
            rc["toxicity_enabled"]
            and tox.is_toxic
            and tox.score >= rc["toxicity_block_threshold"]
        )
        if tox_block:
            threats.append(
                analyzer_pb2.ThreatDetail(
                    type="Toxicity",
                    confidence=tox.score,
                    description=tox.description,
                )
            )
            logger.warning(
                "BLOCK request_id=%s tenant=%s toxicity=%s score=%.2f",
                request.request_id, request.tenant_id, tox.category, tox.score,
            )
            return analyzer_pb2.AnalysisResult(
                request_id=request.request_id,
                action=_ACTION_BLOCK,
                risk_score=max(inj.risk_score, tox.score * 100.0),
                pii_detected=False,
                masked_prompt="",
                threats=threats,
                reason=f"Toxic content blocked: {tox.description}",
            )

        # --- Combined masking pass — PII + secrets in a single per-message rewrite,
        #     plus a source-code-leak signal over the whole body. ---
        # PII redaction and the per-entity allowlist are dashboard-tunable; when
        # redaction is off we pass an empty allowlist so no PII is masked
        # (secrets are always masked — they are not user-configurable).
        pii_allow = runtime_config.enabled_pii_entities() if rc["pii_redaction_enabled"] else []
        with telemetry.span("PIIScanner.scan_and_mask"):
            scan = _scan_and_mask_body(request.prompt, self._pii, self._secrets, pii_allow)

        # Base risk: injection confidence, raised by any sub-threshold toxicity.
        risk = inj.risk_score
        if rc["toxicity_enabled"] and tox.is_toxic:
            risk = max(risk, tox.score * 100.0)
            threats.append(
                analyzer_pb2.ThreatDetail(
                    type="Toxicity",
                    confidence=tox.score,
                    description=tox.description,
                )
            )

        # Source-code leak: flag + risk by default; BLOCK only when CODE_LEAK_BLOCK=true.
        if scan.code_leak:
            risk = max(risk, scan.code_confidence * 100.0)
            threats.append(
                analyzer_pb2.ThreatDetail(
                    type="SourceCodeLeak",
                    confidence=scan.code_confidence,
                    description=f"Source-code paste detected (confidence {scan.code_confidence:.0%})",
                )
            )
            if rc["code_leak_block"]:
                logger.warning(
                    "BLOCK request_id=%s tenant=%s source_code_leak confidence=%.2f",
                    request.request_id, request.tenant_id, scan.code_confidence,
                )
                return analyzer_pb2.AnalysisResult(
                    request_id=request.request_id,
                    action=_ACTION_BLOCK,
                    risk_score=risk,
                    pii_detected=False,
                    masked_prompt="",
                    threats=threats,
                    reason="Source-code leak blocked",
                )

        if scan.pii_entities:
            risk = max(risk, 35.0)  # PII presence raises floor to 35
            threats.append(
                analyzer_pb2.ThreatDetail(
                    type="PII",
                    confidence=0.9,
                    description=f"PII entities detected: {', '.join(scan.pii_entities)}",
                )
            )
        if scan.secret_entities:
            risk = max(risk, 60.0)  # leaked credentials are higher risk than PII
            threats.append(
                analyzer_pb2.ThreatDetail(
                    type="SecretLeak",
                    confidence=0.95,
                    description=f"Secrets/credentials detected: {', '.join(scan.secret_entities)}",
                )
            )

        if scan.pii_entities or scan.secret_entities:
            reason_parts = []
            if scan.pii_entities:
                reason_parts.append(f"PII masked: {', '.join(scan.pii_entities)}")
            if scan.secret_entities:
                reason_parts.append(f"secrets masked: {', '.join(scan.secret_entities)}")
            logger.info(
                "MASK request_id=%s tenant=%s pii=%s secrets=%s",
                request.request_id, request.tenant_id,
                scan.pii_entities, scan.secret_entities,
            )
            return analyzer_pb2.AnalysisResult(
                request_id=request.request_id,
                action=_ACTION_MASK,
                risk_score=risk,
                pii_detected=bool(scan.pii_entities),
                masked_prompt=scan.masked_body,
                threats=threats,
                reason="; ".join(reason_parts),
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


@dataclass
class BodyScan:
    """Aggregate result of one combined PII + secret + code-leak pass."""
    masked_body: str
    pii_entities: list[str]
    secret_entities: list[str]
    code_leak: bool
    code_confidence: float


def _scan_one(text: str, pii_scanner: PIIScanner, secret_scanner: SecretScanner,
              pii_entities=None):
    """
    Run PII then secret masking over a single string. Secrets are masked on the
    PII-masked text so both rewrites compose into one output. Returns
    (masked_text, pii_entities, secret_entities). pii_entities restricts which
    recognizers run (None = all supported).
    """
    pii = pii_scanner.scan(text, pii_entities)
    masked = pii.masked_text if pii.pii_detected else text
    sec = secret_scanner.scan(masked)
    masked = sec.masked_text if sec.secrets_detected else masked
    return (
        masked,
        pii.entities_found if pii.pii_detected else [],
        sec.entities_found if sec.secrets_detected else [],
    )


def _scan_and_mask_body(
    raw_body: str,
    pii_scanner: PIIScanner,
    secret_scanner: SecretScanner,
    pii_entities=None,
) -> BodyScan:
    """
    Scan every message in the JSON body individually for PII *and* secrets and
    replace each message's content in-place, then run the source-code-leak
    heuristic over the concatenated text.

    Scanning per-message rather than on the concatenated text preserves
    conversation structure: masking only touches the messages that actually
    contain sensitive data and never corrupts earlier turns.
    """
    code_leak, code_conf = False, 0.0

    try:
        body = json.loads(raw_body)
        messages = body.get("messages", []) if isinstance(body, dict) else []
    except (json.JSONDecodeError, TypeError):
        body, messages = None, []

    if not messages:
        # Non-JSON or message-less body — scan the whole string.
        masked, pii_ents, sec_ents = _scan_one(raw_body, pii_scanner, secret_scanner, pii_entities)
        leak = secret_scanner.scan(raw_body)
        return BodyScan(
            masked_body=masked if (pii_ents or sec_ents) else raw_body,
            pii_entities=pii_ents,
            secret_entities=sec_ents,
            code_leak=leak.code_leak,
            code_confidence=leak.code_confidence,
        )

    all_pii: list[str] = []
    all_secrets: list[str] = []
    text_parts: list[str] = []

    for msg in messages:
        content = msg.get("content")
        if not isinstance(content, str):
            continue
        text_parts.append(content)
        masked, pii_ents, sec_ents = _scan_one(content, pii_scanner, secret_scanner, pii_entities)
        if pii_ents or sec_ents:
            msg["content"] = masked
            all_pii.extend(pii_ents)
            all_secrets.extend(sec_ents)

    # Source-code-leak heuristic runs once over the full conversation text.
    leak = secret_scanner.scan("\n".join(text_parts))
    code_leak, code_conf = leak.code_leak, leak.code_confidence

    masked_body = json.dumps(body) if (all_pii or all_secrets) else raw_body
    return BodyScan(
        masked_body=masked_body,
        pii_entities=sorted(set(all_pii)),
        secret_entities=sorted(set(all_secrets)),
        code_leak=code_leak,
        code_confidence=code_conf,
    )


def serve() -> None:
    # Start the HTTP side-channel (/embed + /config control plane) alongside gRPC.
    embed.start()

    # Tracing is opt-in: no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
    telemetry.init()

    port = os.getenv("GRPC_PORT", "50051")
    workers = int(os.getenv("GRPC_WORKERS", "4"))
    tls_enabled = os.getenv("GRPC_TLS_ENABLED", "false").lower() in ("true", "1")

    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=workers),
        interceptors=telemetry.server_interceptors(),
    )
    analyzer_pb2_grpc.add_AnalyzerServiceServicer_to_server(
        AnalyzerServicer(), server
    )

    if tls_enabled:
        cert_file = os.getenv("GRPC_TLS_CERT", "/etc/certs/tls.crt")
        key_file  = os.getenv("GRPC_TLS_KEY",  "/etc/certs/tls.key")
        # When a client CA is provided, require and verify client certificates
        # (mutual TLS) so only the gateway can call the analyzer.
        client_ca = os.getenv("GRPC_TLS_CLIENT_CA", "")
        try:
            with open(cert_file, "rb") as f:
                cert_chain = f.read()
            with open(key_file, "rb") as f:
                private_key = f.read()
            if client_ca:
                with open(client_ca, "rb") as f:
                    ca = f.read()
                server_creds = grpc.ssl_server_credentials(
                    [(private_key, cert_chain)],
                    root_certificates=ca,
                    require_client_auth=True,
                )
            else:
                server_creds = grpc.ssl_server_credentials([(private_key, cert_chain)])
            server.add_secure_port(f"[::]:{port}", server_creds)
            logger.info(
                "gRPC AnalyzerService TLS enabled on port %s (cert=%s, mutual=%s)",
                port, cert_file, bool(client_ca),
            )
        except Exception as exc:
            logger.critical(
                "Failed to load TLS credentials (%s) — refusing to start on plaintext. "
                "Fix GRPC_TLS_CERT / GRPC_TLS_KEY / GRPC_TLS_CLIENT_CA before retrying.", exc
            )
            sys.exit(1)
    else:
        server.add_insecure_port(f"[::]:{port}")
        logger.warning(
            "gRPC AnalyzerService listening on plaintext port %s — "
            "set GRPC_TLS_ENABLED=true to encrypt the channel", port
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
