package api

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/placeholder/wordle-rooms/internal/game"
	"github.com/placeholder/wordle-rooms/internal/room"
)

func NewRouter(gameStore *game.Store, roomStore *room.Store) http.Handler {
	corsOrigin := os.Getenv("CORS_ORIGIN")
	if corsOrigin == "" {
		corsOrigin = "http://localhost:3000"
	}

	r := chi.NewRouter()

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
	rh := &roomHandler{store: roomStore}
	r.Post("/api/rooms", rh.createRoom)
	r.Post("/api/rooms/{code}/join", rh.joinRoom)
	r.Get("/api/rooms/{code}", rh.getRoom)
	r.Post("/api/rooms/{code}/start", rh.startRound)
	r.Post("/api/rooms/{code}/guesses", rh.submitGuess)
	r.Post("/api/rooms/{code}/next-round", rh.nextRound)

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
		slog.Info("request",
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
