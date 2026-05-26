package room

import (
	"testing"
	"time"

	"github.com/placeholder/wordle-rooms/internal/game"
)

func TestPlayerView_SpoilerHiding(t *testing.T) {
	now := time.Now()
	tokenA := "tokenA1234567890"
	tokenB := "tokenB1234567890"

	r := &Room{
		Code:       "TEST",
		HostToken:  tokenA,
		Status:     StatusPlaying,
		Length:     5,
		MaxGuesses: 6,
		Target:     "CRANE",
		StartedAt:  &now,
		CreatedAt:  now,
		Players: map[string]*Player{
			tokenA: {
				Token:    tokenA,
				Name:     "Alice",
				JoinedAt: now,
				Guesses: []game.ScoredGuess{
					{Word: "STARE", Scoring: []string{"gray", "gray", "green", "gray", "green"}},
				},
				Status: PlayerPlaying,
			},
			tokenB: {
				Token:    tokenB,
				Name:     "Bob",
				JoinedAt: now.Add(time.Second),
				Guesses: []game.ScoredGuess{
					{Word: "AUDIO", Scoring: []string{"green", "gray", "gray", "gray", "gray"}},
					{Word: "CRANE", Scoring: []string{"green", "green", "green", "green", "green"}},
				},
				Status: PlayerSolved,
			},
		},
	}

	t.Run("Alice sees own guesses, not Bob's", func(t *testing.T) {
		view := PlayerView(r, tokenA)

		if view.Target != nil {
			t.Error("target should be nil while playing")
		}
		if view.Ranking != nil {
			t.Error("ranking should be absent while playing")
		}
		if !view.YouAreHost {
			t.Error("Alice should be identified as host")
		}
		if view.HostToken != tokenA {
			t.Error("HostToken should be echoed back to host")
		}

		for _, p := range view.Players {
			if p.IsYou {
				// Alice's own view
				if p.Name != "Alice" {
					t.Errorf("IsYou player should be Alice, got %q", p.Name)
				}
				if len(p.Guesses) == 0 {
					t.Error("caller's own guesses should be visible")
				}
			} else {
				// Bob's view from Alice's perspective
				if p.Name != "Bob" {
					t.Errorf("other player should be Bob, got %q", p.Name)
				}
				if p.Guesses != nil {
					t.Errorf("other player's guesses should be hidden mid-round, got %v", p.Guesses)
				}
				if p.GuessCount != 2 {
					t.Errorf("other player's guess count should be visible, got %d", p.GuessCount)
				}
			}
		}
	})

	t.Run("Bob sees own guesses, not Alice's", func(t *testing.T) {
		view := PlayerView(r, tokenB)

		if view.YouAreHost {
			t.Error("Bob should not be identified as host")
		}
		if view.HostToken != "" {
			t.Error("HostToken should not be echoed to non-host")
		}

		for _, p := range view.Players {
			if p.IsYou {
				if p.Name != "Bob" {
					t.Errorf("IsYou player should be Bob, got %q", p.Name)
				}
				if len(p.Guesses) != 2 {
					t.Errorf("Bob should see his 2 guesses, got %d", len(p.Guesses))
				}
			} else {
				if p.Guesses != nil {
					t.Errorf("Alice's guesses should be hidden from Bob mid-round, got %v", p.Guesses)
				}
			}
		}
	})

	t.Run("stranger sees no guesses", func(t *testing.T) {
		view := PlayerView(r, "")
		for _, p := range view.Players {
			if p.Guesses != nil {
				t.Errorf("stranger should see no guesses, got %v for %q", p.Guesses, p.Name)
			}
			if p.IsYou {
				t.Error("no player should be isYou for a stranger")
			}
		}
	})

	t.Run("finished round reveals all guesses and ranking", func(t *testing.T) {
		finishedAt := now.Add(time.Minute)
		r.Status = StatusFinished
		r.FinishedAt = &finishedAt
		// Mark Alice out to finish the round
		alice := r.Players[tokenA]
		alice.Status = PlayerOut

		view := PlayerView(r, tokenA)

		if view.Target == nil {
			t.Error("target should be revealed when finished")
		} else if *view.Target != "CRANE" {
			t.Errorf("expected target CRANE, got %q", *view.Target)
		}
		if view.Ranking == nil {
			t.Error("ranking should be present when finished")
		}

		for _, p := range view.Players {
			if p.Guesses == nil {
				t.Errorf("all players' guesses should be revealed when finished, missing for %q", p.Name)
			}
		}
	})
}
