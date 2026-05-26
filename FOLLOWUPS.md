# Follow-up items noted during the pre-Phase-6 fixes

These issues were observed but are out of scope for the current fix pass.

## FU-1 — `setToken(null)` called synchronously inside a `useEffect`

**File:** `frontend/src/app/room/[code]/page.tsx` (the `tokenStale` cleanup effect)  
**What:** The effect calls `setToken(null)` directly in its body rather than in a callback. React's experimental linter rule flags this as a potential cascading-render concern.  
**Impact:** Low — the effect only fires when a stale token is detected (rare path), and the cascade is a single extra render. No user-visible issue observed.  
**Fix:** Derive the cleared token from state instead of calling `setToken` inside an effect, or restructure the token lifecycle so the stale detection is done in the render path rather than an effect.
