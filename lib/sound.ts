/**
 * Son procédural — Web Audio pur, aucun fichier audio. Doit être initialisé
 * (resume()) sur un premier geste utilisateur, sinon le navigateur bloque
 * l'AudioContext.
 */

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

export function initAudio(): void {
  if (typeof window === "undefined") return;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
    noiseBuffer = buildNoiseBuffer(ctx);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

function buildNoiseBuffer(c: AudioContext): AudioBuffer {
  const buffer = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function now(): number {
  return ctx?.currentTime ?? 0;
}

function envGain(peak: number, attack: number, release: number, delay = 0): GainNode {
  const g = ctx!.createGain();
  const t = now() + delay;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(Math.max(peak * 0.001, 0.0001), t + attack + release);
  return g;
}

function tone(freq: number, endFreq: number, type: OscillatorType, peak: number, attack: number, release: number, delay = 0): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  const t = now() + delay;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), t + attack + release);
  const g = envGain(peak, attack, release, delay);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + attack + release + 0.05);
}

function noiseBurst(peak: number, attack: number, release: number, filterFreq: number, delay = 0): void {
  if (!ctx || !noiseBuffer) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterFreq;
  filter.Q.value = 0.9;
  const g = envGain(peak, attack, release, delay);
  src.connect(filter).connect(g).connect(ctx.destination);
  const t = now() + delay;
  src.start(t);
  src.stop(t + attack + release + 0.05);
}

/** Lancer : élastique du lance-pierre qui claque. */
export function playLaunch(): void {
  tone(220, 90, "sine", 0.22, 0.01, 0.11);
  noiseBurst(0.08, 0.002, 0.05, 1400);
}

/** Rebond sur le cadre de la raquette. */
export function playBounce(): void {
  noiseBurst(0.16, 0.002, 0.07, 900);
  tone(180, 120, "triangle", 0.1, 0.005, 0.06);
}

/** Déviation par un requin-marteau. */
export function playSharkHit(): void {
  tone(140, 260, "sawtooth", 0.14, 0.02, 0.14);
  noiseBurst(0.1, 0.005, 0.09, 500);
}

/** Tir homologué — coup d'Anchosiffle. Plus riche pour un tir signé. */
export function playHomologue(signe: boolean): void {
  tone(560, 980, "square", 0.16, 0.015, 0.12);
  noiseBurst(0.1, 0.002, 0.08, 2200);
  if (signe) {
    tone(700, 1200, "square", 0.16, 0.02, 0.16, 0.09);
    tone(880, 1500, "sine", 0.12, 0.02, 0.22, 0.16);
  }
}

/** La balle coule. */
export function playMiss(): void {
  tone(180, 55, "sine", 0.18, 0.02, 0.4);
  noiseBurst(0.06, 0.05, 0.3, 220);
}

/** Fin de séance. */
export function playEnd(): void {
  tone(440, 220, "sine", 0.14, 0.02, 0.5);
}
