# Phase 5 Audit Report

**Date:** 2026-05-25  
**Auditor:** Claude Code (claude-sonnet-4-6)  
**Scope:** Go backend + Next.js frontend, Phases 0–5 nominally complete  

---

## 1. Summary

The project is in reasonable shape for a solo side-project at this stage. The WebSocket layer is clean — correct ping/pong, idempotent close with `sync.Once`, proper backoff reconnect on the frontend, and no stale Phase 4 polling code remaining. The spoiler-hiding logic is correct and tested. Build passes, vet passes, all existing unit tests pass.

There are two genuine correctness problems that rise to the level of bugs. The most serious is a data race on the `Room` and `Game` structs: every handler reads a `*Room` (or `*Game`) pointer via `PlayerView` / `buildResp` outside the store mutex, while concurrent handlers can write to the same object under the mutex. The second is several leaked `setTimeout` handles in Game.tsx that can call `setState` on an unmounted component (benign in React 18 but noisy in dev and will break if React reverts that tolerance).

Beyond those, there are a collection of small but real gaps: the backend returns `400` for "not a word" instead of the conventional `422`; the host can start a round alone (no minimum player count enforced); the ranking logic assigns wrong rank order when all players are out; the NOTES file promises host-disconnect detection in Phase 5 but the implementation does not do it.

Nothing here is alarming enough to block a demo, but the data race should be fixed before any real concurrent load.

---

## 2. Blockers

### B1 — Data race on `*Room` pointer (and `*Game`) — HIGH

**What is broken:** Every store method (`Create`, `Join`, `StartRound`, `SubmitGuess`, `NextRound`) acquires the store mutex, mutates the in-memory `Room` (or `Game`), releases the mutex, and returns the raw `*Room` pointer. The caller then reads that pointer — by calling `room.PlayerView(rm, token)` or `buildResp(g)` — without holding any lock. If a second goroutine is concurrently writing to the same `Room` under the write lock, the Go memory model does not guarantee safe access to the pointer's fields during the first goroutine's read. `Room.Players` is a plain `map[string]*Player`, which is not concurrent-map-safe.

**Locations:**
- `/Users/EricL/dev/wordle-rooms/backend/internal/api/rooms.go` lines 83, 107, 139, 165, 183 — every handler calls `room.PlayerView(rm, token)` after releasing `store.mu`
- `/Users/EricL/dev/wordle-rooms/backend/internal/api/games.go` lines 90, 129 — `buildResp(g)` after releasing `store.mu`
- `/Users/EricL/dev/wordle-rooms/backend/internal/api/realtime.go` line 52 — `rm.Players[token]` map read after releasing `store.mu`
- `/Users/EricL/dev/wordle-rooms/backend/internal/realtime/hub.go` lines 54–63 — `store.Get` releases RLock, then `PlayerView` reads `*Room` outside lock

**Reproduce:** Two players submit guesses simultaneously to the same room. Or a player submits a guess while the WS hub is broadcasting (hub calls `store.Get` then `PlayerView` while the handler writes via `SubmitGuess`). The race is small-window but real, detectable by `go test -race` with a concurrency-exercising integration test.

**Suggested fix:** The cleanest fix is to have `PlayerView` (and `buildResp`) be called under a read lock. One option is to add a dedicated `GetView(code, token string)` method on `Store` that acquires `RLock`, builds the view inside the lock, and returns a plain value (not a pointer). Handlers and `hub.Broadcast` call that instead of getting the pointer first and then calling `PlayerView`. Since `PlayerView` does only reads and CPU work (no I/O), holding the RLock during it is safe.

---

## 3. Bugs

### Bug 1 — `not_a_word` returns `400` instead of `422`

**What:** When a player submits a syntactically valid 5-letter word that is not in the dictionary, the backend returns `HTTP 400 Bad Request`. The conventional REST status for "the request was well-formed but semantically invalid" (a real word vs. a dictionary word) is `422 Unprocessable Entity`.

**Where:** `/Users/EricL/dev/wordle-rooms/backend/internal/api/rooms.go` line 55; `/Users/EricL/dev/wordle-rooms/backend/internal/api/games.go` line 116.

**Reproduce:**  
```bash
# After creating a room and starting a round:
curl -s -X POST http://localhost:8080/api/rooms/CODE/guesses \
  -H "X-Player-Token: TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"guess":"XQZWV"}'
# Returns 400; should be 422
```

**Fix:** Change `http.StatusBadRequest` to `http.StatusUnprocessableEntity` (422) in both `writeRoomErr` and the single-player `submitGuess` handler for the `ErrInvalidWord` case.

---

### Bug 2 — Host can start a round alone (no minimum player count)

**What:** The frontend's "Start Round" button is only disabled when `room.players.length < 1`, meaning it's enabled when there is exactly 1 player (the host). A solo host can start a round; the backend has no minimum-player check at all.

**Where:** `/Users/EricL/dev/wordle-rooms/frontend/src/app/room/[code]/page.tsx` line 261.

**Reproduce:** Create a room as Alice. Do not have anyone join. Click "Start Round." The round starts with one player.

**Fix:** Change the frontend guard to `room.players.length < 2`. Consider also adding a backend guard in `store.StartRound` to return a new `ErrNotEnoughPlayers` error if `len(r.Players) < 2`.

---

### Bug 3 — `bouncingRow`, `setJustRevealedRow`, and `setShakingRow` timeouts are not cleaned up on unmount

**What:** In `Game.tsx`, four `setTimeout` calls are made outside of `useEffect` (or inside a `useEffect` that does not return a cleanup for them), so they can call `setState` on the component after it has unmounted. Specifically:

- Line 223: `setTimeout(() => setBouncingRow(rowIdx), flipDuration)` — inside a `useEffect` but the timeout is not returned for cleanup.
- Line 264: `setTimeout(() => setJustRevealedRow(null), flipDuration)` — inside `handleKey` (a `useCallback`), no cleanup possible.
- Lines 243, 270: `setTimeout(() => setShakingRow(null), 400)` — same issue.

In React 18, calling `setState` on an unmounted component no longer throws, but in development mode it still produces a warning and can produce ghost state updates if the component remounts quickly (e.g., when a new round starts and the `instanceKey` prop changes).

**Where:** `/Users/EricL/dev/wordle-rooms/frontend/src/components/Game.tsx` lines 223, 243, 264, 270.

**Fix:** Convert the bounce-trigger effect to store the timer ID in a ref and return a cleanup. For `handleKey`, store timer IDs in refs and clear them in the component's cleanup effect.

---

### Bug 4 — Ranking assigns rank 1 to "out" players ahead of solved players when all are out

**What:** In `ComputeRanking`, when all players are `PlayerOut` (nobody solved), the ranking assigns rank 1 to whichever out player has the highest `bestRowScore`. If multiple players have identical scores and joined at the same time (as can happen in tests or fast joins), the sort is not stable. More visibly, the "out" players are ranked as if rank 1 is a meaningful prize. In the audit test run, both players got guessCount=6 and rank 1/2, with Alice at rank 1 and Bob at rank 2 solely because Alice joined first. The ranking display shows rank `#1` for an out-player, which is misleading.

This is a display/logic issue rather than an outright crash, but the `bestRowScore` tiebreaker for `unsolved` players in particular can produce counterintuitive results (a player who guessed "ZZZZZ" and got 5 greens by luck ranks above a player who had all grays).

**Where:** `/Users/EricL/dev/wordle-rooms/backend/internal/room/ranking.go` lines 46–51.

**Reproduce:** Both players exhaust all 6 guesses without solving. Both show as "Out." The ranking shows `#1` for the player with a slightly better last guess.

**Fix:** This is partly a design decision. At minimum, the rank label for out-players should probably not display `#1` if nobody solved — or the ranking entry for unsolved players should show rank as `DNF` rather than a number.

---

### Bug 5 — Animation timers inside `Tile` useEffect can leak across remounts (inner cleanup not returned to React)

**What:** The nested `setTimeout` chain in `Tile`'s second `useEffect` (lines 130–141) has a structural issue: `t1`'s callback is started by the effect and its cancel is correctly returned (`return () => clearTimeout(t1)`). But the cleanup functions for `t2` and `t3` are returned by callbacks *inside* `t1`, not by the effect itself. React only runs the cleanup function that the `useEffect` callback returns directly. So if `t1` fires and starts `t2`, then the component unmounts, React runs `clearTimeout(t1)` (already fired, no-op) but never runs `clearTimeout(t2)` or `clearTimeout(t3)`. This means `t2` and `t3` can run after the `Tile` unmounts, setting state on a dead component instance.

**Where:** `/Users/EricL/dev/wordle-rooms/frontend/src/components/Game.tsx` lines 130–141.

**Fix:** Store all timer IDs in refs, and return a single cleanup from the effect that clears all of them.

---

### Bug 6 — NOTES.md claims host-disconnect detection was delivered in Phase 5 — it was not

**What:** `/Users/EricL/dev/wordle-rooms/NOTES.md` under "Phase 4 deferred items → Host disconnect detection" reads: *"Fix in Phase 5: WebSocket presence tracking will detect when the host connection drops."* The Phase 5 WebSocket implementation does not do this. When the host disconnects, `Client.close()` is called, which unregisters the client from the hub and calls `CleanupIfEmpty`. Nothing changes the room's state. Non-host players remain in a `lobby` or `playing` state with no way to start or recover, and no UI indication that the host is gone.

**Where:** `/Users/EricL/dev/wordle-rooms/NOTES.md`; `/Users/EricL/dev/wordle-rooms/backend/internal/realtime/client.go` (close function does not check host status).

**Fix (documentation):** Update NOTES.md to mark this as still-deferred. **Fix (code):** In `Client.close()`, after `hub.Unregister(c)`, check if `c.token == room.HostToken` and if so either (a) broadcast a `host_left` event, (b) close the room, or (c) transfer host to the longest-standing remaining player.

---

## 4. Polish Gaps

**P1 — Scoreboard uses yellow (#b59f3b) for "out" player status.**  
Yellow in Wordle universally means "letter present but wrong position." Using it for "out" (failed) players is semantically inconsistent. A red or muted gray would be clearer. (`Scoreboard.tsx` line 17: `out: "#b59f3b"`)

**P2 — "Start Round" button has no minimum-player label.**  
The button is active when the host is alone. There's no tooltip or copy explaining that at least one other player is needed to make the game meaningful.

**P3 — Room code in Join panel validates only length (4 chars), not format (A–Z).**  
`page.tsx` line 49: `if (code.trim().length !== 4)`. A code like `"1234"` or `"ab!@"` passes the frontend check and goes to the backend, which then returns `not_found`. The backend handles this gracefully, but a frontend-side `/^[A-Z]{4}$/.test(code)` check would give better UX.

**P4 — No visual indicator for whose turn it is when waiting for other players.**  
During playing state, a player who has already submitted all guesses (or solved/out) sees the game grid dimmed but the scoreboard just shows the status. There's no "Waiting for Bob…" banner equivalent to what FinishModal shows while the round is finishing.

**P5 — FinishModal identifies "you" by name comparison (`entry.name === myPlayer.name`).**  
This is safe because names are unique per room (enforced by store), but it's fragile — if the uniqueness invariant ever changes, the "you" highlight breaks silently. Better to compare by a stable identifier. (`FinishModal.tsx` line 80)

**P6 — `console.warn` and `console.error` left in production code.**  
`useRoomSocket.ts` lines 59, 62 emit `console.warn("ws: unknown message type")` and `console.error("ws: parse error")`. These are acceptable for dev but should be guarded by a dev-mode flag or removed before production. The `console.warn` in particular fires for any forward-compatible new message type added in Phase 6+.

---

## 5. Tech Debt and Code Smells

**T1 — Global `sync.RWMutex` in room.Store serializes all rooms.**  
Acknowledged in NOTES.md and the TODO comment in `store.go`. Fine for now, but if 50+ rooms become active simultaneously, all room operations serialize.

**T2 — No room TTL / cleanup goroutine.**  
Acknowledged in NOTES.md. Rooms accumulate in memory indefinitely. A server running for a week with many abandoned rooms will grow without bound.

**T3 — Game memory leak (single-player).**  
`game.Store` has `// TODO: games leak memory until restart` at line 14. Same TTL problem.

**T4 — `newUpgrader()` is called per-connection, not once at startup.**  
`realtime.go` line 57: `upgrader := newUpgrader()`. The upgrader reads `os.Getenv("CORS_ORIGIN")` on every WS upgrade. This is trivially cheap but semantically wrong — configuration should be read once at startup, not per-request. If `CORS_ORIGIN` changes at runtime (e.g., via a process supervisor), the behavior is unpredictable.

**T5 — No API integration tests for the rooms layer.**  
`internal/api` has `[no test files]`. The only tests are unit tests for `Score()` and `PlayerView()`. There are no tests for HTTP status codes, error shapes, or the guard conditions (`startRound` without a token, `nextRound` from a non-host, etc.). This means the audit had to verify these via `curl`.

**T6 — `requestLogger` middleware `statusRecorder` does not override `Flush` or `ReadFrom`.**  
If `chi` or the underlying `net/http` uses these interfaces (e.g., for streaming or sendfile), the wrapper breaks the interface. Low risk for this app but technically incomplete.

**T7 — `handleStart` and `handleNextRound` swallow all errors silently.**  
`room/[code]/page.tsx` lines 132 and 142: both catch blocks are empty `/* WS broadcast will deliver the update */`. If the WS is down (e.g., reconnecting), the user gets no feedback that "Start" or "Next Round" failed. The button just stops spinning.

**T8 — `applyServerResponse` is omitted from the initial fetch's `useEffect` dependency array.**  
`room/[code]/page.tsx` line 45: `// eslint-disable-next-line react-hooks/exhaustive-deps`. The comment says the function is stable (it is, via `useCallback`), but the suppression hides the linter warning rather than using the proper pattern (including it in the dep array, which is harmless since it's stable).

---

## 6. Documentation Issues

**D1 — NOTES.md: Phase 5 host-disconnect promise not fulfilled.**  
See Bug 6. The notes say "Fix in Phase 5: WebSocket presence tracking will detect when the host connection drops." This did not happen. The notes should be updated.

**D2 — README.md project structure is stale.**  
The structure listing shows `frontend/src/app/page.tsx` but not the room page, the play page, lib files, or components. Trivial to update but currently misleading.

**D3 — `.env.example` is minimal but sufficient.** No issues.

**D4 — No CHANGELOG or per-phase completion notes.**  
There's no record of what was delivered in each phase. NOTES.md covers V2 deferred items but not "Phase 5 delivered X, Y, Z." This makes it hard for a new contributor to understand what's done vs. aspirational.

---

## 7. Things I Could Not Verify

- **Browser-based interactive UI testing** was not performed. I cannot open a real browser. All frontend verification was through static code review. I cannot confirm:
  - That the reconnect banner actually appears and disappears correctly during a real WS drop/reconnect cycle.
  - That tile flip animations fire correctly and don't produce visual glitches.
  - That the FinishModal appears at the right moment relative to the WS broadcast arriving.
  - That `navigator.clipboard.writeText` works for the "Copy link" button (requires HTTPS or localhost with user gesture).
  - That mobile layout / keyboard behavior is acceptable.
- **WebSocket concurrent stress test**: The data race (Bug B1) was identified by code reading; I did not run `go test -race` with a concurrency integration test, because no such test exists. The race is theoretical but clearly present in the code paths.
- **Hot-reload / server restart behavior**: The Makefile has no hot-reload. I verified the backend starts and serves; I did not test graceful shutdown under load.
- **Production build of the Next.js frontend**: `pnpm build` was not run; TypeScript errors or build-time failures are possible but unverified.

---

## 8. Phase 4 / Phase 2 Regression Status

**Phase 5 cleanly built on Phase 4.** No stale polling code was found. The single grep hit was a comment inside `Game.tsx` line 145 (`// No animation window (e.g. existing guesses on mount or polling update)`) — a leftover code comment referencing the old polling behavior, not actual polling code. No `setInterval`, `useGamePolling`, or `pollRoom` references exist in the frontend.

**Phase 2 (single-player):** The `/play` page and `/api/games` routes are intact and functional. The same data-race issue exists in `game.Store` (handlers read `*Game` pointer outside the mutex), but since single-player games have exactly one client each, the race window is effectively zero in practice. The single-player flow works correctly in the API tests.

**Phase 4 (HTTP room API):** All 10 endpoint scenarios tested successfully (see Section 9 for output). Error shapes are consistent `{"error":"...", "code":"..."}`. Status codes are correct for all tested cases except `not_a_word` (400 instead of 422).

---

## 9. Test Results

### Go build and vet

```
cd backend && go build ./...    # exit 0, no output
cd backend && go vet ./...      # exit 0, no output
```

### Go unit tests (fresh, no cache)

```
?       github.com/placeholder/wordle-rooms/cmd/server          [no test files]
?       github.com/placeholder/wordle-rooms/internal/api        [no test files]
?       github.com/placeholder/wordle-rooms/internal/db         [no test files]
ok      github.com/placeholder/wordle-rooms/internal/game       0.499s
?       github.com/placeholder/wordle-rooms/internal/realtime   [no test files]
ok      github.com/placeholder/wordle-rooms/internal/room       0.280s
?       github.com/placeholder/wordle-rooms/internal/words      [no test files]
```

All passing. Major packages with no tests: `api`, `realtime`, `db`, `words`.

### API curl tests

| # | Request | Expected | Actual Status | Body `code` | Pass? |
|---|---------|----------|--------------|-------------|-------|
| 1 | `GET /api/rooms/ZZZZ` | 404 `not_found` | 404 | `not_found` | ✓ |
| 2 | `POST /api/rooms` `{"name":""}` | 400 `invalid_name` | 400 | `invalid_name` | ✓ |
| 3 | `POST /api/rooms` `{"name":"Alice"}` | 201, code+playerToken+state | 201 | — | ✓ |
| 4 | `POST /api/rooms/CODE/join` `{"name":"Bob"}` | 200, playerToken+state | 200 | — | ✓ |
| 5 | `GET /api/rooms/CODE` (with token, lobby) | `target: null` | 200 | — | ✓ |
| 6 | `POST /api/rooms/CODE/start` (host) | 200, status=playing | 200 | — | ✓ |
| 7 | `GET /api/rooms/CODE` (playing) | `target: null` | 200 | — | ✓ |
| 8 | `POST /api/rooms/CODE/guesses` `{"guess":"crane"}` | 200, scored | 200 | — | ✓ |
| 9 | `POST /api/rooms/CODE/guesses` `{"guess":"XQZWV"}` | **422** `not_a_word` | **400** | `not_a_word` | **FAIL (status)** |
| 10 | `POST /api/rooms/CODE/next-round` (after finished) | 200, status=playing | 200 | — | ✓ |

Additional checks:
- `POST /api/rooms/CODE/start` without token → 401 `missing_token` ✓
- `POST /api/rooms/CODE/next-round` by non-host → 403 `not_host` ✓
- `GET /api/rooms/CODE` when finished → `target` revealed, `ranking` present ✓
- `POST /api/rooms/CODE/next-round` when already playing → 409 `cannot_next_round` ✓

---

## 10. Recommended Fix Order (Before Phase 6)

1. **B1 (data race)** — Fix `Store` to return plain view values (not raw `*Room` pointers) from all mutating operations, or introduce a `GetView` method that serializes under the lock. This is the only issue that can cause undefined behavior under load.

2. **Bug 1 (`not_a_word` status 400→422)** — One-line fix in both handlers. Easy win.

3. **Bug 2 (solo game start)** — Add `room.players.length < 2` guard on frontend. Optionally add backend validation.

4. **Bug 6 (NOTES.md promise unfulfilled)** — Either implement host-disconnect handling (recommended before Phase 6 since Phase 6 likely adds more presence features) or update NOTES to mark it still-deferred.

5. **Bug 3 + Bug 5 (setTimeout leaks)** — Move all Game.tsx timeouts to refs with proper cleanup effects. Low urgency but good hygiene before adding more animation states in Phase 6.

6. **Bug 4 (ranking for all-out)** — Design call: decide whether `#1` among all-out players is meaningful and adjust the display accordingly.

7. **T5 (no API integration tests)** — Add at minimum a table-driven test for the rooms HTTP layer using `httptest.NewRecorder`. Catches regressions cheaply.

8. **T4 (`newUpgrader` per connection)** — Move upgrader construction to router init. Trivial refactor.

9. **P1–P6 (polish)** — Address as time allows; none are blockers.
