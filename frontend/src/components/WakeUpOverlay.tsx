"use client";

import { WakePhase } from "@/lib/useWakeUpGuard";

interface WakeUpOverlayProps {
  phase: WakePhase;
  onRetry: () => void;
}

export function WakeUpOverlay({ phase, onRetry }: WakeUpOverlayProps) {
  if (phase === "idle") return null;

  return (
    <>
      <style>{`@keyframes wu-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
      <div style={overlayStyle}>
        <div style={boxStyle}>
          {phase === "overlay" ? (
            <>
              <p style={headingStyle}>Waking up the server</p>
              <p style={bodyStyle}>
                This is a hobby project on a free tier, so the server
                goes to sleep after sitting idle for a bit. Give it a
                moment.
              </p>
              <span style={dotsStyle}>...</span>
            </>
          ) : (
            <>
              <p style={headingStyle}>Still not responding</p>
              <p style={bodyStyle}>
                90 seconds and nothing. Could be a bad connection, or
                the server is having a rough morning. Worth a try.
              </p>
              <button onClick={onRetry} style={retryBtnStyle}>
                Try again
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(18, 18, 19, 0.92)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const boxStyle: React.CSSProperties = {
  background: "#1a1a1b",
  border: "1px solid #3a3a3c",
  borderRadius: 8,
  padding: "32px 28px",
  maxWidth: 320,
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  textAlign: "center",
};

const headingStyle: React.CSSProperties = {
  color: "#ffffff",
  fontWeight: 700,
  fontSize: 18,
  margin: 0,
  letterSpacing: 1,
};

const bodyStyle: React.CSSProperties = {
  color: "#818384",
  fontSize: 14,
  lineHeight: 1.5,
  margin: 0,
};

const dotsStyle: React.CSSProperties = {
  color: "#538d4e",
  fontSize: 22,
  fontWeight: 700,
  letterSpacing: 4,
  animation: "wu-pulse 1.5s ease-in-out infinite",
  display: "inline-block",
};

const retryBtnStyle: React.CSSProperties = {
  background: "#538d4e",
  color: "#ffffff",
  border: "none",
  borderRadius: 4,
  padding: "12px 0",
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
  width: "100%",
  letterSpacing: 1,
  marginTop: 4,
};
