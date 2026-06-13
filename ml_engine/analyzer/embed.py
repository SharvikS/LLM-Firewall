"""
Lightweight HTTP side-channel for the ML engine.

Runs as a daemon thread alongside the gRPC AnalyzerService on port 8001
(configurable via EMBED_PORT). Exposes:

    POST /embed     — {"text": "..."} → {"embedding": [...], "dimensions": int}
    GET  /config    — current runtime governance config (toxicity/PII/code-leak)
    POST /config    — merge a config patch pushed by the gateway control plane

The server always starts (the /config plane must be reachable even when
sentence-transformers is unavailable). If the embedding model can't be loaded,
/embed answers 503 and the Go semantic cache simply treats every lookup as a
miss — the rest of the engine is unaffected.
"""

import http.server
import json
import logging
import os
import threading

from analyzer import runtime_config

logger = logging.getLogger("embed_server")

EMBED_PORT = int(os.getenv("EMBED_PORT", "8001"))
MODEL_NAME = os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2")

_model = None


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/config":
            self._respond(200, runtime_config.get())
            return
        if self.path in ("/health", "/healthz"):
            self._respond(200, {"status": "ok", "model_loaded": _model is not None})
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/config":
            self._handle_config()
            return
        if self.path == "/embed":
            self._handle_embed()
            return
        self._respond(404, {"error": "not found"})

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

    def _respond(self, status: int, data: dict) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        pass  # suppress per-request access logs


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


def start() -> None:
    """Start the HTTP side-channel and load the embedding model.

    The HTTP server always starts so the /config control plane is reachable;
    the model load is independent and may fail without affecting /config.
    """
    _load_model()
    server = http.server.ThreadingHTTPServer(("0.0.0.0", EMBED_PORT), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    logger.info("ML HTTP side-channel listening on port %d (/embed, /config)", EMBED_PORT)
