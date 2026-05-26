const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type GameState = {
  gameId: string;
  length: number;
  maxGuesses: number;
  status: "playing" | "won" | "lost";
  guesses: { word: string; scoring: ("green" | "yellow" | "gray")[] }[];
  target?: string;
};

export class ApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let body: { error?: string; code?: string } = {};
    try {
      body = await res.json();
    } catch {
      // ignore parse errors
    }
    throw new ApiError(body.error ?? "request failed", body.code ?? "unknown");
  }
  return res.json() as Promise<T>;
}

export function createGame(): Promise<GameState> {
  return request<GameState>("/api/games", { method: "POST" });
}

export function getGame(id: string): Promise<GameState> {
  return request<GameState>(`/api/games/${id}`);
}

export function submitGuess(id: string, guess: string): Promise<GameState> {
  return request<GameState>(`/api/games/${id}/guesses`, {
    method: "POST",
    body: JSON.stringify({ guess }),
  });
}
