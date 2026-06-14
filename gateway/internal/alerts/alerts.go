// Package alerts delivers security events to an external collector (Slack/Teams
// incoming webhook, PagerDuty, Splunk HEC, or any HTTP endpoint) in real time so
// a customer's SOC sees blocks/quota-breaches as they happen.
//
// Design goals (it sits next to the request hot path, so it must never slow or
// break it):
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
)

// Event is a security-relevant occurrence worth alerting on.
type Event struct {
	Action    string  // ML_BLOCKED, QUOTA_EXCEEDED, RATE_LIMITED, TEST, …
	Tenant    string  //
	Reason    string  //
	RequestID string  //
	Path      string  //
	Risk      float64 // 0–100
	At        time.Time
}

// Config is the live alerting configuration, read fresh per event.
type Config struct {
	Enabled    bool
	WebhookURL string
	MinRisk    float64
}

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
	return d.post(ctx, url, Event{
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
		if err := d.post(ctx, cfg.WebhookURL, ev); err != nil {
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

// post sends a payload that Slack/Teams render nicely ("text") while also
// carrying structured fields for generic HTTP/SIEM collectors.
func (d *Dispatcher) post(ctx context.Context, url string, ev Event) error {
	text := fmt.Sprintf(":shield: *TITAN %s* — tenant `%s` · risk %.0f\n%s",
		ev.Action, ev.Tenant, ev.Risk, ev.Reason)
	payload := map[string]any{
		"text":       text,
		"source":     "titan-gateway",
		"action":     ev.Action,
		"tenant":     ev.Tenant,
		"reason":     ev.Reason,
		"risk_score": ev.Risk,
		"request_id": ev.RequestID,
		"path":       ev.Path,
		"timestamp":  ev.At.UTC().Format(time.RFC3339),
	}
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
