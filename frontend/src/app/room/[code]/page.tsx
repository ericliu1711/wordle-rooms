"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ApiError, RoomState, RoomPlayer,
  getRoom, joinRoom, startRound, submitRoomGuess, nextRound,
} from "@/lib/api";
import { getRoomToken, setRoomToken, clearRoomToken } from "@/lib/tokens";
import { useRoomSocket } from "@/lib/useRoomSocket";
import Game, { ScoredGuess } from "@/components/Game";
import Scoreboard from "@/components/Scoreboard";
import FinishModal from "@/components/FinishModal";

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

  // WebSocket connection — only opens once token is available
  const { room, isConnected, isReconnecting, error: wsError, applyServerResponse } =
    useRoomSocket(code, tokenReady ? token : null);

  // Initial HTTP fetch: gives us state before the WS handshake completes.
  const [initialLoading, setInitialLoading] = useState(true);
  useEffect(() => {
    if (!tokenReady) return;
    if (!token) { setInitialLoading(false); return; }
    getRoom(code, token)
      .then(applyServerResponse)
      .catch(() => { /* WS error handling covers failures */ })
      .finally(() => setInitialLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenReady, token, code]); // applyServerResponse is stable (useCallback)

  // Join form state
  const [joinName, setJoinName] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  // Action loading states
  const [startLoading, setStartLoading] = useState(false);
  const [nextRoundLoading, setNextRoundLoading] = useState(false);

  // Holds the room state from the most recent successful guess HTTP response.
  // Applied via onGuessConfirmed (called in the same React batch as setCurrentLetters)
  // to avoid a one-frame flash where the scored row and the active input row coexist.
  const pendingGuessState = useRef<RoomState | null>(null);

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

  const myPlayer: RoomPlayer | undefined = room?.players.find((p) => p.isYou);

  const hasToken = token !== null;
  // Token is stale if we have one but no player has isYou=true after first load
  const tokenStale = !initialLoading && hasToken && room !== null && myPlayer === undefined;

  useEffect(() => {
    if (tokenStale) {
      clearRoomToken(code);
      setToken(null);
    }
  }, [tokenStale, code]);

  // Redirect when the WS gives up because the room no longer exists.
  useEffect(() => {
    if (wsError === "not_found") {
      router.push("/?roomGone=1");
    }
  }, [wsError, router]);

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
      applyServerResponse(res.state);
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
      applyServerResponse(state);
    } catch { /* WS broadcast will deliver the update */ }
    finally { setStartLoading(false); }
  }

  async function handleNextRound() {
    if (!token) return;
    setNextRoundLoading(true);
    try {
      const state = await nextRound(code, token);
      applyServerResponse(state);
    } catch { /* WS broadcast will deliver the update */ }
    finally { setNextRoundLoading(false); }
  }

  async function handleGuessSubmit(guess: string) {
    if (!token) return;
    try {
      const state = await submitRoomGuess(code, token, guess);
      // Store result; applied by handleGuessConfirmed (called by Game in the
      // same batch as setCurrentLetters) to avoid a duplicate-row flash.
      pendingGuessState.current = state;
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "not_a_word") throw new Error("Not in word list");
        if (e.code === "invalid_guess") throw new Error("Not enough letters");
        if (e.code === "not_found") throw new Error("Room not found");
      }
      throw new Error("Couldn't reach the server");
    }
  }

  function handleGuessConfirmed() {
    if (pendingGuessState.current) {
      applyServerResponse(pendingGuessState.current);
      pendingGuessState.current = null;
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
  if (!tokenReady || initialLoading) {
    return (
      <main style={{ ...pageStyle, justifyContent: "center" }}>
        <span style={{ color: "#ffffff", fontSize: 20, fontWeight: 600 }}>Loading…</span>
      </main>
    );
  }

  // Room permanently gone (server wiped it) — redirect effect handles navigation;
  // render nothing while the redirect fires.
  if (wsError === "not_found") return null;

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
        <ReconnectingBanner show={isReconnecting} />
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
      <ReconnectingBanner show={isReconnecting} />

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
            onGuessConfirmed={handleGuessConfirmed}
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

      {/* Connection dot — subtle indicator in corner when connected */}
      {isConnected && (
        <div style={{ position: "fixed", bottom: 12, right: 14, width: 8, height: 8, borderRadius: "50%", background: "#538d4e", opacity: 0.6 }} />
      )}
    </main>
  );
}

// ---- sub-components ---------------------------------------------------------

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

function ReconnectingBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0,
      background: "#b59f3b", color: "#121213",
      textAlign: "center", padding: "8px 16px",
      fontWeight: 700, fontSize: 13, letterSpacing: 1,
      zIndex: 100,
    }}>
      RECONNECTING…
    </div>
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
  padding: "8px 12px", background: "rgba(181,159,59,0.12)",
  border: "1px solid rgba(181,159,59,0.35)", borderRadius: 4,
};
