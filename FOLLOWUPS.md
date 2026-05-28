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

## ~~FU-3 — Room TTL / cleanup goroutine~~ ✅ Done

Implemented in `room/store.go`: `LastTouchedAt` on `Room`, updated on every mutation. `StartSweeper(ctx, 10m, 1h)` runs a background goroutine that evicts rooms idle for more than 1 hour, ticking every 10 minutes. Wired in `main.go`.

## FU-4 — Single-player game memory leak

**Source:** `backend/internal/game/store.go`  
**What:** `game.Store` has the same TTL problem as FU-3 — games accumulate until restart.  
**Fix:** Same TTL sweeping approach: `LastTouchedAt` field + a sweeper goroutine.

## FU-5 — Sharded hub registry lock

**Source:** `backend/internal/realtime/registry.go`  
**What:** The `HubRegistry` uses a single `sync.Mutex`. If many rooms connect simultaneously the registry mutex becomes contended.  
**Fix:** Shard the registry into N buckets, each with its own lock, keyed by `hash(roomCode) % N`.

## FU-6 — Host migration has no frontend notification

**Source:** `frontend/src/app/room/[code]/page.tsx`  
**What:** When `migrateHost` fires server-side, the `youAreHost` flag flips to `true` in the WS broadcast. The new host's Start/Next Round buttons appear correctly, but there is no explicit notification to the player that they have been promoted.  
**Status:** A toast "You are now the host." has been added in this pass (C7). Consider also adding a banner for the lobby state if the host disconnects before the round starts.

## FU-7 — No backend preview deployments

**Source:** `render.yaml`  
**What:** Vercel creates a preview deployment per PR for the frontend. Render free tier has no equivalent — there is only one service. Backend changes can't be previewed in isolation; the PR preview frontend always hits the production backend.  
**Fix:** Requires a paid Render plan (preview environments) or a separate staging service wired to a staging branch.

## FU-8 — Cold start cannot be fully eliminated on free tier

**Source:** Render free tier behaviour  
**What:** The wake-up overlay in D1 mitigates the cold-start UX impact, but the underlying delay (30–60 seconds after 15 minutes idle) remains. The overlay is a band-aid, not a fix.  
**Fix:** Upgrade to a paid Render plan (always-on), or add a scheduled ping (e.g. cron hitting `/api/health` every 10 minutes) to prevent spin-down. The ping approach is free but burns request quota.
