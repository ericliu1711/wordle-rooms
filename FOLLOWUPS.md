# Follow-up items

## FU-1 — `setToken(null)` called synchronously inside a `useEffect`

**File:** `frontend/src/app/room/[code]/page.tsx` (the `tokenStale` cleanup effect)  
**What:** The effect calls `setToken(null)` directly in its body rather than in a callback. React's experimental linter rule flags this as a potential cascading-render concern.  
**Impact:** Low — the effect only fires when a stale token is detected (rare path), and the cascade is a single extra render. No user-visible issue observed.  
**Fix:** Derive the cleared token from state instead of calling `setToken` inside an effect, or restructure the token lifecycle so the stale detection is done in the render path rather than an effect.

## FU-2 — Per-room mutex for high concurrency

**Source:** `backend/internal/room/store.go`  
**What:** The `RoomStore` uses a single global `sync.RWMutex`. All room operations serialize through it. Fine for low concurrent room counts; becomes a bottleneck if many rooms are active simultaneously.  
**Fix:** Replace with per-room mutexes — a `sync.Map` of individual mutexes keyed by room code.

## FU-3 — Room TTL / cleanup goroutine

**Source:** `backend/internal/room/store.go`  
**What:** Rooms live in memory until the server restarts. There is no cleanup of idle or finished rooms. On a long-running server this is a memory leak.  
**Fix:** Add a TTL sweeping goroutine that removes rooms not touched in N hours.

## FU-4 — Single-player game memory leak

**Source:** `backend/internal/game/store.go`  
**What:** `game.Store` has the same TTL problem — games accumulate until restart.  
**Fix:** Same TTL sweeping approach as FU-3.

## FU-5 — Sharded hub registry lock

**Source:** `backend/internal/realtime/registry.go`  
**What:** The `HubRegistry` uses a single `sync.Mutex`. If many rooms connect simultaneously the registry mutex becomes contended.  
**Fix:** Shard the registry into N buckets, each with its own lock, keyed by `hash(roomCode) % N`.
