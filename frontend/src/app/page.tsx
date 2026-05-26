"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const TARGET_WORD = "REACT";
const MAX_GUESSES = 6;
const WORD_LENGTH = 5;

type TileState = "empty" | "filled" | "correct" | "present" | "absent";

interface TileData {
  letter: string;
  state: TileState;
}

type KeyState = "correct" | "present" | "absent" | "unused";

// Scoring algorithm — two-pass to handle duplicate letters correctly.
//
// Test cases (c=correct/green, p=present/yellow, a=absent/gray):
//   target=ALLEY guess=LLAMA → [p, c, p, a, a]
//     Pass1: pos1 L=L→green. Pass2: pos0 L→L(2) yellow, pos2 A→A(0) yellow, pos3 M→none, pos4 A→none(A consumed)
//   target=ALLEY guess=LULLS → [p, a, c, a, a]
//     Pass1: pos2 L=L→green. Pass2: pos0 L→L(1) yellow, pos1 U→none, pos3 L→none(both Ls consumed), pos4 S→none
//   target=REACT guess=RRACE → [c, a, c, c, p]
//     Pass1: R(0)✓, A(2)✓, C(3)✓. Pass2: pos1 R→none(R consumed), pos4 E→E(1) yellow
//   target=REACT guess=CARET → [p, p, p, p, c]
//     Pass1: T(4)✓. Pass2: C→C(3), A→A(2), R→R(0), E→E(1) all yellow
function scoreGuess(
  guess: string,
  target: string
): Array<"correct" | "present" | "absent"> {
  const result: Array<"correct" | "present" | "absent"> = Array(
    WORD_LENGTH
  ).fill("absent");
  const targetChars = target.split("");
  const consumed = Array(WORD_LENGTH).fill(false);

  // Pass 1: greens
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === targetChars[i]) {
      result[i] = "correct";
      consumed[i] = true;
    }
  }

  // Pass 2: yellows
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] === "correct") continue;
    for (let j = 0; j < WORD_LENGTH; j++) {
      if (!consumed[j] && guess[i] === targetChars[j]) {
        result[i] = "present";
        consumed[j] = true;
        break;
      }
    }
  }

  return result;
}

function emptyGrid(): TileData[][] {
  return Array.from({ length: MAX_GUESSES }, () =>
    Array.from({ length: WORD_LENGTH }, () => ({ letter: "", state: "empty" as TileState }))
  );
}

const KEYBOARD_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Enter", "Z", "X", "C", "V", "B", "N", "M", "Backspace"],
];

const TILE_COLORS: Record<TileState, { bg: string; border: string; text: string }> = {
  empty:   { bg: "transparent",  border: "#3a3a3c", text: "#ffffff" },
  filled:  { bg: "transparent",  border: "#565758", text: "#ffffff" },
  correct: { bg: "#538d4e",      border: "#538d4e", text: "#ffffff" },
  present: { bg: "#b59f3b",      border: "#b59f3b", text: "#ffffff" },
  absent:  { bg: "#3a3a3c",      border: "#3a3a3c", text: "#ffffff" },
};

const KEY_COLORS: Record<KeyState, { bg: string; text: string }> = {
  unused:  { bg: "#818384", text: "#ffffff" },
  correct: { bg: "#538d4e", text: "#ffffff" },
  present: { bg: "#b59f3b", text: "#ffffff" },
  absent:  { bg: "#3a3a3c", text: "#ffffff" },
};

// ------- Tile component -------

interface TileProps {
  letter: string;
  state: TileState;
  flipDelay?: number;   // ms, triggers flip animation
  bounce?: boolean;
  bounceDelay?: number;
  shouldPop?: boolean;
}

function Tile({ letter, state, flipDelay, bounce, bounceDelay, shouldPop }: TileProps) {
  const [displayState, setDisplayState] = useState<TileState>(state);
  const [flipping, setFlipping] = useState<"front" | "back" | null>(null);
  const [popClass, setPopClass] = useState("");
  const prevLetter = useRef(letter);
  const prevState = useRef(state);

  // Pop animation when a letter is typed
  useEffect(() => {
    if (letter && letter !== prevLetter.current && state === "filled") {
      setPopClass("tile-pop");
      const t = setTimeout(() => setPopClass(""), 80);
      prevLetter.current = letter;
      return () => clearTimeout(t);
    }
    prevLetter.current = letter;
  }, [letter, state]);

  // Flip animation when state changes to a scored state
  useEffect(() => {
    if (
      prevState.current !== state &&
      ["correct", "present", "absent"].includes(state) &&
      flipDelay !== undefined
    ) {
      const t1 = setTimeout(() => {
        setFlipping("front");
        const t2 = setTimeout(() => {
          setDisplayState(state);
          setFlipping("back");
          const t3 = setTimeout(() => setFlipping(null), 250);
          return () => clearTimeout(t3);
        }, 250);
        return () => clearTimeout(t2);
      }, flipDelay);
      prevState.current = state;
      return () => clearTimeout(t1);
    }
    prevState.current = state;
    if (!["correct", "present", "absent"].includes(state)) {
      setDisplayState(state);
    }
  }, [state, flipDelay]);

  const colors = TILE_COLORS[displayState];
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
        color: colors.text,
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

// ------- Main Game -------

export default function Home() {
  const [grid, setGrid] = useState<TileData[][]>(emptyGrid());
  const [currentRow, setCurrentRow] = useState(0);
  const [currentCol, setCurrentCol] = useState(0);
  const [keyStates, setKeyStates] = useState<Record<string, KeyState>>({});
  const [gameStatus, setGameStatus] = useState<"playing" | "won" | "lost">("playing");
  const [shakingRow, setShakingRow] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [bouncingRow, setBouncingRow] = useState<number | null>(null);
  // tracks which rows have been scored and should trigger flip
  const [scoredRows, setScoredRows] = useState<Set<number>>(new Set());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1500);
  }, []);

  const submitRow = useCallback(() => {
    if (currentCol < WORD_LENGTH) {
      setShakingRow(currentRow);
      showToast("Not enough letters");
      setTimeout(() => setShakingRow(null), 400);
      return;
    }

    const guess = grid[currentRow].map((t) => t.letter).join("");
    const scores = scoreGuess(guess, TARGET_WORD);

    // Update grid with scores
    setGrid((prev) => {
      const next = prev.map((r) => r.map((t) => ({ ...t })));
      for (let i = 0; i < WORD_LENGTH; i++) {
        next[currentRow][i].state = scores[i];
      }
      return next;
    });

    setScoredRows((prev) => new Set([...prev, currentRow]));

    // Update keyboard — green > yellow > gray, never downgrade green
    setKeyStates((prev) => {
      const next = { ...prev };
      for (let i = 0; i < WORD_LENGTH; i++) {
        const letter = guess[i];
        const score = scores[i];
        const current = next[letter] ?? "unused";
        if (score === "correct") {
          next[letter] = "correct";
        } else if (score === "present" && current !== "correct") {
          next[letter] = "present";
        } else if (score === "absent" && current === "unused") {
          next[letter] = "absent";
        }
      }
      return next;
    });

    const won = scores.every((s) => s === "correct");
    const lastGuess = currentRow === MAX_GUESSES - 1;

    // Delay status update until flip animations complete (~WORD_LENGTH * 250 + 500ms buffer)
    const flipDuration = WORD_LENGTH * 250 + 500;

    if (won) {
      setTimeout(() => {
        setBouncingRow(currentRow);
        setGameStatus("won");
      }, flipDuration);
    } else if (lastGuess) {
      setTimeout(() => setGameStatus("lost"), flipDuration);
    }

    setCurrentRow((r) => r + 1);
    setCurrentCol(0);
  }, [currentRow, currentCol, grid, showToast]);

  const handleKey = useCallback(
    (key: string) => {
      if (gameStatus !== "playing") return;

      if (key === "Enter") {
        submitRow();
        return;
      }

      if (key === "Backspace") {
        if (currentCol === 0) return;
        setGrid((prev) => {
          const next = prev.map((r) => r.map((t) => ({ ...t })));
          next[currentRow][currentCol - 1] = { letter: "", state: "empty" };
          return next;
        });
        setCurrentCol((c) => c - 1);
        return;
      }

      if (/^[A-Z]$/.test(key) && currentCol < WORD_LENGTH) {
        setGrid((prev) => {
          const next = prev.map((r) => r.map((t) => ({ ...t })));
          next[currentRow][currentCol] = { letter: key, state: "filled" };
          return next;
        });
        setCurrentCol((c) => c + 1);
      }
    },
    [gameStatus, currentRow, currentCol, submitRow]
  );

  // Physical keyboard
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

  const resetGame = () => {
    setGrid(emptyGrid());
    setCurrentRow(0);
    setCurrentCol(0);
    setKeyStates({});
    setGameStatus("playing");
    setShakingRow(null);
    setToast(null);
    setBouncingRow(null);
    setScoredRows(new Set());
  };

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

      {/* Toast */}
      <div style={{ height: 36, display: "flex", alignItems: "center", marginBottom: 8 }}>
        {toast && (
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
        )}
        {!toast && gameStatus === "won" && (
          <div style={{ color: "#538d4e", fontWeight: 700, fontSize: 18 }}>
            Solved in {currentRow}!
          </div>
        )}
        {!toast && gameStatus === "lost" && (
          <div style={{ color: "#b59f3b", fontWeight: 700, fontSize: 18 }}>
            The word was {TARGET_WORD}
          </div>
        )}
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
                key={colIdx}
                letter={tile.letter}
                state={tile.state}
                flipDelay={scoredRows.has(rowIdx) ? colIdx * 250 : undefined}
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
              const colors = KEY_COLORS[ks];
              return (
                <button
                  key={key}
                  onClick={() => handleKey(key)}
                  style={{
                    width: isWide ? 65 : 43,
                    height: 58,
                    background: colors.bg,
                    color: colors.text,
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

      {/* New game button */}
      {gameStatus !== "playing" && (
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
