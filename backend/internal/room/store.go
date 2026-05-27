package room

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/placeholder/wordle-rooms/internal/game"
)

// wordRepo is the subset of words.Repository used by the room store.
// Defined as an interface so tests can inject stubs without a real database.
const disconnectGrace = 15 * time.Second

type wordRepo interface {
	RandomTarget(ctx context.Context) (string, error)
	IsValidGuess(ctx context.Context, word string) (bool, error)
}

// isBlockingRound returns true if the player still needs to act for the
// round to end — i.e. they are playing, or disconnected within the grace window.
func isBlockingRound(p *Player) bool {
	if p.Status == PlayerPlaying {
		return true
	}
	if p.Status == PlayerDisconnected && p.DisconnectedAt != nil {
		return time.Since(*p.DisconnectedAt) < disconnectGrace
	}
	return false
}

type Store struct {
	mu    sync.RWMutex
	rooms map[string]*Room
	words wordRepo
}

func NewStore(w wordRepo) *Store {
	return &Store{
		rooms: make(map[string]*Room),
		words: w,
	}
}

// Create creates a new room and returns the caller's PlayerView (built under the write lock).
func (s *Store) Create(ctx context.Context, hostName string) (PlayerViewResponse, string, error) {
	hostName = strings.TrimSpace(hostName)
	if err := validateName(hostName); err != nil {
		return PlayerViewResponse{}, "", err
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
		return PlayerViewResponse{}, "", ErrCodeCollision
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
	return PlayerView(r, hostToken), hostToken, nil
}

// GetView looks up a room and returns the caller's view, built under the read lock.
// An empty callerToken produces a stranger view (no guesses, no isYou).
func (s *Store) GetView(code, callerToken string) (PlayerViewResponse, error) {
	s.mu.RLock()
	r, ok := s.rooms[code]
	if !ok {
		s.mu.RUnlock()
		return PlayerViewResponse{}, ErrRoomNotFound
	}
	view := PlayerView(r, callerToken)
	s.mu.RUnlock()
	return view, nil
}

// ValidatePlayer checks that the room exists and the token belongs to a player in it.
// Used by the WebSocket upgrade handler before upgrading the connection.
func (s *Store) ValidatePlayer(code, token string) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.rooms[code]
	if !ok {
		return ErrRoomNotFound
	}
	if _, ok := r.Players[token]; !ok {
		return ErrNotInRoom
	}
	return nil
}

// Join adds a player to the room and returns their view (built under the write lock).
func (s *Store) Join(ctx context.Context, code, name string) (PlayerViewResponse, string, error) {
	name = strings.TrimSpace(name)
	if err := validateName(name); err != nil {
		return PlayerViewResponse{}, "", err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.rooms[code]
	if !ok {
		return PlayerViewResponse{}, "", ErrRoomNotFound
	}
	if r.Status != StatusLobby {
		return PlayerViewResponse{}, "", ErrRoomNotJoinable
	}
	for _, p := range r.Players {
		if strings.EqualFold(p.Name, name) {
			return PlayerViewResponse{}, "", ErrNameTaken
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
	return PlayerView(r, token), token, nil
}

// StartRound starts a new round and returns the caller's view (built under the write lock).
func (s *Store) StartRound(ctx context.Context, code, token string) (PlayerViewResponse, error) {
	target, err := s.words.RandomTarget(ctx)
	if err != nil {
		return PlayerViewResponse{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.rooms[code]
	if !ok {
		return PlayerViewResponse{}, ErrRoomNotFound
	}
	if token != r.HostToken {
		return PlayerViewResponse{}, ErrNotHost
	}
	if r.Status != StatusLobby {
		return PlayerViewResponse{}, ErrCannotStart
	}
	if len(r.Players) < 2 {
		return PlayerViewResponse{}, ErrNotEnoughPlayers
	}

	now := time.Now()
	r.Target = target
	r.Status = StatusPlaying
	r.StartedAt = &now
	r.FinishedAt = nil

	for _, p := range r.Players {
		p.Guesses = []game.ScoredGuess{}
		if p.Status != PlayerDisconnected {
			p.Status = PlayerPlaying
		}
		p.SolvedAt = nil
	}
	return PlayerView(r, token), nil
}

// SubmitGuess records a guess and returns the player's view (built under the write lock).
func (s *Store) SubmitGuess(ctx context.Context, code, token, guess string) (PlayerViewResponse, error) {
	guess = strings.ToUpper(strings.TrimSpace(guess))
	if len(guess) != 5 || !isAlpha(guess) {
		return PlayerViewResponse{}, game.ErrInvalidGuess
	}

	// Dictionary check before acquiring lock — avoids holding mutex across IO.
	ok, err := s.words.IsValidGuess(ctx, guess)
	if err != nil {
		return PlayerViewResponse{}, err
	}
	if !ok {
		return PlayerViewResponse{}, game.ErrInvalidWord
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.rooms[code]
	if !ok {
		return PlayerViewResponse{}, ErrRoomNotFound
	}
	if r.Status != StatusPlaying {
		return PlayerViewResponse{}, ErrNotYourTurn
	}
	player, ok := r.Players[token]
	if !ok {
		return PlayerViewResponse{}, ErrNotInRoom
	}
	if player.Status != PlayerPlaying {
		return PlayerViewResponse{}, ErrNotYourTurn
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

	s.checkAllDone(r)

	return PlayerView(r, token), nil
}

// NextRound resets the room for a new round and returns the caller's view (built under the write lock).
func (s *Store) NextRound(ctx context.Context, code, token string) (PlayerViewResponse, error) {
	target, err := s.words.RandomTarget(ctx)
	if err != nil {
		return PlayerViewResponse{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.rooms[code]
	if !ok {
		return PlayerViewResponse{}, ErrRoomNotFound
	}
	if token != r.HostToken {
		return PlayerViewResponse{}, ErrNotHost
	}
	if r.Status != StatusFinished {
		return PlayerViewResponse{}, ErrCannotNextRound
	}

	now := time.Now()
	r.Target = target
	r.Status = StatusPlaying
	r.StartedAt = &now
	r.FinishedAt = nil

	for _, p := range r.Players {
		p.Guesses = []game.ScoredGuess{}
		if p.Status != PlayerDisconnected {
			p.Status = PlayerPlaying
		}
		p.SolvedAt = nil
	}
	return PlayerView(r, token), nil
}

// Leave is called when a player intentionally clicks Leave.
// Marks disconnected immediately with no grace period and broadcasts-ready state.
func (s *Store) Leave(code, token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.rooms[code]
	if !ok {
		return ErrRoomNotFound
	}
	p, ok := r.Players[token]
	if !ok {
		return ErrNotInRoom
	}
	if p.Status == PlayerDisconnected {
		return nil
	}

	// Set DisconnectedAt in the past so grace period is already expired.
	pastGrace := time.Now().Add(-disconnectGrace)
	p.Status = PlayerDisconnected
	p.DisconnectedAt = &pastGrace

	if token == r.HostToken {
		s.migrateHost(r)
	}
	s.checkAllDone(r)
	return nil
}

// MarkPlayerDisconnected marks a player as disconnected after a WS drop.
// Affects players who are actively playing or waiting for the next round.
// Returns true if state changed and a broadcast is warranted.
func (s *Store) MarkPlayerDisconnected(code, token string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.rooms[code]
	if !ok {
		return false, nil
	}
	p, ok := r.Players[token]
	if !ok {
		return false, nil
	}
	if p.Status != PlayerPlaying && p.Status != PlayerWaiting {
		return false, nil
	}

	now := time.Now()
	p.Status = PlayerDisconnected
	p.DisconnectedAt = &now
	return true, nil
}

// FinalizeDisconnect is called after the grace period expires.
// If the player is still disconnected, migrates host if needed and ends
// the round if all remaining players are done.
// Returns true if state changed and a broadcast is warranted.
func (s *Store) FinalizeDisconnect(code, token string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.rooms[code]
	if !ok {
		return false, nil
	}
	p, ok := r.Players[token]
	if !ok {
		return false, nil
	}
	if p.Status != PlayerDisconnected {
		return false, nil // reconnected during grace period
	}

	changed := false
	if token == r.HostToken {
		s.migrateHost(r)
		changed = true
	}
	if s.checkAllDone(r) {
		changed = true
	}
	return changed, nil
}

// MarkPlayerReconnected restores a disconnected player to playing status
// if the round (or lobby) is still active.
// Returns true if state changed and a broadcast is warranted.
func (s *Store) MarkPlayerReconnected(code, token string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.rooms[code]
	if !ok {
		return false, nil
	}
	p, ok := r.Players[token]
	if !ok {
		return false, nil
	}
	if p.Status != PlayerDisconnected {
		return false, nil
	}
	if r.Status == StatusFinished {
		p.Status = PlayerWaiting
		p.DisconnectedAt = nil
		return true, nil
	}

	p.Status = PlayerPlaying
	p.DisconnectedAt = nil
	return true, nil
}

// migrateHost picks the next non-disconnected player by JoinedAt and assigns
// them as host. Must be called under the write lock.
func (s *Store) migrateHost(r *Room) {
	var next *Player
	for _, p := range r.Players {
		if p.Token == r.HostToken || p.Status == PlayerDisconnected {
			continue
		}
		if next == nil || p.JoinedAt.Before(next.JoinedAt) {
			next = p
		}
	}
	if next != nil {
		r.HostToken = next.Token
	}
}

// checkAllDone ends the round if no player is still blocking it.
// Must be called under the write lock. Returns true if the round was ended.
func (s *Store) checkAllDone(r *Room) bool {
	if r.Status != StatusPlaying {
		return false
	}
	for _, p := range r.Players {
		if isBlockingRound(p) {
			return false
		}
	}
	now := time.Now()
	r.Status = StatusFinished
	r.FinishedAt = &now
	return true
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
