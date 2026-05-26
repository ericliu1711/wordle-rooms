package realtime

import (
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 30 * time.Second // must be less than pongWait
	maxMessageSize = 1024
)

// Client represents a single WebSocket connection from a player in a room.
type Client struct {
	conn     *websocket.Conn
	token    string
	roomCode string
	send     chan []byte // buffered outgoing channel; capacity 16
	hub      *Hub
	registry *HubRegistry
	once     sync.Once
}

// close is idempotent: the first call unregisters, closes the connection, and
// asks the registry to clean up the hub if it is now empty.
func (c *Client) close() {
	c.once.Do(func() {
		c.hub.Unregister(c)
		c.conn.Close()
		c.registry.CleanupIfEmpty(c.roomCode)
	})
}

// ReadPump drains inbound WebSocket frames. Clients send no meaningful messages
// in Phase 5 (all actions are HTTP), but the pump must run to:
//   - detect close frames and trigger cleanup
//   - extend the read deadline on each pong (keeping the connection alive)
//   - discard unexpected text frames
func (c *Client) ReadPump() {
	defer c.close()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		mt, msg, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				slog.Debug("ws unexpected close", "room", c.roomCode, "err", err)
			}
			return
		}
		if mt == websocket.TextMessage {
			slog.Debug("ws unexpected client message (discarding)", "room", c.roomCode, "msg", string(msg))
		}
	}
}

// WritePump drains the outgoing channel onto the WebSocket and sends periodic
// protocol-level pings to keep the connection alive through NATs and proxies.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// send channel was closed by the backpressure eviction path.
				c.conn.WriteMessage(websocket.CloseMessage, []byte{}) //nolint:errcheck
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
