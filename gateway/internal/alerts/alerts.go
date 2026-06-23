// Package alerts delivers security events to an external collector (Slack/Teams
// incoming webhook, PagerDuty, Splunk HEC, or any HTTP endpoint) in real time so
// a customer's SOC sees blocks/quota-breaches as they happen.
//
// Open-core split: the Event/Config value types (this file) are part of the MIT
// core so the data plane can construct events unconditionally. The dispatcher
// ENGINE — the worker goroutine, webhook delivery, and anti-storm coalescing —
// is a commercial feature; its implementation lives in dispatcher_enterprise.go
// (built only with `-tags enterprise`) and is replaced by a no-op in
// dispatcher_community.go. See EDITIONS.md.
package alerts

import "time"

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
