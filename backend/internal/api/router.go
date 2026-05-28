package api

import (
	"bufio"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"runtime/debug"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/ericliu1711/wordle-rooms/internal/game"
	"github.com/ericliu1711/wordle-rooms/internal/realtime"
	"github.com/ericliu1711/wordle-rooms/internal/room"
)

func NewRouter(gameStore *game.Store, roomStore *room.Store, registry *realtime.HubRegistry) http.Handler {
	corsOrigin := os.Getenv("CORS_ORIGIN")
	if corsOrigin == "" {
		corsOrigin = "http://localhost:3000"
	}

	r := chi.NewRouter()

	r.Use(recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{corsOrigin},
		AllowedMethods: []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type", "X-Player-Token"},
	}))

	r.Use(requestLogger)

	// Single-player game routes (Phase 2)
	gh := &handler{store: gameStore}
	r.Post("/api/games", gh.createGame)
	r.Get("/api/games/{gameId}", gh.getGame)
	r.Post("/api/games/{gameId}/guesses", gh.submitGuess)

	// Multiplayer room routes (Phase 4)
	rh := &roomHandler{store: roomStore, realtime: registry}
	r.Post("/api/rooms", rh.createRoom)
	r.Post("/api/rooms/{code}/join", rh.joinRoom)
	r.Get("/api/rooms/{code}", rh.getRoom)
	r.Post("/api/rooms/{code}/start", rh.startRound)
	r.Post("/api/rooms/{code}/guesses", rh.submitGuess)
	r.Post("/api/rooms/{code}/next-round", rh.nextRound)
	r.Post("/api/rooms/{code}/leave", rh.leaveRoom)

	// WebSocket upgrade (Phase 5)
	wh := newRealtimeHandler(registry, roomStore, corsOrigin)
	r.Get("/api/rooms/{code}/ws", wh.wsUpgrade)

	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	return r
}

func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rw := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		next.ServeHTTP(rw, r)
		// Health-check probes (Render hits this every few seconds) are logged
		// at Debug to avoid drowning out real traffic in production logs.
		logFn := slog.Info
		if r.URL.Path == "/api/health" {
			logFn = slog.Debug
		}
		logFn("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.status,
			"duration", time.Since(start).String(),
		)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (sr *statusRecorder) WriteHeader(code int) {
	sr.status = code
	sr.ResponseWriter.WriteHeader(code)
}

// Hijack forwards to the underlying ResponseWriter so that gorilla/websocket
// can take over the TCP connection for the WS upgrade (HTTP 101).
func (sr *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := sr.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("underlying ResponseWriter does not implement http.Hijacker")
	}
	return h.Hijack()
}

func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rc := recover(); rc != nil {
				slog.Error("handler panic", "err", rc, "stack", string(debug.Stack()))
				http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
