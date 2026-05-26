package room

import (
	"time"

	"github.com/placeholder/wordle-rooms/internal/game"
)

type Status string

const (
	StatusLobby    Status = "lobby"
	StatusPlaying  Status = "playing"
	StatusFinished Status = "finished"
)

type PlayerStatus string

const (
	PlayerPlaying PlayerStatus = "playing"
	PlayerSolved  PlayerStatus = "solved"
	PlayerOut     PlayerStatus = "out"
)

type Room struct {
	Code       string
	HostToken  string
	Status     Status
	Length     int
	MaxGuesses int
	Target     string             // empty in lobby, hidden while playing, exposed when finished
	Players    map[string]*Player // keyed by player token
	StartedAt  *time.Time
	FinishedAt *time.Time
	CreatedAt  time.Time
}

type Player struct {
	Token    string
	Name     string
	JoinedAt time.Time
	Guesses  []game.ScoredGuess
	Status   PlayerStatus
	SolvedAt *time.Time
}
