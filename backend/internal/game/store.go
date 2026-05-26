package game

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/placeholder/wordle-rooms/internal/words"
)

var (
	ErrNotFound        = errors.New("game not found")
	ErrAlreadyFinished = errors.New("game already finished")
	ErrInvalidGuess    = errors.New("invalid guess")
	ErrInvalidWord     = errors.New("not a valid word")
)

// TODO: games leak memory until restart — add TTL sweeping in a future phase.
type Store struct {
	mu    sync.RWMutex
	games map[string]*Game
	words *words.Repository
}

func NewStore(words *words.Repository) *Store {
	return &Store{
		games: make(map[string]*Game),
		words: words,
	}
}

func (s *Store) Create(ctx context.Context, maxGuesses int) (*Game, error) {
	target, err := s.words.RandomTarget(ctx)
	if err != nil {
		return nil, err
	}
	g := &Game{
		ID:         newID(),
		Target:     target,
		MaxGuesses: maxGuesses,
		Status:     "playing",
		Guesses:    []ScoredGuess{},
		CreatedAt:  time.Now(),
	}
	s.mu.Lock()
	s.games[g.ID] = g
	s.mu.Unlock()
	return g, nil
}

func (s *Store) Get(id string) (*Game, bool) {
	s.mu.RLock()
	g, ok := s.games[id]
	s.mu.RUnlock()
	return g, ok
}

func (s *Store) SubmitGuess(ctx context.Context, id, guess string) (*Game, error) {
	guess = strings.ToUpper(strings.TrimSpace(guess))
	if len(guess) != 5 || !isAlpha(guess) {
		return nil, ErrInvalidGuess
	}

	ok, err := s.words.IsValidGuess(ctx, guess)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrInvalidWord
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	g, ok := s.games[id]
	if !ok {
		return nil, ErrNotFound
	}
	if g.Status != "playing" {
		return nil, ErrAlreadyFinished
	}

	scoring := Score(guess, g.Target)
	g.Guesses = append(g.Guesses, ScoredGuess{Word: guess, Scoring: scoring})

	allGreen := true
	for _, s := range scoring {
		if s != "green" {
			allGreen = false
			break
		}
	}

	if allGreen {
		g.Status = "won"
	} else if len(g.Guesses) >= g.MaxGuesses {
		g.Status = "lost"
	}

	return g, nil
}

func isAlpha(s string) bool {
	for _, c := range s {
		if c < 'A' || c > 'Z' {
			return false
		}
	}
	return true
}

// newID returns a 10-character base64url-encoded random ID.
// 8 bytes → 11 base64url chars; we slice to 10 for a tidy ID.
func newID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b)[:10]
}
