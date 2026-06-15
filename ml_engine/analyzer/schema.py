"""
Provider-agnostic request-body traversal.

The gateway can front three cloud LLM wire formats, each of which puts the
human-readable prompt text in a different place:

    OpenAI / ChatGPT   messages[].content        (str, or [{type,text}] blocks)
    Anthropic / Claude system + messages[].content (str, or [{type,text}] blocks)
    Google / Gemini    contents[].parts[].text and systemInstruction.parts[].text

`collect_text_nodes` returns references to every editable text string across all
three schemas so the analyzer can (a) concatenate them for classification and
(b) mask PII/secrets *in place* without corrupting conversation structure. Each
node is a (container, key) pair whose value is a string; assigning
`container[key] = masked` rewrites it. This is what lets PII redaction work on
Claude and Gemini traffic, not just OpenAI — extracting the wrong shape would
silently leave their prompts uninspected.
"""

from __future__ import annotations

from typing import Any


# A text node is a (container, key) pair where container[key] is a str.
TextNode = tuple[Any, Any]


def _add_content(container: dict, key: str, nodes: list[TextNode]) -> None:
    """Record container[key], which is either a plain string or a list of typed
    content blocks each carrying a 'text' field (OpenAI/Anthropic shape)."""
    val = container.get(key)
    if isinstance(val, str):
        nodes.append((container, key))
    elif isinstance(val, list):
        for blk in val:
            if isinstance(blk, dict) and isinstance(blk.get("text"), str):
                nodes.append((blk, "text"))


def _add_parts(holder: Any, nodes: list[TextNode]) -> None:
    """Record holder.parts[].text (Gemini shape)."""
    if not isinstance(holder, dict):
        return
    parts = holder.get("parts")
    if isinstance(parts, list):
        for p in parts:
            if isinstance(p, dict) and isinstance(p.get("text"), str):
                nodes.append((p, "text"))


def collect_text_nodes(body: Any) -> list[TextNode]:
    """Return every editable human-text node in a parsed request body, covering
    the OpenAI, Anthropic, and Gemini schemas. Unknown shapes yield no nodes."""
    nodes: list[TextNode] = []
    if not isinstance(body, dict):
        return nodes

    # OpenAI / Anthropic chat messages.
    msgs = body.get("messages")
    if isinstance(msgs, list):
        for m in msgs:
            if isinstance(m, dict):
                _add_content(m, "content", nodes)

    # Anthropic top-level system prompt (str or content blocks).
    if "system" in body:
        _add_content(body, "system", nodes)

    # Gemini conversation turns and system instruction.
    contents = body.get("contents")
    if isinstance(contents, list):
        for c in contents:
            _add_parts(c, nodes)
    _add_parts(body.get("systemInstruction"), nodes)

    return nodes


def extract_text(body: Any) -> str:
    """Concatenate all human-readable text in a parsed body, newline-joined."""
    return "\n".join(container[key] for container, key in collect_text_nodes(body))
