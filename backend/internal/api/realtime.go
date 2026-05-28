package api

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/ericliu1711/wordle-rooms/internal/realtime"
	"github.com/ericliu1711/wordle-rooms/internal/room"
)

type realtimeHandler struct {
	registry *realtime.HubRegistry
	rooms    *room.Store
	upgrader websocket.Upgrader
}

// newRealtimeHandler creates the handler with a WS upgrader that allows only
// the given origin. The origin value comes from NewRouter (single read site).
func newRealtimeHandler(registry *realtime.HubRegistry, rooms *room.Store, allowedOrigin string) *realtimeHandler {
	return &realtimeHandler{
		registry: registry,
		rooms:    rooms,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return r.Header.Get("Origin") == allowedOrigin
			},
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

	if err := h.rooms.ValidatePlayer(code, token); err != nil {
		if errors.Is(err, room.ErrRoomNotFound) {
			writeErr(w, http.StatusNotFound, "room not found", "not_found")
		} else {
			writeErr(w, http.StatusForbidden, "forbidden", "forbidden")
		}
		return
	}

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		// upgrader already wrote the HTTP error; just log.
		slog.Warn("ws upgrade failed", "room", code, "err", err)
		return
	}

	// From here the connection is hijacked — do not write any HTTP body.
	h.registry.Connect(conn, token, code)
}
