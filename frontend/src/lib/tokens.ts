const key = (code: string) => `wordle:token:${code.toUpperCase()}`;

export function getRoomToken(code: string): string | null {
  try {
    return localStorage.getItem(key(code));
  } catch {
    return null;
  }
}

export function setRoomToken(code: string, token: string): void {
  try {
    localStorage.setItem(key(code), token);
  } catch {
    // ignore (private browsing with storage disabled)
  }
}

export function clearRoomToken(code: string): void {
  try {
    localStorage.removeItem(key(code));
  } catch {
    // ignore
  }
}
