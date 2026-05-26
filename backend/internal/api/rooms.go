package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/placeholder/wordle-rooms/internal/game"
	"github.com/placeholder/wordle-rooms/internal/room"
)

type roomHandler struct {
	store *room.Store
}

// ---- request helpers --------------------------------------------------------

func roomCode(r *http.Request) string {
	return strings.ToUpper(chi.URLParam(r, "code"))
}

func playerToken(r *http.Request) string {
	return strings.TrimSpace(r.Header.Get("X-Player-Token"))
}

// ---- error mapping ----------------------------------------------------------

func writeRoomErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, room.ErrRoomNotFound):
		writeErr(w, http.StatusNotFound, "room not found", "not_found")
	case errors.Is(err, room.ErrCodeCollision):
		writeErr(w, http.StatusServiceUnavailable, "could not allocate room code", "collision")
	case errors.Is(err, room.ErrRoomNotJoinable):
		writeErr(w, http.StatusConflict, "room is not accepting new players", "not_joinable")
	case errors.Is(err, room.ErrNameTaken):
		writeErr(w, http.StatusConflict, "name already in use", "name_taken")
	case errors.Is(err, room.ErrInvalidName):
		writeErr(w, http.StatusBadRequest, "invalid name", "invalid_name")
	case errors.Is(err, room.ErrNotHost):
		writeErr(w, http.StatusForbidden, "only the host can do that", "not_host")
	case errors.Is(err, room.ErrCannotStart):
		writeErr(w, http.StatusConflict, "cannot start round in this state", "cannot_start")
	case errors.Is(err, room.ErrNotInRoom):
		writeErr(w, http.StatusForbidden, "you are not in this room", "not_in_room")
	case errors.Is(err, room.ErrNotYourTurn):
		writeErr(w, http.StatusConflict, "you cannot guess right now", "not_your_turn")
	case errors.Is(err, room.ErrCannotNextRound):
		writeErr(w, http.StatusConflict, "cannot start next round in this state", "cannot_next_round")
	case errors.Is(err, game.ErrInvalidWord):
		writeErr(w, http.StatusBadRequest, "not in word list", "not_a_word")
	case errors.Is(err, game.ErrInvalidGuess):
		writeErr(w, http.StatusBadRequest, "guess must be exactly 5 letters", "invalid_guess")
	default:
		writeErr(w, http.StatusInternalServerError, "internal error", "internal_error")
	}
}

// ---- handlers ---------------------------------------------------------------

func (h *roomHandler) createRoom(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}

	rm, token, err := h.store.Create(r.Context(), body.Name)
	if err != nil {
		writeRoomErr(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"code":        rm.Code,
		"playerToken": token,
		"state":       room.PlayerView(rm, token),
	})
}

func (h *roomHandler) joinRoom(w http.ResponseWriter, r *http.Request) {
	code := roomCode(r)

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}

	rm, token, err := h.store.Join(r.Context(), code, body.Name)
	if err != nil {
		writeRoomErr(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"playerToken": token,
		"state":       room.PlayerView(rm, token),
	})
}

func (h *roomHandler) getRoom(w http.ResponseWriter, r *http.Request) {
	code := roomCode(r)
	token := playerToken(r) // optional

	rm, err := h.store.Get(code)
	if err != nil {
		writeRoomErr(w, err)
		return
	}

	writeJSON(w, http.StatusOK, room.PlayerView(rm, token))
}

func (h *roomHandler) startRound(w http.ResponseWriter, r *http.Request) {
	code := roomCode(r)
	token := playerToken(r)
	if token == "" {
		writeErr(w, http.StatusUnauthorized, "missing player token", "missing_token")
		return
	}

	rm, err := h.store.StartRound(r.Context(), code, token)
	if err != nil {
		writeRoomErr(w, err)
		return
	}

	writeJSON(w, http.StatusOK, room.PlayerView(rm, token))
}

func (h *roomHandler) submitGuess(w http.ResponseWriter, r *http.Request) {
	code := roomCode(r)
	token := playerToken(r)
	if token == "" {
		writeErr(w, http.StatusUnauthorized, "missing player token", "missing_token")
		return
	}

	var body struct {
		Guess string `json:"guess"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}

	rm, err := h.store.SubmitGuess(r.Context(), code, token, body.Guess)
	if err != nil {
		writeRoomErr(w, err)
		return
	}

	writeJSON(w, http.StatusOK, room.PlayerView(rm, token))
}

func (h *roomHandler) nextRound(w http.ResponseWriter, r *http.Request) {
	code := roomCode(r)
	token := playerToken(r)
	if token == "" {
		writeErr(w, http.StatusUnauthorized, "missing player token", "missing_token")
		return
	}

	rm, err := h.store.NextRound(r.Context(), code, token)
	if err != nil {
		writeRoomErr(w, err)
		return
	}

	writeJSON(w, http.StatusOK, room.PlayerView(rm, token))
}
