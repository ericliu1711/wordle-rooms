package game

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"time"
)

var (
	ErrNotFound        = errors.New("game not found")
	ErrAlreadyFinished = errors.New("game already finished")
	ErrInvalidGuess    = errors.New("invalid guess")
	ErrInvalidWord     = errors.New("not a valid word")
)

// wordRepo is the subset of words.Repository used by the game store.
// Defined as an interface so tests can inject stubs without a real database.
type wordRepo interface {
	RandomTarget(ctx context.Context) (string, error)
	IsValidGuess(ctx context.Context, word string) (bool, error)
}

// Snapshot is a value-type copy of a Game's state, built under the store lock.
// Handlers and tests use this type instead of holding *Game pointers.
type Snapshot struct {
	ID         string
	Length     int
	MaxGuesses int
	Status     string
	Guesses    []ScoredGuess
	Target     string // non-empty only when game is over
}

// TODO: games leak memory until restart — add TTL sweeping in a future phase.
type Store struct {
	mu    sync.RWMutex
	games map[string]*Game
	words wordRepo
}

func NewStore(words wordRepo) *Store {
	return &Store{
		games: make(map[string]*Game),
		words: words,
	}
}

func (s *Store) Create(ctx context.Context, maxGuesses int) (Snapshot, error) {
	target, err := s.words.RandomTarget(ctx)
	if err != nil {
		return Snapshot{}, err
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
	snap := snapshotOf(g)
	s.mu.Unlock()
	return snap, nil
}

func (s *Store) Get(id string) (Snapshot, bool) {
	s.mu.RLock()
	g, ok := s.games[id]
	if !ok {
		s.mu.RUnlock()
		return Snapshot{}, false
	}
	snap := snapshotOf(g)
	s.mu.RUnlock()
	return snap, true
}

func (s *Store) SubmitGuess(ctx context.Context, id, guess string) (Snapshot, error) {
	guess = strings.ToUpper(strings.TrimSpace(guess))
	if len(guess) != 5 || !isAlpha(guess) {
		return Snapshot{}, ErrInvalidGuess
	}

	ok, err := s.words.IsValidGuess(ctx, guess)
	if err != nil {
		return Snapshot{}, err
	}
	if !ok {
		return Snapshot{}, ErrInvalidWord
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	g, ok := s.games[id]
	if !ok {
		return Snapshot{}, ErrNotFound
	}
	if g.Status != "playing" {
		return Snapshot{}, ErrAlreadyFinished
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

	return snapshotOf(g), nil
}

// snapshotOf builds a Snapshot from a *Game. Must be called under the store lock.
func snapshotOf(g *Game) Snapshot {
	guesses := make([]ScoredGuess, len(g.Guesses))
	copy(guesses, g.Guesses)
	snap := Snapshot{
		ID:         g.ID,
		Length:     len(g.Target),
		MaxGuesses: g.MaxGuesses,
		Status:     g.Status,
		Guesses:    guesses,
	}
	if g.Status == "won" || g.Status == "lost" {
		snap.Target = g.Target
	}
	return snap
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
