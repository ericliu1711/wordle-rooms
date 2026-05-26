"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createRoom, joinRoom } from "@/lib/api";
import { setRoomToken } from "@/lib/tokens";

type Panel = "none" | "create" | "join";

export default function LandingPage() {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>("none");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function openPanel(p: Panel) {
    setPanel(p);
    setName("");
    setCode("");
    setError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError("Please enter your name."); return; }
    setLoading(true);
    try {
      const res = await createRoom(name.trim());
      setRoomToken(res.code, res.playerToken);
      router.push(`/room/${res.code}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "invalid_name") setError("Name must be 1–20 alphanumeric characters.");
        else setError(err.message);
      } else {
        setError("Couldn't reach the server.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (code.trim().length !== 4) { setError("Room code must be 4 letters."); return; }
    if (!name.trim()) { setError("Please enter your name."); return; }
    setLoading(true);
    try {
      const upperCode = code.trim().toUpperCase();
      const res = await joinRoom(upperCode, name.trim());
      setRoomToken(upperCode, res.playerToken);
      router.push(`/room/${upperCode}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "not_found") setError("Room not found.");
        else if (err.code === "name_taken") setError("That name is already taken.");
        else if (err.code === "invalid_name") setError("Name must be 1–20 alphanumeric characters.");
        else if (err.code === "not_joinable") setError("That room is already in progress.");
        else setError(err.message);
      } else {
        setError("Couldn't reach the server.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#121213", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <h1 style={{ color: "#ffffff", fontSize: 36, fontWeight: 700, letterSpacing: 6, marginBottom: 8 }}>
        WORDLE
      </h1>
      <p style={{ color: "#818384", fontSize: 14, marginBottom: 48, letterSpacing: 2 }}>
        ROOMS
      </p>

      {panel === "none" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 280 }}>
          <button onClick={() => openPanel("create")} style={primaryBtn}>
            Create Room
          </button>
          <button onClick={() => openPanel("join")} style={secondaryBtn}>
            Join Room
          </button>
          <a href="/play" style={{ color: "#818384", fontSize: 13, textAlign: "center", marginTop: 8, textDecoration: "none" }}>
            Play single-player →
          </a>
        </div>
      )}

      {panel === "create" && (
        <form onSubmit={handleCreate} style={formStyle}>
          <p style={formTitle}>Create a room</p>
          <input
            autoFocus
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            style={inputStyle}
          />
          {error && <p style={errorStyle}>{error}</p>}
          <button type="submit" disabled={loading} style={primaryBtn}>
            {loading ? "Creating…" : "Create"}
          </button>
          <button type="button" onClick={() => openPanel("none")} style={ghostBtn}>
            Back
          </button>
        </form>
      )}

      {panel === "join" && (
        <form onSubmit={handleJoin} style={formStyle}>
          <p style={formTitle}>Join a room</p>
          <input
            autoFocus
            placeholder="ABCD"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={4}
            style={{ ...inputStyle, textTransform: "uppercase", textAlign: "center" }}
          />
          <input
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            style={inputStyle}
          />
          {error && <p style={errorStyle}>{error}</p>}
          <button type="submit" disabled={loading} style={primaryBtn}>
            {loading ? "Joining…" : "Join"}
          </button>
          <button type="button" onClick={() => openPanel("none")} style={ghostBtn}>
            Back
          </button>
        </form>
      )}
    </main>
  );
}

// ---- styles -----------------------------------------------------------------

const primaryBtn: React.CSSProperties = {
  background: "#538d4e", color: "#ffffff", border: "none", borderRadius: 4,
  padding: "14px 0", fontWeight: 700, fontSize: 16, cursor: "pointer",
  width: "100%", letterSpacing: 1,
};

const secondaryBtn: React.CSSProperties = {
  background: "#3a3a3c", color: "#ffffff", border: "none", borderRadius: 4,
  padding: "14px 0", fontWeight: 700, fontSize: 16, cursor: "pointer",
  width: "100%", letterSpacing: 1,
};

const ghostBtn: React.CSSProperties = {
  background: "transparent", color: "#818384", border: "none",
  padding: "10px 0", fontWeight: 600, fontSize: 14, cursor: "pointer",
  width: "100%",
};

const formStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 12,
  width: "100%", maxWidth: 280,
};

const formTitle: React.CSSProperties = {
  color: "#ffffff", fontWeight: 700, fontSize: 18,
  textAlign: "center", marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  background: "#1a1a1b", color: "#ffffff", border: "1px solid #3a3a3c",
  borderRadius: 4, padding: "12px 14px", fontSize: 16, outline: "none",
  fontFamily: "inherit",
};

const errorStyle: React.CSSProperties = {
  color: "#b59f3b", fontSize: 13, textAlign: "center", margin: 0,
  padding: "8px 12px", background: "rgba(181,159,59,0.12)",
  border: "1px solid rgba(181,159,59,0.35)", borderRadius: 4,
};
