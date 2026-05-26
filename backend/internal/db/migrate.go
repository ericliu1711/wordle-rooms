package db

import (
	"embed"
	"errors"
	"fmt"
	"log/slog"

	"github.com/golang-migrate/migrate/v4"
	pgxmigrate "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
)

// Migrations are embedded from migrations/ (sibling directory to this file).
// This avoids the need for a separate migrations binary or CLI.
//
//go:embed migrations/*.sql
var migrationsFS embed.FS

func Migrate(pool *pgxpool.Pool) error {
	sqlDB := stdlib.OpenDBFromPool(pool)

	driver, err := pgxmigrate.WithInstance(sqlDB, &pgxmigrate.Config{})
	if err != nil {
		return fmt.Errorf("migrate: create driver: %w", err)
	}

	src, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("migrate: load source: %w", err)
	}

	m, err := migrate.NewWithInstance("iofs", src, "pgx5", driver)
	if err != nil {
		return fmt.Errorf("migrate: init: %w", err)
	}

	if err := m.Up(); err != nil {
		if errors.Is(err, migrate.ErrNoChange) {
			slog.Info("no migrations to apply")
			return nil
		}
		return fmt.Errorf("migrate: up: %w", err)
	}

	version, _, _ := m.Version()
	slog.Info("applied migrations", "version", version)
	return nil
}
