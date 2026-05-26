"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, RoomState, WS_BASE, getRoom } from "./api";

type SocketState = {
  room: RoomState | null;
  isConnected: boolean;
  isReconnecting: boolean;
  error: string | null;
};

// Backoff schedule in ms: 500, 1s, 2s, 4s, then cap at 8s.
const BACKOFF = [500, 1000, 2000, 4000, 8000];

export function useRoomSocket(
  code: string,
  token: string | null
): SocketState & { applyServerResponse: (room: RoomState) => void } {
  const [state, setState] = useState<SocketState>({
    room: null,
    isConnected: false,
    isReconnecting: false,
    error: null,
  });

  // Stable setter for callers to apply HTTP action responses immediately,
  // without waiting for the subsequent WS broadcast (which carries the same data).
  const applyServerResponse = useCallback((room: RoomState) => {
    setState((prev) => ({ ...prev, room }));
  }, []);

  useEffect(() => {
    if (!code || !token) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffIdx = 0;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const url = `${WS_BASE}/api/rooms/${encodeURIComponent(code)}/ws?token=${encodeURIComponent(token!)}`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        if (cancelled) { ws!.close(1000); return; }
        backoffIdx = 0;
        setState((prev) => ({ ...prev, isConnected: true, isReconnecting: false, error: null }));
      };

      ws.onmessage = (evt: MessageEvent) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(evt.data as string) as { type: string; data: unknown };
          if (msg.type === "room_state") {
            setState((prev) => ({ ...prev, room: msg.data as RoomState }));
          } else if (process.env.NODE_ENV !== "production") {
            console.warn("ws: unknown message type", msg.type);
          }
        } catch (e) {
          if (process.env.NODE_ENV !== "production") console.error("ws: parse error", e);
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setState((prev) => ({ ...prev, isConnected: false }));

        const delay = BACKOFF[Math.min(backoffIdx, BACKOFF.length - 1)];
        backoffIdx++;
        setState((prev) => ({ ...prev, isReconnecting: true }));

        reconnectTimer = setTimeout(async () => {
          if (cancelled) return;
          // Before reconnecting, check whether the room still exists. If the
          // server restarted, the room is gone and we should stop retrying.
          try {
            await getRoom(code, token);
          } catch (e) {
            if (e instanceof ApiError && e.code === "not_found") {
              if (!cancelled) {
                setState((prev) => ({ ...prev, isReconnecting: false, error: "not_found" }));
              }
              return;
            }
            // Network still down or other transient error — keep retrying.
          }
          if (!cancelled) connect();
        }, delay);
      };

      ws.onerror = () => {
        // onerror always fires before onclose; let onclose schedule the reconnect.
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close(1000); // clean close; onclose won't reconnect because cancelled=true
    };
  }, [code, token]);

  return { ...state, applyServerResponse };
}
