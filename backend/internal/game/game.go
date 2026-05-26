package game

import "time"

type Game struct {
	ID         string
	Target     string // uppercase, never exposed in API while playing
	Guesses    []ScoredGuess
	MaxGuesses int
	Status     string // "playing" | "won" | "lost"
	CreatedAt  time.Time
}

type ScoredGuess struct {
	Word    string   `json:"word"`    // uppercase
	Scoring []string `json:"scoring"` // ["green","yellow","gray","gray","green"]
}

// Score uses a two-pass algorithm to correctly handle duplicate letters.
//
// Test cases (verified against actual two-pass behavior):
//
//	target=ALLEY guess=LLAMA  → [yellow, green,  yellow, gray, gray]
//	  Pass1: pos1 L=L→green. Pass2: pos0 L→L(2) yellow, pos2 A→A(0) yellow, pos3 M→none, pos4 A→none (A consumed)
//
//	target=ALLEY guess=LULLS  → [yellow, gray,   green,  gray, gray]
//	  Pass1: pos2 L=L→green. Pass2: pos0 L→L(1) yellow, pos1 U→none, pos3 L→none (both Ls consumed), pos4 S→none
//
//	target=REACT guess=REACT  → [green, green, green, green, green]
//
//	target=REACT guess=TACOS  → [yellow, yellow, yellow, gray, gray]
//	  Pass1: no greens. Pass2: T→T(4), A→A(2), C→C(3), O→none, S→none
func Score(guess, target string) []string {
	n := len(target)
	result := make([]string, n)
	for i := range result {
		result[i] = "gray"
	}
	consumed := make([]bool, n)

	// Pass 1: greens
	for i := 0; i < n; i++ {
		if i < len(guess) && guess[i] == target[i] {
			result[i] = "green"
			consumed[i] = true
		}
	}

	// Pass 2: yellows
	for i := 0; i < len(guess); i++ {
		if result[i] == "green" {
			continue
		}
		for j := 0; j < n; j++ {
			if !consumed[j] && guess[i] == target[j] {
				result[i] = "yellow"
				consumed[j] = true
				break
			}
		}
	}

	return result
}
