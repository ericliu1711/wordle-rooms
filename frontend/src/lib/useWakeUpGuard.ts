"use client";

import { useState, useRef } from "react";
import { checkHealth } from "./api";

export type WakePhase = "idle" | "overlay" | "timedout";

export function useWakeUpGuard() {
  const [phase, setPhase] = useState<WakePhase>("idle");
  const cleanupRef = useRef<(() => void) | null>(null);
  const retryRef = useRef<(() => void) | null>(null);

  function guard<T>(action: () => Promise<T>): Promise<T> {
    // Cancel any in-flight guard from a previous call
    cleanupRef.current?.();

    let dismissed = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    function stopAll() {
      dismissed = true;
      timeouts.forEach(clearTimeout);
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function dismiss() {
      stopAll();
      setPhase("idle");
    }

    cleanupRef.current = dismiss;
    retryRef.current = () => guard(action);

    const actionPromise = action();

    // After 3s with no resolution: show overlay and start polling /api/health
    const tripWire = setTimeout(() => {
      if (dismissed) return;
      setPhase("overlay");

      function poll() {
        if (dismissed) return;
        checkHealth()
          .then((ok) => { if (ok && !dismissed) dismiss(); })
          .catch(() => {});
      }

      poll();
      pollTimer = setInterval(poll, 2000);
    }, 3000);
    timeouts.push(tripWire);

    // Hard ceiling: 90s from action start
    const ceiling = setTimeout(() => {
      if (dismissed) return;
      stopAll();
      setPhase("timedout");
    }, 90_000);
    timeouts.push(ceiling);

    // Dismiss overlay as soon as the original action settles (success or error)
    actionPromise.then(
      () => { if (!dismissed) dismiss(); },
      () => { if (!dismissed) dismiss(); }
    );

    return actionPromise;
  }

  function retry() {
    retryRef.current?.();
  }

  return { phase, guard, retry };
}
