"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

// ---- types ------------------------------------------------------------------

export type ScoredGuess = {
  word: string;
  scoring: ("green" | "yellow" | "gray")[];
};

export type GameStatus = "playing" | "won" | "lost" | "solved" | "out";

type TileState = "empty" | "filled" | "correct" | "present" | "absent";
type KeyState = "correct" | "present" | "absent" | "unused";

interface TileData {
  letter: string;
  state: TileState;
}

// ---- constants --------------------------------------------------------------

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
  guesses: ScoredGuess[],
  currentLetters: string[],
  length: number,
  maxGuesses: number,
  status: GameStatus
): TileData[][] {
  const rows: TileData[][] = [];

  for (const { word, scoring } of guesses) {
    rows.push(
      word.split("").map((letter, i) => ({
        letter,
        state: scoringToState(scoring[i]),
      }))
    );
  }

  if ((status === "playing") && rows.length < maxGuesses) {
    const row: TileData[] = [];
    for (let i = 0; i < length; i++) {
      row.push({
        letter: currentLetters[i] ?? "",
        state: currentLetters[i] ? "filled" : "empty",
      });
    }
    rows.push(row);
  }

  while (rows.length < maxGuesses) {
    rows.push(
      Array.from({ length }, () => ({ letter: "", state: "empty" as TileState }))
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
  rowKey: string;
}

function isScored(s: TileState): s is "correct" | "present" | "absent" {
  return s === "correct" || s === "present" || s === "absent";
}

function Tile({ letter, state, flipDelay, bounce, bounceDelay }: TileProps) {
  const [displayState, setDisplayState] = useState<TileState>(state);
  const [preFlipColor, setPreFlipColor] = useState<TileState>(state);
  const [flipping, setFlipping] = useState<"front" | "back" | null>(null);
  const [popClass, setPopClass] = useState("");
  const prevLetter = useRef(letter);
  const prevState = useRef(state);

  useEffect(() => {
    if (letter && letter !== prevLetter.current && state === "filled") {
      setPopClass("tile-pop");
      const t = setTimeout(() => setPopClass(""), 80);
      prevLetter.current = letter;
      return () => clearTimeout(t);
    }
    prevLetter.current = letter;
  }, [letter, state]);

  useEffect(() => {
    if (prevState.current !== state && isScored(state)) {
      if (flipDelay !== undefined) {
        const captured = prevState.current;
        prevState.current = state;

        // Track all three timers so the cleanup can cancel any that are
        // still pending if the component unmounts mid-animation.
        let t2: ReturnType<typeof setTimeout>;
        let t3: ReturnType<typeof setTimeout>;

        const t1 = setTimeout(() => {
          setPreFlipColor(captured);
          setFlipping("front");
          t2 = setTimeout(() => {
            setDisplayState(state);
            setFlipping("back");
            t3 = setTimeout(() => setFlipping(null), 250);
          }, 250);
        }, flipDelay);

        return () => {
          clearTimeout(t1);
          clearTimeout(t2);
          clearTimeout(t3);
        };
      } else {
        // No animation window (e.g. existing guesses on mount or polling update):
        // update displayState immediately so the colour still shows.
        setDisplayState(state);
      }
    }
    prevState.current = state;
  }, [state, flipDelay]);

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
      className={[popClass, bounce ? "tile-bounce" : "", flipping === "front" ? "tile-flip-front" : "", flipping === "back" ? "tile-flip-back" : ""].filter(Boolean).join(" ")}
      style={{
        width: 62, height: 62,
        border: `2px solid ${colors.border}`,
        background: colors.bg,
        color: "#ffffff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 32, fontWeight: 700, userSelect: "none",
        ...bounceStyle,
      }}
    >
      {letter}
    </div>
  );
}

// ---- Game component ---------------------------------------------------------

export interface GameProps {
  /** Unique key prefix — include gameId or round identifier so tiles remount on new game/round. */
  instanceKey: string;
  length: number;
  maxGuesses: number;
  guesses: ScoredGuess[];
  status: GameStatus;
  /** Called when the player submits a complete word. Reject/throw to trigger shake + toast. */
  onSubmit: (guess: string) => Promise<void>;
  /**
   * Called in the same synchronous block as setCurrentLetters([]) after a
   * successful submit. Lets the parent apply room-state updates in the same
   * React batch so the scored row and the cleared input are committed together,
   * preventing a one-frame flash where the typed word appears in both the
   * scored row and the active input row simultaneously.
   */
  onGuessConfirmed?: () => void;
  /** Disable keyboard input (e.g. player is done, round over). */
  disabled?: boolean;
}

export default function Game({ instanceKey, length, maxGuesses, guesses, status, onSubmit, onGuessConfirmed, disabled }: GameProps) {
  const [currentLetters, setCurrentLetters] = useState<string[]>([]);
  const [shakingRow, setShakingRow] = useState<number | null>(null);
  const [justRevealedRow, setJustRevealedRow] = useState<number | null>(null);
  const [bouncingRow, setBouncingRow] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittingRef = useRef(false);
  // Tracks all in-flight timeouts created by handleKey so they can be cancelled on unmount.
  const pendingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const prevGuessesLengthRef = useRef(guesses.length);

  // Cancel all pending timers when the component unmounts (e.g. on Next Round).
  useEffect(() => {
    return () => {
      pendingTimers.current.forEach(clearTimeout);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // If a WebSocket broadcast updates guesses while an HTTP guess submission is
  // still in-flight, clear currentLetters before the browser paints so the typed
  // word never flashes into the next (now-active) row.
  useLayoutEffect(() => {
    if (guesses.length > prevGuessesLengthRef.current && submittingRef.current) {
      setCurrentLetters([]);
    }
    prevGuessesLengthRef.current = guesses.length;
  }, [guesses.length]);

  const showToast = useCallback((msg: string, duration = 3000) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), duration);
  }, []);

  // Trigger bounce when we transition to a won/solved state.
  useEffect(() => {
    if ((status === "won" || status === "solved") && guesses.length > 0) {
      const rowIdx = guesses.length - 1;
      const flipDuration = length * 250 + 600;
      const t = setTimeout(() => setBouncingRow(rowIdx), flipDuration);
      return () => clearTimeout(t);
    }
  }, [status, guesses.length, length]);

  const isInputDisabled = disabled || status !== "playing";

  const handleKey = useCallback(
    async (key: string) => {
      if (isInputDisabled || submittingRef.current) return;

      if (key === "Backspace") {
        setCurrentLetters((prev) => prev.slice(0, -1));
        return;
      }

      if (key === "Enter") {
        if (currentLetters.length < length) {
          const rowIdx = guesses.length;
          setShakingRow(rowIdx);
          showToast("Not enough letters", 1500);
          const t = setTimeout(() => setShakingRow(null), 400);
          pendingTimers.current.push(t);
          return;
        }

        submittingRef.current = true;
        const guess = currentLetters.join("");
        const rowIdx = guesses.length;
        const flipDuration = length * 250 + 600;

        // Set justRevealedRow BEFORE the network call so it is already true
        // when onSubmit resolves and the parent updates the guesses prop.
        // This ensures flipDelay is defined in the same render that state
        // changes to scored, satisfying the Tile animation conditions.
        setJustRevealedRow(rowIdx);

        try {
          await onSubmit(guess);
          // Call both state setters in the same synchronous block so React
          // batches them into one render — prevents the duplicate-row flash.
          setCurrentLetters([]);
          onGuessConfirmed?.();
          const t = setTimeout(() => setJustRevealedRow(null), flipDuration);
          pendingTimers.current.push(t);
        } catch (e) {
          setJustRevealedRow(null);
          const msg = e instanceof Error ? e.message : "Something went wrong";
          setShakingRow(rowIdx);
          showToast(msg, 1500);
          const t = setTimeout(() => setShakingRow(null), 400);
          pendingTimers.current.push(t);
        } finally {
          submittingRef.current = false;
        }
        return;
      }

      if (/^[A-Z]$/.test(key) && currentLetters.length < length) {
        setCurrentLetters((prev) => [...prev, key]);
      }
    },
    [isInputDisabled, currentLetters, length, guesses.length, onSubmit, onGuessConfirmed, showToast]
  );

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

  const keyStates = useMemo<Record<string, KeyState>>(() => {
    const result: Record<string, KeyState> = {};
    for (const { word, scoring } of guesses) {
      for (let i = 0; i < word.length; i++) {
        const letter = word[i];
        const s = scoring[i];
        const current = result[letter];
        if (s === "green") result[letter] = "correct";
        else if (s === "yellow" && current !== "correct") result[letter] = "present";
        else if (s === "gray" && !current) result[letter] = "absent";
      }
    }
    return result;
  }, [guesses]);

  const grid = buildGrid(guesses, currentLetters, length, maxGuesses, status);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {/* Toast */}
      <div style={{ height: 36, display: "flex", alignItems: "center", marginBottom: 8 }}>
        {toast && (
          <div style={{ background: "#ffffff", color: "#121213", borderRadius: 4, padding: "6px 14px", fontWeight: 700, fontSize: 14 }}>
            {toast}
          </div>
        )}
      </div>

      {/* Grid */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 24 }}>
        {grid.map((row, rowIdx) => (
          <div
            key={`${instanceKey}-${rowIdx}`}
            className={shakingRow === rowIdx ? "row-shake" : ""}
            style={{ display: "flex", gap: 5 }}
          >
            {row.map((tile, colIdx) => (
              <Tile
                key={`${instanceKey}-${rowIdx}-${colIdx}`}
                rowKey={instanceKey}
                letter={tile.letter}
                state={tile.state}
                flipDelay={justRevealedRow === rowIdx ? colIdx * 250 : undefined}
                bounce={bouncingRow === rowIdx}
                bounceDelay={colIdx * 100}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Keyboard */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
        {KEYBOARD_ROWS.map((row, rIdx) => (
          <div key={rIdx} style={{ display: "flex", gap: 6 }}>
            {row.map((key) => {
              const isWide = key === "Enter" || key === "Backspace";
              const ks = keyStates[key] ?? "unused";
              return (
                <button
                  key={key}
                  onClick={() => handleKey(key)}
                  disabled={isInputDisabled}
                  style={{
                    width: isWide ? 65 : 43, height: 58,
                    background: KEY_COLORS[ks].bg,
                    color: "#ffffff",
                    border: "none", borderRadius: 4,
                    fontWeight: 700, fontSize: isWide ? 12 : 16,
                    cursor: isInputDisabled ? "default" : "pointer",
                    userSelect: "none",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "inherit",
                    opacity: isInputDisabled ? 0.6 : 1,
                  }}
                >
                  {key === "Backspace" ? "⌫" : key}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
