"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ApiError, RoomState, RoomPlayer,
  getRoom, joinRoom, startRound, submitRoomGuess, nextRound,
} from "@/lib/api";
import { getRoomToken, setRoomToken, clearRoomToken } from "@/lib/tokens";
import Game, { ScoredGuess } from "@/components/Game";
import Scoreboard from "@/components/Scoreboard";
import FinishModal from "@/components/FinishModal";

// ---- polling hook -----------------------------------------------------------

// enabled=false keeps the hook idle (isLoading=true, error=null) until we know
// the token. This prevents a transient 404 error from flashing on screen before
// the localStorage read completes.
function useRoomPolling(code: string, token: string | null, enabled: boolean) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const poll = useCallback(async () => {
    if (!mountedRef.current) return;
    if (document.visibilityState !== "visible") {
      timerRef.current = setTimeout(poll, 1500);
      return;
    }
    try {
      const state = await getRoom(code, tokenRef.current);
      if (!mountedRef.current) return;
      setRoom(state);
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof ApiError ? e.code : "network");
    } finally {
      if (mountedRef.current) {
        timerRef.current = setTimeout(poll, 1500);
      }
    }
  }, [code]);

  const refetch = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    poll();
  }, [poll]);

  useEffect(() => {
    if (!enabled) return; // wait until tokenReady before polling

    mountedRef.current = true;
    setIsLoading(true);

    poll().then(() => {
      if (mountedRef.current) setIsLoading(false);
    });

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (timerRef.current) clearTimeout(timerRef.current);
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [poll, enabled]);

  return { room, setRoom, error, isLoading, refetch };
}

// ---- main component ---------------------------------------------------------

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const code = (params.code as string).toUpperCase();

  // Token state — read from localStorage on mount
  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    setToken(getRoomToken(code));
    setTokenReady(true);
  }, [code]);

  const { room, setRoom, error, isLoading } = useRoomPolling(code, token, tokenReady);

  // Join form state
  const [joinName, setJoinName] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  // Action loading states
  const [startLoading, setStartLoading] = useState(false);
  const [nextRoundLoading, setNextRoundLoading] = useState(false);

  // Modal: show when myPlayer is done (solved/out)
  const [modalDismissed, setModalDismissed] = useState(false);

  // Track round identity — reset modalDismissed when a new round starts
  const prevStartedAt = useRef<string | null>(null);
  useEffect(() => {
    if (room?.startedAt && room.startedAt !== prevStartedAt.current) {
      prevStartedAt.current = room.startedAt;
      setModalDismissed(false);
    }
  }, [room?.startedAt]);

  // ---- derived state --------------------------------------------------------

  const myPlayer: RoomPlayer | undefined =
    room?.players.find((p) => p.isYou);

  const hasToken = token !== null;
  // Token is stale if we have one but no player has isYou=true after first load
  const tokenStale = !isLoading && hasToken && room !== null && myPlayer === undefined;

  useEffect(() => {
    if (tokenStale) {
      clearRoomToken(code);
      setToken(null);
    }
  }, [tokenStale, code]);

  const showModal =
    !modalDismissed &&
    myPlayer !== undefined &&
    (myPlayer.status === "solved" || myPlayer.status === "out");

  // ---- actions --------------------------------------------------------------

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setJoinError(null);
    setJoining(true);
    try {
      const res = await joinRoom(code, joinName.trim());
      setRoomToken(code, res.playerToken);
      setToken(res.playerToken);
      setRoom(res.state);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "not_found") setJoinError("Room not found.");
        else if (err.code === "name_taken") setJoinError("That name is already taken.");
        else if (err.code === "invalid_name") setJoinError("Name must be 1–20 alphanumeric characters.");
        else if (err.code === "not_joinable") setJoinError("This room is already in progress.");
        else setJoinError(err.message);
      } else {
        setJoinError("Couldn't reach the server.");
      }
    } finally {
      setJoining(false);
    }
  }

  async function handleStart() {
    if (!token) return;
    setStartLoading(true);
    try {
      const state = await startRound(code, token);
      setRoom(state);
    } catch { /* polling will pick up changes */ }
    finally { setStartLoading(false); }
  }

  async function handleNextRound() {
    if (!token) return;
    setNextRoundLoading(true);
    try {
      const state = await nextRound(code, token);
      setRoom(state);
    } catch { /* polling will pick up changes */ }
    finally { setNextRoundLoading(false); }
  }

  async function handleGuessSubmit(guess: string) {
    if (!token) return;
    try {
      const state = await submitRoomGuess(code, token, guess);
      setRoom(state);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "not_a_word") throw new Error("Not in word list");
        if (e.code === "invalid_guess") throw new Error("Not enough letters");
        if (e.code === "not_found") throw new Error("Room not found");
      }
      throw new Error("Couldn't reach the server");
    }
  }

  function copyRoomLink() {
    navigator.clipboard.writeText(window.location.href).catch(() => {});
  }

  // ---- render ---------------------------------------------------------------

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    background: "#121213",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 24,
  };

  // Not ready yet
  if (!tokenReady || isLoading) {
    return (
      <main style={{ ...pageStyle, justifyContent: "center" }}>
        <span style={{ color: "#ffffff", fontSize: 20, fontWeight: 600 }}>Loading…</span>
      </main>
    );
  }

  // Room not found
  if (error === "not_found") {
    return (
      <main style={{ ...pageStyle, justifyContent: "center", gap: 16 }}>
        <p style={{ color: "#ffffff", fontWeight: 700, fontSize: 20 }}>Room not found</p>
        <button onClick={() => router.push("/")} style={primaryBtn}>Back to home</button>
      </main>
    );
  }

  // Network error (and no cached room)
  if (error && !room) {
    return (
      <main style={{ ...pageStyle, justifyContent: "center" }}>
        <p style={{ color: "#b59f3b", fontWeight: 600 }}>Couldn't reach the server</p>
      </main>
    );
  }

  // No token → show join form
  if (!token || tokenStale) {
    return (
      <main style={{ ...pageStyle, justifyContent: "center" }}>
        <form onSubmit={handleJoin} style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 280 }}>
          <p style={{ color: "#818384", fontSize: 13, textAlign: "center", margin: 0, letterSpacing: 1 }}>
            ROOM
          </p>
          <p style={{ color: "#ffffff", fontWeight: 700, fontSize: 32, letterSpacing: 12, textAlign: "center", margin: 0 }}>
            {code}
          </p>
          <input
            autoFocus
            placeholder="Your name"
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
            maxLength={20}
            style={inputStyle}
          />
          {joinError && <p style={errorStyle}>{joinError}</p>}
          <button type="submit" disabled={joining || !joinName.trim()} style={primaryBtn}>
            {joining ? "Joining…" : "Join Room"}
          </button>
          <a href="/" style={{ color: "#818384", fontSize: 13, textAlign: "center", textDecoration: "none" }}>← Back</a>
        </form>
      </main>
    );
  }

  if (!room) return null;

  // ---- LOBBY ----------------------------------------------------------------
  if (room.status === "lobby") {
    return (
      <main style={pageStyle}>
        <Header />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, width: "100%", maxWidth: 400 }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ color: "#818384", fontSize: 12, letterSpacing: 2, marginBottom: 4, textTransform: "uppercase" }}>Room code</p>
            <p style={{ color: "#ffffff", fontWeight: 700, fontSize: 40, letterSpacing: 12, margin: "0 0 12px" }}>{code}</p>
            <button onClick={copyRoomLink} style={secondaryBtn}>Copy link</button>
          </div>

          <div style={{ width: "100%", borderTop: "1px solid #3a3a3c", paddingTop: 20 }}>
            <p style={{ color: "#818384", fontSize: 11, fontWeight: 700, letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}>
              Players ({room.players.length})
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {room.players.map((p) => (
                <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, color: "#ffffff", fontSize: 15 }}>
                  <span>{p.name}</span>
                  {p.isHost && <span style={{ color: "#538d4e", fontSize: 11, fontWeight: 700 }}>HOST</span>}
                  {p.isYou && <span style={{ color: "#818384", fontSize: 12 }}>(you)</span>}
                </div>
              ))}
            </div>
          </div>

          {room.youAreHost ? (
            <button
              onClick={handleStart}
              disabled={startLoading || room.players.length < 1}
              style={primaryBtn}
            >
              {startLoading ? "Starting…" : "Start Round"}
            </button>
          ) : (
            <p style={{ color: "#818384", fontSize: 14 }}>Waiting for host to start…</p>
          )}
        </div>
      </main>
    );
  }

  // ---- PLAYING / FINISHED ---------------------------------------------------

  const myGuesses: ScoredGuess[] = (myPlayer?.guesses ?? []).map((g) => ({
    word: g.word,
    scoring: g.scoring,
  }));

  const myStatus =
    myPlayer?.status === "solved" ? "solved"
    : myPlayer?.status === "out"    ? "out"
    : "playing";

  // Round key: use startedAt so tiles fully remount each new round
  const roundKey = `${code}-${room.startedAt ?? "lobby"}`;

  return (
    <main style={pageStyle}>
      <Header />

      {showModal && myPlayer && (
        <FinishModal
          myPlayer={myPlayer}
          roomStatus={room.status}
          players={room.players}
          ranking={room.ranking}
          target={room.target}
          youAreHost={room.youAreHost}
          onNextRound={handleNextRound}
          onDismiss={() => setModalDismissed(true)}
          nextRoundLoading={nextRoundLoading}
        />
      )}

      <div style={{ display: "flex", flexDirection: "row", gap: 40, alignItems: "flex-start", width: "100%", maxWidth: 720, justifyContent: "center" }}>
        {/* Game grid */}
        <div style={{ flex: "0 0 auto" }}>
          <Game
            instanceKey={roundKey}
            length={room.length}
            maxGuesses={room.maxGuesses}
            guesses={myGuesses}
            status={myStatus}
            onSubmit={handleGuessSubmit}
            disabled={myStatus !== "playing" || room.status === "finished"}
          />
        </div>

        {/* Scoreboard */}
        <div style={{ paddingTop: 44 }}>
          <Scoreboard players={room.players} status={room.status} />

          {room.status === "finished" && !showModal && (
            <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
              {room.target && (
                <p style={{ color: "#818384", fontSize: 14, margin: 0 }}>
                  Word: <strong style={{ color: "#ffffff", letterSpacing: 3 }}>{room.target}</strong>
                </p>
              )}
              {room.youAreHost ? (
                <button onClick={handleNextRound} disabled={nextRoundLoading} style={primaryBtn}>
                  {nextRoundLoading ? "Starting…" : "Next Round"}
                </button>
              ) : (
                <p style={{ color: "#818384", fontSize: 13, margin: 0 }}>Waiting for host to start…</p>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// ---- shared sub-components --------------------------------------------------

function Header() {
  return (
    <h1 style={{
      color: "#ffffff", fontSize: 24, fontWeight: 700, letterSpacing: 4,
      borderBottom: "1px solid #3a3a3c", width: "100%", maxWidth: 720,
      textAlign: "center", paddingBottom: 12, marginBottom: 20,
    }}>
      WORDLE ROOMS
    </h1>
  );
}

// ---- styles -----------------------------------------------------------------

const primaryBtn: React.CSSProperties = {
  background: "#538d4e", color: "#ffffff", border: "none", borderRadius: 4,
  padding: "12px 24px", fontWeight: 700, fontSize: 15, cursor: "pointer",
  letterSpacing: 1, width: "100%",
};

const secondaryBtn: React.CSSProperties = {
  background: "#3a3a3c", color: "#ffffff", border: "none", borderRadius: 4,
  padding: "8px 20px", fontWeight: 600, fontSize: 13, cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  background: "#1a1a1b", color: "#ffffff", border: "1px solid #3a3a3c",
  borderRadius: 4, padding: "12px 14px", fontSize: 16, outline: "none",
  fontFamily: "inherit",
};

const errorStyle: React.CSSProperties = {
  color: "#b59f3b", fontSize: 13, textAlign: "center", margin: 0,
};
