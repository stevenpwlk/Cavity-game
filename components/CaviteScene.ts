import * as Phaser from "phaser";
import {
  ENGINE,
  mulberry32,
  computeShotDiff,
  racketPose,
  cavityWorld,
  sharkPose,
  potFactor,
  currentNow,
  physStep,
  simulateShot,
  type ShotDiff,
  type ShotInput,
  type Vec2
} from "@/lib/engine";
import { initAudio, playLaunch, playBounce, playSharkHit, playHomologue, playMiss } from "@/lib/sound";
import { vibrateLaunch, vibrateBounce, vibrateSharkHit, vibrateHit, vibrateMiss } from "@/lib/haptics";

const TUTORIAL_KEY = "cavite_tutorial_seen_v1";

function tutorialSeen(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(TUTORIAL_KEY) === "1";
  } catch {
    return true;
  }
}

function markTutorialSeen(): void {
  try {
    window.localStorage.setItem(TUTORIAL_KEY, "1");
  } catch {
    /* stockage indisponible, tant pis */
  }
}

const { W, H, SURF, LAUNCH_K, SPEED_MAX } = ENGINE;

const VENUES = [
  { nom: "Piscine Municipale des Siffleurs", sky: 0x0c2140, top: 0x1c4e7c, bot: 0x081c36, decor: "siffleurs" },
  { nom: "Fosse Paprikée Internationale", sky: 0x241423, top: 0x57303a, bot: 0x170b15, decor: "paprikee" },
  { nom: "Delphes-sur-Mer", sky: 0x0a2a35, top: 0x0f5e69, bot: 0x052430, decor: "delphes" },
  { nom: "Couloir des Requins-Marteaux", sky: 0x0a1526, top: 0x16304e, bot: 0x030a16, decor: "requins" }
] as const;
const ROMAIN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const PILLAR_XS = [120, 660] as const;
// Fond illustré des bassins à photo, servi en statique et affiché en calque DOM
// plein écran (voir CaviteGame). URL exposée à React via HudState.venueBg.
const VENUE_BG: Partial<Record<(typeof VENUES)[number]["decor"], string>> = {
  siffleurs: "/backgrounds/bassin-siffleurs.webp"
};

const MILESTONES: Record<number, string> = {
  1: "PREMIER TIR — RAQUETTE FIXE",
  2: "COURANT ACTIF — L’APERÇU NE LE COMPENSE PAS",
  3: "LA RAQUETTE DÉRIVE",
  4: "LA CAVITÉ SE RESSERRE",
  6: "PALIER II — LA FOSSE PAPRIKÉE",
  7: "LE COURANT PEUT CHANGER DE SENS",
  8: "REQUINS-MARTEAUX EN TRANSIT",
  9: "COURANT TURBULENT PENDANT LE VOL",
  11: "PALIER III — DELPHES-SUR-MER",
  12: "UN BANC D’ANCHOIS MASQUE LA VUE",
  16: "PALIER IV — LE COULOIR DES REQUINS"
};

export interface HudState {
  score: number;
  serie: number;
  lives: number;
  tir: number;
  stars: number;
  potentiel: number;
  pill: string;
  venuePalier: string;
  venueNom: string;
  courantLevel: number;
  courantDir: 1 | -1;
  venueBg: string | null;
}

export interface StampEvent {
  text: string;
  points: string;
  isMiss: boolean;
}

export interface CaviteCallbacks {
  onHud: (hud: HudState) => void;
  onStamp: (stamp: StampEvent) => void;
  onEnd: (summary: { score: number; hits: number; tirAtteint: number; bestSerie: number }) => void;
  onCrash?: (message: string) => void;
}

type Phase = "ready" | "aiming" | "flying" | "pause" | "over";

export class CaviteScene extends Phaser.Scene {
  private seed = 0;
  private rng: () => number = () => 0;
  private callbacks!: CaviteCallbacks;

  private tir = 0;
  private score = 0;
  private serie = 0;
  private bestSerie = 0;
  private hits = 0;
  private lives = 3;
  private bassin = -1;

  private mod!: ShotDiff;
  private shotStartAt = 0; // secondes de perf.now() au début du tir courant
  private stateName: Phase = "ready";
  private aimStart: Vec2 = { x: 0, y: 0 };
  private aimCur: Vec2 = { x: 0, y: 0 };

  private ball!: Phaser.GameObjects.Container;
  private ballGlow!: Phaser.GameObjects.Image;
  private ballVel: Vec2 = { x: 0, y: 0 };
  private ballFlyT = 0;
  private ballHome: Vec2 = { x: 0, y: 0 };
  private ballBounced = false;
  private ballSharkHit = false;
  private ballLaunchPotF = 1;
  private trace: Vec2[] = [];
  private ghost: Vec2[] | null = null;

  private racket!: Phaser.GameObjects.Container;
  private racketFrame!: Phaser.GameObjects.Image;
  private cavity!: Phaser.GameObjects.Container;
  private cavGlow!: Phaser.GameObjects.Image;
  private shark!: Phaser.GameObjects.Container;
  private anchois!: Phaser.GameObjects.Container;
  private swimmer!: Phaser.GameObjects.Container;

  private arenaGfx!: Phaser.GameObjects.Graphics;
  private bokehLayer!: Phaser.GameObjects.Container;
  private caustic1!: Phaser.GameObjects.TileSprite;
  private caustic2!: Phaser.GameObjects.TileSprite;
  private raysGfx!: Phaser.GameObjects.Graphics;
  private grain!: Phaser.GameObjects.TileSprite;
  private waveGfx!: Phaser.GameObjects.Graphics;
  private flowGfx!: Phaser.GameObjects.Graphics;
  private ghostGfx!: Phaser.GameObjects.Graphics;
  private aimGfx!: Phaser.GameObjects.Graphics;
  private spinGfx!: Phaser.GameObjects.Graphics;
  private spinA = 0;
  private waveT = 0;
  private flowX = 0;
  private flowSeeds: { y: number; off: number; len: number }[] = [];
  private racketOrigin = { x: 0.5, y: 0.5 };
  private bgImage: Phaser.GameObjects.Image | null = null;
  private photoBg = false;
  private venueBgUrl: string | null = null;
  // Latéralité : quand true (droitier), le canvas est retourné en miroir via CSS
  // (voir CaviteGame). La simulation reste canonique ; on ré-inverse simplement
  // le X du doigt pour que la visée corresponde à ce qui est affiché.
  private flipX = false;

  private trail!: Phaser.GameObjects.Particles.ParticleEmitter;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;

  private shots: ShotInput[] = [];
  private slowMoActive = false;
  private flightStartedAt = 0;
  private crashReported = false;
  private tutorialGfx: Phaser.GameObjects.Container | null = null;
  private tutorialShown = false;

  constructor() {
    super("cavite");
  }

  init(data: { seed: number; callbacks: CaviteCallbacks; flipX?: boolean }) {
    this.seed = data.seed;
    this.rng = mulberry32(this.seed);
    this.callbacks = data.callbacks;
    this.flipX = !!data.flipX;
  }

  preload() {
    // Fond illustré du bassin des Siffleurs (généré via image_gen, servi en
    // statique). Les autres bassins restent en rendu procédural pour l'instant ;
    // si le chargement échoue, drawArena retombe automatiquement sur le décor
    // procédural (garde-fou this.bgImage !== null).
    this.load.image("bg_siffleurs", "/backgrounds/bassin-siffleurs.webp");
  }

  create() {
    this.makeTextures();
    this.bgImage = this.textures.exists("bg_siffleurs")
      ? this.add.image(W / 2, H / 2, "bg_siffleurs").setDisplaySize(W, H).setVisible(false)
      : null;
    this.arenaGfx = this.add.graphics();
    this.bokehLayer = this.add.container();
    this.caustic1 = this.add
      .tileSprite(0, SURF, W, H - SURF, "causticTile")
      .setOrigin(0, 0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.1);
    this.caustic2 = this.add
      .tileSprite(0, SURF, W, H - SURF, "causticTile")
      .setOrigin(0, 0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.06)
      .setTileScale(1.4, 1.4);

    this.raysGfx = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);

    this.racket = this.add.container(600, 520);
    this.buildRacket();

    this.shark = this.add.container(-300, 400);
    this.buildShark();
    this.anchois = this.add.container(-500, 500);
    this.buildAnchois();

    this.swimmer = this.add.container(170, 848);
    this.swimmer.add(this.add.image(0, 16, "shadowSoft").setScale(0.5, 0.32).setAlpha(0.28));
    this.buildSwimmer();
    this.tweens.add({ targets: this.swimmer, y: "+=10", duration: 3000, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

    this.ball = this.add.container(this.ballHome.x, this.ballHome.y);
    this.ball.add(this.add.image(0, 0, "ballTex").setDisplaySize(44, 44));
    this.ballGlow = this.add
      .image(this.ball.x, this.ball.y, "glow")
      .setScale(0.9)
      .setTint(0xbfe0ff)
      .setAlpha(0.18)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.trail = this.add.particles(0, 0, "bubble", {
      speed: { min: 8, max: 30 },
      angle: { min: 250, max: 290 },
      scale: { start: 0.55, end: 0.15 },
      alpha: { start: 0.6, end: 0 },
      lifespan: 900,
      frequency: -1
    });
    this.burst = this.add.particles(0, 0, "gold", {
      speed: { min: 60, max: 320 },
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 700,
      frequency: -1,
      blendMode: Phaser.BlendModes.ADD
    });
    this.add.particles(0, 0, "dot", {
      x: { min: 0, max: W },
      y: { min: SURF + 40, max: H - 80 },
      speedY: { min: -14, max: -5 },
      speedX: { min: -6, max: 10 },
      scale: { min: 0.2, max: 0.5 },
      alpha: { start: 0.16, end: 0 },
      lifespan: 9000,
      frequency: 320
    });

    this.waveGfx = this.add.graphics();
    this.flowGfx = this.add.graphics();
    this.ghostGfx = this.add.graphics();
    this.aimGfx = this.add.graphics();
    this.spinGfx = this.add.graphics();
    this.flowSeeds = Array.from({ length: 14 }, (_, i) => ({
      y: 220 + ((i * 67) % 880),
      off: (i * 173) % 780,
      len: 26 + ((i * 31) % 40)
    }));

    this.grain = this.add.tileSprite(0, 0, W, H, "grainTile").setOrigin(0, 0).setAlpha(0.035);

    try {
      if (this.sys.game.renderer.type === Phaser.WEBGL) {
        this.cameras.main.postFX.addVignette(0.5, 0.5, 0.78, 0.35);
        this.cavGlow.postFX.addBloom(0xe8c766, 1, 1, 1.3, 1.2, 6);
        this.ballGlow.postFX.addBloom(0xbfe0ff, 1, 1, 1.1, 1, 6);
      }
    } catch {
      /* rendu Canvas : pas de postFX, dégradation silencieuse */
    }

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      try {
        if (this.stateName !== "ready") return;
        initAudio();
        if (this.tutorialGfx) this.hideTutorialHint();
        this.stateName = "aiming";
        const px = this.flipX ? W - p.x : p.x;
        this.aimStart = { x: px, y: p.y };
        this.aimCur = { x: px, y: p.y };
      } catch (e) {
        this.reportCrash(e);
      }
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (this.stateName === "aiming") this.aimCur = { x: this.flipX ? W - p.x : p.x, y: p.y };
    });
    this.input.on("pointerup", () => {
      try {
        if (this.stateName !== "aiming") return;
        const dx = this.aimStart.x - this.aimCur.x;
        const dy = this.aimStart.y - this.aimCur.y;
        this.aimGfx.clear();
        if (Math.hypot(dx, dy) < ENGINE.MIN_DRAG) {
          this.stateName = "ready";
          return;
        }
        this.launch(dx, dy);
      } catch (e) {
        this.reportCrash(e);
      }
    });

    this.startRun();
  }

  private startRun() {
    this.tir = 0;
    this.score = 0;
    this.serie = 0;
    this.hits = 0;
    this.bestSerie = 0;
    this.lives = 3;
    this.ghost = null;
    this.bassin = -1;
    this.shots = [];
    this.nextShot();
  }

  private nextShot() {
    this.tir += 1;
    this.mod = computeShotDiff(this.tir, this.rng);
    this.shotStartAt = this.time.now / 1000;

    if (this.mod.bassin !== this.bassin) {
      this.bassin = this.mod.bassin;
      this.drawArena(VENUES[this.mod.bassin]!);
    }
    this.ballHome = { x: this.mod.bx, y: this.mod.by };
    this.tweens.add({ targets: this.swimmer, x: this.mod.bx - 98, y: this.mod.by + 38, duration: 450, ease: "Sine.easeInOut" });
    this.cavity.setPosition(this.mod.cavOx, this.mod.cavOy);
    this.cavity.setScale(this.mod.cavScale);
    this.cavGlow.setAlpha(this.mod.signe ? 0.9 : 0.5);

    this.resetBall();
    this.emitHud();

    if (this.tir === 1 && !this.tutorialShown && !tutorialSeen()) {
      this.showTutorialHint();
    }
  }

  private showTutorialHint() {
    this.tutorialShown = true;
    const startX = this.ball.x;
    const startY = this.ball.y;
    const endX = startX - 70;
    const endY = startY + 90;

    const dot = this.add.circle(startX, startY, 16, 0xe9f1fb, 0.85).setStrokeStyle(2, 0x4fa3d8, 0.9);
    const label = this.add
      .text(startX, startY - 70, "GLISSE POUR VISER", {
        fontFamily: "sans-serif",
        fontSize: "15px",
        color: "#e9f1fb",
        fontStyle: "bold"
      })
      .setOrigin(0.5)
      // Le canvas entier est retourné en miroir côté CSS pour les droitiers ;
      // on contre-inverse le seul texte in-canvas pour qu'il reste lisible.
      .setScale(this.flipX ? -1 : 1, 1)
      .setAlpha(0.85);

    this.tutorialGfx = this.add.container(0, 0, [dot, label]);
    this.tutorialGfx.setDepth(50);

    this.tweens.add({ targets: dot, x: endX, y: endY, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.tweens.add({ targets: label, alpha: { from: 0.85, to: 0.4 }, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  private hideTutorialHint() {
    if (this.tutorialGfx) {
      this.tweens.killTweensOf(this.tutorialGfx.list);
      this.tutorialGfx.destroy(true);
      this.tutorialGfx = null;
    }
    markTutorialSeen();
  }

  private resetBall() {
    this.ball.setPosition(this.ballHome.x, this.ballHome.y).setAlpha(1).setVisible(true);
    this.ball.rotation = 0;
    this.stateName = "ready";
  }

  private tSinceShotStart(): number {
    return this.time.now / 1000 - this.shotStartAt;
  }

  private pillText(): string {
    const d = this.mod;
    if (d.signe) return "TIR SIGNÉ — HOMOLOGATION ×3";
    if (MILESTONES[d.n]) return MILESTONES[d.n]!;
    if (d.n > 16 && (d.n - 1) % 5 === 0) {
      return `PALIER ${ROMAIN[Math.floor((d.n - 1) / 5)] ?? d.n} — CYCLE ${ROMAIN[d.cycle] ?? d.cycle + 1}`;
    }
    return d.cavScale < 0.8 ? "LA CAVITÉ SE RESSERRE" : "DÉRIVE ET COURANT ACCRUS";
  }

  private emitHud() {
    const d = this.mod;
    const readyT = this.stateName === "ready" || this.stateName === "aiming" ? this.tSinceShotStart() : 0;
    const pf = potFactor(readyT);
    const lvl = d.curBase === 0 ? 0 : d.curBase < 80 ? 1 : d.curBase < 140 ? 2 : 3;
    this.callbacks.onHud({
      score: this.score,
      serie: this.serie,
      lives: this.lives,
      tir: this.tir,
      stars: d.stars,
      potentiel: Math.round(d.potBase * pf * (d.signe ? 3 : 1)),
      pill: this.pillText(),
      venuePalier: `PALIER ${ROMAIN[Math.floor((d.n - 1) / 5)] ?? "?"}`,
      venueNom: VENUES[d.bassin]!.nom + (d.cycle ? ` · CYCLE ${ROMAIN[d.cycle]}` : ""),
      courantLevel: lvl,
      courantDir: d.curDir,
      venueBg: this.venueBgUrl
    });
  }

  private launch(dx: number, dy: number) {
    const len = Math.hypot(dx, dy);
    const sp = Math.min(len * LAUNCH_K, SPEED_MAX);
    this.ballVel = { x: (dx / len) * sp, y: (dy / len) * sp };
    const readySeconds = this.tSinceShotStart();
    this.shots.push({ dx, dy, readySeconds });
    this.ballLaunchPotF = potFactor(readySeconds);
    // Sur la dernière balle, si ce tir va terminer la série (prédiction via le
    // même moteur déterministe que le rejeu serveur), on joue le vol au ralenti
    // pour le suspense — cosmétique uniquement, le score reste calculé par le
    // rejeu réel côté serveur.
    this.slowMoActive = this.lives === 1 && !simulateShot(this.mod, this.seed, { dx, dy, readySeconds }).hit;
    this.stateName = "flying";
    this.flightStartedAt = this.time.now;
    this.ballFlyT = 0;
    this.ballBounced = false;
    this.ballSharkHit = false;
    this.trace = [];
    playLaunch();
    vibrateLaunch();
    this.trail.emitParticleAt(this.ball.x, this.ball.y, 6);
  }

  update(time: number, dms: number) {
    // Filet de diagnostic : si safeUpdate() lève une exception (constatée sur
    // Safari iOS, cause encore non identifiée), on l'attrape ici plutôt que
    // de laisser la frame planter silencieusement — ce qui, sur certains
    // moteurs JS, tue la boucle requestAnimationFrame et fige le jeu pour de
    // bon, y compris le filet de sécurité temporel plus bas. On journalise
    // et on remonte le message à l'écran via onCrash pour pouvoir diagnostiquer
    // sans accès à un vrai appareil iOS.
    try {
      this.safeUpdate(time, dms);
    } catch (e) {
      this.reportCrash(e);
    }
  }

  private reportCrash(e: unknown): void {
    // eslint-disable-next-line no-console
    console.error("CaviteScene update crashed", e);
    if (this.crashReported) return;
    this.crashReported = true;
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    this.callbacks.onCrash?.(message);
  }

  private safeUpdate(_: number, dms: number) {
    // Sur certains navigateurs mobiles (Safari iOS notamment), un delta de
    // frame anormal (NaN, négatif, énorme après une pause d'onglet) peut
    // survenir ; on le neutralise ici pour ne jamais laisser un NaN
    // contaminer la physique (ce qui gèlerait la balle indéfiniment).
    const rawDt = dms / 1000;
    const dt = Number.isFinite(rawDt) && rawDt > 0 ? Math.min(rawDt, 0.033) : 0;
    const d = this.mod;
    if (!d) return;

    const readyT = this.stateName === "ready" || this.stateName === "aiming" ? this.tSinceShotStart() : 0;
    if (this.stateName === "ready" || this.stateName === "aiming") this.emitHud();

    const curNow =
      this.stateName === "flying"
        ? currentNow(d, this.ballFlyT)
        : currentNow(d, (this.waveT + readyT) * 0);
    this.flowX += curNow * dt * 0.9;
    this.flowGfx.clear();
    if (d.curBase) {
      this.flowGfx.lineStyle(2, 0x9fc8ee, 0.14);
      for (const s of this.flowSeeds) {
        const x = (((s.off + this.flowX) % (W + 120)) + (W + 120)) % (W + 120) - 60;
        this.flowGfx.beginPath();
        this.flowGfx.moveTo(x, s.y);
        this.flowGfx.lineTo(x + s.len * Math.sign(curNow || 1), s.y);
        this.flowGfx.strokePath();
      }
    }

    this.caustic1.tilePositionX += dt * 10;
    this.caustic1.tilePositionY += dt * 4;
    this.caustic2.tilePositionX -= dt * 6;
    this.caustic2.tilePositionY += dt * 7;

    // Sur un bassin à fond photo, la photo porte déjà ses propres rais de
    // lumière et sa surface — on n'y superpose pas les versions procédurales.
    if (this.photoBg) {
      this.raysGfx.clear();
    } else {
      this.drawRays();
    }

    this.waveT += dt;
    this.waveGfx.clear();
    if (!this.photoBg) {
      this.waveGfx.lineStyle(3, 0xe6f1fc, 0.8);
      this.waveGfx.beginPath();
      for (let x = 0; x <= W; x += 12) {
        const y = SURF + Math.sin(x / 46 + this.waveT * 1.8) * 4;
        x === 0 ? this.waveGfx.moveTo(x, y) : this.waveGfx.lineTo(x, y);
      }
      this.waveGfx.strokePath();
    }

    // pose de la raquette pilotée par le moteur partagé
    const tShot = this.tSinceShotStart();
    const pose = racketPose(d, tShot);
    this.racket.setPosition(pose.x, pose.y);
    this.racket.angle = pose.angleDeg;

    const cav = cavityWorld(d, pose);
    this.spinA += dt * 0.5;
    this.spinGfx.clear();
    this.spinGfx.lineStyle(2, 0xe8c766, 0.8);
    for (let i = 0; i < 10; i++) {
      const a = this.spinA + (i * Math.PI) / 5;
      this.spinGfx.beginPath();
      this.spinGfx.arc(cav.x, cav.y, cav.r + 12, a, a + 0.22);
      this.spinGfx.strokePath();
    }

    // requin
    if (d.shark) {
      const s = sharkPose(d, this.seed, tShot);
      if (s) {
        this.shark.setPosition(s.x, s.y).setVisible(true);
      } else {
        this.shark.setVisible(false);
      }
    } else {
      this.shark.setPosition(-300, 400);
    }
    if (d.anchois) {
      const ax = 375 + 55 * Math.sin((tShot * 2 * Math.PI) / 4.8);
      const ay = this.mod.by - 200 + 16 * Math.sin((tShot * 2 * Math.PI) / 1.6);
      this.anchois.setPosition(ax, ay);
    } else {
      this.anchois.setPosition(-500, 500);
    }

    this.ghostGfx.clear();
    if (this.ghost) {
      this.ghostGfx.lineStyle(2.4, 0xaebdd0, 0.32);
      for (let i = 0; i + 1 < this.ghost.length; i += 2) {
        this.ghostGfx.beginPath();
        this.ghostGfx.moveTo(this.ghost[i]!.x, this.ghost[i]!.y);
        this.ghostGfx.lineTo(this.ghost[i + 1]!.x, this.ghost[i + 1]!.y);
        this.ghostGfx.strokePath();
      }
      const e = this.ghost[this.ghost.length - 1];
      if (e) {
        this.ghostGfx.lineStyle(3, 0xaebdd0, 0.45);
        this.ghostGfx.beginPath();
        this.ghostGfx.moveTo(e.x - 8, e.y - 8);
        this.ghostGfx.lineTo(e.x + 8, e.y + 8);
        this.ghostGfx.moveTo(e.x + 8, e.y - 8);
        this.ghostGfx.lineTo(e.x - 8, e.y + 8);
        this.ghostGfx.strokePath();
      }
    }

    this.ballGlow.setPosition(this.ball.x, this.ball.y);
    if (this.stateName === "aiming") this.drawAim();

    if (this.stateName === "flying") {
      // Filet de sécurité indépendant de l'accumulateur ballFlyT : si un tir
      // ne s'est toujours pas résolu après un délai réel généreux (mesuré
      // via l'horloge de Phaser, insensible à une éventuelle corruption du
      // delta de frame), on force un raté plutôt que de laisser la balle
      // bloquée indéfiniment.
      const failsafeMs = this.slowMoActive ? 12000 : 5000;
      if (this.time.now - this.flightStartedAt > failsafeMs) {
        this.onMiss();
        return;
      }
      const flightDt = this.slowMoActive ? dt * 0.32 : dt;
      const prev: Vec2 = { x: this.ball.x, y: this.ball.y };
      const p: Vec2 = { x: this.ball.x, y: this.ball.y };
      physStep(p, this.ballVel, flightDt, currentNow(d, this.ballFlyT));
      this.ball.setPosition(p.x, p.y);
      this.ballFlyT += flightDt;
      this.ball.rotation += flightDt * 2.4;
      if (Math.random() < (this.slowMoActive ? 0.14 : 0.35)) this.trail.emitParticleAt(this.ball.x - 6, this.ball.y, 1);
      if (Math.random() < 0.5) this.trace.push({ x: this.ball.x, y: this.ball.y });

      if (d.shark && !this.ballSharkHit) {
        const s = sharkPose(d, this.seed, tShot);
        if (s) {
          const sx = (p.x - s.x - 70) / 80;
          const sy = (p.y - s.y - 16) / 30;
          if (sx * sx + sy * sy < 1) {
            this.ballSharkHit = true;
            this.ballVel.y = Math.abs(this.ballVel.y) * 0.3 + 170;
            this.ballVel.x *= 0.3;
            this.cameras.main.shake(110, 0.005);
            this.trail.emitParticleAt(this.ball.x, this.ball.y, 10);
            playSharkHit();
            vibrateSharkHit();
          }
        }
      }

      const crossed = (prev.x - cav.x) * (p.x - cav.x) <= 0 && prev.x !== p.x;
      if (crossed) {
        const k = (cav.x - prev.x) / (p.x - prev.x);
        const yc = prev.y + k * (p.y - prev.y);
        const dist = Math.abs(yc - cav.y);
        if (dist < cav.r - 2) {
          this.onSuccess(dist, cav.r);
          return;
        }
        if (!this.ballBounced && Math.abs(yc - pose.y) < 100) {
          this.ballBounced = true;
          const bx = cav.x - Math.sign(this.ballVel.x) * 24;
          this.ball.setPosition(bx, yc);
          this.ballVel.x = -this.ballVel.x * 0.4;
          this.ballVel.y *= 0.55;
          this.cameras.main.shake(90, 0.004);
          this.tweens.add({ targets: this.racket, angle: "+=5", duration: 90, yoyo: true });
          this.trail.emitParticleAt(this.ball.x, this.ball.y, 8);
          playBounce();
          vibrateBounce();
        }
      }
      const past = this.ball.x > this.racket.x + 150 && this.ballVel.y > 0 && this.ball.y > this.racket.y + 150;
      if (this.ball.y > H - 60 || this.ball.x > W + 80 || this.ball.x < -80 || this.ballFlyT > 3.5 || past) {
        this.onMiss();
      }
    }
  }

  private drawAim() {
    const g = this.aimGfx;
    g.clear();
    const dx = this.aimStart.x - this.aimCur.x;
    const dy = this.aimStart.y - this.aimCur.y;
    g.lineStyle(4, 0x4fa3d8, 0.85);
    g.beginPath();
    g.moveTo(this.ball.x, this.ball.y);
    g.lineTo(this.aimCur.x, this.aimCur.y);
    g.strokePath();
    g.lineStyle(3, 0xeef5ff, 0.9);
    g.strokeCircle(this.aimCur.x, this.aimCur.y, 20);
    const len = Math.hypot(dx, dy);
    if (len < ENGINE.MIN_DRAG) return;
    const sp = Math.min(len * LAUNCH_K, SPEED_MAX);
    const p: Vec2 = { x: this.ball.x, y: this.ball.y };
    const v: Vec2 = { x: (dx / len) * sp, y: (dy / len) * sp };
    g.fillStyle(0xeef5ff, 0.95);
    const steps = 60;
    const shown = Math.floor(steps * 0.26);
    for (let i = 0; i < steps; i++) {
      physStep(p, v, 1 / 45, 0);
      if (i % 4 === 0 && i < shown) g.fillCircle(p.x, p.y, 4.5 - (i / steps) * 2.5);
    }
  }

  private onSuccess(dist: number, r: number) {
    this.stateName = "pause";
    this.serie += 1;
    this.hits += 1;
    this.bestSerie = Math.max(this.bestSerie, this.serie);
    const centered = dist < r * 0.35;
    const base = this.mod.potBase + Math.round(300 * (1 - dist / r));
    const basePoints = Math.round(base * this.ballLaunchPotF * (centered ? 1.2 : 1)) * (this.mod.signe ? 3 : 1);
    const points = basePoints * this.serie;
    this.score += points;

    this.burst.emitParticleAt(this.ball.x, this.ball.y, this.mod.signe ? 60 : 26);
    this.cameras.main.flash(280, 232, 199, 102);
    this.cameras.main.shake(200, 0.008);
    this.tweens.add({ targets: this.cavGlow, scale: 3, alpha: 0.9, duration: 160, yoyo: true });
    playHomologue(this.mod.signe);
    vibrateHit();

    this.callbacks.onStamp({
      text: this.mod.signe ? "TIR SIGNÉ HOMOLOGUÉ" : "HOMOLOGUÉ",
      points: `+${points.toLocaleString("fr-FR")} PTS${centered ? " · PASSAGE CENTRÉ ×1,2" : ""}`,
      isMiss: false
    });
    this.ball.setVisible(false);
    this.emitHud();
    this.time.delayedCall(1350, () => this.advance());
  }

  private onMiss() {
    this.stateName = "pause";
    this.serie = 0;
    this.lives -= 1;
    this.ghost = this.trace.slice();
    playMiss();
    vibrateMiss();
    this.callbacks.onStamp({
      text: "LA BALLE COULE",
      points:
        this.lives > 0
          ? `récupération en apnée — ${this.lives} balle${this.lives > 1 ? "s" : ""} restante${this.lives > 1 ? "s" : ""}`
          : "stock de balles épuisé",
      isMiss: true
    });
    this.tweens.add({ targets: this.ball, alpha: 0, duration: 500 });
    this.emitHud();
    this.time.delayedCall(1100, () => this.advance());
  }

  private advance() {
    if (this.lives <= 0) {
      this.stateName = "over";
      this.callbacks.onEnd({ score: this.score, hits: this.hits, tirAtteint: this.tir, bestSerie: this.bestSerie });
      return;
    }
    this.nextShot();
  }

  getShotLog(): ShotInput[] {
    return this.shots;
  }

  // ───────────────────────── textures peintes (identiques au prototype) ─────────────────────────
  private makeTextures() {
    let g = this.make.graphics(undefined, false);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture("dot", 8, 8);
    g.destroy();

    let c: Phaser.Textures.CanvasTexture;
    let ctx: CanvasRenderingContext2D;

    c = this.textures.createCanvas("gold", 20, 20)!;
    ctx = c.getContext();
    let rg = ctx.createRadialGradient(10, 10, 0, 10, 10, 10);
    rg.addColorStop(0, "rgba(255,250,222,1)");
    rg.addColorStop(0.35, "rgba(232,199,102,1)");
    rg.addColorStop(1, "rgba(232,199,102,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, 20, 20);
    c.refresh();

    c = this.textures.createCanvas("bubble", 16, 16)!;
    ctx = c.getContext();
    ctx.strokeStyle = "rgba(219,233,248,.9)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(8, 8, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.7)";
    ctx.beginPath();
    ctx.arc(5.6, 5.6, 1.3, 0, Math.PI * 2);
    ctx.fill();
    c.refresh();

    c = this.textures.createCanvas("glow", 128, 128)!;
    ctx = c.getContext();
    rg = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, "rgba(255,255,255,1)");
    rg.addColorStop(0.4, "rgba(255,255,255,.35)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, 128, 128);
    c.refresh();

    c = this.textures.createCanvas("shadowSoft", 160, 90)!;
    ctx = c.getContext();
    rg = ctx.createRadialGradient(80, 45, 0, 80, 45, 80);
    rg.addColorStop(0, "rgba(2,6,14,.55)");
    rg.addColorStop(1, "rgba(2,6,14,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, 160, 90);
    c.refresh();

    c = this.textures.createCanvas("ballTex", 96, 96)!;
    ctx = c.getContext();
    let bg2 = ctx.createRadialGradient(34, 30, 4, 48, 48, 46);
    bg2.addColorStop(0, "#fbf3dd");
    bg2.addColorStop(0.55, "#efe0bd");
    bg2.addColorStop(1, "#c8a86f");
    ctx.fillStyle = bg2;
    ctx.beginPath();
    ctx.arc(48, 48, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(160,131,79,.55)";
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(8, 36);
    ctx.quadraticCurveTo(48, 62, 88, 36);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(8, 58);
    ctx.quadraticCurveTo(48, 32, 88, 58);
    ctx.stroke();
    const rim2 = ctx.createRadialGradient(48, 48, 32, 48, 48, 46);
    rim2.addColorStop(0, "rgba(90,66,28,0)");
    rim2.addColorStop(1, "rgba(60,44,20,.42)");
    ctx.fillStyle = rim2;
    ctx.beginPath();
    ctx.arc(48, 48, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.beginPath();
    ctx.ellipse(32, 26, 12, 7.5, -0.5, 0, Math.PI * 2);
    ctx.fill();
    c.refresh();

    const RW = 200,
      RH = 320,
      RX = 100,
      RY = 114;
    c = this.textures.createCanvas("racketTex", RW, RH)!;
    ctx = c.getContext();
    let rs = ctx.createRadialGradient(RX + 6, RY + 18, 10, RX + 6, RY + 18, 98);
    rs.addColorStop(0, "rgba(2,6,14,.32)");
    rs.addColorStop(1, "rgba(2,6,14,0)");
    ctx.fillStyle = rs;
    ctx.beginPath();
    ctx.ellipse(RX + 6, RY + 18, 98, 110, 0, 0, Math.PI * 2);
    ctx.fill();
    const hg = ctx.createLinearGradient(RX - 11, 0, RX + 11, 0);
    hg.addColorStop(0, "#5f3f22");
    hg.addColorStop(0.45, "#b98b5e");
    hg.addColorStop(1, "#6d4626");
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.moveTo(RX - 11, RY + 86);
    ctx.lineTo(RX - 11, RY + 180);
    ctx.quadraticCurveTo(RX - 11, RY + 190, RX - 1, RY + 190);
    ctx.lineTo(RX + 1, RY + 190);
    ctx.quadraticCurveTo(RX + 11, RY + 190, RX + 11, RY + 180);
    ctx.lineTo(RX + 11, RY + 86);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(50,32,16,.5)";
    ctx.lineWidth = 1.4;
    for (let y = RY + 104; y <= RY + 176; y += 18) {
      ctx.beginPath();
      ctx.moveTo(RX - 11, y);
      ctx.lineTo(RX + 11, y + 4);
      ctx.stroke();
    }
    const fg = ctx.createLinearGradient(RX - 82, RY - 96, RX + 82, RY + 96);
    fg.addColorStop(0, "#f4f8fc");
    fg.addColorStop(0.35, "#aebdd0");
    fg.addColorStop(0.65, "#66788f");
    fg.addColorStop(1, "#cbd6e4");
    ctx.lineWidth = 11;
    ctx.strokeStyle = fg;
    ctx.beginPath();
    ctx.ellipse(RX, RY, 82, 96, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = "rgba(102,120,143,.55)";
    ctx.beginPath();
    ctx.ellipse(RX, RY, 72, 86, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = "rgba(238,245,255,.75)";
    ctx.beginPath();
    ctx.ellipse(RX, RY, 82, 96, 0, Math.PI * 1.05, Math.PI * 1.5);
    ctx.stroke();
    ctx.strokeStyle = "rgba(169,188,210,.5)";
    ctx.lineWidth = 1;
    for (let x = -64; x <= 64; x += 16) {
      const half = Math.sqrt(Math.max(0, 1 - (x / 70) ** 2)) * 84;
      ctx.beginPath();
      ctx.moveTo(RX + x, RY - half);
      ctx.lineTo(RX + x, RY + half);
      ctx.stroke();
    }
    for (let y = -72; y <= 72; y += 16) {
      const half = Math.sqrt(Math.max(0, 1 - (y / 86) ** 2)) * 70;
      ctx.beginPath();
      ctx.moveTo(RX - half, RY + y);
      ctx.lineTo(RX + half, RY + y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(238,245,255,.1)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(RX - 60, RY - 40);
    ctx.lineTo(RX + 60, RY + 40);
    ctx.stroke();
    const sg = ctx.createRadialGradient(RX + 20, RY + 94, 1, RX + 20, RY + 94, 9);
    sg.addColorStop(0, "#f7e4a3");
    sg.addColorStop(1, "#a8862f");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(RX + 20, RY + 94, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = "#7a5f1f";
    ctx.stroke();
    c.refresh();
    this.racketOrigin = { x: RX / RW, y: RY / RH };

    c = this.textures.createCanvas("grainTile", 128, 128)!;
    ctx = c.getContext();
    const img = ctx.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.random() * 40;
    }
    ctx.putImageData(img, 0, 0);
    c.refresh();

    c = this.textures.createCanvas("causticTile", 256, 256)!;
    ctx = c.getContext();
    const cr = new Phaser.Math.RandomDataGenerator(["caustics"]);
    for (let i = 0; i < 14; i++) {
      const x = cr.between(0, 256),
        y = cr.between(0, 256),
        r = cr.between(20, 46);
      for (const ox of [-256, 0, 256]) {
        for (const oy of [-256, 0, 256]) {
          const grad = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          grad.addColorStop(0, "rgba(207,230,255,.9)");
          grad.addColorStop(1, "rgba(207,230,255,0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    c.refresh();
  }

  private drawRays() {
    const g = this.raysGfx;
    g.clear();
    for (const mx of PILLAR_XS) {
      const dir = mx < W / 2 ? 1 : -1;
      const sway = Math.sin(this.waveT * 0.35 + mx) * 26;
      const pulse = 0.05 + 0.035 * (1 + Math.sin(this.waveT * 0.6 + mx * 0.01));
      g.fillStyle(0xdceeff, pulse);
      g.fillTriangle(mx - 15, 30, mx + 15, 30, mx + dir * 150 + sway, H * 0.55);
      g.fillStyle(0xdceeff, pulse * 0.5);
      g.fillTriangle(mx - 26, 30, mx + 26, 30, mx + dir * 170 + sway, H * 0.55);
    }
  }

  private drawArena(v: (typeof VENUES)[number]) {
    const g = this.arenaGfx;
    g.clear();

    // Bassin à fond illustré : la photo fournit toute l'ambiance (arène,
    // surface, rais de lumière), on saute donc le décor procédural et on recale
    // les caustiques sur la ligne de surface de la photo.
    // `this.bgImage !== null` sert de garde-fou : l'image n'est utilisée (en
    // calque DOM) que si Phaser a bien pu la précharger — sinon on retombe sur
    // le décor procédural.
    const bgUrl = this.bgImage !== null ? VENUE_BG[v.decor] : undefined;
    this.photoBg = !!bgUrl;
    if (bgUrl) {
      // Le décor plein écran est un calque DOM (voir CaviteGame / HudState.venueBg).
      // Le canvas Phaser est transparent et ne peint que le gameplay : on masque
      // le bgImage in-canvas et toutes les couches d'ambiance procédurales, qui
      // s'arrêteraient au bord letterboxé du canvas et créeraient une couture.
      this.venueBgUrl = bgUrl;
      this.bgImage!.setVisible(false);
      this.bokehLayer.removeAll(true);
      this.raysGfx.clear();
      this.waveGfx.clear();
      this.caustic1.setVisible(false);
      this.caustic2.setVisible(false);
      return;
    }
    this.venueBgUrl = null;
    if (this.bgImage) this.bgImage.setVisible(false);
    this.caustic1.setVisible(true).setPosition(0, SURF).setSize(W, H - SURF);
    this.caustic2.setVisible(true).setPosition(0, SURF).setSize(W, H - SURF);

    g.fillStyle(v.sky, 1);
    g.fillRect(0, 0, W, SURF);
    g.fillStyle(0x060f20, 1);
    this.band(g, 40, 96);
    g.fillStyle(0x081426, 1);
    this.band(g, 92, 132);

    this.bokehLayer.removeAll(true);
    const rnd = new Phaser.Math.RandomDataGenerator(["fist" + v.decor]);
    const cols = [0xe4c05c, 0xe9f1fb, 0x4fa3d8, 0xc8563b];
    for (let i = 0; i < 34; i++) {
      const img = this.add
        .image(rnd.between(10, W - 10), rnd.between(46, 128), "glow")
        .setTint(rnd.pick(cols))
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(rnd.realInRange(0.35, 0.8))
        .setScale(rnd.realInRange(0.05, 0.11));
      this.bokehLayer.add(img);
    }

    for (const mx of PILLAR_XS) {
      g.fillStyle(0x040b18, 1);
      g.fillRect(mx - 3, 24, 6, SURF - 24);
      g.fillRoundedRect(mx - 24, 14, 48, 14, 6);
      g.fillStyle(0xffe9ad, 1);
      for (const dx of [-13, 0, 13]) g.fillCircle(mx + dx, 21, 4);
    }
    g.fillGradientStyle(v.top, v.top, v.bot, v.bot, 1);
    g.fillRect(0, SURF, W, H - SURF);

    if (v.decor === "siffleurs") {
      g.lineStyle(1, 0xe9f1fb, 0.05);
      for (let y = SURF + 110; y < H - 120; y += 112) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.strokePath();
      }
      for (let x = 96; x < W; x += 196) {
        g.beginPath();
        g.moveTo(x, SURF);
        g.lineTo(x, H - 140);
        g.strokePath();
      }
      for (let i = 0; i < 12; i++) {
        g.fillStyle(i % 2 ? 0xc8563b : 0xe9f1fb, 0.8);
        g.fillCircle(30 + i * 44, SURF, 4.5);
      }
      g.lineStyle(5, 0x8fa2ba, 0.5);
      g.beginPath();
      g.moveTo(706, SURF);
      g.lineTo(706, SURF + 190);
      g.moveTo(734, SURF);
      g.lineTo(734, SURF + 190);
      for (let y = SURF + 46; y <= SURF + 190; y += 50) {
        g.moveTo(700, y);
        g.lineTo(740, y);
      }
      g.strokePath();
    }
    if (v.decor === "paprikee") {
      g.fillStyle(0x120810, 0.9);
      g.fillPoints(
        [
          { x: 488, y: H },
          { x: 516, y: 808 },
          { x: 564, y: 808 },
          { x: 592, y: H }
        ],
        true
      );
      g.fillPoints(
        [
          { x: 104, y: H },
          { x: 128, y: 936 },
          { x: 168, y: 936 },
          { x: 192, y: H }
        ],
        true
      );
      g.fillStyle(0xff6a3d, 0.35);
      g.fillEllipse(540, 800, 100, 36);
      g.fillEllipse(148, 930, 70, 26);
    }
    if (v.decor === "delphes") {
      g.fillStyle(0x2a7d80, 0.35);
      g.fillRect(72, 504, 60, H - 504);
      g.fillRect(56, 480, 92, 26);
      g.fillRect(320, 600, 52, H - 600);
      g.fillRect(306, 578, 80, 24);
      g.fillPoints(
        [
          { x: 40, y: H },
          { x: 148, y: H - 72 },
          { x: 224, y: H }
        ],
        true
      );
    }
    if (v.decor === "requins") {
      g.fillStyle(0x0b1830, 0.85);
      g.fillPoints(
        [
          { x: 452, y: H },
          { x: 580, y: 1080 },
          { x: 776, y: 1152 },
          { x: 780, y: H }
        ],
        true
      );
      g.fillRect(612, 904, 8, 260);
      g.fillRect(672, 984, 6, 184);
    }
    g.fillStyle(0xe4c05c, 1);
    g.fillCircle(604, SURF, 10);
    g.lineStyle(2.4, 0x8fa2ba, 0.55);
    g.beginPath();
    for (let y = SURF + 14; y < 380; y += 18) {
      g.moveTo(602, y);
      g.lineTo(601, y + 10);
    }
    g.strokePath();
    for (let i = 0; i < 9; i++) {
      g.fillStyle(0x02060f, 0.09 + i * 0.015);
      g.fillRect(0, H - 300 + i * 33, W, 34);
    }
  }

  private band(g: Phaser.GameObjects.Graphics, yTop: number, yBot: number) {
    const pts: Vec2[] = [];
    for (let x = 0; x <= W; x += 30) pts.push({ x, y: yTop + Math.sin((x / W) * Math.PI) * -22 });
    for (let x = W; x >= 0; x -= 30) pts.push({ x, y: yBot + Math.sin((x / W) * Math.PI) * -22 });
    g.fillPoints(pts, true);
  }

  private buildRacket() {
    this.racketFrame = this.add.image(0, 0, "racketTex").setOrigin(this.racketOrigin.x, this.racketOrigin.y);
    this.racket.add(this.racketFrame);
    this.cavity = this.add.container(-12, -16);
    this.cavGlow = this.add.image(0, 0, "glow").setScale(1.5).setTint(0xe8c766).setAlpha(0.5).setBlendMode(Phaser.BlendModes.ADD);
    const hole = this.add.graphics();
    hole.fillStyle(0x020a16, 1);
    hole.fillCircle(0, 0, ENGINE.CAV_BASE);
    hole.lineStyle(7, 0xe8c766, 1);
    hole.strokeCircle(0, 0, ENGINE.CAV_BASE);
    hole.lineStyle(2, 0xfff3c9, 0.75);
    hole.strokeCircle(0, 0, ENGINE.CAV_BASE - 4);
    this.cavity.add([this.cavGlow, hole]);
    this.racket.add(this.cavity);
    this.tweens.add({ targets: this.cavGlow, alpha: 0.25, duration: 1400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  private buildShark() {
    const s = this.add.graphics();
    s.fillStyle(0x152741, 0.92);
    s.fillPoints(
      [
        { x: 0, y: 16 },
        { x: 30, y: 4 },
        { x: 60, y: 0 },
        { x: 82, y: 4 },
        { x: 96, y: -4 },
        { x: 100, y: 8 },
        { x: 120, y: 10 },
        { x: 140, y: 16 },
        { x: 120, y: 24 },
        { x: 98, y: 27 },
        { x: 95, y: 38 },
        { x: 82, y: 29 },
        { x: 56, y: 33 },
        { x: 26, y: 29 }
      ],
      true
    );
    s.fillPoints(
      [
        { x: 62, y: 6 },
        { x: 74, y: -10 },
        { x: 82, y: 6 }
      ],
      true
    );
    s.fillStyle(0x050e1e, 1);
    s.fillCircle(6, 20, 2.4);
    s.fillCircle(134, 18, 2.4);
    this.shark.add(s);
  }

  private buildAnchois() {
    const a = this.add.graphics();
    a.fillStyle(0x9fb8c8, 0.8);
    const F = (x: number, y: number) =>
      a.fillPoints(
        [
          { x, y: y - 5 },
          { x: x + 18, y: y - 2 },
          { x: x + 26, y },
          { x: x + 18, y: y + 2 },
          { x, y: y + 5 },
          { x: x + 6, y }
        ],
        true
      );
    F(0, 0);
    F(34, -18);
    F(30, 22);
    F(66, 4);
    F(58, -30);
    F(94, -12);
    F(90, 26);
    F(120, 8);
    this.anchois.add(a);
  }

  private buildSwimmer() {
    const s = this.add.graphics();
    const navy = 0x16294a;
    s.fillStyle(navy, 1);
    s.fillPoints(
      [
        { x: -4, y: 0 },
        { x: -18, y: 2 },
        { x: -32, y: 8 },
        { x: -44, y: 8 },
        { x: -45, y: 13 },
        { x: -32, y: 13 },
        { x: -17, y: 12 },
        { x: -3, y: 6 }
      ],
      true
    );
    s.fillPoints(
      [
        { x: -4, y: 4 },
        { x: -16, y: 10 },
        { x: -30, y: 17 },
        { x: -42, y: 19 },
        { x: -41, y: 24 },
        { x: -28, y: 22 },
        { x: -14, y: 16 },
        { x: -2, y: 10 }
      ],
      true
    );
    s.fillStyle(0x54687f, 1);
    s.fillPoints(
      [
        { x: -45, y: 8 },
        { x: -53, y: 6 },
        { x: -52, y: 13 },
        { x: -45, y: 12 }
      ],
      true
    );
    s.fillPoints(
      [
        { x: -42, y: 19 },
        { x: -50, y: 19 },
        { x: -48, y: 26 },
        { x: -42, y: 23 }
      ],
      true
    );
    s.fillStyle(navy, 1);
    s.fillPoints(
      [
        { x: -6, y: -2 },
        { x: 4, y: -8 },
        { x: 16, y: -10 },
        { x: 26, y: -8 },
        { x: 30, y: -1 },
        { x: 20, y: 3 },
        { x: 8, y: 5 },
        { x: -4, y: 6 }
      ],
      true
    );
    s.fillPoints(
      [
        { x: 24, y: -8 },
        { x: 32, y: -14 },
        { x: 40, y: -18 },
        { x: 46, y: -19 },
        { x: 47, y: -13 },
        { x: 41, y: -12 },
        { x: 33, y: -7 },
        { x: 28, y: -3 }
      ],
      true
    );
    s.fillCircle(14, -16, 9);
    s.fillStyle(0xe9f1fb, 1);
    s.slice(14, -16, 9, Math.PI, Math.PI * 2, false);
    s.fillPath();
    s.fillStyle(0xc8563b, 1);
    s.fillCircle(13, -24, 1.8);
    s.fillStyle(0xcfe6ff, 1);
    s.fillCircle(20, -14.5, 1.4);
    s.lineStyle(1.2, 0x9fc8ee, 0.8);
    s.beginPath();
    s.moveTo(-44, 8);
    s.lineTo(-30, 6);
    s.lineTo(-16, 2);
    s.lineTo(-4, -2);
    s.lineTo(6, -8);
    s.lineTo(16, -10);
    s.lineTo(26, -8);
    s.strokePath();
    this.swimmer.add(s);
    this.swimmer.setScale(2);
  }
}
