package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/placeholder/wordle-rooms/internal/api"
	"github.com/placeholder/wordle-rooms/internal/db"
	"github.com/placeholder/wordle-rooms/internal/game"
	"github.com/placeholder/wordle-rooms/internal/words"
)

func main() {
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
	router := api.NewRouter(gameStore)

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: router,
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

	if err := srv.Shutdown(shutCtx); err != nil {
		slog.Error("shutdown error", "err", err)
	}
	slog.Info("stopped")
}
