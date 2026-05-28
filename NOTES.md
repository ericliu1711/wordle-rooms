# Architecture notes and known gaps

## Phase 4 deferred items

### ~~Host disconnect detection~~ ✅ Done
`migrateHost` transfers host status to the next-oldest active player when the host's WebSocket closes. A 15-second grace period allows reconnect before finalising the drop. Frontend shows a "you are now the host" toast when `youAreHost` flips true mid-session.

### ~~Room TTL / cleanup~~ ✅ Done
`StartSweeper(ctx, 10m, 1h)` runs a background goroutine that evicts rooms idle for more than 1 hour, ticking every 10 minutes. `LastTouchedAt` is updated on every mutation.

### Per-room mutex
The RoomStore uses a single global `sync.RWMutex`. All room operations are serialised through it. This is fine for low concurrent room counts but becomes a bottleneck if many rooms are active simultaneously. Fix in V2: replace with per-room mutexes (a `sync.Map` of individual mutexes keyed by room code).

### Room persistence
Rooms are in-memory only. A server restart drops all active rooms. Fix in V3: persist room state in Redis (fast, TTL-native) or Postgres (durable).

### Mid-round join
Joining a room that is `playing` returns 409. Players must join before the round starts. Mid-round join can be added in V2 if needed — player would start with 0 guesses and the existing board.

### No-spoiler rule — verified
The `PlayerView` function is the single place where room state is serialised to JSON. `view_test.go` asserts that mid-round, a player's guesses are hidden from other players and from unauthenticated callers. Only the player themselves (matched by token) sees their own guesses while the round is live. All guesses are revealed when the room transitions to `finished`.
