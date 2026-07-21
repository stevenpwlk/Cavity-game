"use client";

import { useState } from "react";
import Link from "next/link";

export interface LeaderboardRow {
  userId: string;
  displayName: string;
  score: number;
  /** Rang déjà tranché côté DB (classement général). Absent pour le défi du jour, qui garde i+1. */
  rank?: number;
  /**
   * Mouvement depuis la dernière run terminée du joueur (classement général uniquement).
   * undefined/null = pas de donnée (jamais rejoué depuis la mise en place de la fonctionnalité) → aucune flèche.
   */
  rankMovement?: "up" | "down" | "same" | null;
}

function movementGlyph(movement: LeaderboardRow["rankMovement"]): { symbol: string; color: string } | null {
  if (movement === "up") return { symbol: "▲", color: "var(--sonar)" };
  if (movement === "down") return { symbol: "▼", color: "#c8563b" };
  if (movement === "same") return { symbol: "▬", color: "var(--argent-sombre)" };
  return null;
}

export function LeaderboardTabs({
  daily,
  general,
  currentUserId
}: {
  daily: LeaderboardRow[];
  general: LeaderboardRow[];
  currentUserId: string;
}) {
  const [tab, setTab] = useState<"jour" | "general">("jour");
  const rows = tab === "jour" ? daily : general;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "22px 18px", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Link href="/" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--sonar)", textDecoration: "underline" }}>
          ‹ RETOUR AU JEU
        </Link>
        <span style={{ fontSize: 9, letterSpacing: "0.24em", color: "var(--argent-sombre)" }}>GREFFE DE LA F.I.S.T.</span>
        <h1 style={{ fontSize: 20, letterSpacing: "0.08em" }}>CLASSEMENTS</h1>
      </div>

      <div style={{ display: "flex", border: "1px solid var(--ligne)", borderRadius: 99, padding: 3, gap: 3 }}>
        <button
          onClick={() => setTab("jour")}
          style={segStyle(tab === "jour")}
        >
          DÉFI DU JOUR
        </button>
        <button onClick={() => setTab("general")} style={segStyle(tab === "general")}>
          GÉNÉRAL
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--argent-sombre)", textAlign: "center", padding: "24px 0" }}>
            Aucun score homologué pour l&apos;instant.
          </p>
        ) : (
          rows.map((row, i) => {
            const rank = row.rank ?? i + 1;
            const isMe = row.userId === currentUserId;
            const rankColor = rank === 1 ? "var(--or)" : rank === 2 ? "var(--argent)" : rank === 3 ? "#c8563b" : "var(--argent-sombre)";
            const glyph = movementGlyph(row.rankMovement);
            return (
              <div
                key={row.userId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  border: `1px solid ${isMe ? "var(--sonar)" : "var(--ligne)"}`,
                  background: isMe ? "rgba(79,163,216,.12)" : "rgba(10,28,56,.5)",
                  borderRadius: 14,
                  padding: "11px 14px"
                }}
              >
                <span style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 22, gap: 1 }}>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700, textAlign: "center", color: rankColor }}>
                    {rank}
                  </span>
                  {glyph ? (
                    <span aria-hidden="true" style={{ fontSize: 8, lineHeight: 1, color: glyph.color }}>
                      {glyph.symbol}
                    </span>
                  ) : null}
                </span>
                <span style={{ flex: 1, fontSize: 14, letterSpacing: "0.03em" }}>
                  {row.displayName}
                  {isMe ? <span style={{ fontSize: 8, letterSpacing: "0.2em", color: "var(--sonar)", marginLeft: 8 }}>VOUS</span> : null}
                </span>
                <span className="num" style={{ fontSize: 14, fontWeight: 700 }}>
                  {row.score.toLocaleString("fr-FR")}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function segStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    fontFamily: "var(--sg)",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.12em",
    padding: "9px 0",
    borderRadius: 99,
    border: "none",
    background: active ? "#16345d" : "transparent",
    color: active ? "var(--ecume)" : "var(--argent)",
    cursor: "pointer"
  };
}
