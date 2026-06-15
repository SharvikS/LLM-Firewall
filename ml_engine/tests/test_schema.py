"""Tests for provider-agnostic request-body traversal (analyzer.schema)."""

import json

from analyzer import schema


def test_openai_string_content():
    body = {"messages": [{"role": "user", "content": "hello openai"}]}
    assert schema.extract_text(body) == "hello openai"


def test_openai_block_content():
    body = {"messages": [{"role": "user", "content": [
        {"type": "text", "text": "block one"},
        {"type": "text", "text": "block two"},
    ]}]}
    assert schema.extract_text(body) == "block one\nblock two"


def test_anthropic_system_and_messages():
    body = {
        "system": "be terse",
        "messages": [{"role": "user", "content": "hi claude"}],
    }
    text = schema.extract_text(body)
    assert "be terse" in text and "hi claude" in text


def test_gemini_contents_and_system():
    body = {
        "systemInstruction": {"parts": [{"text": "sys gemini"}]},
        "contents": [{"role": "user", "parts": [{"text": "hi gemini"}]}],
    }
    text = schema.extract_text(body)
    assert "sys gemini" in text and "hi gemini" in text


def test_unknown_shape_yields_nothing():
    assert schema.extract_text({"prompt": "raw"}) == ""
    assert schema.extract_text("not a dict") == ""


def test_in_place_masking_openai_string():
    body = {"messages": [{"role": "user", "content": "secret"}]}
    nodes = schema.collect_text_nodes(body)
    assert len(nodes) == 1
    container, key = nodes[0]
    container[key] = "[MASKED]"
    assert body["messages"][0]["content"] == "[MASKED]"


def test_in_place_masking_gemini_part():
    body = {"contents": [{"parts": [{"text": "secret"}]}]}
    container, key = schema.collect_text_nodes(body)[0]
    container[key] = "[MASKED]"
    assert body["contents"][0]["parts"][0]["text"] == "[MASKED]"
    # Round-trips through JSON unchanged in structure.
    assert json.loads(json.dumps(body))["contents"][0]["parts"][0]["text"] == "[MASKED]"


def test_in_place_masking_anthropic_blocks():
    body = {"messages": [{"role": "user", "content": [
        {"type": "text", "text": "leak me"},
        {"type": "image", "source": {}},
    ]}]}
    nodes = schema.collect_text_nodes(body)
    # Only the text block is editable; the image block is left alone.
    assert len(nodes) == 1
    container, key = nodes[0]
    container[key] = "[MASKED]"
    assert body["messages"][0]["content"][0]["text"] == "[MASKED]"
    assert body["messages"][0]["content"][1]["type"] == "image"
