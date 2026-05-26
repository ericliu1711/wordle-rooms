package api

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/placeholder/wordle-rooms/internal/realtime"
	"github.com/placeholder/wordle-rooms/internal/room"
)

// wsUpgrader is created once at package init from the CORS_ORIGIN env var.
// Production should use a strict allowlist; the default covers local development.
var wsUpgrader = func() websocket.Upgrader {
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
}()

type realtimeHandler struct {
	registry *realtime.HubRegistry
	rooms    *room.Store
}

func (h *realtimeHandler) wsUpgrade(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(chi.URLParam(r, "code"))

	token := r.URL.Query().Get("token")
	if token == "" {
		writeErr(w, http.StatusUnauthorized, "missing token", "missing_token")
		return
	}

	if err := h.rooms.ValidatePlayer(code, token); err != nil {
		if errors.Is(err, room.ErrRoomNotFound) {
			writeErr(w, http.StatusNotFound, "room not found", "not_found")
		} else {
			writeErr(w, http.StatusForbidden, "forbidden", "forbidden")
		}
		return
	}

	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		// upgrader already wrote the HTTP error; just log.
		slog.Warn("ws upgrade failed", "room", code, "err", err)
		return
	}

	// From here the connection is hijacked — do not write any HTTP body.
	h.registry.Connect(conn, token, code)
}
