import { RoomPlayer, RoomStatus } from "@/lib/api";
import { CheckIcon, CrossIcon } from "@/components/Icons";

interface ScoreboardProps {
  players: RoomPlayer[];
  status: RoomStatus;
}

const STATUS_LABEL: Record<string, string> = {
  playing:      "Playing",
  solved:       "Solved",
  out:          "Out",
  disconnected: "Away",
  waiting:      "Waiting",
};

const STATUS_COLOR: Record<string, string> = {
  playing:      "#818384",
  solved:       "#538d4e",
  out:          "#7a3535",
  disconnected: "#3a3a3c",
  waiting:      "#818384",
};

export default function Scoreboard({ players, status }: ScoreboardProps) {
  return (
    <div style={{ minWidth: 180 }}>
      <p style={{ color: "#818384", fontSize: 11, fontWeight: 700, letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>
        Scoreboard
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {players.map((p) => (
          <div
            key={p.name}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 12, padding: "6px 10px",
              background: p.isYou ? "#1a1a1b" : "transparent",
              borderRadius: 4,
              border: p.isYou ? "1px solid #3a3a3c" : "1px solid transparent",
              opacity: p.status === "disconnected" ? 0.45 : p.status === "waiting" ? 0.7 : 1,
            }}
          >
            <span style={{ color: "#ffffff", fontSize: 14, fontWeight: p.isYou ? 700 : 400 }}>
              {p.name}
              {p.isYou && <span style={{ color: "#818384", fontWeight: 400, fontSize: 12, marginLeft: 4 }}>(you)</span>}
              {p.isHost && <span style={{ color: "#538d4e", fontSize: 11, marginLeft: 6, fontWeight: 700 }}>HOST</span>}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLOR[p.status] ?? "#818384", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
              {p.status === "solved" ? (
                <><CheckIcon size={12} color={STATUS_COLOR.solved} />{p.guessCount}</>
              ) : status === "finished" && p.status === "out" ? (
                <CrossIcon size={12} color={STATUS_COLOR.out} />
              ) : (
                STATUS_LABEL[p.status] ?? p.status
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
