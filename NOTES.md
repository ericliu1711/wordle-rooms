# Architecture notes and known gaps

## Phase 4 deferred items

### Host disconnect detection
Still deferred. Phase 5 added WebSocket presence (we now know when a client's socket closes), but we deliberately did not act on host disconnects. Open design questions: room dies, longest-standing player migrates to host, or grace period with reconnect. Defer to V2.

### Room TTL / cleanup
Rooms live in memory until the server restarts. There is no cleanup of idle or finished rooms. On a long-running server this is a memory leak. Fix in V2: add a TTL sweeping goroutine that removes rooms not touched in N hours.

### Per-room mutex
The RoomStore uses a single global `sync.RWMutex`. All room operations are serialised through it. This is fine for low concurrent room counts but becomes a bottleneck if many rooms are active simultaneously. Fix in V2: replace with per-room mutexes (a `sync.Map` of individual mutexes keyed by room code).

### Room persistence
Rooms are in-memory only. A server restart drops all active rooms. Fix in V3: persist room state in Redis (fast, TTL-native) or Postgres (durable).

### Mid-round join
Joining a room that is `playing` returns 409. Players must join before the round starts. Mid-round join can be added in V2 if needed — player would start with 0 guesses and the existing board.

### No-spoiler rule — verified
The `PlayerView` function is the single place where room state is serialised to JSON. `view_test.go` asserts that mid-round, a player's guesses are hidden from other players and from unauthenticated callers. Only the player themselves (matched by token) sees their own guesses while the round is live. All guesses are revealed when the room transitions to `finished`.
