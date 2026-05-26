package api_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/placeholder/wordle-rooms/internal/api"
	"github.com/placeholder/wordle-rooms/internal/game"
	"github.com/placeholder/wordle-rooms/internal/realtime"
	"github.com/placeholder/wordle-rooms/internal/room"
)

// ---- stub word repository ---------------------------------------------------

// stubWords satisfies both room.wordRepo and game.wordRepo interfaces.
// It returns a fixed target and recognises a small allow-list of valid guesses.
type stubWords struct {
	target     string
	validWords map[string]bool
}

func (s *stubWords) RandomTarget(_ context.Context) (string, error) {
	return s.target, nil
}

func (s *stubWords) IsValidGuess(_ context.Context, word string) (bool, error) {
	return s.validWords[word], nil
}

func newStub() *stubWords {
	return &stubWords{
		target: "CRANE",
		validWords: map[string]bool{
			"CRANE": true,
			"STARE": true,
			"AUDIO": true,
			"SLATE": true,
			"RAISE": true,
		},
	}
}

// ---- test helpers -----------------------------------------------------------

func newRouter(t *testing.T) http.Handler {
	t.Helper()
	w := newStub()
	gameStore := game.NewStore(w)
	roomStore := room.NewStore(w)
	registry := realtime.NewHubRegistry(roomStore)
	return api.NewRouter(gameStore, roomStore, registry)
}

type apiResp struct {
	Code        string          `json:"code"`        // room code (create)
	PlayerToken string          `json:"playerToken"` // create / join
	State       json.RawMessage `json:"state"`       // room state
	Error       string          `json:"error"`
	ErrorCode   string          `json:"code"` // note: same JSON key as room code — read via rawBody
	Status      string          `json:"status"`
}

// do executes one request against the router and returns status + parsed body.
func do(t *testing.T, router http.Handler, method, path, token, body string) (int, map[string]any) {
	t.Helper()
	var reqBody *strings.Reader
	if body != "" {
		reqBody = strings.NewReader(body)
	} else {
		reqBody = strings.NewReader("{}")
	}
	req := httptest.NewRequest(method, path, reqBody)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("X-Player-Token", token)
	}
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	var result map[string]any
	json.Unmarshal(rr.Body.Bytes(), &result) //nolint:errcheck
	return rr.Code, result
}

func str(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

// ---- tests ------------------------------------------------------------------

func TestRoomsAPI(t *testing.T) {
	t.Run("POST /api/rooms with empty name returns 400 invalid_name", func(t *testing.T) {
		router := newRouter(t)
		status, body := do(t, router, "POST", "/api/rooms", "", `{"name":""}`)
		if status != http.StatusBadRequest {
			t.Errorf("want 400, got %d", status)
		}
		if str(body, "code") != "invalid_name" {
			t.Errorf("want code=invalid_name, got %q", str(body, "code"))
		}
	})

	t.Run("GET /api/rooms/ZZZZ returns 404 not_found", func(t *testing.T) {
		router := newRouter(t)
		status, body := do(t, router, "GET", "/api/rooms/ZZZZ", "", "")
		if status != http.StatusNotFound {
			t.Errorf("want 404, got %d", status)
		}
		if str(body, "code") != "not_found" {
			t.Errorf("want code=not_found, got %q", str(body, "code"))
		}
	})

	t.Run("start round without token returns 401 missing_token", func(t *testing.T) {
		router := newRouter(t)
		// create a room first so the code exists
		_, b := do(t, router, "POST", "/api/rooms", "", `{"name":"Alice"}`)
		roomCode := str(b, "code")
		status, body := do(t, router, "POST", fmt.Sprintf("/api/rooms/%s/start", roomCode), "", "")
		if status != http.StatusUnauthorized {
			t.Errorf("want 401, got %d", status)
		}
		if str(body, "code") != "missing_token" {
			t.Errorf("want code=missing_token, got %q", str(body, "code"))
		}
	})

	t.Run("start round with only host present returns 409 not_enough_players", func(t *testing.T) {
		router := newRouter(t)
		_, b := do(t, router, "POST", "/api/rooms", "", `{"name":"Alice"}`)
		roomCode := str(b, "code")
		hostToken := str(b, "playerToken")
		status, body := do(t, router, "POST", fmt.Sprintf("/api/rooms/%s/start", roomCode), hostToken, "")
		if status != http.StatusConflict {
			t.Errorf("want 409, got %d", status)
		}
		if str(body, "code") != "not_enough_players" {
			t.Errorf("want code=not_enough_players, got %q", str(body, "code"))
		}
	})

	t.Run("happy path: create, join, start, valid guess", func(t *testing.T) {
		router := newRouter(t)

		// Create
		s, b := do(t, router, "POST", "/api/rooms", "", `{"name":"Alice"}`)
		if s != http.StatusCreated {
			t.Fatalf("create: want 201, got %d", s)
		}
		roomCode := str(b, "code")
		hostToken := str(b, "playerToken")

		// Join with second player
		s, b = do(t, router, "POST", fmt.Sprintf("/api/rooms/%s/join", roomCode), "", `{"name":"Bob"}`)
		if s != http.StatusOK {
			t.Fatalf("join: want 200, got %d", s)
		}
		bobToken := str(b, "playerToken")
		if bobToken == "" {
			t.Fatal("join: expected playerToken in response")
		}

		// Start round (host)
		s, b = do(t, router, "POST", fmt.Sprintf("/api/rooms/%s/start", roomCode), hostToken, "")
		if s != http.StatusOK {
			t.Fatalf("start: want 200, got %d body=%v", s, b)
		}
		// Verify state inside the response
		stateRaw, _ := b["state"].(map[string]any)
		if stateRaw == nil {
			// start returns the view directly, not nested under "state"
			stateRaw = b
		}
		if str(stateRaw, "status") != "playing" {
			t.Errorf("start: want status=playing, got %q", str(stateRaw, "status"))
		}
		if stateRaw["target"] != nil {
			t.Error("start: target must not be revealed while playing")
		}

		// Submit valid guess (Alice)
		s, _ = do(t, router, "POST", fmt.Sprintf("/api/rooms/%s/guesses", roomCode), hostToken, `{"guess":"STARE"}`)
		if s != http.StatusOK {
			t.Errorf("guess: want 200, got %d", s)
		}

		// Submit valid guess (Bob) — solving word
		s, b = do(t, router, "POST", fmt.Sprintf("/api/rooms/%s/guesses", roomCode), bobToken, `{"guess":"CRANE"}`)
		if s != http.StatusOK {
			t.Errorf("guess bob: want 200, got %d", s)
		}
		_ = b
	})

	t.Run("submit invalid word returns 422 not_a_word", func(t *testing.T) {
		router := newRouter(t)

		// Set up a started round with two players
		_, b := do(t, router, "POST", "/api/rooms", "", `{"name":"Alice"}`)
		roomCode := str(b, "code")
		hostToken := str(b, "playerToken")
		do(t, router, "POST", fmt.Sprintf("/api/rooms/%s/join", roomCode), "", `{"name":"Bob"}`) //nolint:errcheck
		do(t, router, "POST", fmt.Sprintf("/api/rooms/%s/start", roomCode), hostToken, "")       //nolint:errcheck

		status, body := do(t, router, "POST", fmt.Sprintf("/api/rooms/%s/guesses", roomCode), hostToken, `{"guess":"XQZWV"}`)
		if status != http.StatusUnprocessableEntity {
			t.Errorf("want 422, got %d", status)
		}
		if str(body, "code") != "not_a_word" {
			t.Errorf("want code=not_a_word, got %q", str(body, "code"))
		}
	})

	t.Run("start round with non-host token returns 403 not_host", func(t *testing.T) {
		router := newRouter(t)
		_, b := do(t, router, "POST", "/api/rooms", "", `{"name":"Alice"}`)
		roomCode := str(b, "code")
		_, b2 := do(t, router, "POST", fmt.Sprintf("/api/rooms/%s/join", roomCode), "", `{"name":"Bob"}`)
		bobToken := str(b2, "playerToken")

		status, body := do(t, router, "POST", fmt.Sprintf("/api/rooms/%s/start", roomCode), bobToken, "")
		if status != http.StatusForbidden {
			t.Errorf("want 403, got %d", status)
		}
		if str(body, "code") != "not_host" {
			t.Errorf("want code=not_host, got %q", str(body, "code"))
		}
	})
}
