"""
Lightweight HTTP embedding service.

Runs as a daemon thread alongside the gRPC AnalyzerService on port 8001
(configurable via EMBED_PORT).  Exposes:

    POST /embed
    Body: {"text": "<prompt text>"}
    Returns: {"embedding": [float, ...], "dimensions": int}

Call embed.start() from server.py to activate.  If sentence-transformers
is not installed the call is a silent no-op and the /embed endpoint never
starts — the Go semantic cache will treat every lookup as a miss.
"""

import http.server
import json
import logging
import os
import threading

logger = logging.getLogger("embed_server")

EMBED_PORT = int(os.getenv("EMBED_PORT", "8001"))
MODEL_NAME = os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2")

_model = None


class _EmbedHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/embed":
            self.send_response(404)
            self.end_headers()
            return
        if _model is None:
            self._respond(503, {"error": "Embedding model not loaded"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            text = body.get("text", "")
            if not text:
                self._respond(400, {"error": "text field required"})
                return
            embedding = _model.encode([text])[0].tolist()
            self._respond(200, {"embedding": embedding, "dimensions": len(embedding)})
        except Exception as exc:
            logger.error("embed error: %s", exc)
            self._respond(500, {"error": str(exc)})

    def _respond(self, status: int, data: dict) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        pass  # suppress per-request access logs


def start() -> None:
    """Load the sentence-transformer model and start the embedding HTTP server.

    This is a no-op if sentence-transformers is not installed, so the rest
    of the analyzer service starts cleanly regardless.
    """
    global _model
    try:
        from sentence_transformers import SentenceTransformer  # noqa: PLC0415
        _model = SentenceTransformer(MODEL_NAME)
        dims = _model.get_sentence_embedding_dimension()
        logger.info("Embedding model loaded: %s (dims=%d)", MODEL_NAME, dims)
    except Exception as exc:
        logger.warning(
            "sentence-transformers unavailable (%s) — "
            "embedding server disabled; semantic cache will not function",
            exc,
        )
        return

    server = http.server.HTTPServer(("0.0.0.0", EMBED_PORT), _EmbedHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    logger.info("Embedding HTTP server listening on port %d", EMBED_PORT)
