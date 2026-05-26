package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/placeholder/wordle-rooms/internal/game"
)

type handler struct {
	store *game.Store
}

// ---- response types --------------------------------------------------------

type errResp struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

type guessResp struct {
	Word    string   `json:"word"`
	Scoring []string `json:"scoring"`
}

type gameResp struct {
	GameID     string      `json:"gameId"`
	Length     int         `json:"length"`
	MaxGuesses int         `json:"maxGuesses"`
	Status     string      `json:"status"`
	Guesses    []guessResp `json:"guesses"`
	Target     string      `json:"target,omitempty"` // revealed only when game is over
}

// buildResp is the single place where we decide whether to expose Target.
func buildResp(g *game.Game) gameResp {
	guesses := make([]guessResp, len(g.Guesses))
	for i, sg := range g.Guesses {
		guesses[i] = guessResp{Word: sg.Word, Scoring: sg.Scoring}
	}
	resp := gameResp{
		GameID:     g.ID,
		Length:     len(g.Target),
		MaxGuesses: g.MaxGuesses,
		Status:     g.Status,
		Guesses:    guesses,
	}
	if g.Status == "won" || g.Status == "lost" {
		resp.Target = g.Target
	}
	return resp
}

// ---- helpers ----------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func writeErr(w http.ResponseWriter, status int, msg, code string) {
	writeJSON(w, status, errResp{Error: msg, Code: code})
}

var onlyLetters = regexp.MustCompile(`^[A-Za-z]+$`)

// ---- handlers ---------------------------------------------------------------

func (h *handler) createGame(w http.ResponseWriter, r *http.Request) {
	g := h.store.Create(game.RandomTarget(), 6)
	writeJSON(w, http.StatusCreated, buildResp(g))
}

func (h *handler) getGame(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "gameId")
	g, ok := h.store.Get(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "game not found", "not_found")
		return
	}
	writeJSON(w, http.StatusOK, buildResp(g))
}

type guessReq struct {
	Guess string `json:"guess"`
}

func (h *handler) submitGuess(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "gameId")

	var body guessReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}

	guess := strings.ToUpper(strings.TrimSpace(body.Guess))
	if len(guess) != 5 || !onlyLetters.MatchString(guess) {
		writeErr(w, http.StatusBadRequest, "guess must be exactly 5 letters", "invalid_guess")
		return
	}

	g, err := h.store.SubmitGuess(id, guess)
	if err != nil {
		switch {
		case errors.Is(err, game.ErrNotFound):
			writeErr(w, http.StatusNotFound, "game not found", "not_found")
		case errors.Is(err, game.ErrAlreadyFinished):
			writeErr(w, http.StatusConflict, "game already finished", "game_finished")
		case errors.Is(err, game.ErrInvalidGuess):
			writeErr(w, http.StatusBadRequest, "invalid guess", "invalid_guess")
		default:
			writeErr(w, http.StatusInternalServerError, "internal error", "internal_error")
		}
		return
	}

	writeJSON(w, http.StatusOK, buildResp(g))
}
