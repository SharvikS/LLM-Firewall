package proxy

import (
	"bytes"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
)

// Streaming output scanning.
//
// Buffered (non-stream) responses run the full ML output scanner. Streamed
// responses (SSE) can't be buffered without destroying the streaming UX, so we
// apply a fast, deterministic masker to the assistant text *as it streams*:
//
//   - High-confidence, regex-detectable entities only (SSN, email, credit card,
//     AWS keys, OpenAI-style secrets). These are the entities that leak
//     verbatim and are unambiguous — no ML needed.
//   - A carry buffer holds back the trailing maxHold bytes of generated text
//     between chunks so a pattern split across SSE deltas is still caught: a
//     pattern is only emitted once it is far enough from the live edge that it
//     cannot still be growing.
//
// Everything is fail-open: any SSE line we can't parse is forwarded verbatim.

// maxHold must exceed the longest pattern we mask so no complete match can be
// emitted before we've seen all of it. Longest here is a spaced 16-digit card
// (19) / an OpenAI secret; 64 is a comfortable margin.
const maxHold = 64

type streamReplacer struct {
	re   *regexp.Regexp
	with string
}

var streamReplacers = []streamReplacer{
	{regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`), "<EMAIL_ADDRESS>"},
	{regexp.MustCompile(`\b\d{3}-\d{2}-\d{4}\b`), "<US_SSN>"},
	{regexp.MustCompile(`\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b`), "<CREDIT_CARD>"},
	{regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`), "<AWS_ACCESS_KEY>"},
	{regexp.MustCompile(`\bsk-[A-Za-z0-9]{20,}\b`), "<SECRET>"},
}

// maskStreamText masks every high-confidence entity in s. Returns (masked, true)
// when anything changed.
func maskStreamText(s string) (string, bool) {
	out := s
	changed := false
	for _, r := range streamReplacers {
		if r.re.MatchString(out) {
			out = r.re.ReplaceAllString(out, r.with)
			changed = true
		}
	}
	return out, changed
}

// streamMasker wraps the client ResponseWriter and rewrites SSE content deltas.
type streamMasker struct {
	http.ResponseWriter
	buf      bytes.Buffer    // incomplete trailing SSE bytes between Writes
	carry    string          // held-back generated text (cross-chunk)
	envelope json.RawMessage // a recent content event, reused to flush carry
	masked   bool
}

func newStreamMasker(w http.ResponseWriter) *streamMasker {
	return &streamMasker{ResponseWriter: w}
}

func (sm *streamMasker) Write(p []byte) (int, error) {
	sm.buf.Write(p)
	// Process every complete line (terminated by \n); keep the remainder.
	for {
		idx := bytes.IndexByte(sm.buf.Bytes(), '\n')
		if idx < 0 {
			break
		}
		line := make([]byte, idx+1)
		copy(line, sm.buf.Next(idx+1))
		if err := sm.handleLine(line); err != nil {
			return 0, err
		}
	}
	sm.flush()
	// Report the full input as written — we own the re-chunking downstream.
	return len(p), nil
}

// handleLine processes one SSE line (including its trailing newline). On any
// uncertainty it forwards the line unchanged (fail-open).
func (sm *streamMasker) handleLine(line []byte) error {
	trimmed := bytes.TrimRight(line, "\r\n")
	payload, isData := bytes.CutPrefix(trimmed, []byte("data: "))
	if !isData {
		// Blank separator line or non-data field — pass through.
		_, err := sm.ResponseWriter.Write(line)
		return err
	}
	if bytes.Equal(bytes.TrimSpace(payload), []byte("[DONE]")) {
		// End of stream: flush whatever is held, then forward the sentinel.
		if err := sm.flushCarry(); err != nil {
			return err
		}
		_, err := sm.ResponseWriter.Write(line)
		return err
	}

	var event map[string]any
	if err := json.Unmarshal(payload, &event); err != nil {
		_, werr := sm.ResponseWriter.Write(line) // not JSON we understand
		return werr
	}

	content, hasContent, finished := extractDelta(event)
	if finished {
		// A finish event ends generation: flush carry first, then forward it.
		if err := sm.flushCarry(); err != nil {
			return err
		}
		_, err := sm.ResponseWriter.Write(line)
		return err
	}
	if !hasContent {
		_, err := sm.ResponseWriter.Write(line) // role-only / non-content delta
		return err
	}

	// Remember this envelope so flushCarry can synthesize a final delta.
	sm.envelope = append(sm.envelope[:0], payload...)

	emit := sm.advance(content)
	if emit == "" {
		// Nothing safe to emit yet — drop this delta; content is held in carry.
		return nil
	}
	return sm.writeContentEvent(event, emit)
}

// advance appends new content to the carry, then returns the prefix that is now
// safe to emit (masked). The trailing maxHold bytes stay in carry.
func (sm *streamMasker) advance(content string) string {
	text := sm.carry + content
	if len(text) <= maxHold {
		sm.carry = text
		return ""
	}
	split := len(text) - maxHold
	emit, did := maskStreamText(text[:split])
	if did {
		sm.masked = true
	}
	sm.carry = text[split:]
	return emit
}

// flushCarry masks and emits any remaining held content as a final delta.
func (sm *streamMasker) flushCarry() error {
	if sm.carry == "" {
		return nil
	}
	emit, did := maskStreamText(sm.carry)
	if did {
		sm.masked = true
	}
	sm.carry = ""
	if sm.envelope == nil {
		return nil // never saw a content event; nothing to synthesize from
	}
	var event map[string]any
	if err := json.Unmarshal(sm.envelope, &event); err != nil {
		return nil
	}
	return sm.writeContentEvent(event, emit)
}

// writeContentEvent re-serializes event with delta.content replaced by emit and
// writes it as a single SSE data line.
func (sm *streamMasker) writeContentEvent(event map[string]any, emit string) error {
	setDeltaContent(event, emit)
	out, err := json.Marshal(event)
	if err != nil {
		return nil // fail-open: skip rather than corrupt the stream
	}
	_, err = sm.ResponseWriter.Write([]byte("data: " + string(out) + "\n\n"))
	return err
}

func (sm *streamMasker) flush() {
	if f, ok := sm.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (sm *streamMasker) Flush() { sm.flush() }

// Close drains any buffered lines and flushes held-back content. Call it after
// the upstream stream completes, in case it ended without a [DONE] sentinel —
// otherwise the trailing carry (up to maxHold bytes) would be silently dropped.
func (sm *streamMasker) Close() error {
	for {
		idx := bytes.IndexByte(sm.buf.Bytes(), '\n')
		if idx < 0 {
			break
		}
		line := make([]byte, idx+1)
		copy(line, sm.buf.Next(idx+1))
		if err := sm.handleLine(line); err != nil {
			return err
		}
	}
	if err := sm.flushCarry(); err != nil {
		return err
	}
	// Forward any incomplete trailing bytes verbatim (fail-open).
	if sm.buf.Len() > 0 {
		if _, err := sm.ResponseWriter.Write(sm.buf.Bytes()); err != nil {
			return err
		}
		sm.buf.Reset()
	}
	sm.flush()
	return nil
}

// extractDelta pulls choices[0].delta.content and whether the choice finished.
func extractDelta(event map[string]any) (content string, hasContent, finished bool) {
	choices, ok := event["choices"].([]any)
	if !ok || len(choices) == 0 {
		return "", false, false
	}
	c0, ok := choices[0].(map[string]any)
	if !ok {
		return "", false, false
	}
	if fr, ok := c0["finish_reason"]; ok && fr != nil {
		finished = true
	}
	delta, ok := c0["delta"].(map[string]any)
	if !ok {
		return "", false, finished
	}
	if s, ok := delta["content"].(string); ok && s != "" {
		return s, true, finished
	}
	return "", false, finished
}

// setDeltaContent writes emit into choices[0].delta.content (creating the path
// if the model omitted it).
func setDeltaContent(event map[string]any, emit string) {
	choices, ok := event["choices"].([]any)
	if !ok || len(choices) == 0 {
		return
	}
	c0, ok := choices[0].(map[string]any)
	if !ok {
		return
	}
	delta, ok := c0["delta"].(map[string]any)
	if !ok {
		delta = map[string]any{}
		c0["delta"] = delta
	}
	delta["content"] = emit
	// A flushed event must not also carry a finish_reason (we forward the real
	// finish event separately).
	delete(c0, "finish_reason")
}

// looksStreamingJSON is a tiny guard the proxy can use if needed.
func looksStreamingJSON(ct string) bool {
	return strings.Contains(ct, "text/event-stream")
}
