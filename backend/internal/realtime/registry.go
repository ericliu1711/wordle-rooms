package realtime

import (
	"log/slog"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/placeholder/wordle-rooms/internal/room"
)

// HubRegistry lazily creates and cleans up Hubs keyed by room code.
// A Hub is created on the first client connection and removed when the last
// client disconnects.
//
// TODO V2: sharded locks if hub creation becomes contended under many concurrent rooms.
type HubRegistry struct {
	mu    sync.Mutex
	hubs  map[string]*Hub
	rooms *room.Store
}

func NewHubRegistry(rooms *room.Store) *HubRegistry {
	slog.Info("realtime registry initialized")
	return &HubRegistry{
		hubs:  make(map[string]*Hub),
		rooms: rooms,
	}
}

// GetOrCreate returns the existing hub for roomCode, or creates one.
func (r *HubRegistry) GetOrCreate(roomCode string) *Hub {
	r.mu.Lock()
	defer r.mu.Unlock()
	if h, ok := r.hubs[roomCode]; ok {
		return h
	}
	h := newHub(roomCode, r.rooms)
	r.hubs[roomCode] = h
	slog.Info("realtime hub created", "room", roomCode)
	return h
}

// BroadcastRoom pushes current room state to all clients in the room.
// No-op if no hub exists (nobody connected).
func (r *HubRegistry) BroadcastRoom(roomCode string) {
	r.mu.Lock()
	h, ok := r.hubs[roomCode]
	r.mu.Unlock()
	if !ok {
		return
	}
	h.Broadcast()
}

// CleanupIfEmpty removes the hub from the registry if it has no clients.
// Called from Client.close() after every disconnect.
func (r *HubRegistry) CleanupIfEmpty(roomCode string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	h, ok := r.hubs[roomCode]
	if !ok {
		return
	}
	if h.Empty() {
		delete(r.hubs, roomCode)
		slog.Info("realtime hub removed", "room", roomCode)
	}
}

// Connect creates a Client for the upgraded connection, registers it with the
// room's hub (creating the hub if needed), and starts its read/write pumps.
// This is the single entry point called by the WS upgrade handler.
func (r *HubRegistry) Connect(conn *websocket.Conn, token, roomCode string) {
	hub := r.GetOrCreate(roomCode)
	c := &Client{
		conn:     conn,
		token:    token,
		roomCode: roomCode,
		send:     make(chan []byte, 16),
		hub:      hub,
		registry: r,
	}
	hub.Register(c)
	go c.ReadPump()
	go c.WritePump()
}
