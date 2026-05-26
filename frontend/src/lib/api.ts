const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// ---- single-player types ----------------------------------------------------

export type GameState = {
  gameId: string;
  length: number;
  maxGuesses: number;
  status: "playing" | "won" | "lost";
  guesses: { word: string; scoring: ("green" | "yellow" | "gray")[] }[];
  target?: string;
};

// ---- room types -------------------------------------------------------------

export type RoomStatus = "lobby" | "playing" | "finished";
export type PlayerStatus = "playing" | "solved" | "out";

export type RoomPlayer = {
  name: string;
  status: PlayerStatus;
  guessCount: number;
  solvedAt: string | null;
  isYou: boolean;
  isHost: boolean;
  guesses?: { word: string; scoring: ("green" | "yellow" | "gray")[] }[];
};

export type RankingEntry = {
  name: string;
  status: PlayerStatus;
  guessCount: number;
  solvedAt: string | null;
  rank: number;
};

export type RoomState = {
  code: string;
  status: RoomStatus;
  hostToken?: string;
  length: number;
  maxGuesses: number;
  startedAt: string | null;
  finishedAt: string | null;
  target: string | null;
  youAreHost: boolean;
  players: RoomPlayer[];
  ranking?: RankingEntry[];
};

export type CreateRoomResponse = {
  code: string;
  playerToken: string;
  state: RoomState;
};

export type JoinRoomResponse = {
  playerToken: string;
  state: RoomState;
};

// ---- error ------------------------------------------------------------------

export class ApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "ApiError";
  }
}

// ---- shared fetch -----------------------------------------------------------

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let body: { error?: string; code?: string } = {};
    try { body = await res.json(); } catch { /* ignore */ }
    throw new ApiError(body.error ?? "request failed", body.code ?? "unknown");
  }
  return res.json() as Promise<T>;
}

function withToken(token: string | null): HeadersInit {
  return token ? { "X-Player-Token": token } : {};
}

// ---- single-player ----------------------------------------------------------

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

// ---- rooms ------------------------------------------------------------------

export function createRoom(name: string): Promise<CreateRoomResponse> {
  return request<CreateRoomResponse>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function joinRoom(code: string, name: string): Promise<JoinRoomResponse> {
  return request<JoinRoomResponse>(`/api/rooms/${code}/join`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function getRoom(code: string, token: string | null): Promise<RoomState> {
  return request<RoomState>(`/api/rooms/${code}`, {
    headers: withToken(token),
  });
}

export function startRound(code: string, token: string): Promise<RoomState> {
  return request<RoomState>(`/api/rooms/${code}/start`, {
    method: "POST",
    headers: withToken(token),
  });
}

export function submitRoomGuess(code: string, token: string, guess: string): Promise<RoomState> {
  return request<RoomState>(`/api/rooms/${code}/guesses`, {
    method: "POST",
    headers: withToken(token),
    body: JSON.stringify({ guess }),
  });
}

export function nextRound(code: string, token: string): Promise<RoomState> {
  return request<RoomState>(`/api/rooms/${code}/next-round`, {
    method: "POST",
    headers: withToken(token),
  });
}
