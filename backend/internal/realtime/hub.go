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
// If a client's send channel is full, it is evicted (backpressure).
// Broadcast failures for individual clients do not affect others.
func (h *Hub) Broadcast() {
	r, err := h.rooms.Get(h.roomCode)
	if err != nil {
		return // room gone — safe to ignore
	}

	h.mu.Lock()
	var toEvict []*Client
	sent := 0
	for c := range h.clients {
		payload := buildPayload(r, c.token)
		if payload == nil {
			continue
		}
		select {
		case c.send <- payload:
			sent++
		default:
			// Channel full: mark for eviction and remove from hub now so no
			// future broadcast sends to this client.
			toEvict = append(toEvict, c)
			delete(h.clients, c)
		}
	}
	h.mu.Unlock()

	// Close evicted clients' send channels outside the lock. This signals
	// WritePump to send a close frame and exit, which triggers Client.close().
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
	r, err := h.rooms.Get(h.roomCode)
	if err != nil {
		return
	}
	payload := buildPayload(r, c.token)
	if payload == nil {
		return
	}
	select {
	case c.send <- payload:
	default:
	}
}

// wsEnvelope is the single wire format for all server→client messages.
// The type field enables forward-compatible extension in Phase 6+.
type wsEnvelope struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

func buildPayload(r *room.Room, token string) []byte {
	view := room.PlayerView(r, token)
	b, err := json.Marshal(wsEnvelope{Type: "room_state", Data: view})
	if err != nil {
		return nil
	}
	return b
}
