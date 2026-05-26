package realtime

import (
	"encoding/json"
	"log/slog"
	"sync"

	"github.com/placeholder/wordle-rooms/internal/room"
)

// Hub manages all WebSocket clients connected to a single room.
type Hub struct {
	roomCode string
	mu       sync.RWMutex
	clients  map[*Client]struct{}
	rooms    *room.Store
}

func newHub(roomCode string, rooms *room.Store) *Hub {
	return &Hub{
		roomCode: roomCode,
		clients:  make(map[*Client]struct{}),
		rooms:    rooms,
	}
}

// Register adds the client to the hub and immediately pushes the current room
// state to it. Called before ReadPump/WritePump start, so the initial payload
// lands in the buffered send channel and is drained once WritePump is running.
func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	n := len(h.clients)
	h.mu.Unlock()
	slog.Info("ws client connected", "room", h.roomCode, "total", n)

	h.sendToOne(c)
}

// Unregister removes the client from the hub. Called by Client.close().
func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	delete(h.clients, c)
	n := len(h.clients)
	h.mu.Unlock()
	slog.Info("ws client disconnected", "room", h.roomCode, "remaining", n)
}

// Broadcast pushes the current room state to every connected client.
// Each client receives a personalized PlayerView snapshot (spoiler rules apply).
// The view is built per-client under the store's read lock so no *Room pointer
// escapes the lock boundary.
// If a client's send channel is full, it is evicted (backpressure).
func (h *Hub) Broadcast() {
	// Snapshot client tokens while holding the hub lock, then release.
	h.mu.RLock()
	clients := make([]*Client, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	var toEvict []*Client
	sent := 0

	for _, c := range clients {
		payload := h.buildPayload(c.token)
		if payload == nil {
			continue
		}
		h.mu.Lock()
		if _, still := h.clients[c]; !still {
			// Client disconnected between snapshot and send — skip.
			h.mu.Unlock()
			continue
		}
		select {
		case c.send <- payload:
			sent++
		default:
			toEvict = append(toEvict, c)
			delete(h.clients, c)
		}
		h.mu.Unlock()
	}

	// Close evicted clients' send channels outside the lock.
	for _, c := range toEvict {
		close(c.send)
		slog.Warn("ws dropped slow client", "room", h.roomCode)
	}
	slog.Info("ws broadcast", "room", h.roomCode, "sent", sent, "dropped", len(toEvict))
}

// Empty reports whether the hub has no connected clients.
func (h *Hub) Empty() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients) == 0
}

// sendToOne pushes the current room state to a single client (non-blocking).
func (h *Hub) sendToOne(c *Client) {
	payload := h.buildPayload(c.token)
	if payload == nil {
		return
	}
	select {
	case c.send <- payload:
	default:
	}
}

// buildPayload builds the per-client wire payload. The view is built under the
// store's read lock so no *Room pointer escapes the lock boundary.
func (h *Hub) buildPayload(token string) []byte {
	view, err := h.rooms.GetView(h.roomCode, token)
	if err != nil {
		return nil // room gone — safe to ignore
	}
	b, err := json.Marshal(wsEnvelope{Type: "room_state", Data: view})
	if err != nil {
		return nil
	}
	return b
}

// wsEnvelope is the single wire format for all server→client messages.
// The type field enables forward-compatible extension in Phase 6+.
type wsEnvelope struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}
