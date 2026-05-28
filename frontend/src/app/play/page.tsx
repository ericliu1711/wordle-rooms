"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, GameState, createGame, getGame, submitGuess } from "@/lib/api";
import Game, { ScoredGuess } from "@/components/Game";

export default function PlayPage() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showStatus = useCallback((msg: string) => {
    setStatusMsg(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatusMsg(null), 3000);
  }, []);

  useEffect(() => {
    async function init() {
      const params = new URLSearchParams(window.location.search);
      const id = params.get("game");

      let state: GameState | null = null;

      if (id) {
        try {
          state = await getGame(id);
          window.history.replaceState(null, "", `?game=${state.gameId}`);
        } catch (e) {
          if (e instanceof ApiError && e.code === "not_found") {
            showStatus("Game not found, started a new one");
            state = null;
          } else {
            showStatus("Couldn't reach the server");
            setLoading(false);
            return;
          }
        }
      }

      if (!state) {
        try {
          state = await createGame();
          window.history.replaceState(null, "", `?game=${state.gameId}`);
        } catch {
          showStatus("Couldn't reach the server");
          setLoading(false);
          return;
        }
      }

      setGameState(state);
      setLoading(false);
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(
    async (guess: string) => {
      if (!gameState) return;
      try {
        const newState = await submitGuess(gameState.gameId, guess);
        setGameState(newState);
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.code === "not_a_word") throw new Error("Not in word list");
          if (e.code === "invalid_guess" || e.code === "bad_request") throw new Error("That guess isn't valid");
          if (e.code === "not_found") throw new Error("Game not found");
        }
        throw new Error("Couldn't reach the server");
      }
    },
    [gameState]
  );

  const resetGame = useCallback(async () => {
    try {
      const newState = await createGame();
      window.history.replaceState(null, "", `?game=${newState.gameId}`);
      setGameState(newState);
      setStatusMsg(null);
    } catch {
      showStatus("Couldn't reach the server");
    }
  }, [showStatus]);

  if (loading) {
    return (
      <main style={{ minHeight: "100vh", background: "#121213", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#ffffff", fontSize: 20, fontWeight: 600 }}>Loading…</span>
      </main>
    );
  }

  if (!gameState) return null;

  const guesses: ScoredGuess[] = gameState.guesses.map((g) => ({
    word: g.word,
    scoring: g.scoring,
  }));

  const status =
    gameState.status === "won" ? "won"
    : gameState.status === "lost" ? "lost"
    : "playing";

  return (
    <main style={{ minHeight: "100vh", background: "#121213", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 24, paddingBottom: 24 }}>
      {/* Header */}
      <h1 style={{ color: "#ffffff", fontSize: 28, fontWeight: 700, letterSpacing: 4, borderBottom: "1px solid #3a3a3c", width: "100%", maxWidth: 500, textAlign: "center", paddingBottom: 12, marginBottom: 16 }}>
        WORDLE
      </h1>

      {/* Status message (win/lose) */}
      <div style={{ height: 36, display: "flex", alignItems: "center", marginBottom: 8 }}>
        {statusMsg ? (
          <div style={{ background: "#ffffff", color: "#121213", borderRadius: 4, padding: "6px 14px", fontWeight: 700, fontSize: 14 }}>
            {statusMsg}
          </div>
        ) : gameState.status === "won" ? (
          <div style={{ color: "#538d4e", fontWeight: 700, fontSize: 18 }}>
            Solved in {gameState.guesses.length}!
          </div>
        ) : gameState.status === "lost" ? (
          <div style={{ color: "#b59f3b", fontWeight: 700, fontSize: 18 }}>
            The word was {gameState.target}
          </div>
        ) : null}
      </div>

      <Game
        key={gameState.gameId}
        instanceKey={gameState.gameId}
        length={gameState.length}
        maxGuesses={gameState.maxGuesses}
        guesses={guesses}
        status={status}
        onSubmit={handleSubmit}
        disabled={gameState.status !== "playing"}
      />

      {gameState.status !== "playing" && (
        <button
          onClick={resetGame}
          style={{ marginTop: 24, background: "#538d4e", color: "#ffffff", border: "none", borderRadius: 4, padding: "12px 28px", fontWeight: 700, fontSize: 16, cursor: "pointer", letterSpacing: 1 }}
        >
          New Game
        </button>
      )}
    </main>
  );
}
