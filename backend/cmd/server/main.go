package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ericliu1711/wordle-rooms/internal/api"
	"github.com/ericliu1711/wordle-rooms/internal/db"
	"github.com/ericliu1711/wordle-rooms/internal/game"
	"github.com/ericliu1711/wordle-rooms/internal/realtime"
	"github.com/ericliu1711/wordle-rooms/internal/room"
	"github.com/ericliu1711/wordle-rooms/internal/words"
)

func main() {
	if os.Getenv("APP_ENV") == "production" {
		slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := db.NewPool(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		slog.Error("database connection failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	slog.Info("connected to postgres")

	if err := db.Migrate(pool); err != nil {
		slog.Error("migrations failed", "err", err)
		os.Exit(1)
	}

	wordsRepo := words.NewRepository(pool)

	if err := words.Seed(ctx, pool); err != nil {
		slog.Error("seed failed", "err", err)
		os.Exit(1)
	}

	gameStore := game.NewStore(wordsRepo)
	roomStore := room.NewStore(wordsRepo)
	roomStore.StartSweeper(ctx, 10*time.Minute, 1*time.Hour)
	realtimeRegistry := realtime.NewHubRegistry(ctx, roomStore)
	router := api.NewRouter(gameStore, roomStore, realtimeRegistry)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           router,
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		slog.Info("server starting", "port", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-stop
	slog.Info("shutting down")

	shutCtx, shutCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutCancel()

	// Close WebSocket connections cleanly before stopping HTTP.
	wsCtx, wsCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer wsCancel()
	realtimeRegistry.Shutdown(wsCtx)

	if err := srv.Shutdown(shutCtx); err != nil {
		slog.Error("shutdown error", "err", err)
	}
	slog.Info("stopped")
}
