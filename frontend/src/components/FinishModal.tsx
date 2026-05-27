import { RankingEntry, RoomPlayer, RoomStatus } from "@/lib/api";
import { CheckIcon, CrossIcon } from "@/components/Icons";

interface FinishModalProps {
  myPlayer: RoomPlayer;
  roomStatus: RoomStatus;
  players: RoomPlayer[];
  ranking: RankingEntry[] | undefined;
  target: string | null;
  youAreHost: boolean;
  onNextRound: () => void;
  onDismiss: () => void;
  nextRoundLoading: boolean;
}

export default function FinishModal({
  myPlayer, roomStatus, players, ranking, target,
  youAreHost, onNextRound, onDismiss, nextRoundLoading,
}: FinishModalProps) {
  const stillPlaying = players.filter((p) => p.status === "playing" && !p.isYou);
  const isFinished = roomStatus === "finished";

  const resultLine =
    myPlayer.status === "solved"
      ? `You solved it in ${myPlayer.guessCount}!`
      : "You ran out of guesses.";

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onDismiss}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.6)",
          zIndex: 40,
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: "fixed", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 50,
          background: "#1a1a1b",
          border: "1px solid #3a3a3c",
          borderRadius: 8,
          padding: "28px 32px",
          minWidth: 300, maxWidth: 400, width: "90vw",
          display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        {/* Result */}
        <p style={{ color: myPlayer.status === "solved" ? "#538d4e" : "#b59f3b", fontWeight: 700, fontSize: 20, margin: 0, textAlign: "center" }}>
          {resultLine}
        </p>

        {/* Waiting / final target */}
        {isFinished ? (
          <div style={{ textAlign: "center" }}>
            <p style={{ color: "#818384", fontSize: 13, margin: "0 0 4px" }}>The word was</p>
            <p style={{ color: "#ffffff", fontWeight: 700, fontSize: 28, letterSpacing: 6, margin: 0 }}>
              {target}
            </p>
          </div>
        ) : (
          <p style={{ color: "#818384", fontSize: 14, textAlign: "center", margin: 0 }}>
            Waiting for {stillPlaying.length} player{stillPlaying.length !== 1 ? "s" : ""} to finish…
          </p>
        )}

        {/* Live / final ranking */}
        {isFinished && ranking ? (
          <div>
            <p style={{ color: "#818384", fontSize: 11, fontWeight: 700, letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>
              Final ranking
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ranking.map((entry) => {
                const isYouEntry = entry.name === myPlayer.name;
                return (
                  <div
                    key={entry.name}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      background: isYouEntry ? "#121213" : "transparent",
                      padding: "5px 8px", borderRadius: 4,
                      border: isYouEntry ? "1px solid #3a3a3c" : "1px solid transparent",
                    }}
                  >
                    <span style={{ color: "#818384", fontWeight: 700, fontSize: 13, minWidth: 20 }}>
                      {entry.status === "out" ? "DNF" : `#${entry.rank}`}
                    </span>
                    <span style={{ color: "#ffffff", fontSize: 14, fontWeight: isYouEntry ? 700 : 400, flex: 1 }}>
                      {entry.name}
                      {isYouEntry && <span style={{ color: "#818384", fontWeight: 400, fontSize: 12, marginLeft: 4 }}>(you)</span>}
                    </span>
                    <span style={{ color: entry.status === "solved" ? "#538d4e" : (entry.status === "disconnected" || entry.status === "waiting") ? "#3a3a3c" : "#b59f3b", fontSize: 13, fontWeight: 600 }}>
                      {entry.status === "solved" ? `${entry.guessCount} guess${entry.guessCount !== 1 ? "es" : ""}` : entry.status === "disconnected" ? "Left" : entry.status === "waiting" ? "Waiting" : "Out"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Live scoreboard while waiting */
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {players.map((p) => (
              <div key={p.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: p.status === "playing" ? "#818384" : "#ffffff" }}>
                <span>{p.name}{p.isYou && <span style={{ color: "#818384", marginLeft: 4 }}>(you)</span>}</span>
                <span style={{ color: p.status === "solved" ? "#538d4e" : p.status === "out" ? "#b59f3b" : "#818384", display: "flex", alignItems: "center", gap: 4 }}>
                  {p.status === "solved" ? (
                    <><CheckIcon size={12} color="#538d4e" />{p.guessCount}</>
                  ) : p.status === "out" ? (
                    <CrossIcon size={12} color="#b59f3b" />
                  ) : p.status === "disconnected" ? (
                    <span style={{ color: "#3a3a3c", fontSize: 11 }}>Away</span>
                  ) : p.status === "waiting" ? (
                    <span style={{ color: "#818384", fontSize: 11 }}>Waiting</span>
                  ) : (
                    `${p.guessCount} guesses`
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        {isFinished && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {youAreHost ? (
              <button
                onClick={onNextRound}
                disabled={nextRoundLoading}
                style={{ background: "#538d4e", color: "#ffffff", border: "none", borderRadius: 4, padding: "12px 0", fontWeight: 700, fontSize: 15, cursor: "pointer" }}
              >
                {nextRoundLoading ? "Starting…" : "Next Round"}
              </button>
            ) : (
              <p style={{ color: "#818384", fontSize: 13, textAlign: "center", margin: 0 }}>
                Waiting for host to start the next round…
              </p>
            )}
            <button onClick={onDismiss} style={{ background: "transparent", color: "#818384", border: "none", fontSize: 13, cursor: "pointer", padding: "4px 0" }}>
              Close
            </button>
          </div>
        )}
      </div>
    </>
  );
}
