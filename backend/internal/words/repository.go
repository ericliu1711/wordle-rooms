package words

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNoTarget = errors.New("no target word available")

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) RandomTarget(ctx context.Context) (string, error) {
	var word string
	err := r.pool.QueryRow(ctx,
		`SELECT word FROM words WHERE is_answer = true ORDER BY RANDOM() LIMIT 1`,
	).Scan(&word)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNoTarget
	}
	if err != nil {
		return "", fmt.Errorf("random target: %w", err)
	}
	return word, nil
}

func (r *Repository) IsValidGuess(ctx context.Context, word string) (bool, error) {
	word = strings.ToUpper(strings.TrimSpace(word))
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM words WHERE word = $1)`, word,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("valid guess check: %w", err)
	}
	return exists, nil
}
