package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/auth"
	"github.com/sharvik/llm-firewall/gateway/internal/store"
)

// userHandler serves control-plane user management (admin-only routes).
type userHandler struct{ st *store.Store }

func (h *userHandler) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.st.ListUsers(r.Context())
	if err != nil {
		internalError(w, "list users", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users, "count": len(users)})
}

func (h *userHandler) createUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	if body.Email == "" || !strings.Contains(body.Email, "@") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "valid email required"})
		return
	}
	if !auth.Role(body.Role).Valid() {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "role must be viewer|compliance|security|admin"})
		return
	}
	if len(body.Password) < 8 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password must be at least 8 characters"})
		return
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		internalError(w, "hash password", err)
		return
	}
	u, err := h.st.CreateUser(r.Context(), body.Email, hash, body.Role, "local")
	if err != nil {
		// Most likely a unique-violation on email.
		writeJSON(w, http.StatusConflict, map[string]string{"error": "could not create user (email may already exist)"})
		return
	}
	writeJSON(w, http.StatusCreated, u)
}

func (h *userHandler) updateRole(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid user id"})
		return
	}
	var body struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !auth.Role(body.Role).Valid() {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "role must be viewer|compliance|security|admin"})
		return
	}
	u, err := h.st.UpdateUserRole(r.Context(), id, body.Role)
	if err != nil {
		internalError(w, "update role", err)
		return
	}
	if u == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (h *userHandler) deleteUser(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid user id"})
		return
	}
	// Guard: an admin must not delete their own account out from under them.
	if id.String() == identityFrom(r.Context()).UserID {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot delete the acting user"})
		return
	}
	if err := h.st.DeleteUser(r.Context(), id); err != nil {
		internalError(w, "delete user", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
