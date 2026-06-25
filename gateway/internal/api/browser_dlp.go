package api

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/alerts"
	"github.com/sharvik/llm-firewall/gateway/internal/events"
	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	"github.com/sharvik/llm-firewall/gateway/internal/metrics"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

// BrowserDLPHandler ingests data-loss-prevention events from the TITAN browser
// extension (ChatGPT/Claude/Gemini web UIs) and fans them out to the SAME
// observability surfaces the API proxy feeds: the live threat feed, the durable
// Kafka→ClickHouse audit log, the blocked-request counters, and real-time SOC
// alerting. This is what makes the browser a first-class sensor instead of an
// island — a prompt blocked in the browser shows up next to one blocked at the
// gateway, in one unified view.
//
// The endpoint is unauthenticated by design: the browser/engine cannot hold a
// tenant API key. When a shared token is configured it is required, so the
// endpoint can be safely exposed beyond localhost.
type BrowserDLPHandler struct {
	producer  *events.EventProducer
	alerts    *alerts.Dispatcher
	store     *store.Store
	threshold int    // violations past which a subject is flagged (>threshold)
	token     string // optional shared secret; when set, X-Titan-DLP-Token must match
}

// NewBrowserDLPHandler wires the ingest endpoint to the event/alert plane and
// the durable violation/flag store. producer, alerts, and st may be nil (those
// dependencies disabled) — the handler degrades gracefully and never errors on a
// missing dependency. threshold<1 defaults to 3 (a flag is raised on the 4th
// violation by the same subject).
func NewBrowserDLPHandler(producer *events.EventProducer, dispatcher *alerts.Dispatcher, st *store.Store, threshold int, token string) *BrowserDLPHandler {
	if threshold < 1 {
		threshold = 3
	}
	return &BrowserDLPHandler{
		producer: producer, alerts: dispatcher, store: st,
		threshold: threshold, token: strings.TrimSpace(token),
	}
}

// browserDLPEvent is the wire shape reported by the extension (relayed by the ML
// engine /report). It carries only verdict metadata and the final user action —
// never the prompt text, PII values, or secrets themselves.
type browserDLPEvent struct {
	Site       string   `json:"site"`       // chatgpt | claude | gemini
	Host       string   `json:"host"`       // page hostname (e.g. chatgpt.com)
	Decision   string   `json:"decision"`   // block | redact | allow
	Action     string   `json:"action"`     // blocked | redacted | auto_redacted | sent_anyway | cancelled
	Risk       float64  `json:"risk"`       // 0–100
	Reason     string   `json:"reason"`     // human-readable summary
	Categories []string `json:"categories"` // injection | toxicity | pii | secret | code_leak
	PII        []string `json:"pii"`        // entity TYPES only (e.g. EMAIL_ADDRESS)
	Secrets    []string `json:"secrets"`    // secret TYPES only (e.g. AWS_ACCESS_KEY)
	Source     string   `json:"source"`     // engine | local (which scanner produced the verdict)
	Kind       string   `json:"kind"`       // text | file | image (attachment scanning)
	Filename   string   `json:"filename"`   // attachment name, when kind != text
	Subject    string   `json:"subject"`    // stable identity: extension install id (always sent)
	Account    string   `json:"account"`    // best-effort human identity (detected account email/name)
	ClientIP   string   `json:"client_ip"`  // browser source IP, stamped by the engine relay
	Device     *device  `json:"device"`     // device/browser fingerprint
}

// device is the browser/OS fingerprint reported by the extension. Browsers don't
// expose the OS hostname/local IP (privacy), so Name/ID are populated only when an
// enterprise provisions them via managed extension policy (MDM).
type device struct {
	Name      string `json:"name"` // MDM-provisioned device name, if any
	ID        string `json:"id"`   // MDM-provisioned device id, if any
	UserAgent string `json:"user_agent"`
	Platform  string `json:"platform"` // e.g. "MacIntel", "Win32"
	OS        string `json:"os"`       // derived: macOS / Windows / Linux / …
	Browser   string `json:"browser"`  // derived: Chrome / Firefox / Edge / Safari
	Mobile    bool   `json:"mobile"`
	Timezone  string `json:"timezone"`
	Languages string `json:"languages"`
	Screen    string `json:"screen"` // e.g. "2560x1440@2"
	Cores     int    `json:"cores"`
	Memory    int    `json:"memory"` // GB (navigator.deviceMemory)
}

// Report handles POST /internal/dlp-event.
func (h *BrowserDLPHandler) Report(w http.ResponseWriter, r *http.Request) {
	// CORS so a browser-direct integration also works; the primary path is the
	// server-to-server relay from the ML engine, which ignores these.
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Titan-DLP-Token")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if h.token != "" && r.Header.Get("X-Titan-DLP-Token") != h.token {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid DLP token"})
		return
	}

	var ev browserDLPEvent
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&ev); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}

	action, blocked := mapBrowserAction(ev)
	reason := strings.TrimSpace(ev.Reason)
	if reason == "" {
		reason = "browser DLP event"
	}
	site := firstNonEmpty(ev.Site, ev.Host, "browser")

	// 1) Live threat feed (in-memory ring + cluster Redis) → dashboard Events tab.
	eventID := uuid.New().String()
	metrics.Events.Push(metrics.Event{
		EventID:   eventID,
		TenantID:  "browser:" + site,
		Action:    action,
		RiskScore: ev.Risk,
		Reason:    reason,
		Path:      "/web/" + site,
		Timestamp: time.Now().UTC(),
	})

	// 2) Counters + traffic chart — a browser block is a blocked request too.
	if blocked {
		metrics.Global.BlockedRequests.Add(1)
		metrics.HourlyTraffic.Record(true)
	} else {
		metrics.HourlyTraffic.Record(false)
	}

	// 3) Durable audit (Kafka → ClickHouse / Postgres) for compliance & analytics.
	if h.producer != nil {
		h.producer.EmitAudit(context.Background(), events.AuditEvent{
			EventID:    eventID,
			RequestID:  eventID,
			TenantID:   "", // no tenant: browser-side, maps to NULL in the consumer
			Action:     action,
			RiskScore:  ev.Risk,
			Provider:   site,
			Model:      "web-ui",
			Prompt:     "[REDACTED]",
			StatusCode: browserStatusCode(blocked),
			Path:       "/web/" + site,
			Reason:     reason,
			Timestamp:  time.Now().UTC(),
		})
	}

	// 4) Real-time SOC alert — only for genuine blocks/redactions, never the
	//    clean/cancelled noise. The dispatcher applies its own min-risk +
	//    anti-storm coalescing on top.
	if h.alerts != nil && action != "BROWSER_DLP_CLEAN" {
		h.alerts.Emit(alerts.Event{
			Action:    action,
			Tenant:    "browser:" + site,
			Reason:    reason,
			RequestID: eventID,
			Path:      "/web/" + site,
			Risk:      ev.Risk,
			At:        time.Now().UTC(),
		})
	}

	// 5) Durable violation record + repeat-offender flagging. Every non-clean
	//    event is a violation tied to the subject (extension install id / account).
	//    Crossing the threshold raises a flag the admin sees on the portal and
	//    fires a distinct high-priority alert.
	resp := map[string]any{"recorded": true, "action": action}
	if h.store != nil && action != "BROWSER_DLP_CLEAN" {
		subject := firstNonEmpty(ev.Subject, ev.Account, "anon:"+site)
		clientIP := clientIPFromRequest(r, ev.ClientIP)
		kind := strings.ToLower(strings.TrimSpace(ev.Kind))
		if kind == "" {
			kind = "text"
		}
		viol := store.DLPViolation{
			Subject:    subject,
			Account:    ev.Account,
			Site:       site,
			Action:     action,
			Risk:       ev.Risk,
			Categories: strings.Join(ev.Categories, ","),
			Reason:     reason,
			Source:     ev.Source,
			Kind:       kind,
			Filename:   ev.Filename,
			ClientIP:   clientIP,
		}
		applyDevice(&viol, ev.Device)
		out, err := h.store.RecordDLPViolation(r.Context(), viol, h.threshold)
		if err != nil {
			logger.Get().Error("DLP violation record failed", "error", err.Error(), "subject", subject)
		} else {
			resp["violation_count"] = out.ViolationCount
			resp["flagged"] = out.Flagged
			if out.NewlyFlagged && out.Flag != nil {
				h.raiseFlagSignals(*out.Flag)
			}
		}
	}

	writeJSON(w, http.StatusAccepted, resp)
}

// raiseFlagSignals fans a freshly-raised repeat-offender flag out to the live
// feed and SOC alerting so the admin is notified the moment a subject crosses
// the threshold — not only when they next open the portal.
func (h *BrowserDLPHandler) raiseFlagSignals(f store.DLPFlag) {
	who := firstNonEmpty(f.Account, f.Subject)
	where := ""
	if f.LastDevice != "" || f.LastIP != "" {
		where = " — device: " + firstNonEmpty(f.LastDevice, "unknown")
		if f.LastIP != "" {
			where += " @ " + f.LastIP
		}
	}
	reason := "Repeat DLP offender flagged: " + who +
		" (" + itoaSmall(f.ViolationCount) + " violations)" + where + " — latest: " + f.LastReason

	metrics.Events.Push(metrics.Event{
		EventID:   uuid.New().String(),
		TenantID:  "browser:" + f.LastSite,
		Action:    "DLP_FLAG_RAISED",
		RiskScore: f.MaxRisk,
		Reason:    reason,
		Path:      "/web/" + f.LastSite,
		Timestamp: time.Now().UTC(),
	})

	if h.alerts != nil {
		h.alerts.Emit(alerts.Event{
			Action:    "DLP_FLAG_RAISED",
			Tenant:    "browser:" + who,
			Reason:    reason,
			RequestID: f.ID.String(),
			Path:      "/web/" + f.LastSite,
			Risk:      f.MaxRisk,
			At:        time.Now().UTC(),
		})
	}

	if h.producer != nil {
		h.producer.EmitAudit(context.Background(), events.AuditEvent{
			EventID:    f.ID.String(),
			RequestID:  f.ID.String(),
			Action:     "DLP_FLAG_RAISED",
			RiskScore:  f.MaxRisk,
			Provider:   f.LastSite,
			Model:      "web-ui",
			Prompt:     "[REDACTED]",
			StatusCode: http.StatusForbidden,
			Path:       "/web/" + f.LastSite,
			Reason:     reason,
			Timestamp:  time.Now().UTC(),
		})
	}
}

// itoaSmall stringifies a small non-negative count for alert text.
func itoaSmall(n int) string {
	if n <= 0 {
		return "0"
	}
	var b [12]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// mapBrowserAction turns the extension's (decision, action) pair into a canonical
// audit Action and whether it counts as a blocked request. The user's *final*
// choice is what matters: a redact-capable verdict the user sent anyway is an
// override, not a block.
func mapBrowserAction(ev browserDLPEvent) (action string, blocked bool) {
	switch strings.ToLower(ev.Action) {
	case "blocked", "cancelled", "cancel":
		// A hard block, or the user backed out after a warning — nothing left.
		return "BROWSER_DLP_BLOCK", true
	case "redacted", "auto_redacted", "redact":
		return "BROWSER_DLP_REDACT", true
	case "sent_anyway", "override":
		return "BROWSER_DLP_OVERRIDE", false
	default:
		if strings.ToLower(ev.Decision) == "allow" {
			return "BROWSER_DLP_CLEAN", false
		}
		return "BROWSER_DLP_BLOCK", true
	}
}

func browserStatusCode(blocked bool) int {
	if blocked {
		return http.StatusForbidden
	}
	return http.StatusOK
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// clientIPFromRequest resolves the browser's IP. Preference order:
//  1. the IP the engine observed on the /report connection and stamped into the
//     event (most reliable — it's the actual browser→engine source);
//  2. X-Forwarded-For / X-Real-IP (the engine relay sets XFF);
//  3. the gateway's own RemoteAddr (last resort: the relay's IP).
func clientIPFromRequest(r *http.Request, stamped string) string {
	if ip := strings.TrimSpace(stamped); ip != "" {
		return ip
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	if xr := r.Header.Get("X-Real-IP"); xr != "" {
		return strings.TrimSpace(xr)
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// applyDevice copies the reported fingerprint onto the violation, derives a
// human-readable device label, and preserves the full blob in device_json so
// nothing is lost. nil device → forensic fields stay empty (graceful).
func applyDevice(v *store.DLPViolation, d *device) {
	if d == nil {
		return
	}
	v.UserAgent = d.UserAgent
	v.DeviceName = d.Name
	v.DeviceID = d.ID
	v.Timezone = d.Timezone
	v.Languages = d.Languages
	v.Screen = d.Screen
	v.DeviceLabel = deviceLabel(d)
	if blob, err := json.Marshal(d); err == nil {
		v.DeviceJSON = string(blob)
	}
}

// deviceLabel builds a compact "OS · Browser · Platform" string for at-a-glance
// display, falling back to the user agent when the structured hints are absent.
func deviceLabel(d *device) string {
	parts := []string{}
	if d.OS != "" {
		parts = append(parts, d.OS)
	}
	if d.Browser != "" {
		parts = append(parts, d.Browser)
	}
	if d.Platform != "" && d.Platform != d.OS {
		parts = append(parts, d.Platform)
	}
	if d.Mobile {
		parts = append(parts, "mobile")
	}
	if len(parts) == 0 {
		if d.UserAgent != "" {
			return d.UserAgent
		}
		return "unknown device"
	}
	return strings.Join(parts, " · ")
}
