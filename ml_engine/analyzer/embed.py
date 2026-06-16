"""
Lightweight HTTP side-channel for the ML engine.

Runs as a daemon thread alongside the gRPC AnalyzerService on port 8001
(configurable via EMBED_PORT). Exposes:

    POST /embed     — {"text": "..."} → {"embedding": [...], "dimensions": int}
    GET  /config    — current runtime governance config (toxicity/PII/code-leak)
    POST /config    — merge a config patch pushed by the gateway control plane
    POST /scan      — {"text": "..."} → DLP verdict {decision, risk, reason,
                      categories, pii, secrets, masked_text}. Used by the browser
                      DLP extension to scan prompts typed into chat web UIs.
    POST /report    — browser-DLP event {site, decision, action, risk, ...}
                      relayed to the gateway so endpoint-side blocks/redactions
                      land in the unified live feed / audit log / SOC alerts.

The server always starts (the /config plane must be reachable even when
sentence-transformers is unavailable). If the embedding model can't be loaded,
/embed answers 503 and the Go semantic cache simply treats every lookup as a
miss — the rest of the engine is unaffected.

CORS is permissive (Access-Control-Allow-Origin: *) so the browser extension
content/background scripts can reach /scan. The endpoint returns only verdicts
and masked text — never the configured secrets or upstream keys.
"""

import http.server
import json
import logging
import os
import threading
import urllib.request

from analyzer import runtime_config

logger = logging.getLogger("embed_server")

EMBED_PORT = int(os.getenv("EMBED_PORT", "8001"))
MODEL_NAME = os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2")

# Where browser-DLP events are relayed so they land in the gateway's unified
# live feed / audit log / SOC alerting. The engine is the single backend the
# browser extension talks to; this server-to-server hop keeps the extension's
# contract to one endpoint and avoids cross-origin from the chat pages.
GATEWAY_EVENT_URL = os.getenv("GATEWAY_EVENT_URL", "http://localhost:8080/internal/dlp-event")
BROWSER_EVENT_TOKEN = os.getenv("BROWSER_EVENT_TOKEN", "")

_model = None
_scan_fn = None  # set by start(); maps raw text → DLP verdict dict


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        # CORS preflight for the browser extension.
        self.send_response(204)
        self._cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path == "/config":
            self._respond(200, runtime_config.get())
            return
        if self.path in ("/health", "/healthz"):
            self._respond(200, {"status": "ok", "model_loaded": _model is not None,
                                "scan_enabled": _scan_fn is not None})
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/config":
            self._handle_config()
            return
        if self.path == "/embed":
            self._handle_embed()
            return
        if self.path == "/scan":
            self._handle_scan()
            return
        if self.path == "/report":
            self._handle_report()
            return
        self._respond(404, {"error": "not found"})

    def _handle_scan(self):
        if _scan_fn is None:
            self._respond(503, {"error": "scanner not available"})
            return
        try:
            body = self._read_json()
            text = body.get("text", "")
            if not isinstance(text, str):
                self._respond(400, {"error": "text field must be a string"})
                return
            if not text.strip():
                self._respond(200, {"decision": "allow", "risk": 0.0, "reason": "empty",
                                    "categories": [], "pii": [], "secrets": [], "masked_text": text})
                return
            self._respond(200, _scan_fn(text))
        except Exception as exc:
            logger.error("scan error: %s", exc)
            self._respond(500, {"error": str(exc)})

    def _handle_report(self):
        """Relay a browser-DLP event from the extension to the gateway's event
        plane. Best-effort and fail-open: we ack the extension immediately and
        forward in the background, so a slow/absent gateway never blocks the
        user's next keystroke. The payload carries verdict metadata only — never
        prompt text, PII values, or secrets."""
        try:
            event = self._read_json()
        except Exception as exc:
            self._respond(400, {"error": str(exc)})
            return
        # Stamp the browser's source IP as observed on THIS connection. The
        # extension can't know its own IP and the page can't be trusted to
        # report it, so the engine — the first server hop — is the authoritative
        # source. X-Forwarded-For (if the engine itself sits behind a proxy)
        # takes precedence over the raw socket peer.
        if isinstance(event, dict):
            xff = self.headers.get("X-Forwarded-For", "")
            client_ip = xff.split(",")[0].strip() if xff else self.client_address[0]
            event["client_ip"] = client_ip
        # Ack first; forward off the request thread.
        self._respond(202, {"accepted": True})
        threading.Thread(target=_relay_event, args=(event,), daemon=True).start()

    def _handle_config(self):
        try:
            patch = self._read_json()
            updated = runtime_config.update(patch)
            self._respond(200, updated)
        except Exception as exc:
            logger.error("config update error: %s", exc)
            self._respond(400, {"error": str(exc)})

    def _handle_embed(self):
        if _model is None:
            self._respond(503, {"error": "Embedding model not loaded"})
            return
        try:
            body = self._read_json()
            text = body.get("text", "")
            if not text:
                self._respond(400, {"error": "text field required"})
                return
            embedding = _model.encode([text])[0].tolist()
            self._respond(200, {"embedding": embedding, "dimensions": len(embedding)})
        except Exception as exc:
            logger.error("embed error: %s", exc)
            self._respond(500, {"error": str(exc)})

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length))

    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _respond(self, status: int, data: dict) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        pass  # suppress per-request access logs


def _relay_event(event: dict) -> None:
    """POST a browser-DLP event to the gateway. Swallows every error: the
    gateway being down must not surface to the extension or log-spam."""
    if not isinstance(event, dict):
        return
    try:
        data = json.dumps(event).encode()
        req = urllib.request.Request(
            GATEWAY_EVENT_URL, data=data, method="POST",
            headers={"Content-Type": "application/json"},
        )
        if BROWSER_EVENT_TOKEN:
            req.add_header("X-Titan-DLP-Token", BROWSER_EVENT_TOKEN)
        # Forward the observed browser IP so the gateway records the user's IP,
        # not the engine's. The gateway prefers the in-body client_ip, but XFF
        # is a belt-and-suspenders fallback.
        client_ip = event.get("client_ip")
        if client_ip:
            req.add_header("X-Forwarded-For", client_ip)
        with urllib.request.urlopen(req, timeout=2) as resp:  # noqa: S310 (trusted internal URL)
            resp.read()
    except Exception as exc:
        logger.debug("browser-DLP event relay failed (gateway unreachable?): %s", exc)


def _load_model() -> None:
    """Load the sentence-transformer model in the background (best-effort)."""
    global _model
    try:
        from sentence_transformers import SentenceTransformer  # noqa: PLC0415
        _model = SentenceTransformer(MODEL_NAME)
        dims = _model.get_sentence_embedding_dimension()
        logger.info("Embedding model loaded: %s (dims=%d)", MODEL_NAME, dims)
    except Exception as exc:
        logger.warning(
            "sentence-transformers unavailable (%s) — /embed disabled; "
            "semantic cache will not function (config plane still active)",
            exc,
        )


def start(scan_fn=None) -> None:
    """Start the HTTP side-channel and load the embedding model.

    The HTTP server always starts so the /config control plane is reachable;
    the model load is independent and may fail without affecting /config.

    scan_fn, when supplied, is a callable text -> verdict dict that backs the
    /scan endpoint (the browser DLP extension). When None, /scan answers 503.
    """
    global _scan_fn
    _scan_fn = scan_fn
    _load_model()
    server = http.server.ThreadingHTTPServer(("0.0.0.0", EMBED_PORT), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    routes = "/embed, /config" + (", /scan, /report" if scan_fn is not None else "")
    logger.info("ML HTTP side-channel listening on port %d (%s)", EMBED_PORT, routes)
