# Design decisions

Architecture and trade-off notes for anyone reading this cold — interviewer, future maintainer, or curious passer-by.

---

### Go for the backend

**Choice:** Go 1.22 with stdlib HTTP + gorilla/websocket.

**Alternatives considered:** Node/Express, Python/FastAPI.

**Reasoning:** Go's goroutine model fits the "one goroutine per WebSocket connection" pattern cleanly, and the stdlib covers HTTP, JSON, and crypto without dependencies. The single compiled binary simplifies deployment. The main trade-off vs. Node is that JavaScript/TypeScript is more familiar for full-stack developers; Go means the backend and frontend are in different languages. That's acceptable here because the backend surface is small and the type boundary is explicit (JSON shapes defined in `api.ts`).

---

### HTTP for mutations, WebSocket only for push notifications

**Choice:** All room actions (create, join, start, guess, next-round) are HTTP POST/GET. WebSocket carries only server-to-client `room_state` broadcasts.

**Alternatives considered:** All traffic over WebSocket; WebSocket for mutations + HTTP polling for state.

**Reasoning:** HTTP mutations give us standard status codes, headers (`X-Player-Token`), and caching semantics for free. They're easy to test with `httptest` and easy to curl. The WebSocket channel is stateless from the server's perspective — it only pushes snapshots; it never receives commands. This keeps the WS handler trivially simple (read pump discards all inbound frames) and avoids the need to re-implement request/response semantics over a framed stream.

---

### In-memory room state, not Redis

**Choice:** Rooms live in a `sync.RWMutex`-guarded `map[string]*Room` in the server process.

**Alternatives considered:** Redis from day one, Postgres-backed rooms.

**Reasoning:** A Wordle room lasts minutes. Persistence across restarts has no user-visible value for this use case. Redis adds an infrastructure dependency, a serialization step, and TTL management complexity. The in-memory store is ~100 lines, directly testable with a stub, and has zero serialization overhead. The trade-off is that a server restart drops all active games, which is documented and acceptable. Redis migration is straightforward — the `Store` interface is already abstracted behind a `wordRepo` interface, and the same pattern would apply to room state.

---

### Per-store mutex instead of per-room locking

**Choice:** One `sync.RWMutex` on the `Store` struct guards all room map access and all mutations to individual rooms.

**Alternatives considered:** Per-room `sync.Mutex` (a `sync.Map` of mutexes keyed by room code); sharded maps.

**Reasoning:** With a small number of concurrent rooms (< 100), a single mutex is fast, simple, and easy to reason about. Per-room locking would require two lock levels (store-level to find the room, room-level to mutate it), which introduces lock-ordering rules and the risk of deadlock. The bottleneck only materialises if many rooms are active simultaneously — at that point, the fix is straightforward: replace with a `sync.Map` of individual `sync.RWMutex` values. This is tracked in [FOLLOWUPS.md](FOLLOWUPS.md) as FU-2.

---

### Server returns view values under the lock, not `*Room` pointers

**Choice:** Every `Store` method that mutates a room calls `PlayerView(r, token)` before releasing the mutex and returns a plain `PlayerViewResponse` value. The `GetView` method builds the view under a read lock. No `*Room` pointer escapes the store.

**Alternatives considered:** Return `*Room` to callers; callers build their own views.

**Reasoning:** Returning a raw pointer means callers read the struct outside the lock, which is a data race under the Go memory model — `Room.Players` is an unsynchronised `map[string]*Player`. During a Phase 5 audit this was identified as the most serious bug in the codebase. The fix was to have all view construction happen inside the lock, so callers receive immutable value types. The pattern is slightly more coupling (the store knows about `PlayerView`) but the safety guarantee is worth it.

---

### HTTP polling first, then WebSockets

**Choice:** The project was built in phases: Phases 2–3 used polling (`getGame`/`getRoom` on interval); Phase 5 replaced polling with WebSockets.

**Alternatives considered:** WebSockets from day one.

**Reasoning:** Polling first kept the Phase 2–4 surface small and fully testable with `httptest`. It de-risked the HTTP layer before adding WebSocket complexity. By the time Phase 5 started, the HTTP contract was stable and the WS layer could be added without touching any existing handler logic. The trade-off is that the polling code was thrown away, but it was never complex and the architecture didn't need to change.

---

### 4-character A–Z room codes

**Choice:** Room codes are exactly 4 uppercase ASCII letters (e.g., `ABCD`), generated from `crypto/rand`.

**Alternatives considered:** 6-character alphanumeric codes; numeric PINs; UUIDs.

**Reasoning:** 26^4 = 456,976 possible codes. With collision retry (up to 5 attempts), the probability of failure is negligible at any realistic room count. 4 characters are easy to read aloud and type on mobile. The tradeoff vs. UUIDs is a slightly higher collision probability at large scale, which doesn't apply here. Frontend validation uses `/^[A-Z]{4}$/` so invalid formats are caught early.

---

### Opaque player tokens in the `X-Player-Token` header

**Choice:** Each player receives a random 16-character base64url token at create/join time. The token is stored in `localStorage` keyed by room code and sent as `X-Player-Token` on every request.

**Alternatives considered:** Session cookies; JWTs.

**Reasoning:** Session cookies require either a server-side session store (adds infrastructure) or signed cookies (adds key management). JWTs are stateless but add a signature-verification step and a dependency. An opaque random token stored in a map is simpler: validity is checked by a single `map` lookup. The token has no expiry and no signature — it's a secret capability token (possession = authorisation). The trade-off is that token rotation and revocation are not supported, which is fine for short-lived game sessions.

**Token placement for WebSocket:** The token is sent as `X-Player-Token` on all HTTP mutations, but the WebSocket upgrade passes it as a URL query parameter (`?token=…`). This is not a design choice — it's a browser constraint. The `WebSocket` constructor in browsers does not accept custom headers; only the URL can be controlled from JavaScript. Passing the token in the URL means it appears in server access logs. This is an accepted trade-off: the token is already a short-lived, room-scoped capability with no other privileges, and log access is restricted to the service operator.

---

### Spoiler-hiding enforced in a single `PlayerView` builder

**Choice:** `PlayerView` in `room/view.go` is the single place where `*Room` state is serialised to JSON. It applies all spoiler rules: hide other players' guesses while the round is live, reveal everything when finished, echo `hostToken` only to the host.

**Alternatives considered:** Per-handler filtering; a middleware that strips fields.

**Reasoning:** Centralising the rule means it's impossible for a new handler to accidentally leak guesses — you have to go through `PlayerView`. The test in `view_test.go` asserts the spoiler contract directly. Per-handler filtering would require duplicating the rules in every handler and trusting that future contributors don't skip it.

---

### `room_state` snapshot broadcasts, not event deltas

**Choice:** After every mutation, the server pushes a complete `room_state` snapshot to every connected client.

**Alternatives considered:** Event-by-event deltas (e.g., `player_guessed`, `round_started`, `player_solved`).

**Reasoning:** Snapshots are idempotent — a reconnecting client that missed events simply gets the current state and is fully caught up after one message. Deltas require clients to track sequence numbers and handle gaps, which is significantly more complex. The snapshot is small (a few KB at most), so bandwidth is not a concern. The trade-off is slightly higher per-message payload, which doesn't matter here.

---

## What I'd build next, and why

1. **Redis fan-out for horizontal scaling** — Replace in-memory room state with Redis hashes + pub/sub. Each server instance subscribes to its rooms' channels; broadcasts fan out via Redis. Unlocks multi-instance deploys behind a load balancer.

2. **Per-room mutex** — Replace the single global `sync.RWMutex` with per-room locks (`sync.Map` of `*sync.RWMutex`). Eliminates the serialisation bottleneck when many rooms are active simultaneously. Low effort, high reward once room counts grow.

---

## Deployment choices

**Render (free tier)** — Docker support, persistent WebSocket connections, and zero cost. The trade-off is a cold-start delay (30–60 seconds) after 15 minutes of inactivity. The frontend handles this with a wake-up overlay. A paid Render plan eliminates the cold start; the code needs no changes.

**Neon (Postgres)** — Free managed Postgres with generous storage limits and a native `pgx`-compatible connection string. No wrapper or ORM needed. Requires `sslmode=require` in the connection string, which is enforced in `.env.example`.

**Vercel (Next.js)** — Zero-config Next.js hosting with GitHub-native preview deployments per PR. `NEXT_PUBLIC_API_URL` is the only environment variable the frontend needs, set once in the Vercel dashboard.
