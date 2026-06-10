package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/batch"
	"github.com/sharvik/llm-firewall/gateway/internal/middleware"
)

// injectTenant is a test middleware that stands in for APIKeyAuth, putting a
// fixed tenant identity on the request context.
func injectTenant(tenantID uuid.UUID) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := context.WithValue(r.Context(), middleware.AuthCtxKey, middleware.AuthContext{
				TenantID: tenantID,
				APIKeyID: uuid.New(),
			})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// buildRouter mirrors main.go's authed group: batch routes registered before a
// catch-all that must NOT win for /v1/batch.
func buildRouter(tenantID uuid.UUID, mgr *batch.Manager) http.Handler {
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(injectTenant(tenantID))
		h := NewBatchHandler(mgr)
		r.Post("/v1/batch", h.Submit)
		r.Get("/v1/batch/{id}", h.Status)
		r.Handle("/*", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusTeapot) // sentinel: wildcard wrongly matched
		}))
	})
	return r
}

func TestBatch_SubmitProcessAndPoll(t *testing.T) {
	// Fake upstream LLM — returns a canned completion for any POST.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"cmpl-1","choices":[{"message":{"role":"assistant","content":"hi"}}]}`))
	}))
	defer upstream.Close()

	tenantID := uuid.New()
	// nil redis → in-memory store; nil ml client → analyzer fails open (ALLOW).
	mgr := batch.NewManager(nil, nil, upstream.URL, "test-key")
	router := buildRouter(tenantID, mgr)

	reqBody := `{"requests":[
		{"model":"m","messages":[{"role":"user","content":"a"}]},
		{"model":"m","messages":[{"role":"user","content":"b"}]}
	]}`
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/batch", bytes.NewBufferString(reqBody)))

	if rec.Code != http.StatusAccepted {
		t.Fatalf("submit: expected 202, got %d (wildcard hijack would be 418) body=%s", rec.Code, rec.Body.String())
	}
	var submit struct {
		JobID string `json:"job_id"`
		Total int    `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &submit); err != nil {
		t.Fatalf("decode submit response: %v", err)
	}
	if submit.Total != 2 || submit.JobID == "" {
		t.Fatalf("unexpected submit response: %+v", submit)
	}

	// Poll until completed (processing is async).
	var job batch.Job
	deadline := time.Now().Add(5 * time.Second)
	for {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/batch/"+submit.JobID, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status: expected 200, got %d", rec.Code)
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &job); err != nil {
			t.Fatalf("decode job: %v", err)
		}
		if job.Status == batch.StatusCompleted {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("batch did not complete in time; last status=%s", job.Status)
		}
		time.Sleep(20 * time.Millisecond)
	}

	if job.Completed != 2 {
		t.Fatalf("expected 2 completed items, got %d", job.Completed)
	}
	for _, it := range job.Items {
		if it.Status != batch.ItemAllowed {
			t.Errorf("item %d: expected allowed, got %s (err=%s)", it.Index, it.Status, it.Error)
		}
		if len(it.Response) == 0 {
			t.Errorf("item %d: expected an upstream response", it.Index)
		}
	}
}

func TestBatch_CrossTenantReturns404(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	owner := uuid.New()
	mgr := batch.NewManager(nil, nil, upstream.URL, "k")

	// Owner submits.
	ownerRouter := buildRouter(owner, mgr)
	rec := httptest.NewRecorder()
	ownerRouter.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/batch",
		bytes.NewBufferString(`{"requests":[{"model":"m","messages":[]}]}`)))
	var submit struct {
		JobID string `json:"job_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &submit)

	// A different tenant must not see it.
	otherRouter := buildRouter(uuid.New(), mgr)
	rec2 := httptest.NewRecorder()
	otherRouter.ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/v1/batch/"+submit.JobID, nil))
	if rec2.Code != http.StatusNotFound {
		t.Fatalf("cross-tenant access: expected 404, got %d", rec2.Code)
	}
}

func TestBatch_EmptyRequestsRejected(t *testing.T) {
	mgr := batch.NewManager(nil, nil, "http://unused", "k")
	router := buildRouter(uuid.New(), mgr)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/batch",
		bytes.NewBufferString(`{"requests":[]}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty batch: expected 400, got %d", rec.Code)
	}
}
