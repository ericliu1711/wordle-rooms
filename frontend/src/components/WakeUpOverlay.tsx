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
              <p style={headingStyle}>Server is waking up</p>
              <p style={bodyStyle}>
                The server spins down after 15 minutes of inactivity — a
                deliberate trade-off on the free tier. It will be ready
                in a moment.
              </p>
              <span style={dotsStyle}>...</span>
            </>
          ) : (
            <>
              <p style={headingStyle}>Taking longer than expected</p>
              <p style={bodyStyle}>
                The server has not responded in 90 seconds. Check your
                connection or try again.
              </p>
              <button onClick={onRetry} style={retryBtnStyle}>
                Retry
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
