"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, GameState, createGame, getGame, submitGuess } from "@/lib/api";

// ---- types ------------------------------------------------------------------

type TileState = "empty" | "filled" | "correct" | "present" | "absent";
type KeyState = "correct" | "present" | "absent" | "unused";

interface TileData {
  letter: string;
  state: TileState;
}

// ---- constants --------------------------------------------------------------

const WORD_LENGTH = 5;

const KEYBOARD_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Enter", "Z", "X", "C", "V", "B", "N", "M", "Backspace"],
];

const TILE_COLORS: Record<TileState, { bg: string; border: string }> = {
  empty:   { bg: "transparent", border: "#3a3a3c" },
  filled:  { bg: "transparent", border: "#565758" },
  correct: { bg: "#538d4e",     border: "#538d4e" },
  present: { bg: "#b59f3b",     border: "#b59f3b" },
  absent:  { bg: "#3a3a3c",     border: "#3a3a3c" },
};

const KEY_COLORS: Record<KeyState, { bg: string }> = {
  unused:  { bg: "#818384" },
  correct: { bg: "#538d4e" },
  present: { bg: "#b59f3b" },
  absent:  { bg: "#3a3a3c" },
};

// ---- helpers ----------------------------------------------------------------

function scoringToState(s: "green" | "yellow" | "gray"): TileState {
  if (s === "green") return "correct";
  if (s === "yellow") return "present";
  return "absent";
}

function buildGrid(
  gameState: GameState,
  currentLetters: string[]
): TileData[][] {
  const rows: TileData[][] = [];

  for (const { word, scoring } of gameState.guesses) {
    rows.push(
      word.split("").map((letter, i) => ({
        letter,
        state: scoringToState(scoring[i]),
      }))
    );
  }

  if (gameState.status === "playing" && rows.length < gameState.maxGuesses) {
    const row: TileData[] = [];
    for (let i = 0; i < gameState.length; i++) {
      row.push({
        letter: currentLetters[i] ?? "",
        state: currentLetters[i] ? "filled" : "empty",
      });
    }
    rows.push(row);
  }

  while (rows.length < gameState.maxGuesses) {
    rows.push(
      Array.from({ length: gameState.length }, () => ({
        letter: "",
        state: "empty" as TileState,
      }))
    );
  }

  return rows;
}

// ---- Tile -------------------------------------------------------------------

interface TileProps {
  letter: string;
  state: TileState;
  flipDelay?: number;
  bounce?: boolean;
  bounceDelay?: number;
}

function isScored(s: TileState): s is "correct" | "present" | "absent" {
  return s === "correct" || s === "present" || s === "absent";
}

function Tile({ letter, state, flipDelay, bounce, bounceDelay }: TileProps) {
  // displayState: scored color revealed at flip midpoint (not used for empty/filled).
  // preFlipColor: what the tile showed *before* scoring — held as state so it's safe
  //   to read during render; set inside the setTimeout (deferred), not synchronously.
  const [displayState, setDisplayState] = useState<TileState>(state);
  const [preFlipColor, setPreFlipColor] = useState<TileState>(state);
  const [flipping, setFlipping] = useState<"front" | "back" | null>(null);
  const [popClass, setPopClass] = useState("");
  const prevLetter = useRef(letter);
  const prevState = useRef(state);

  // Pop when a letter is typed into this tile
  useEffect(() => {
    if (letter && letter !== prevLetter.current && state === "filled") {
      setPopClass("tile-pop");
      const t = setTimeout(() => setPopClass(""), 80);
      prevLetter.current = letter;
      return () => clearTimeout(t);
    }
    prevLetter.current = letter;
  }, [letter, state]);

  // Flip when state transitions to a scored value.
  // All setX calls are inside setTimeout callbacks (deferred), never synchronous in the body.
  useEffect(() => {
    if (prevState.current !== state && isScored(state) && flipDelay !== undefined) {
      const captured = prevState.current; // pre-flip color to show during front half
      prevState.current = state;
      const t1 = setTimeout(() => {
        setPreFlipColor(captured); // batched with setFlipping in same tick
        setFlipping("front");
        const t2 = setTimeout(() => {
          setDisplayState(state);
          setFlipping("back");
          const t3 = setTimeout(() => setFlipping(null), 250);
          return () => clearTimeout(t3);
        }, 250);
        return () => clearTimeout(t2);
      }, flipDelay);
      return () => clearTimeout(t1);
    }
    prevState.current = state;
  }, [state, flipDelay]); // preFlipColor intentionally omitted — we only write it, never read it here

  // During front flip: show what the tile looked like before scoring.
  // Scored tiles at rest / back-flip: show displayState (revealed at midpoint).
  // Unscored tiles (empty/filled): read state prop directly — no setState needed.
  const colorKey: TileState =
    flipping === "front" ? preFlipColor
    : isScored(state)   ? displayState
    :                     state;

  const colors = TILE_COLORS[colorKey];
  const bounceStyle =
    bounce && bounceDelay !== undefined
      ? { animationDelay: `${bounceDelay}ms` }
      : {};

  return (
    <div
      className={[
        popClass,
        bounce ? "tile-bounce" : "",
        flipping === "front" ? "tile-flip-front" : "",
        flipping === "back" ? "tile-flip-back" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        width: 62,
        height: 62,
        border: `2px solid ${colors.border}`,
        background: colors.bg,
        color: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 32,
        fontWeight: 700,
        userSelect: "none",
        ...bounceStyle,
      }}
    >
      {letter}
    </div>
  );
}

// ---- Main game --------------------------------------------------------------

export default function Home() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentLetters, setCurrentLetters] = useState<string[]>([]);
  const [shakingRow, setShakingRow] = useState<number | null>(null);
  const [justRevealedRow, setJustRevealedRow] = useState<number | null>(null);
  const [bouncingRow, setBouncingRow] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittingRef = useRef(false);

  const showToast = useCallback((msg: string, duration = 3000) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), duration);
  }, []);

  // On mount: resume from URL or create a new game
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
            showToast("Game not found, started a new one");
            state = null;
          } else {
            showToast("Couldn't reach the server");
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
          showToast("Couldn't reach the server");
          setLoading(false);
          return;
        }
      }

      setGameState(state);
      setLoading(false);
    }

    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived: keyboard letter states from all scored guesses
  const keyStates = useMemo<Record<string, KeyState>>(() => {
    if (!gameState) return {};
    const result: Record<string, KeyState> = {};
    for (const { word, scoring } of gameState.guesses) {
      for (let i = 0; i < word.length; i++) {
        const letter = word[i];
        const s = scoring[i];
        const current = result[letter];
        if (s === "green") {
          result[letter] = "correct";
        } else if (s === "yellow" && current !== "correct") {
          result[letter] = "present";
        } else if (s === "gray" && !current) {
          result[letter] = "absent";
        }
      }
    }
    return result;
  }, [gameState]);

  const handleKey = useCallback(
    async (key: string) => {
      if (!gameState || gameState.status !== "playing" || submittingRef.current)
        return;

      if (key === "Backspace") {
        setCurrentLetters((prev) => prev.slice(0, -1));
        return;
      }

      if (key === "Enter") {
        if (currentLetters.length < WORD_LENGTH) {
          const rowIdx = gameState.guesses.length;
          setShakingRow(rowIdx);
          showToast("Not enough letters", 1500);
          setTimeout(() => setShakingRow(null), 400);
          return;
        }

        submittingRef.current = true;
        const guess = currentLetters.join("");
        const rowIdx = gameState.guesses.length;

        try {
          const newState = await submitGuess(gameState.gameId, guess);
          const flipDuration = WORD_LENGTH * 250 + 600;

          setCurrentLetters([]);
          setJustRevealedRow(rowIdx);
          setGameState(newState);

          setTimeout(() => setJustRevealedRow(null), flipDuration);

          if (newState.status === "won") {
            setTimeout(() => setBouncingRow(rowIdx), flipDuration);
          }
        } catch (e) {
          if (e instanceof ApiError) {
            if (e.code === "invalid_guess" || e.code === "bad_request") {
              showToast("That guess isn't valid");
            } else if (e.code === "not_found") {
              showToast("Game not found, started a new one");
            } else {
              showToast("Couldn't reach the server");
            }
          } else {
            showToast("Couldn't reach the server");
          }
        } finally {
          submittingRef.current = false;
        }
        return;
      }

      if (/^[A-Z]$/.test(key) && currentLetters.length < WORD_LENGTH) {
        setCurrentLetters((prev) => [...prev, key]);
      }
    },
    [gameState, currentLetters, showToast]
  );

  // Physical keyboard listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Enter") { handleKey("Enter"); return; }
      if (e.key === "Backspace") { handleKey("Backspace"); return; }
      const letter = e.key.toUpperCase();
      if (/^[A-Z]$/.test(letter)) handleKey(letter);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleKey]);

  const resetGame = useCallback(async () => {
    try {
      const newState = await createGame();
      window.history.replaceState(null, "", `?game=${newState.gameId}`);
      setGameState(newState);
      setCurrentLetters([]);
      setJustRevealedRow(null);
      setBouncingRow(null);
      setShakingRow(null);
      setToast(null);
    } catch {
      showToast("Couldn't reach the server");
    }
  }, [showToast]);

  // ---- render ----------------------------------------------------------------

  if (loading) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "#121213",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ color: "#ffffff", fontSize: 20, fontWeight: 600 }}>
          Loading…
        </span>
      </main>
    );
  }

  if (!gameState) return null;

  const grid = buildGrid(gameState, currentLetters);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#121213",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 24,
        paddingBottom: 24,
      }}
    >
      {/* Header */}
      <h1
        style={{
          color: "#ffffff",
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: 4,
          borderBottom: "1px solid #3a3a3c",
          width: "100%",
          maxWidth: 500,
          textAlign: "center",
          paddingBottom: 12,
          marginBottom: 16,
        }}
      >
        WORDLE
      </h1>

      {/* Toast / status message */}
      <div
        style={{
          height: 36,
          display: "flex",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        {toast ? (
          <div
            style={{
              background: "#ffffff",
              color: "#121213",
              borderRadius: 4,
              padding: "6px 14px",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            {toast}
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

      {/* Grid */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 5,
          marginBottom: 24,
        }}
      >
        {grid.map((row, rowIdx) => (
          <div
            key={rowIdx}
            className={shakingRow === rowIdx ? "row-shake" : ""}
            style={{ display: "flex", gap: 5 }}
          >
            {row.map((tile, colIdx) => (
              <Tile
                key={`${gameState.gameId}-${rowIdx}-${colIdx}`}
                letter={tile.letter}
                state={tile.state}
                flipDelay={
                  justRevealedRow === rowIdx ? colIdx * 250 : undefined
                }
                bounce={bouncingRow === rowIdx}
                bounceDelay={colIdx * 100}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Keyboard */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: "center",
        }}
      >
        {KEYBOARD_ROWS.map((row, rIdx) => (
          <div key={rIdx} style={{ display: "flex", gap: 6 }}>
            {row.map((key) => {
              const isWide = key === "Enter" || key === "Backspace";
              const ks = keyStates[key] ?? "unused";
              return (
                <button
                  key={key}
                  onClick={() => handleKey(key)}
                  style={{
                    width: isWide ? 65 : 43,
                    height: 58,
                    background: KEY_COLORS[ks].bg,
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 4,
                    fontWeight: 700,
                    fontSize: isWide ? 12 : 16,
                    cursor: "pointer",
                    userSelect: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "inherit",
                  }}
                >
                  {key === "Backspace" ? "⌫" : key}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* New game */}
      {gameState.status !== "playing" && (
        <button
          onClick={resetGame}
          style={{
            marginTop: 24,
            background: "#538d4e",
            color: "#ffffff",
            border: "none",
            borderRadius: 4,
            padding: "12px 28px",
            fontWeight: 700,
            fontSize: 16,
            cursor: "pointer",
            letterSpacing: 1,
          }}
        >
          New Game
        </button>
      )}

    </main>
  );
}
