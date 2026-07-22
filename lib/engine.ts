/**
 * CAVITÉ — moteur de simulation pur, sans dépendance à Phaser ni au DOM.
 * Importé à la fois par le rendu client (Phaser dessine à partir de cet état)
 * et par la route API de rejeu serveur (authorité du score). Une seule
 * implémentation, deux consommateurs : la reproductibilité vient de là,
 * pas d'un effort de "faire correspondre" deux implémentations séparées.
 *
 * Simplifications assumées par rapport au prototype Phaser-only :
 * - la raquette n'anime plus une transition d'entrée (elle est à sa position
 *   finale dès t=0 du tir) ; oscillation/dérive en sinusoïdes pures au lieu
 *   de tweens Phaser, pour être trivialement rejouables hors navigateur.
 * - la position du requin-marteau à chaque passage est dérivée d'un hash
 *   déterministe (seed, n, lapIndex) plutôt que de piocher dans le flux rng
 *   partagé — sinon le nombre d'appels rng() consommés dépendrait du temps
 *   réel passé à viser, ce qui casserait le rejeu.
 * - le banc d'anchois est purement visuel (aucune collision dans le jeu
 *   original) : il n'a pas sa place dans ce moteur, seulement côté rendu.
 */

export const ENGINE = {
  W: 780,
  H: 1240,
  SURF: 150,
  G: 300,
  DRAG: 0.32,
  LAUNCH_K: 3.6,
  SPEED_MAX: 1500,
  BALL_R: 22,
  CAV_BASE: 38,
  MIN_DRAG: 24,
  // Rayons de l'ellipse du cadre de la raquette (anneau + cordage dessinés
  // dans CaviteScene.buildRacket : stroke ellipse(RX, RY, 82, 96, lineWidth
  // 11), centrée exactement sur le pivot de pose) — utilisés pour le test de
  // rebond sur le cadre, avec une petite marge pour la moitié de l'épaisseur
  // du trait.
  FRAME_RX: 88,
  FRAME_RY: 102
} as const;

export type Vec2 = { x: number; y: number };

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash déterministe (seed, clés...) -> [0,1), sans état partagé. */
export function hashToUnit(seed: number, ...keys: number[]): number {
  let h = seed >>> 0;
  for (const k of keys) {
    h = Math.imul(h ^ (k | 0), 2654435761) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
  }
  return h / 4294967296;
}

/** Seed dérivée d'une date calendaire (défi homologué du jour). */
export function dailySeed(dateISO: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < dateISO.length; i++) {
    h ^= dateISO.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface ShotDiff {
  n: number;
  bassin: number;
  cycle: number;
  signe: boolean;
  cavScale: number;
  driftAmp: number;
  driftPeriod: number; // secondes, cycle complet
  oscAmp: number;
  oscPeriod: number; // secondes, cycle complet
  curBase: number;
  curDir: 1 | -1;
  curPhase: number;
  turb: boolean;
  shark: boolean;
  anchois: boolean;
  rx: number;
  ry: number;
  rAngle: number;
  cavOx: number;
  cavOy: number;
  bx: number;
  by: number;
  stars: number;
  potBase: number;
}

/**
 * Consomme le flux rng dans un ordre fixe. L'ORDRE DES APPELS compte : ne
 * pas réordonner sans regénérer toute compatibilité de rejeu (aucune donnée
 * historique à préserver pour l'instant, mais la cohérence future si).
 */
export function computeShotDiff(n: number, rng: () => number): ShotDiff {
  const tranche = Math.floor((n - 1) / 5);
  const bassin = tranche % 4;
  const cycle = Math.floor(tranche / 4);
  const k = n - 1 + cycle * 6;

  const curDir: 1 | -1 = n >= 7 ? (rng() < 0.5 ? 1 : -1) : 1;
  const curPhase = rng() * Math.PI * 2;
  const rx = 540 + Math.floor(rng() * 120);
  const ry = 380 + Math.floor(rng() * 280);
  const rAngle = -8 + Math.floor(rng() * 29) - 14;
  const cavOx = -32 + Math.floor(rng() * 64);
  const cavOy = -36 + Math.floor(rng() * 44);
  const bx = 220 + Math.floor(rng() * 90);
  const by = 700 + Math.floor(rng() * 200);

  const oscDur = (2400 - Math.min(1400, n * 70)) / 1000;
  const driftDur = Math.max(900, 2800 - 140 * k) / 1000;

  return {
    n,
    bassin,
    cycle,
    signe: n % 5 === 0,
    cavScale: Math.max(0.45, 1 - 0.04 * k),
    driftAmp: n < 3 ? 0 : Math.min(190, 34 * (k - 1)),
    driftPeriod: 2 * driftDur,
    oscAmp: 16 + Math.min(110, 12 * k),
    oscPeriod: 2 * oscDur,
    curBase: n < 2 ? 0 : Math.min(200, 50 + 18 * (k - 1)),
    curDir,
    curPhase,
    turb: n >= 9,
    shark: n >= 8,
    anchois: n >= 5,
    rx,
    ry,
    rAngle,
    cavOx,
    cavOy,
    bx,
    by,
    stars: Math.min(5, 1 + Math.floor(k / 3)),
    potBase: 400 + 40 * n
  };
}

export interface RacketPose {
  x: number;
  y: number;
  angleDeg: number;
}

/** Pose de la raquette au temps t (secondes depuis le début du tir). */
export function racketPose(d: ShotDiff, t: number): RacketPose {
  const bobPhase = (t * 2 * Math.PI) / d.oscPeriod;
  const y = d.ry + d.oscAmp * Math.sin(bobPhase);
  const angleDeg = d.rAngle + 3 * Math.sin(bobPhase);
  let x = d.rx;
  if (d.driftAmp > 0) {
    const driftPhase = (t * 2 * Math.PI) / d.driftPeriod;
    x = d.rx - d.driftAmp * 0.5 * (1 - Math.cos(driftPhase));
  }
  return { x, y, angleDeg };
}

export interface CavityWorld {
  x: number;
  y: number;
  r: number;
}

/** Centre mondial de la cavité, en tenant compte de la rotation de la raquette. */
export function cavityWorld(d: ShotDiff, pose: RacketPose): CavityWorld {
  const rad = (pose.angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: pose.x + d.cavOx * cos - d.cavOy * sin,
    y: pose.y + d.cavOx * sin + d.cavOy * cos,
    r: ENGINE.CAV_BASE * d.cavScale
  };
}

/** Position du requin-marteau au temps t, ou null s'il est hors-écran / inactif. */
export function sharkPose(d: ShotDiff, seed: number, t: number): Vec2 | null {
  if (!d.shark) return null;
  const travel = (2600 - Math.min(1200, d.n * 40)) / 1000;
  const lapPeriod = travel + 0.7;
  if (lapPeriod <= 0) return null;
  const lapIndex = Math.floor(t / lapPeriod);
  const lapT = t - lapIndex * lapPeriod;
  if (lapT > travel) return null;
  const x = -200 + (ENGINE.W + 400) * (lapT / travel);
  const y = 300 + hashToUnit(seed, d.n, lapIndex) * 380;
  return { x, y };
}

export function potFactor(readySeconds: number): number {
  return Math.min(1, Math.max(0.4, 1 - Math.max(0, readySeconds - 4) * 0.15));
}

export function currentNow(d: ShotDiff, flyT: number): number {
  if (!d.curBase) return 0;
  const turb = d.turb ? 0.5 + Math.sin(flyT * 2.6 + d.curPhase) : 1;
  return d.curBase * d.curDir * turb;
}

export function physStep(p: Vec2, v: Vec2, dt: number, current: number): void {
  v.x += current * dt;
  v.y += ENGINE.G * dt;
  const f = Math.exp(-ENGINE.DRAG * dt);
  v.x *= f;
  v.y *= f;
  p.x += v.x * dt;
  p.y += v.y * dt;
}

export interface ShotInput {
  /** Vecteur de tir (recul du lance-pierre), unités = mêmes que le design 780×1240. */
  dx: number;
  dy: number;
  /** Secondes passées à viser avant le lâcher (pour le potentiel qui fond). */
  readySeconds: number;
}

export interface ShotOutcome {
  hit: boolean;
  basePoints: number;
  centered: boolean;
  signe: boolean;
  sharkHit: boolean;
  bounced: boolean;
  minDist: number;
  flightSeconds: number;
}

// Exporte : le client (CaviteScene) doit intégrer le vol de balle sur exactement
// le même pas que ce rejeu serveur, sous peine de résoudre différemment un tir
// limite (voir CaviteScene.safeUpdate).
export const FLIGHT_STEP = 1 / 60;
const FLIGHT_MAX_SECONDS = 4;

export function simulateShot(d: ShotDiff, seed: number, input: ShotInput): ShotOutcome {
  const potF = potFactor(Math.max(0, input.readySeconds));
  const len = Math.hypot(input.dx, input.dy);
  if (len < ENGINE.MIN_DRAG) {
    return { hit: false, basePoints: 0, centered: false, signe: d.signe, sharkHit: false, bounced: false, minDist: Infinity, flightSeconds: 0 };
  }
  const sp = Math.min(len * ENGINE.LAUNCH_K, ENGINE.SPEED_MAX);
  const p: Vec2 = { x: d.bx, y: d.by };
  const v: Vec2 = { x: (input.dx / len) * sp, y: (input.dy / len) * sp };

  let sharkHit = false;
  let bounced = false;
  let minDist = Infinity;
  let flyT = 0;
  const t0 = Math.max(0, input.readySeconds);

  for (let step = 0; step < FLIGHT_MAX_SECONDS / FLIGHT_STEP; step++) {
    const prev: Vec2 = { x: p.x, y: p.y };
    physStep(p, v, FLIGHT_STEP, currentNow(d, flyT));
    flyT += FLIGHT_STEP;
    const t = t0 + flyT;

    if (d.shark && !sharkHit) {
      const shark = sharkPose(d, seed, t);
      if (shark) {
        const sx = (p.x - shark.x - 70) / 80;
        const sy = (p.y - shark.y - 16) / 30;
        if (sx * sx + sy * sy < 1) {
          sharkHit = true;
          v.y = Math.abs(v.y) * 0.3 + 170;
          v.x *= 0.3;
        }
      }
    }

    const pose = racketPose(d, t);
    const cav = cavityWorld(d, pose);

    // Distance point-segment (collision continue) plutôt que "croisement de x
    // du pas puis interpolation linéaire de y au point de croisement" : sur un
    // tir rapide, le segment parcouru en un seul pas peut être plus large que
    // la cavité elle-même, et son point de croisement exact avec x=cav.x n'est
    // pas forcément le point du segment le plus proche du centre — un tir qui
    // "survole" la cavité pouvait alors ne jamais être détecté comme touché
    // (tunnelling). Vérifié contre des tirs réels : élimine l'essentiel des
    // tunnellings à haute vitesse (vs le test par croisement précédent).
    const segDx = p.x - prev.x;
    const segDy = p.y - prev.y;
    const segLenSq = segDx * segDx + segDy * segDy;
    const segT =
      segLenSq > 1e-9 ? Math.max(0, Math.min(1, ((cav.x - prev.x) * segDx + (cav.y - prev.y) * segDy) / segLenSq)) : 0;
    const closestX = prev.x + segT * segDx;
    const closestY = prev.y + segT * segDy;
    const dist = Math.hypot(closestX - cav.x, closestY - cav.y);
    minDist = Math.min(minDist, dist);
    if (dist < cav.r - 2) {
      const centered = dist < cav.r * 0.35;
      const base = d.potBase + Math.round(300 * (1 - dist / cav.r));
      const basePoints = Math.round(base * potF * (centered ? 1.2 : 1)) * (d.signe ? 3 : 1);
      return { hit: true, basePoints, centered, signe: d.signe, sharkHit, bounced, minDist, flightSeconds: flyT };
    }

    // Rebond sur le cadre de la raquette : zone large, beaucoup moins
    // sensible au tunnelling que la petite cavité — reste sur le test de
    // croisement pour trouver le point, mais teste ensuite ce point contre
    // la VRAIE silhouette elliptique du cadre (dans le repère tourné de la
    // raquette), pas une bande verticale plate non tournée. L'ancienne bande
    // ±100px ignorait la rotation de la raquette (jusqu'à ~25°) : sur un tir
    // avec une raquette inclinée, elle pouvait déclencher un rebond dans une
    // zone qui, une fois la rotation prise en compte, tombe visiblement en
    // dehors de l'anneau dessiné (repoussé "sans raison").
    const crossedFrame = (prev.x - cav.x) * (p.x - cav.x) <= 0 && prev.x !== p.x;
    if (crossedFrame && !bounced) {
      const k = (cav.x - prev.x) / (p.x - prev.x);
      const yc = prev.y + k * (p.y - prev.y);
      const rad = (pose.angleDeg * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      const relX = cav.x - pose.x;
      const relY = yc - pose.y;
      const localX = relX * cosA + relY * sinA;
      const localY = -relX * sinA + relY * cosA;
      const onFrame = (localX / ENGINE.FRAME_RX) ** 2 + (localY / ENGINE.FRAME_RY) ** 2 <= 1;
      if (onFrame) {
        bounced = true;
        p.x = cav.x - Math.sign(v.x) * 24;
        p.y = yc;
        v.x = -v.x * 0.4;
        v.y *= 0.55;
      }
    }
    if (p.y > ENGINE.H - 60 || p.x > ENGINE.W + 80 || p.x < -80) break;
  }
  return { hit: false, basePoints: 0, centered: false, signe: d.signe, sharkHit, bounced, minDist, flightSeconds: flyT };
}

export interface RunShotResult extends ShotOutcome {
  n: number;
  serieAfter: number;
  points: number;
}

export interface RunResult {
  score: number;
  hits: number;
  tirAtteint: number;
  bestSerie: number;
  shots: RunShotResult[];
}

/**
 * Paliers fixes du Gauntlet homologué (défi du jour) : un aperçu curé de
 * chaque grande étape de la courbe de difficulté normale (bassin d'accueil,
 * Fosse Paprikée, requins, anchois/Delphes, Couloir des Requins final) — pas
 * de progression procédurale infinie, toujours 5 tirs. Piloté par le même
 * computeShotDiff() que la séance libre ; la reproductibilité vient de la
 * cohérence de l'ORDRE des appels (ce tableau) entre client et serveur, pas
 * d'un nombre fixe d'appels rng() par palier (variable selon n).
 */
export const GAUNTLET_SHOT_NUMBERS = [1, 6, 8, 12, 16] as const;

const MAX_SHOTS_PER_RUN = 500;

/** Rejoue une séance entière depuis une seed + un journal de tirs. Autorité du score. */
export function simulateRun(seed: number, shots: ShotInput[]): RunResult {
  const rng = mulberry32(seed);
  let score = 0;
  let hits = 0;
  let serie = 0;
  let bestSerie = 0;
  const results: RunShotResult[] = [];

  const capped = shots.slice(0, MAX_SHOTS_PER_RUN);
  for (let i = 0; i < capped.length; i++) {
    const n = i + 1;
    const d = computeShotDiff(n, rng);
    const outcome = simulateShot(d, seed, capped[i]!);
    let points = 0;
    if (outcome.hit) {
      serie += 1;
      hits += 1;
      bestSerie = Math.max(bestSerie, serie);
      points = outcome.basePoints * serie;
      score += points;
    } else {
      serie = 0;
    }
    results.push({ ...outcome, n, serieAfter: serie, points });
  }

  return { score, hits, tirAtteint: capped.length, bestSerie, shots: results };
}

/**
 * Rejoue un Gauntlet homologué (défi du jour) : mêmes règles de score que
 * simulateRun, mais la séquence de paliers est fixe (GAUNTLET_SHOT_NUMBERS)
 * au lieu de n=i+1 — pas de "vies", toujours 5 tirs quoi qu'il arrive (un
 * raté rapporte 0 point et casse la série, mais ne termine pas le parcours).
 */
export function simulateGauntletRun(seed: number, shots: ShotInput[]): RunResult {
  const rng = mulberry32(seed);
  let score = 0;
  let hits = 0;
  let serie = 0;
  let bestSerie = 0;
  const results: RunShotResult[] = [];

  const capped = shots.slice(0, GAUNTLET_SHOT_NUMBERS.length);
  for (let i = 0; i < capped.length; i++) {
    const n = GAUNTLET_SHOT_NUMBERS[i]!;
    const d = computeShotDiff(n, rng);
    const outcome = simulateShot(d, seed, capped[i]!);
    let points = 0;
    if (outcome.hit) {
      serie += 1;
      hits += 1;
      bestSerie = Math.max(bestSerie, serie);
      points = outcome.basePoints * serie;
      score += points;
    } else {
      serie = 0;
    }
    results.push({ ...outcome, n, serieAfter: serie, points });
  }

  return { score, hits, tirAtteint: capped.length, bestSerie, shots: results };
}
