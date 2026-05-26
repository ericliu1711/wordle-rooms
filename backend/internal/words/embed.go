// Word lists sourced from:
//   - answers.txt:       https://github.com/Roy-Orbison/wordle-guesses-answers
//   - valid_guesses.txt: https://github.com/tabatkins/wordle-list
//
// Downloaded 2026-05-24. Files are NYT Wordle's original answer and
// valid-guess lists, public domain via fan mirror.

package words

import _ "embed"

//go:embed data/answers.txt
var answersData []byte

//go:embed data/valid_guesses.txt
var validGuessesData []byte
