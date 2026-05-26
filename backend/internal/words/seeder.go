package words

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Seed(ctx context.Context, pool *pgxpool.Pool) error {
	var populated bool
	err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM words LIMIT 1)`).Scan(&populated)
	if err != nil {
		return fmt.Errorf("seed: check table: %w", err)
	}
	if populated {
		slog.Info("words table already populated, skipping seed")
		return nil
	}

	start := time.Now()

	guesses := parseWords(validGuessesData)
	if len(guesses) == 0 {
		return fmt.Errorf("seed: no valid guesses parsed")
	}

	rows := make([][]any, len(guesses))
	for i, w := range guesses {
		rows[i] = []any{w, false}
	}

	n, err := pool.CopyFrom(ctx,
		pgx.Identifier{"words"},
		[]string{"word", "is_answer"},
		pgx.CopyFromRows(rows),
	)
	if err != nil {
		return fmt.Errorf("seed: insert guesses: %w", err)
	}

	answers := parseWords(answersData)
	if len(answers) == 0 {
		return fmt.Errorf("seed: no answers parsed")
	}

	_, err = pool.Exec(ctx,
		`UPDATE words SET is_answer = true WHERE word = ANY($1)`,
		answers,
	)
	if err != nil {
		return fmt.Errorf("seed: mark answers: %w", err)
	}

	slog.Info("seeded words",
		"valid_guesses", n,
		"answers", len(answers),
		"took", time.Since(start).Round(time.Millisecond).String(),
	)
	return nil
}

func parseWords(data []byte) []string {
	var words []string
	sc := bufio.NewScanner(bytes.NewReader(data))
	for sc.Scan() {
		w := strings.ToUpper(strings.TrimSpace(sc.Text()))
		if len(w) == 5 {
			words = append(words, w)
		}
	}
	return words
}
