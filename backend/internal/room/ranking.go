package room

import "slices"

type RankingEntry struct {
	Name       string       `json:"name"`
	Status     PlayerStatus `json:"status"`
	GuessCount int          `json:"guessCount"`
	SolvedAt   interface{}  `json:"solvedAt"` // *time.Time, serialises as null when nil
	Rank       int          `json:"rank"`
}

// ComputeRanking returns a ranked list of all players.
// Sort order:
//  1. Solved before unsolved.
//  2. Among solved: fewer guesses → lower rank; tiebreaker: earlier SolvedAt.
//  3. Among unsolved: higher best-row score → lower rank; tiebreaker: earlier JoinedAt.
func ComputeRanking(r *Room) []RankingEntry {
	type candidate struct {
		player       *Player
		bestRowScore int
	}

	var solved []candidate
	var unsolved []candidate

	for _, p := range r.Players {
		c := candidate{player: p, bestRowScore: bestRowScore(p)}
		if p.Status == PlayerSolved {
			solved = append(solved, c)
		} else {
			unsolved = append(unsolved, c)
		}
	}

	slices.SortFunc(solved, func(a, b candidate) int {
		if na, nb := len(a.player.Guesses), len(b.player.Guesses); na != nb {
			return na - nb
		}
		if a.player.SolvedAt != nil && b.player.SolvedAt != nil {
			return a.player.SolvedAt.Compare(*b.player.SolvedAt)
		}
		return 0
	})

	slices.SortFunc(unsolved, func(a, b candidate) int {
		if a.bestRowScore != b.bestRowScore {
			return b.bestRowScore - a.bestRowScore // higher score → better rank
		}
		return a.player.JoinedAt.Compare(b.player.JoinedAt)
	})

	entries := make([]RankingEntry, 0, len(r.Players))
	for i, c := range solved {
		entries = append(entries, RankingEntry{
			Name:       c.player.Name,
			Status:     c.player.Status,
			GuessCount: len(c.player.Guesses),
			SolvedAt:   c.player.SolvedAt,
			Rank:       i + 1,
		})
	}
	for i, c := range unsolved {
		entries = append(entries, RankingEntry{
			Name:       c.player.Name,
			Status:     c.player.Status,
			GuessCount: len(c.player.Guesses),
			SolvedAt:   nil,
			Rank:       len(solved) + i + 1,
		})
	}
	return entries
}

func bestRowScore(p *Player) int {
	best := 0
	for _, g := range p.Guesses {
		score := 0
		for _, s := range g.Scoring {
			if s == "green" { //nolint:staticcheck // QF1003: if-chain is clearer than tagged switch here
				score += 2
			} else if s == "yellow" {
				score += 1
			}
		}
		if score > best {
			best = score
		}
	}
	return best
}
