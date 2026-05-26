package room

import (
	"slices"
	"time"

	"github.com/placeholder/wordle-rooms/internal/game"
)

// PlayerView builds the JSON response for a specific caller.
// This is the single place where spoiler-hiding and field filtering happen.
// All handlers must call this; no handler should construct room JSON directly.
func PlayerView(r *Room, callerToken string) PlayerViewResponse {
	isHost := callerToken != "" && callerToken == r.HostToken

	// Sort players by JoinedAt for stable ordering.
	players := make([]*Player, 0, len(r.Players))
	for _, p := range r.Players {
		players = append(players, p)
	}
	slices.SortFunc(players, func(a, b *Player) int {
		return a.JoinedAt.Compare(b.JoinedAt)
	})

	viewPlayers := make([]PlayerViewPlayer, 0, len(players))
	for _, p := range players {
		isYou := callerToken != "" && p.Token == callerToken
		isPlayerHost := p.Token == r.HostToken

		vp := PlayerViewPlayer{
			Name:       p.Name,
			Status:     p.Status,
			GuessCount: len(p.Guesses),
			SolvedAt:   p.SolvedAt,
			IsYou:      isYou,
			IsHost:     isPlayerHost,
		}

		// Guesses revealed only to the player themselves, or to everyone when finished.
		if isYou || r.Status == StatusFinished {
			vp.Guesses = p.Guesses
		}

		viewPlayers = append(viewPlayers, vp)
	}

	resp := PlayerViewResponse{
		Code:       r.Code,
		Status:     r.Status,
		Length:     r.Length,
		MaxGuesses: r.MaxGuesses,
		StartedAt:  r.StartedAt,
		FinishedAt: r.FinishedAt,
		YouAreHost: isHost,
		Players:    viewPlayers,
	}

	// HostToken only echoed back to the host themselves.
	if isHost {
		resp.HostToken = r.HostToken
	}

	// Target revealed only when the round is over.
	if r.Status == StatusFinished {
		t := r.Target
		resp.Target = &t
	}

	// Ranking only when finished.
	if r.Status == StatusFinished {
		resp.Ranking = ComputeRanking(r)
	}

	return resp
}

// ---- response types --------------------------------------------------------

type PlayerViewResponse struct {
	Code       string             `json:"code"`
	Status     Status             `json:"status"`
	HostToken  string             `json:"hostToken,omitempty"`
	Length     int                `json:"length"`
	MaxGuesses int                `json:"maxGuesses"`
	StartedAt  *time.Time         `json:"startedAt"`
	FinishedAt *time.Time         `json:"finishedAt"`
	Target     *string            `json:"target"`
	YouAreHost bool               `json:"youAreHost"`
	Players    []PlayerViewPlayer `json:"players"`
	Ranking    []RankingEntry     `json:"ranking,omitempty"`
}

type PlayerViewPlayer struct {
	Name       string             `json:"name"`
	Status     PlayerStatus       `json:"status"`
	GuessCount int                `json:"guessCount"`
	SolvedAt   *time.Time         `json:"solvedAt"`
	IsYou      bool               `json:"isYou"`
	IsHost     bool               `json:"isHost"`
	Guesses    []game.ScoredGuess `json:"guesses,omitempty"`
}
