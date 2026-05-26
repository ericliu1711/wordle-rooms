package api

import (
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/placeholder/wordle-rooms/internal/realtime"
	"github.com/placeholder/wordle-rooms/internal/room"
)

type realtimeHandler struct {
	registry *realtime.HubRegistry
	rooms    *room.Store
}

// newUpgrader returns a Upgrader that allows only the configured CORS origin.
// Production should use a strict allowlist; CORS_ORIGIN env var (default
// http://localhost:3000) covers local development.
func newUpgrader() websocket.Upgrader {
	allowed := os.Getenv("CORS_ORIGIN")
	if allowed == "" {
		allowed = "http://localhost:3000"
	}
	return websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return r.Header.Get("Origin") == allowed
		},
	}
}

func (h *realtimeHandler) wsUpgrade(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(chi.URLParam(r, "code"))

	token := r.URL.Query().Get("token")
	if token == "" {
		writeErr(w, http.StatusUnauthorized, "missing token", "missing_token")
		return
	}

	rm, err := h.rooms.Get(code)
	if err != nil {
		writeErr(w, http.StatusNotFound, "room not found", "not_found")
		return
	}

	if _, ok := rm.Players[token]; !ok {
		writeErr(w, http.StatusForbidden, "forbidden", "forbidden")
		return
	}

	upgrader := newUpgrader()
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		// upgrader already wrote the HTTP error; just log.
		slog.Warn("ws upgrade failed", "room", code, "err", err)
		return
	}

	// From here the connection is hijacked — do not write any HTTP body.
	h.registry.Connect(conn, token, code)
}
