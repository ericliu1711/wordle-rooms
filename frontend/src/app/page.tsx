"use client";

import { useEffect, useState } from "react";

type HealthStatus = { status: string } | null;

export default function Home() {
  const [health, setHealth] = useState<HealthStatus>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("http://localhost:8080/api/health")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ status: string }>;
      })
      .then(setHealth)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "fetch failed");
      });
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">wordle-rooms</h1>
      <div className="text-sm text-gray-500">
        {error ? (
          <span className="text-red-500">backend unreachable: {error}</span>
        ) : health ? (
          <span className="text-green-600">
            backend status: {health.status}
          </span>
        ) : (
          <span>checking backend…</span>
        )}
      </div>
    </main>
  );
}
