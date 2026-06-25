// Package siem defines TITAN's stable outbound security-event contract.
package siem

import (
	"fmt"
	"strings"
	"time"
)

const (
	SchemaVersion = "titan.siem.v1"

	FormatGeneric   = "generic"
	FormatSplunkHEC = "splunk_hec"
	FormatDatadog   = "datadog"
	FormatElastic   = "elastic"
)

// Event is the canonical payload external collectors should parse. Additive
// fields are allowed; existing JSON keys are stable within titan.siem.v1.
type Event struct {
	SchemaVersion string    `json:"schema_version"`
	Vendor        string    `json:"vendor"`
	Product       string    `json:"product"`
	EventType     string    `json:"event_type"`
	EventAction   string    `json:"event_action"`
	Severity      string    `json:"severity"`
	Category      string    `json:"category"`
	TenantID      string    `json:"tenant_id,omitempty"`
	RequestID     string    `json:"request_id,omitempty"`
	Path          string    `json:"path,omitempty"`
	Reason        string    `json:"reason,omitempty"`
	RiskScore     float64   `json:"risk_score"`
	Source        string    `json:"source"`
	Timestamp     time.Time `json:"timestamp"`
	Message       string    `json:"message"`
}

// Envelope returns the HTTP JSON body for the target collector format.
func Envelope(format string, ev Event) map[string]any {
	switch NormalizeFormat(format) {
	case FormatSplunkHEC:
		return map[string]any{
			"time":       float64(ev.Timestamp.UnixNano()) / float64(time.Second),
			"host":       "titan-gateway",
			"source":     "titan",
			"sourcetype": "titan:security",
			"event":      ev,
		}
	case FormatDatadog:
		return map[string]any{
			"ddsource": "titan",
			"service":  "titan-gateway",
			"message":  ev.Message,
			"status":   datadogStatus(ev.Severity),
			"event":    ev,
		}
	case FormatElastic:
		return map[string]any{
			"@timestamp": ev.Timestamp.UTC().Format(time.RFC3339Nano),
			"ecs": map[string]string{
				"version": "8.0.0",
			},
			"event": map[string]string{
				"kind":     "alert",
				"category": ev.Category,
				"action":   ev.EventAction,
				"type":     ev.EventType,
			},
			"message": ev.Message,
			"titan":   ev,
		}
	default:
		return map[string]any{
			"text":  ev.Message,
			"event": ev,
		}
	}
}

func NormalizeFormat(format string) string {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case FormatSplunkHEC, "splunk":
		return FormatSplunkHEC
	case FormatDatadog:
		return FormatDatadog
	case FormatElastic, "ecs":
		return FormatElastic
	default:
		return FormatGeneric
	}
}

func Severity(action string, risk float64) string {
	switch {
	case strings.Contains(action, "QUOTA") || strings.Contains(action, "RATE_LIMIT"):
		return "medium"
	case risk >= 95:
		return "critical"
	case risk >= 85:
		return "high"
	case risk >= 50:
		return "medium"
	default:
		return "low"
	}
}

func Category(action string) string {
	switch {
	case strings.Contains(action, "DLP"), strings.Contains(action, "PII"), strings.Contains(action, "SECRET"):
		return "data_loss"
	case strings.Contains(action, "AUTH"), strings.Contains(action, "ADMIN"):
		return "control_plane"
	case strings.Contains(action, "QUOTA"), strings.Contains(action, "RATE_LIMIT"):
		return "abuse"
	default:
		return "llm_security"
	}
}

func Message(ev Event) string {
	return fmt.Sprintf("TITAN %s tenant=%s severity=%s risk=%.0f reason=%s",
		ev.EventAction, emptyDash(ev.TenantID), ev.Severity, ev.RiskScore, ev.Reason)
}

func emptyDash(v string) string {
	if strings.TrimSpace(v) == "" {
		return "-"
	}
	return v
}

func datadogStatus(severity string) string {
	switch severity {
	case "critical", "high":
		return "error"
	case "medium":
		return "warning"
	default:
		return "info"
	}
}
