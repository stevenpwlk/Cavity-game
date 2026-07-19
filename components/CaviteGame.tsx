"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { HudState, StampEvent } from "./CaviteScene";

type Mode = "normal" | "daily";
type Screen = "menu" | "loading" | "playing" | "summary" | "error";

interface Summary {
  score: number;
  hits: number;
  tirAtteint: number;
  bestSerie: number;
}

export function CaviteGame({ displayName }: { displayName: string }) {
  const [screen, setScreen] = useState<Screen>("menu");
  const [hud, setHud] = useState<HudState | null>(null);
  const [stamp, setStamp] = useState<StampEvent | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("normal");

  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<import("phaser").Game | null>(null);
  const sceneRef = useRef<import("./CaviteScene").CaviteScene | null>(null);
  const runIdRef = useRef<string | null>(null);
  const stampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function startRun(selectedMode: Mode) {
    setMode(selectedMode);
    setScreen("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/runs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: selectedMode })
      });
      if (!res.ok) throw new Error("start_failed");
      const data = (await res.json()) as { runId: string; seed: number };
      runIdRef.current = data.runId;

      const Phaser = await import("phaser");
      const { CaviteScene } = await import("./CaviteScene");

      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }

      const scene = new CaviteScene();
      sceneRef.current = scene;

      gameRef.current = new Phaser.Game({
        type: Phaser.AUTO,
        parent: containerRef.current!,
        backgroundColor: "#050e1e",
        width: 780,
        height: 1240,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene
      });

      scene.scene.settings.data = {
        seed: data.seed,
        callbacks: {
          onHud: (h: HudState) => setHud(h),
          onStamp: (s: StampEvent) => {
            setStamp(s);
            if (stampTimer.current) clearTimeout(stampTimer.current);
            stampTimer.current = setTimeout(() => setStamp(null), 1050);
          },
          onEnd: (s: Summary) => void finishRun(s)
        }
      };

      setScreen("playing");
    } catch {
      setErrorMsg("Impossible de démarrer la séance. Réessaie.");
      setScreen("error");
    }
  }

  async function finishRun(clientSummary: Summary) {
    const runId = runIdRef.current;
    const shots = sceneRef.current?.getShotLog() ?? [];
    if (!runId) {
      setSummary(clientSummary);
      setScreen("summary");
      return;
    }
    try {
      const res = await fetch(`/api/runs/${runId}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shots })
      });
      if (!res.ok) throw new Error("finish_failed");
      const authoritative = (await res.json()) as Summary;
      setSummary(authoritative);
    } catch {
      // Le score authentique n'a pas pu être enregistré ; on montre quand
      // même l'aperçu client pour ne pas bloquer le joueur.
      setSummary(clientSummary);
    }
    setScreen("summary");
  }

  useEffect(() => {
    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div className="phone-shell">
      <div className="phone">
        {screen === "menu" ? (
          <MenuScreen displayName={displayName} onStart={startRun} />
        ) : null}

        {screen === "loading" ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--argent)" }}>OUVERTURE DU BASSIN…</span>
          </div>
        ) : null}

        {screen === "error" ? (
          <div
            style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, alignItems: "center", justifyContent: "center", padding: 24 }}
          >
            <p style={{ fontSize: 13, color: "var(--argent)" }}>{errorMsg}</p>
            <button className="btn" onClick={() => setScreen("menu")}>
              RETOUR
            </button>
          </div>
        ) : null}

        {screen === "playing" ? <PlayingChrome hud={hud} stamp={stamp} mode={mode} /> : null}

        <div ref={containerRef} style={{ display: screen === "playing" ? "block" : "none", flex: 1 }} />

        {screen === "summary" && summary ? (
          <SummaryScreen summary={summary} onReplay={() => startRun(mode)} onMenu={() => setScreen("menu")} />
        ) : null}
      </div>
    </div>
  );
}

function MenuScreen({ displayName, onStart }: { displayName: string; onStart: (mode: Mode) => void }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 22, gap: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, letterSpacing: "0.22em", color: "var(--argent-sombre)" }}>F.I.S.T.</span>
        <span style={{ fontSize: 12, color: "var(--argent)" }}>{displayName}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginTop: 20 }}>
        <span style={{ fontSize: 9, letterSpacing: "0.2em", color: "var(--argent-sombre)" }}>
          CENTRE D&apos;ENTRAÎNEMENT OFFICIEL
        </span>
        <h1 style={{ fontSize: 40, fontWeight: 700, letterSpacing: "0.06em" }}>CAVITÉ</h1>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
        <button
          onClick={() => onStart("normal")}
          style={cardStyle(false)}
        >
          <span style={{ fontWeight: 700, letterSpacing: "0.06em", fontSize: 15 }}>SÉANCE LIBRE</span>
          <span style={{ fontSize: 11, color: "var(--argent)", lineHeight: 1.5 }}>
            Run infini, difficulté croissante — trois balles.
          </span>
        </button>
        <button onClick={() => onStart("daily")} style={cardStyle(true)}>
          <span style={{ fontWeight: 700, letterSpacing: "0.06em", fontSize: 15, color: "var(--or)" }}>
            DÉFI HOMOLOGUÉ DU JOUR
          </span>
          <span style={{ fontSize: 11, color: "var(--argent)", lineHeight: 1.5 }}>
            Bassin identique pour tous — tentatives illimitées, meilleur score du jour retenu.
          </span>
        </button>
        <Link href="/classement" style={{ ...cardStyle(false), textDecoration: "none" }}>
          <span style={{ fontWeight: 700, letterSpacing: "0.06em", fontSize: 15 }}>CLASSEMENTS</span>
        </Link>
      </div>
    </div>
  );
}

function cardStyle(gold: boolean): React.CSSProperties {
  return {
    textAlign: "left",
    border: `1px solid ${gold ? "rgba(228,192,92,.55)" : "var(--ligne)"}`,
    borderRadius: 16,
    padding: "16px 18px",
    background: gold ? "rgba(228,192,92,.08)" : "rgba(22,52,93,.35)",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    color: "inherit",
    font: "inherit",
    cursor: "pointer"
  };
}

function PlayingChrome({ hud, stamp, mode }: { hud: HudState | null; stamp: StampEvent | null; mode: Mode }) {
  if (!hud) return null;
  return (
    <>
      <div className="topPanel" style={{ padding: "14px 16px 6px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 9, letterSpacing: "0.22em", color: "var(--argent-sombre)" }}>
            {mode === "daily" ? "DÉFI DU JOUR" : "F.I.S.T."}
          </span>
          <div style={{ textAlign: "center" }}>
            <div className="num" style={{ fontSize: 25, fontWeight: 700, letterSpacing: "0.04em" }}>
              {hud.score.toLocaleString("fr-FR")}
            </div>
            <div style={{ fontSize: 9, letterSpacing: "0.24em", color: "var(--argent-sombre)" }}>POINTS</div>
          </div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "var(--or)",
              border: "1px solid rgba(228,192,92,.5)",
              borderRadius: 99,
              padding: "5px 10px",
              opacity: hud.serie >= 2 ? 1 : 0.35
            }}
          >
            SÉRIE ×{Math.max(hud.serie, 1)}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", padding: "7px 0 5px" }}>
          {Array.from({ length: 3 }, (_, i) => (
            <i
              key={i}
              style={{
                width: 9,
                height: 9,
                background: i < hud.lives ? "var(--ecume)" : "transparent",
                border: i < hud.lives ? "none" : "1px solid var(--argent-sombre)",
                borderRadius: "50% 50% 50% 0",
                transform: "rotate(-45deg)",
                display: "inline-block"
              }}
            />
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 12,
            fontSize: 9.5,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--argent)"
          }}
        >
          <span>
            TIR <b className="num">{hud.tir}</b>
          </span>
          <span>·</span>
          <span>
            COTE <span style={{ color: "var(--or)" }}>{"★".repeat(hud.stars) + "☆".repeat(5 - hud.stars)}</span>
          </span>
          <span>·</span>
          <span>
            POTENTIEL <b className="num">{hud.potentiel.toLocaleString("fr-FR")}</b>
          </span>
        </div>
        <div
          style={{
            alignSelf: "center",
            margin: "6px auto 0",
            fontSize: 9,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--or)",
            border: "1px solid rgba(228,192,92,.45)",
            background: "rgba(228,192,92,.05)",
            borderRadius: 99,
            padding: "4px 12px",
            width: "fit-content"
          }}
        >
          {hud.pill}
        </div>
      </div>

      {stamp ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            pointerEvents: "none"
          }}
        >
          <div
            style={{
              fontSize: stamp.isMiss ? 22 : 30,
              fontWeight: 700,
              letterSpacing: "0.28em",
              marginRight: "-0.28em",
              color: stamp.isMiss ? "var(--argent)" : "var(--or)",
              border: `3px solid ${stamp.isMiss ? "var(--argent)" : "var(--or)"}`,
              borderRadius: 6,
              padding: "12px 18px 12px 24px",
              transform: "rotate(-4deg)",
              background: "rgba(5,14,30,.55)"
            }}
          >
            {stamp.text}
          </div>
          <div className="num" style={{ fontSize: 20, fontWeight: 700, color: "var(--ecume)", letterSpacing: "0.1em" }}>
            {stamp.points}
          </div>
        </div>
      ) : null}
    </>
  );
}

function SummaryScreen({ summary, onReplay, onMenu }: { summary: Summary; onReplay: () => void; onMenu: () => void }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        textAlign: "center"
      }}
    >
      <span style={{ fontSize: 10, letterSpacing: "0.24em", color: "var(--argent-sombre)" }}>PROCÈS-VERBAL PROVISOIRE</span>
      <h2 style={{ fontSize: 22, letterSpacing: "0.1em" }}>FIN DE SÉANCE</h2>
      <div className="num" style={{ fontSize: 46, fontWeight: 700 }}>
        {summary.score.toLocaleString("fr-FR")}
      </div>
      <p style={{ fontSize: 12, color: "var(--argent)", maxWidth: "30ch", lineHeight: 1.6, borderTop: "1px solid var(--ligne)", paddingTop: 14 }}>
        Tir atteint : n°{summary.tirAtteint} · {summary.hits} homologué{summary.hits > 1 ? "s" : ""} · meilleure série ×
        {Math.max(summary.bestSerie, 1)}. Procès-verbal transmis au greffe de la F.I.S.T.
      </p>
      <button className="btn" onClick={onReplay}>
        NOUVELLE SÉANCE
      </button>
      <Link href="/classement" className="btn-ghost" style={{ textDecoration: "none", display: "inline-block" }}>
        VOIR LES CLASSEMENTS
      </Link>
      <button className="btn-ghost" onClick={onMenu}>
        MENU
      </button>
    </div>
  );
}
