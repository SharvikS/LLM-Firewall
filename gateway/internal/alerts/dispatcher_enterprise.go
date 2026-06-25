//go:build enterprise

// TITAN Enterprise — commercial license (see LICENSE-ENTERPRISE.md), not MIT.
//
// Real-time SOC alert dispatcher. It sits next to the request hot path, so it
// must never slow or break it:
//   - Non-blocking: Emit drops onto a buffered channel and returns immediately;
//     if the buffer is full the event is dropped (a slow webhook can't back up
//     the proxy).
//   - Fail-open: any webhook error is logged and swallowed.
//   - Anti-storm: per (tenant, action) coalescing window so a flood of identical
//     blocks produces one alert, not thousands.
package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	"github.com/sharvik/llm-firewall/gateway/internal/siem"
)

// Dispatcher owns the worker goroutine and the dedup state.
type Dispatcher struct {
	ch     chan Event
	cfg    func() Config
	client *http.Client

	mu       sync.Mutex
	lastSent map[string]time.Time // (tenant|action) → last alert time
	window   time.Duration
}

// New starts the dispatcher. cfgFn returns the current alerting config so the
// webhook URL/threshold can change live from the dashboard.
func New(cfgFn func() Config) *Dispatcher {
	d := &Dispatcher{
		ch:       make(chan Event, 256),
		cfg:      cfgFn,
		client:   &http.Client{Timeout: 5 * time.Second},
		lastSent: make(map[string]time.Time),
		window:   60 * time.Second,
	}
	go d.run()
	return d
}

// Emit queues an event without blocking. Safe to call from the request path.
func (d *Dispatcher) Emit(ev Event) {
	if d == nil {
		return
	}
	if ev.At.IsZero() {
		ev.At = time.Now()
	}
	select {
	case d.ch <- ev:
	default: // buffer full — drop rather than block a request
	}
}

// SendTest delivers a synthetic alert immediately and returns any error, so the
// dashboard "Send test alert" button can surface success/failure to the operator.
func (d *Dispatcher) SendTest(ctx context.Context, url string) error {
	if url == "" {
		return fmt.Errorf("no webhook URL configured")
	}
	return d.post(ctx, url, siem.FormatGeneric, Event{
		Action: "TEST", Tenant: "—", Reason: "TITAN test alert — your SOC webhook is wired correctly.",
		Risk: 0, At: time.Now(),
	})
}

func (d *Dispatcher) run() {
	for ev := range d.ch {
		cfg := d.cfg()
		if !cfg.Enabled || cfg.WebhookURL == "" {
			continue
		}
		// Quota/rate events always alert; risk-scored events gate on the threshold.
		if ev.Action == "ML_BLOCKED" && ev.Risk < cfg.MinRisk {
			continue
		}
		if d.suppressed(ev) {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := d.post(ctx, cfg.WebhookURL, cfg.Format, ev); err != nil {
			logger.Get().Warn("alert webhook delivery failed", slog.String("error", err.Error()))
		}
		cancel()
	}
}

// suppressed coalesces identical (tenant, action) alerts within the window.
func (d *Dispatcher) suppressed(ev Event) bool {
	key := ev.Tenant + "|" + ev.Action
	d.mu.Lock()
	defer d.mu.Unlock()
	if last, ok := d.lastSent[key]; ok && ev.At.Sub(last) < d.window {
		return true
	}
	d.lastSent[key] = ev.At
	return false
}

// post sends a versioned SIEM payload. The generic format keeps a top-level
// text field so Slack/Teams incoming webhooks still render a useful message.
func (d *Dispatcher) post(ctx context.Context, url, format string, ev Event) error {
	payload := siem.Envelope(format, alertToSIEM(ev))
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned %d", resp.StatusCode)
	}
	return nil
}

func alertToSIEM(ev Event) siem.Event {
	if ev.At.IsZero() {
		ev.At = time.Now()
	}
	out := siem.Event{
		SchemaVersion: siem.SchemaVersion,
		Vendor:        "titan",
		Product:       "titan-gateway",
		EventType:     "security",
		EventAction:   ev.Action,
		Severity:      siem.Severity(ev.Action, ev.Risk),
		Category:      siem.Category(ev.Action),
		TenantID:      ev.Tenant,
		RequestID:     ev.RequestID,
		Path:          ev.Path,
		Reason:        ev.Reason,
		RiskScore:     ev.Risk,
		Source:        "gateway",
		Timestamp:     ev.At.UTC(),
	}
	out.Message = siem.Message(out)
	return out
}
