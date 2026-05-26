package game

import "math/rand/v2"

// TEMPORARY: replaced by Postgres lookup in Phase 3 — keep this function signature stable so the swap is minimal.
var fiveLetterWords = []string{
	"REACT", "WORLD", "BRICK", "PLANT", "STORM", "CRANE", "FROST", "LIGHT",
	"BREAD", "CHAIR", "DRINK", "EARTH", "FLAME", "GLASS", "HEART", "IVORY",
	"JOLLY", "KNIFE", "LEMON", "MUSIC", "NIGHT", "OCEAN", "PIANO", "QUIET",
	"RIVER", "STONE", "TIGER", "UNCLE", "VOICE", "WHEAT",
}

func RandomTarget() string {
	return fiveLetterWords[rand.IntN(len(fiveLetterWords))]
}
