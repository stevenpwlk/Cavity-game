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

const DISPATCHES = [
  "Dépêche F.I.S.T. n°071 — Le sifflet réglementaire doit être immergé trois secondes avant tout coup d'Anchosiffle, sous peine d'invalidation du tir.",
  "Communiqué du Conseil — La raquette ne peut être huilée qu'au beurre clarifié. L'huile de tournesol reste strictement prohibée.",
  "Note de service — Un requin-marteau ayant traversé la cavité sans faute technique conserve son droit de passage jusqu'à la fin de la manche.",
  "Bulletin officiel — Le nuage de paprika est classé arôme réglementaire depuis la réforme de l'an dernier. Toute contestation se fait par écrit.",
  "Avis aux licenciés — Un banc d'anchois traversant la trajectoire n'est ni un obstacle ni un bonus tant que le Conseil n'a pas tranché.",
  "Procès-verbal type — Toute balle immergée plus de quinze mètres est déclarée définitivement coulée, sauf saisine du Conseil des Siffleurs.",
  "Circulaire n°12 — Le courant peut légalement changer de sens sans préavis, conformément à l'article 4 du règlement aquatique.",
  "Mémo interne — La Fosse Paprikée Internationale n'accepte aucune réclamation formulée hors du bassin.",
  "Communiqué — Le duel de souffle reste l'unique méthode homologuée pour départager un vote 2-2 du Conseil.",
  "Rappel réglementaire — Delphes-sur-Mer impose une salinité mesurée chaque matin par un huissier assermenté.",
  "Avis du greffe — Tout tir signé homologué triple les points, mais engage la responsabilité morale du tireur devant le Conseil.",
  "Note technique — Le Couloir des Requins-Marteaux est en transit permanent ; aucune pause n'est prévue au calendrier.",
  "Bulletin météo aquatique — Bassin calme en surface, jugé « charpenté, notes de sédiment » par le sommelier officiel.",
  "Dépêche express — Les vies restantes ne sont pas remboursables, sauf décision contraire du Conseil des Siffleurs."
];

function pickDispatch(): string {
  return DISPATCHES[Math.floor(Math.random() * DISPATCHES.length)]!;
}

const BUBBLES = Array.from({ length: 9 }, (_, i) => ({
  left: (i * 41 + 6) % 100,
  size: 5 + ((i * 11) % 9),
  duration: 10 + ((i * 7) % 9),
  delay: (i * 2.6) % 9
}));

export function CaviteGame({ displayName }: { displayName: string }) {
  const [screen, setScreen] = useState<Screen>("menu");
  const [hud, setHud] = useState<HudState | null>(null);
  const [stamp, setStamp] = useState<StampEvent | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("normal");
  const [dispatch, setDispatch] = useState("");
  const [crashMsg, setCrashMsg] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<import("phaser").Game | null>(null);
  const sceneRef = useRef<import("./CaviteScene").CaviteScene | null>(null);
  const runIdRef = useRef<string | null>(null);
  const stampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function startRun(selectedMode: Mode) {
    setMode(selectedMode);
    setScreen("loading");
    setDispatch(pickDispatch());
    setErrorMsg(null);
    setCrashMsg(null);
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

      // `?canvas=1` force le renderer Canvas de Phaser : le rendu WebGL est
      // instable en headless (GPU stall SwiftShader/ANGLE sur certaines
      // machines), ce qui fige les captures d'écran automatisées. Le mode
      // Canvas est fidèle au visuel (seuls les postFX bloom/vignette WebGL,
      // déjà en try/catch, sont absents) et permet de tester le jeu.
      const forceCanvas =
        typeof window !== "undefined" && new URLSearchParams(window.location.search).get("canvas") === "1";

      gameRef.current = new Phaser.Game({
        type: forceCanvas ? Phaser.CANVAS : Phaser.AUTO,
        parent: containerRef.current!,
        // Canvas transparent : sur les bassins à fond illustré, le décor est un
        // calque DOM plein écran (venue-bg) et le canvas ne peint que le
        // gameplay par-dessus. Les bassins procéduraux peignent un fond opaque
        // dans leur zone, donc restent inchangés.
        transparent: true,
        backgroundColor: "#050e1e",
        width: 780,
        height: 1240,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }
      });

      // Le boot de la Game est différé par Phaser : `scene.scene` (le plugin
      // injecté sur l'instance) n'existe pas encore ici. `game.scene.add(...,
      // autoStart, data)` passe par la file d'attente du SceneManager, qui est
      // sûre à appeler avant la fin du boot.
      gameRef.current.scene.add("cavite", scene, true, {
        seed: data.seed,
        callbacks: {
          onHud: (h: HudState) => setHud(h),
          onStamp: (s: StampEvent) => {
            setStamp(s);
            if (stampTimer.current) clearTimeout(stampTimer.current);
            stampTimer.current = setTimeout(() => setStamp(null), 1050);
          },
          onEnd: (s: Summary) => void finishRun(s),
          onCrash: (m: string) => setCrashMsg(m)
        }
      });

      setScreen("playing");
    } catch (e) {
      console.error("startRun failed", e);
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
        {screen === "playing" && hud?.venueBg ? (
          <div className="venue-bg" style={{ backgroundImage: `url(${hud.venueBg})` }} />
        ) : null}

        {screen === "menu" ? (
          <MenuScreen displayName={displayName} onStart={startRun} />
        ) : null}

        {screen === "loading" ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              padding: "0 34px",
              textAlign: "center"
            }}
          >
            <span style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--argent)" }}>OUVERTURE DU BASSIN…</span>
            <p style={{ fontSize: 11, color: "var(--argent-sombre)", lineHeight: 1.6, fontStyle: "italic" }}>{dispatch}</p>
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

        <div
          ref={containerRef}
          className={hud?.venueBg ? "canvas-lift" : undefined}
          style={{ display: screen === "playing" ? "block" : "none", flex: 1, touchAction: "none", position: "relative", zIndex: 1 }}
        />

        {screen === "summary" && summary ? (
          <SummaryScreen summary={summary} onReplay={() => startRun(mode)} onMenu={() => setScreen("menu")} />
        ) : null}

        {crashMsg ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 30,
              background: "rgba(120,20,20,.94)",
              color: "#fff",
              padding: "12px 14px",
              fontSize: 11,
              lineHeight: 1.5,
              fontFamily: "monospace"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
              <b>Erreur technique détectée</b>
              <button
                onClick={() => setCrashMsg(null)}
                style={{ background: "none", border: "none", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 15 }}
              >
                ×
              </button>
            </div>
            <div style={{ wordBreak: "break-word" }}>{crashMsg}</div>
            <div style={{ marginTop: 6, opacity: 0.8 }}>Capture d&apos;écran utile pour le débogage, merci.</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MenuScreen({ displayName, onStart }: { displayName: string; onStart: (mode: Mode) => void }) {
  return (
    <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", padding: 22, gap: 22, overflow: "hidden" }}>
      <div className="menu-backdrop">
        <div className="menu-caustic" />
        {BUBBLES.map((b, i) => (
          <span
            key={i}
            className="menu-bubble"
            style={{
              left: `${b.left}%`,
              width: b.size,
              height: b.size,
              animationDuration: `${b.duration}s`,
              animationDelay: `${b.delay}s`
            }}
          />
        ))}
      </div>

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 22, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Link
            href="https://prono.trounis.fr/"
            style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--sonar)", textDecoration: "underline" }}
          >
            ‹ RETOUR AUX PRONOS
          </Link>
          <span style={{ fontSize: 12, color: "var(--argent)" }}>{displayName}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginTop: 12 }}>
          <span style={{ fontSize: 9, letterSpacing: "0.2em", color: "var(--argent-sombre)" }}>
            CENTRE D&apos;ENTRAÎNEMENT OFFICIEL
          </span>
          <h1 style={{ fontSize: 40, fontWeight: 700, letterSpacing: "0.06em" }}>CAVITY GAME</h1>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          <button onClick={() => onStart("normal")} style={cardStyle(false)}>
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
      <div className="topPanel" style={{ padding: "12px 16px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 9, letterSpacing: "0.22em", color: "var(--argent-sombre)" }}>
            {mode === "daily" ? "DÉFI DU JOUR" : "F.I.S.T."}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "var(--or)",
              border: "1px solid rgba(228,192,92,.5)",
              borderRadius: 99,
              padding: "5px 10px",
              opacity: hud.serie >= 2 ? 1 : 0.4
            }}
          >
            SÉRIE ×{Math.max(hud.serie, 1)}
          </span>
        </div>
        <div style={{ textAlign: "center", marginTop: 4 }}>
          <div className="num" style={{ fontSize: 44, fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1 }}>
            {hud.score.toLocaleString("fr-FR")}
          </div>
          <div style={{ fontSize: 9, letterSpacing: "0.24em", color: "var(--argent-sombre)", marginTop: 3 }}>POINTS</div>
        </div>
        <div style={{ display: "flex", gap: 9, justifyContent: "center", marginTop: 9 }}>
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
      </div>

      {/* Dock bas : fiche du tir posée sur l'eau vide, affichage pur (ne bloque
          jamais le geste de visée grâce à pointerEvents: none). */}
      <div
        className="bottomDock"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 2,
          pointerEvents: "none",
          textAlign: "center",
          padding: "40px 18px 30px",
          background: "linear-gradient(0deg, rgba(2,8,16,.92) 40%, rgba(2,8,16,.45) 78%, rgba(2,8,16,0))"
        }}
      >
        <div
          style={{
            display: "inline-block",
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--or)",
            border: "1px solid rgba(228,192,92,.45)",
            background: "rgba(228,192,92,.05)",
            borderRadius: 99,
            padding: "6px 15px",
            marginBottom: 14
          }}
        >
          {hud.pill}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 14,
            fontSize: 10.5,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--argent)"
          }}
        >
          <span>
            TIR <b className="num">{hud.tir}</b>
          </span>
          <span style={{ color: "var(--argent-sombre)" }}>·</span>
          <span>
            COTE <span style={{ color: "var(--or)" }}>{"★".repeat(hud.stars) + "☆".repeat(5 - hud.stars)}</span>
          </span>
          <span style={{ color: "var(--argent-sombre)" }}>·</span>
          <span>
            POTENTIEL <b className="num">{hud.potentiel.toLocaleString("fr-FR")}</b>
          </span>
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
