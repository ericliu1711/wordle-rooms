package room

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/placeholder/wordle-rooms/internal/game"
	"github.com/placeholder/wordle-rooms/internal/words"
)

// TODO V2: per-room mutex if global mutex becomes contended under high concurrent room load.
type Store struct {
	mu    sync.RWMutex
	rooms map[string]*Room
	words *words.Repository
}

func NewStore(w *words.Repository) *Store {
	return &Store{
		rooms: make(map[string]*Room),
		words: w,
	}
}

func (s *Store) Create(ctx context.Context, hostName string) (*Room, string, error) {
	hostName = strings.TrimSpace(hostName)
	if err := validateName(hostName); err != nil {
		return nil, "", err
	}

	hostToken := GenerateToken()
	now := time.Now()

	player := &Player{
		Token:    hostToken,
		Name:     hostName,
		JoinedAt: now,
		Guesses:  []game.ScoredGuess{},
		Status:   PlayerPlaying,
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	var code string
	for i := 0; i < 5; i++ {
		c := GenerateCode()
		if _, exists := s.rooms[c]; !exists {
			code = c
			break
		}
	}
	if code == "" {
		return nil, "", ErrCodeCollision
	}

	r := &Room{
		Code:       code,
		HostToken:  hostToken,
		Status:     StatusLobby,
		Length:     5,
		MaxGuesses: 6,
		Players:    map[string]*Player{hostToken: player},
		CreatedAt:  now,
	}
	s.rooms[code] = r
	return r, hostToken, nil
}

func (s *Store) Get(code string) (*Room, error) {
	s.mu.RLock()
	r, ok := s.rooms[code]
	s.mu.RUnlock()
	if !ok {
		return nil, ErrRoomNotFound
	}
	return r, nil
}

func (s *Store) Join(ctx context.Context, code, name string) (*Room, string, error) {
	name = strings.TrimSpace(name)
	if err := validateName(name); err != nil {
		return nil, "", err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.rooms[code]
	if !ok {
		return nil, "", ErrRoomNotFound
	}
	if r.Status != StatusLobby {
		return nil, "", ErrRoomNotJoinable
	}
	for _, p := range r.Players {
		if strings.EqualFold(p.Name, name) {
			return nil, "", ErrNameTaken
		}
	}

	token := GenerateToken()
	now := time.Now()
	r.Players[token] = &Player{
		Token:    token,
		Name:     name,
		JoinedAt: now,
		Guesses:  []game.ScoredGuess{},
		Status:   PlayerPlaying,
	}
	return r, token, nil
}

func (s *Store) StartRound(ctx context.Context, code, token string) (*Room, error) {
	target, err := s.words.RandomTarget(ctx)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.rooms[code]
	if !ok {
		return nil, ErrRoomNotFound
	}
	if token != r.HostToken {
		return nil, ErrNotHost
	}
	if r.Status != StatusLobby {
		return nil, ErrCannotStart
	}

	now := time.Now()
	r.Target = target
	r.Status = StatusPlaying
	r.StartedAt = &now
	r.FinishedAt = nil

	for _, p := range r.Players {
		p.Guesses = []game.ScoredGuess{}
		p.Status = PlayerPlaying
		p.SolvedAt = nil
	}
	return r, nil
}

func (s *Store) SubmitGuess(ctx context.Context, code, token, guess string) (*Room, error) {
	guess = strings.ToUpper(strings.TrimSpace(guess))
	if len(guess) != 5 || !isAlpha(guess) {
		return nil, game.ErrInvalidGuess
	}

	// Dictionary check before acquiring lock — avoids holding mutex across IO.
	ok, err := s.words.IsValidGuess(ctx, guess)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, game.ErrInvalidWord
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.rooms[code]
	if !ok {
		return nil, ErrRoomNotFound
	}
	if r.Status != StatusPlaying {
		return nil, ErrNotYourTurn
	}
	player, ok := r.Players[token]
	if !ok {
		return nil, ErrNotInRoom
	}
	if player.Status != PlayerPlaying {
		return nil, ErrNotYourTurn
	}

	scoring := game.Score(guess, r.Target)
	player.Guesses = append(player.Guesses, game.ScoredGuess{Word: guess, Scoring: scoring})

	allGreen := true
	for _, sc := range scoring {
		if sc != "green" {
			allGreen = false
			break
		}
	}
	if allGreen {
		player.Status = PlayerSolved
		now := time.Now()
		player.SolvedAt = &now
	} else if len(player.Guesses) >= r.MaxGuesses {
		player.Status = PlayerOut
	}

	// Atomic round-end check: if every player is done, finish the round.
	allDone := true
	for _, p := range r.Players {
		if p.Status == PlayerPlaying {
			allDone = false
			break
		}
	}
	if allDone {
		r.Status = StatusFinished
		now := time.Now()
		r.FinishedAt = &now
	}

	return r, nil
}

func (s *Store) NextRound(ctx context.Context, code, token string) (*Room, error) {
	target, err := s.words.RandomTarget(ctx)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.rooms[code]
	if !ok {
		return nil, ErrRoomNotFound
	}
	if token != r.HostToken {
		return nil, ErrNotHost
	}
	if r.Status != StatusFinished {
		return nil, ErrCannotNextRound
	}

	now := time.Now()
	r.Target = target
	r.Status = StatusPlaying
	r.StartedAt = &now
	r.FinishedAt = nil

	for _, p := range r.Players {
		p.Guesses = []game.ScoredGuess{}
		p.Status = PlayerPlaying
		p.SolvedAt = nil
	}
	return r, nil
}

func validateName(name string) error {
	if len(name) == 0 || len(name) > 20 {
		return ErrInvalidName
	}
	hasNonSpace := false
	for _, c := range name {
		if c != ' ' {
			hasNonSpace = true
		}
		if !((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == ' ') {
			return ErrInvalidName
		}
	}
	if !hasNonSpace {
		return ErrInvalidName
	}
	return nil
}

func isAlpha(s string) bool {
	for _, c := range s {
		if c < 'A' || c > 'Z' {
			return false
		}
	}
	return true
}
