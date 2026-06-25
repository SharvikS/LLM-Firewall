package api

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/logger"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

type auditRecorder struct {
	st *store.Store
}

type controlAuditEvent struct {
	Action     string
	StatusCode int
	Reason     string
	ActorEmail string
	ActorID    string
	ActorRole  string
	ActorType  string
	TargetType string
	TargetID   string
}

func newAuditRecorder(st *store.Store) *auditRecorder {
	if st == nil {
		return nil
	}
	return &auditRecorder{st: st}
}

func (a *auditRecorder) Record(r *http.Request, ev controlAuditEvent) {
	if a == nil || a.st == nil || r == nil || ev.Action == "" {
		return
	}
	id := identityFrom(r.Context())
	if ev.ActorEmail == "" {
		ev.ActorEmail = id.Email
	}
	if ev.ActorID == "" {
		ev.ActorID = id.UserID
	}
	if ev.ActorRole == "" && id.Role != "" {
		ev.ActorRole = string(id.Role)
	}
	if ev.ActorType == "" {
		if id.Machine {
			ev.ActorType = "machine"
		} else if ev.ActorEmail != "" {
			ev.ActorType = "human"
		} else {
			ev.ActorType = "anonymous"
		}
	}
	if ev.StatusCode == 0 {
		ev.StatusCode = http.StatusOK
	}

	row := store.AuditRow{
		EventID:    uuid.NewString(),
		RequestID:  requestID(r),
		Action:     ev.Action,
		StatusCode: ev.StatusCode,
		Reason:     ev.Reason,
		Path:       r.URL.Path,
		Region:     "control-plane",
		ActorID:    ev.ActorID,
		ActorEmail: ev.ActorEmail,
		ActorRole:  ev.ActorRole,
		ActorType:  ev.ActorType,
		TargetType: ev.TargetType,
		TargetID:   ev.TargetID,
		SourceIP:   clientIP(r),
		UserAgent:  r.UserAgent(),
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := a.st.InsertAuditBatch(ctx, []store.AuditRow{row}); err != nil {
			logger.Get().Warn("control-plane audit insert failed",
				slog.String("action", ev.Action),
				slog.String("error", err.Error()),
			)
		}
	}()
}

func requestID(r *http.Request) string {
	if rid := chimiddleware.GetReqID(r.Context()); rid != "" {
		return rid
	}
	return uuid.NewString()
}

func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return strings.TrimSpace(strings.Split(fwd, ",")[0])
	}
	if real := r.Header.Get("X-Real-IP"); real != "" {
		return strings.TrimSpace(real)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}
