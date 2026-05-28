package realtime

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/ericliu1711/wordle-rooms/internal/room"
)

// HubRegistry lazily creates and cleans up Hubs keyed by room code.
// A Hub is created on the first client connection and removed when the last
// client disconnects.
type HubRegistry struct {
	mu    sync.Mutex
	hubs  map[string]*Hub
	rooms *room.Store
	ctx   context.Context // cancelled on server shutdown; stops grace goroutines
	wg    sync.WaitGroup  // tracks in-flight grace-period goroutines
}

func NewHubRegistry(ctx context.Context, rooms *room.Store) *HubRegistry {
	slog.Info("realtime registry initialized")
	return &HubRegistry{
		hubs:  make(map[string]*Hub),
		rooms: rooms,
		ctx:   ctx,
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
	// Restore player to active before registering so the initial push
	// already reflects the correct (playing) state.
	r.OnClientReconnect(roomCode, token)

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

// OnClientDisconnect marks the player disconnected immediately and schedules
// a FinalizeDisconnect call after the 15-second grace period.
// The goroutine exits early if the server is shutting down.
func (r *HubRegistry) OnClientDisconnect(roomCode, token string) {
	changed, _ := r.rooms.MarkPlayerDisconnected(roomCode, token)
	if changed {
		r.BroadcastRoom(roomCode)
	}

	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		select {
		case <-time.After(15 * time.Second):
			changed, _ := r.rooms.FinalizeDisconnect(roomCode, token)
			if changed {
				r.BroadcastRoom(roomCode)
			}
		case <-r.ctx.Done():
			// Server shutting down — skip finalization.
		}
	}()
}

// OnClientReconnect restores a disconnected player to active status.
func (r *HubRegistry) OnClientReconnect(roomCode, token string) {
	changed, _ := r.rooms.MarkPlayerReconnected(roomCode, token)
	if changed {
		r.BroadcastRoom(roomCode)
	}
}

// Shutdown closes every connected client's send channel, causing each
// WritePump to emit a clean WebSocket close frame before returning.
// It also waits for in-flight grace-period goroutines (which exit early
// because the registry ctx is already cancelled by the time Shutdown runs).
// Blocks until all work finishes or ctx is done.
func (r *HubRegistry) Shutdown(ctx context.Context) {
	r.mu.Lock()
	var clients []*Client
	for _, h := range r.hubs {
		h.mu.Lock()
		for c := range h.clients {
			clients = append(clients, c)
		}
		h.mu.Unlock()
	}
	r.mu.Unlock()

	done := make(chan struct{})
	go func() {
		for _, c := range clients {
			c.close()
		}
		r.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-ctx.Done():
		slog.Warn("realtime shutdown timed out", "remaining", len(clients))
	}
}
