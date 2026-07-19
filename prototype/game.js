/* CAVITÉ — Prototype P2 · run infini, difficulté progressive, 4 bassins, tirs signés
   Design interne 780×1240 (unités = 2× la maquette), Scale.FIT portrait. */

const W = 780, H = 1240;
const SURF = 150;
const G = 300;
const DRAG = 0.32;
const LAUNCH_K = 3.6;
const SPEED_MAX = 1500;

const VENUES = [
  { nom: 'Piscine Municipale des Siffleurs', sky: 0x0c2140, top: 0x1c4e7c, bot: 0x081c36, decor: 'siffleurs' },
  { nom: 'Fosse Paprikée Internationale',    sky: 0x241423, top: 0x57303a, bot: 0x170b15, decor: 'paprikee' },
  { nom: 'Delphes-sur-Mer',                  sky: 0x0a2a35, top: 0x0f5e69, bot: 0x052430, decor: 'delphes' },
  { nom: 'Couloir des Requins-Marteaux',     sky: 0x0a1526, top: 0x16304e, bot: 0x030a16, decor: 'requins' },
];
const ROMAIN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// annonces : la nouveauté du tir (une seule à la fois)
const MILESTONES = {
  1: 'PREMIER TIR — RAQUETTE FIXE',
  2: 'COURANT ACTIF — L’APERÇU NE LE COMPENSE PAS',
  3: 'LA RAQUETTE DÉRIVE',
  4: 'LA CAVITÉ SE RESSERRE',
  6: 'PALIER II — LA FOSSE PAPRIKÉE',
  7: 'LE COURANT PEUT CHANGER DE SENS',
  8: 'REQUINS-MARTEAUX EN TRANSIT',
  9: 'COURANT TURBULENT PENDANT LE VOL',
  11: 'PALIER III — DELPHES-SUR-MER',
  12: 'UN BANC D’ANCHOIS MASQUE LA VUE',
  16: 'PALIER IV — LE COULOIR DES REQUINS',
};

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const $ = id => document.getElementById(id);

class Main extends Phaser.Scene {
  create() {
    this.makeTextures();
    this.arenaGfx = this.add.graphics();
    this.arenaGlow = null;

    // ─── raquette-cible ───
    this.cavBase = 38;
    this.racket = this.add.container(600, 520);
    this.buildRacket();

    // ─── obstacles vivants ───
    this.shark = this.add.container(-300, 400);
    this.buildShark();
    this.anchois = this.add.container(-500, 500);
    this.buildAnchois();

    // ─── tireur ───
    this.swimmer = this.add.container(170, 848);
    this.buildSwimmer();
    this.tweens.add({ targets: this.swimmer, y: '+=10', duration: 3000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // ─── balle ───
    this.ballHome = { x: 268, y: 810 };
    this.ball = this.add.container(this.ballHome.x, this.ballHome.y);
    const bg = this.add.graphics();
    bg.fillStyle(0xefe6cf, 1); bg.fillCircle(0, 0, 22);
    bg.lineStyle(3, 0xc9b98b, 1);
    bg.beginPath(); bg.arc(0, -7, 20, Math.PI * 0.15, Math.PI * 0.85, false); bg.strokePath();
    bg.beginPath(); bg.arc(0, 7, 20, Math.PI * 1.15, Math.PI * 1.85, false); bg.strokePath();
    bg.lineStyle(3, 0xfffbe9, .8);
    bg.beginPath(); bg.arc(-2, -2, 15, Math.PI * 1.05, Math.PI * 1.45, false); bg.strokePath();
    this.ball.add(bg);
    this.ballGlow = this.add.image(this.ball.x, this.ball.y, 'glow').setScale(.9).setTint(0xbfe0ff).setAlpha(.18).setBlendMode(Phaser.BlendModes.ADD);

    this.trail = this.add.particles(0, 0, 'bubble', {
      speed: { min: 8, max: 30 }, angle: { min: 250, max: 290 },
      scale: { start: .5, end: .1 }, alpha: { start: .5, end: 0 },
      lifespan: 900, frequency: -1,
    });
    this.burst = this.add.particles(0, 0, 'gold', {
      speed: { min: 60, max: 320 }, scale: { start: .9, end: 0 },
      alpha: { start: 1, end: 0 }, lifespan: 700, frequency: -1,
      blendMode: Phaser.BlendModes.ADD,
    });
    this.add.particles(0, 0, 'dot', {
      x: { min: 0, max: W }, y: { min: SURF + 40, max: H - 80 },
      speedY: { min: -14, max: -5 }, speedX: { min: -6, max: 10 },
      scale: { min: .2, max: .5 }, alpha: { start: .16, end: 0 },
      lifespan: 9000, frequency: 320,
    });

    this.waveGfx = this.add.graphics();
    this.flowGfx = this.add.graphics();
    this.ghostGfx = this.add.graphics();
    this.aimGfx = this.add.graphics();
    this.spinGfx = this.add.graphics();
    this.spinA = 0;
    // filets de courant : traits qui dérivent à la vitesse du courant réel
    this.flowSeeds = Array.from({ length: 14 }, (_, i) => ({
      y: 220 + (i * 67) % 880, off: (i * 173) % 780, len: 26 + (i * 31) % 40,
    }));
    this.flowX = 0;

    // ─── input ───
    this.input.on('pointerdown', p => {
      if (this.stateName !== 'ready') return;
      this.stateName = 'aiming';
      this.aimStart = { x: p.x, y: p.y };
      this.aimCur = { x: p.x, y: p.y };
    });
    this.input.on('pointermove', p => {
      if (this.stateName === 'aiming') this.aimCur = { x: p.x, y: p.y };
    });
    this.input.on('pointerup', () => {
      if (this.stateName !== 'aiming') return;
      const dx = this.aimStart.x - this.aimCur.x, dy = this.aimStart.y - this.aimCur.y;
      const pow = Math.hypot(dx, dy);
      this.aimGfx.clear();
      if (pow < 24) { this.stateName = 'ready'; return; }
      this.launch(dx, dy);
    });
    $('replay').addEventListener('click', () => this.restart());

    window.__scene = this;
    window.__C = { G, DRAG, LAUNCH_K, SPEED_MAX };

    this.restart();
  }

  // ───────────────────────── difficulté ─────────────────────────
  diff(n) {
    const tranche = Math.floor((n - 1) / 5);
    const bassin = tranche % 4;
    const cycle = Math.floor(tranche / 4);
    const k = (n - 1) + cycle * 6;
    const r = this.rng;
    return {
      n, bassin, cycle,
      signe: n % 5 === 0,
      cavScale: Math.max(.45, 1 - .04 * k),
      driftAmp: n < 3 ? 0 : Math.min(190, 34 * (k - 1)),
      driftDur: Math.max(900, 2800 - 140 * k),
      oscAmp: 16 + Math.min(110, 12 * k),
      curBase: n < 2 ? 0 : Math.min(200, 50 + 18 * (k - 1)),
      curDir: n >= 7 ? (r() < .5 ? 1 : -1) : 1,
      curPhase: r() * Math.PI * 2,
      turb: n >= 9,
      shark: n >= 8,
      anchois: n >= 12,
      rx: 540 + Math.floor(r() * 120),
      ry: 380 + Math.floor(r() * 280),
      rAngle: -8 + Math.floor(r() * 29) - 14,
      cavOx: -32 + Math.floor(r() * 64),
      cavOy: -36 + Math.floor(r() * 44),
      bx: 220 + Math.floor(r() * 90),
      by: 700 + Math.floor(r() * 200),
      stars: Math.min(5, 1 + Math.floor(k / 3)),
      potBase: 400 + 40 * n,
    };
  }

  pill(d) {
    if (d.signe) return `TIR SIGNÉ — HOMOLOGATION ×3`;
    if (MILESTONES[d.n]) return MILESTONES[d.n];
    if (d.n > 16 && (d.n - 1) % 5 === 0) return `PALIER ${ROMAIN[Math.floor((d.n - 1) / 5)] || d.n} — CYCLE ${ROMAIN[d.cycle] || d.cycle + 1}`;
    return d.cavScale < .8 ? 'LA CAVITÉ SE RESSERRE' : 'DÉRIVE ET COURANT ACCRUS';
  }

  setupShot() {
    const d = this.diff(this.tir);
    this.mod = d;
    // bassin
    if (d.bassin !== this.bassin) {
      this.bassin = d.bassin;
      this.drawArena(VENUES[d.bassin]);
      $('venueP').textContent = `PALIER ${ROMAIN[Math.floor((d.n - 1) / 5)] || '?'}`;
      $('venueN').textContent = VENUES[d.bassin].nom + (d.cycle ? ` · CYCLE ${ROMAIN[d.cycle]}` : '');
    }
    // position de tir : le tireur change de poste à chaque balle
    this.ballHome = { x: d.bx, y: d.by };
    this.tweens.add({ targets: this.swimmer, x: d.bx - 98, y: d.by + 38, duration: 450, ease: 'Sine.easeInOut' });
    // raquette : position, angle, cavité, mouvements
    this.tweens.killTweensOf(this.racket);
    this.racket.angle = d.rAngle;
    this.tweens.add({ targets: this.racket, x: d.rx, y: d.ry, duration: 550, ease: 'Sine.easeInOut' });
    this.bobT = this.tweens.add({ targets: this.racket, y: d.ry + d.oscAmp, angle: d.rAngle + 3,
      duration: 2400 - Math.min(1400, d.n * 70), yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 560 });
    if (d.driftAmp > 0) {
      this.driftT = this.tweens.add({ targets: this.racket, x: d.rx - d.driftAmp,
        duration: d.driftDur, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 560 });
    } else this.driftT = null;
    this.cavity.setPosition(d.cavOx, d.cavOy);
    this.cavity.setScale(d.cavScale);
    this.cavGlow.setAlpha(d.signe ? .9 : .5);
    // courant
    const lvl = d.curBase === 0 ? 0 : d.curBase < 80 ? 1 : d.curBase < 140 ? 2 : 3;
    $('courant').style.opacity = lvl ? 1 : 0;
    $('courantVal').textContent = lvl + '/3';
    $('courant').style.transform = d.curDir < 0 ? 'scaleX(-1)' : '';
    // obstacles
    this.tweens.killTweensOf(this.shark);
    if (d.shark) {
      this.shark.setPosition(-200, 300 + this.rng() * 380);
      this.sharkT = this.tweens.add({ targets: this.shark, x: W + 200,
        duration: 2600 - Math.min(1200, d.n * 40), repeat: -1, repeatDelay: 700,
        onRepeat: () => { this.shark.y = 300 + this.rng() * 380; } });
    } else this.shark.setPosition(-300, 400);
    this.tweens.killTweensOf(this.anchois);
    if (d.anchois) {
      this.anchois.setPosition(430, 380 + this.rng() * 260);
      this.tweens.add({ targets: this.anchois, x: 320, duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    } else this.anchois.setPosition(-500, 500);
    // HUD + pression temporelle (le potentiel fond après 4 s)
    this.basePill = this.pill(d);
    this.impatient = false;
    this.readyT = 0;
    $('modif').textContent = this.basePill;
    $('ballNo').textContent = this.tir;
    $('stars').textContent = '★'.repeat(d.stars) + '☆'.repeat(5 - d.stars);
    $('pot').textContent = (d.potBase * (d.signe ? 3 : 1)).toLocaleString('fr-FR');
    this.refreshHud();
  }

  potFactor() {
    return Phaser.Math.Clamp(1 - Math.max(0, this.readyT - 4) * .15, .4, 1);
  }

  // ───────────────────────── textures ─────────────────────────
  makeTextures() {
    let g = this.make.graphics({ add: false });
    g.fillStyle(0xffffff, 1); g.fillCircle(4, 4, 4);
    g.generateTexture('dot', 8, 8); g.destroy();
    g = this.make.graphics({ add: false });
    g.fillStyle(0xe8c766, 1); g.fillCircle(5, 5, 5);
    g.generateTexture('gold', 10, 10); g.destroy();
    g = this.make.graphics({ add: false });
    g.lineStyle(2, 0xdbe9f8, 1); g.strokeCircle(6, 6, 5);
    g.generateTexture('bubble', 12, 12); g.destroy();
    const c = this.textures.createCanvas('glow', 128, 128);
    const ctx = c.getContext();
    const rg = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(.4, 'rgba(255,255,255,.35)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, 128, 128);
    c.refresh();
  }

  // ───────────────────────── décor ─────────────────────────
  drawArena(v) {
    const g = this.arenaGfx;
    g.clear();
    g.fillStyle(v.sky, 1); g.fillRect(0, 0, W, SURF);
    g.fillStyle(0x060f20, 1); this.band(g, 40, 96);
    g.fillStyle(0x081426, 1); this.band(g, 92, 132);
    const rnd = new Phaser.Math.RandomDataGenerator(['fist' + v.decor]);
    const cols = [0xe4c05c, 0xe9f1fb, 0x4fa3d8, 0xc8563b];
    for (let i = 0; i < 42; i++) {
      g.fillStyle(rnd.pick(cols), rnd.realInRange(.25, .6));
      g.fillCircle(rnd.between(10, W - 10), rnd.between(48, 124), rnd.realInRange(1.6, 3.2));
    }
    for (const mx of [120, 660]) {
      g.fillStyle(0x040b18, 1);
      g.fillRect(mx - 3, 24, 6, SURF - 24);
      g.fillRoundedRect(mx - 24, 14, 48, 14, 6);
      g.fillStyle(0xffe9ad, 1);
      for (const dx of [-13, 0, 13]) g.fillCircle(mx + dx, 21, 4);
    }
    g.fillGradientStyle(v.top, v.top, v.bot, v.bot, 1);
    g.fillRect(0, SURF, W, H - SURF);

    // décors spécifiques
    if (v.decor === 'siffleurs') {
      g.lineStyle(1, 0xe9f1fb, .05);
      for (let y = SURF + 110; y < H - 120; y += 112) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.strokePath(); }
      for (let x = 96; x < W; x += 196) { g.beginPath(); g.moveTo(x, SURF); g.lineTo(x, H - 140); g.strokePath(); }
      for (let i = 0; i < 12; i++) { g.fillStyle(i % 2 ? 0xc8563b : 0xe9f1fb, .8); g.fillCircle(30 + i * 44, SURF, 4.5); }
      g.lineStyle(5, 0x8fa2ba, .5);
      g.beginPath(); g.moveTo(706, SURF); g.lineTo(706, SURF + 190); g.moveTo(734, SURF); g.lineTo(734, SURF + 190);
      for (let y = SURF + 46; y <= SURF + 190; y += 50) { g.moveTo(700, y); g.lineTo(740, y); }
      g.strokePath();
    }
    if (v.decor === 'paprikee') {
      g.fillStyle(0x120810, .9);
      g.fillPoints([{x:488,y:H},{x:516,y:808},{x:564,y:808},{x:592,y:H}], true);
      g.fillPoints([{x:104,y:H},{x:128,y:936},{x:168,y:936},{x:192,y:H}], true);
      g.fillStyle(0xff6a3d, .35); g.fillEllipse(540, 800, 100, 36); g.fillEllipse(148, 930, 70, 26);
    }
    if (v.decor === 'delphes') {
      g.fillStyle(0x2a7d80, .35);
      g.fillRect(72, 504, 60, H - 504); g.fillRect(56, 480, 92, 26);
      g.fillRect(320, 600, 52, H - 600); g.fillRect(306, 578, 80, 24);
      g.fillPoints([{x:40,y:H},{x:148,y:H-72},{x:224,y:H}], true);
    }
    if (v.decor === 'requins') {
      g.fillStyle(0x0b1830, .85);
      g.fillPoints([{x:452,y:H},{x:580,y:1080},{x:776,y:1152},{x:780,y:H}], true);
      g.fillRect(612, 904, 8, 260);
      g.fillRect(672, 984, 6, 184);
    }
    // bouée + filin
    g.fillStyle(0xe4c05c, 1); g.fillCircle(604, SURF, 10);
    g.lineStyle(2.4, 0x8fa2ba, .55);
    g.beginPath();
    for (let y = SURF + 14; y < 380; y += 18) { g.moveTo(602, y); g.lineTo(601, y + 10); }
    g.strokePath();
    // brume de profondeur
    for (let i = 0; i < 9; i++) {
      g.fillStyle(0x02060f, .09 + i * .015);
      g.fillRect(0, H - 300 + i * 33, W, 34);
    }
  }
  band(g, yTop, yBot) {
    const pts = [];
    for (let x = 0; x <= W; x += 30) pts.push({ x, y: yTop + Math.sin((x / W) * Math.PI) * -22 });
    for (let x = W; x >= 0; x -= 30) pts.push({ x, y: yBot + Math.sin((x / W) * Math.PI) * -22 });
    g.fillPoints(pts, true);
  }

  // ───────────────────────── acteurs ─────────────────────────
  buildRacket() {
    const r = this.add.graphics();
    r.fillStyle(0x8f6238, 1); r.fillRoundedRect(-11, 86, 22, 104, 10);
    r.fillStyle(0xb98b5e, 1); r.fillRoundedRect(-11, 86, 22, 52, 10);
    r.lineStyle(2, 0x5f3f26, .7);
    for (let y = 104; y <= 176; y += 18) { r.beginPath(); r.moveTo(-11, y); r.lineTo(11, y + 4); r.strokePath(); }
    r.fillStyle(0x040c1a, .3); r.fillEllipse(0, 0, 164, 192);
    r.lineStyle(9, 0xcbd6e4, 1); r.strokeEllipse(0, 0, 164, 192);
    r.lineStyle(2, 0x7e93ac, .7); r.strokeEllipse(0, 0, 144, 172);
    r.lineStyle(1.2, 0xa9bcd2, .5);
    for (let x = -64; x <= 64; x += 16) {
      const half = Math.sqrt(Math.max(0, 1 - (x / 70) ** 2)) * 84;
      r.beginPath(); r.moveTo(x, -half); r.lineTo(x, half); r.strokePath();
    }
    for (let y = -72; y <= 72; y += 16) {
      const half = Math.sqrt(Math.max(0, 1 - (y / 86) ** 2)) * 70;
      r.beginPath(); r.moveTo(-half, y); r.lineTo(half, y); r.strokePath();
    }
    r.lineStyle(3, 0xeef5ff, .6);
    r.beginPath(); r.arc(0, 0, 88, Math.PI * 1.05, Math.PI * 1.5, false); r.strokePath();
    this.racket.add(r);
    this.racket.rotation = -0.14;
    this.cavity = this.add.container(-12, -16);
    this.cavGlow = this.add.image(0, 0, 'glow').setScale(1.5).setTint(0xe8c766).setAlpha(.5).setBlendMode(Phaser.BlendModes.ADD);
    const hole = this.add.graphics();
    hole.fillStyle(0x020a16, 1); hole.fillCircle(0, 0, this.cavBase);
    hole.lineStyle(7, 0xe8c766, 1); hole.strokeCircle(0, 0, this.cavBase);
    this.cavity.add([this.cavGlow, hole]);
    this.racket.add(this.cavity);
    this.tweens.add({ targets: this.cavGlow, alpha: .25, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const seal = this.add.graphics();
    seal.fillStyle(0xe4c05c, 1); seal.fillCircle(20, 94, 8);
    seal.lineStyle(2, 0xa8862f, 1); seal.strokeCircle(20, 94, 8);
    this.racket.add(seal);
  }

  buildShark() {
    const s = this.add.graphics();
    s.fillStyle(0x152741, .92);
    s.fillPoints([{x:0,y:16},{x:30,y:4},{x:60,y:0},{x:82,y:4},{x:96,y:-4},{x:100,y:8},
      {x:120,y:10},{x:140,y:16},{x:120,y:24},{x:98,y:27},{x:95,y:38},{x:82,y:29},
      {x:56,y:33},{x:26,y:29}], true);
    s.fillPoints([{x:62,y:6},{x:74,y:-10},{x:82,y:6}], true);
    s.fillStyle(0x050e1e, 1); s.fillCircle(6, 20, 2.4); s.fillCircle(134, 18, 2.4);
    this.shark.add(s);
  }

  buildAnchois() {
    const a = this.add.graphics();
    a.fillStyle(0x9fb8c8, .8);
    const F = (x, y) => a.fillPoints([{x,y:y-5},{x:x+18,y:y-2},{x:x+26,y},{x:x+18,y:y+2},{x,y:y+5},{x:x+6,y}], true);
    F(0, 0); F(34, -18); F(30, 22); F(66, 4); F(58, -30); F(94, -12); F(90, 26); F(120, 8);
    this.anchois.add(a);
    this.tweens.add({ targets: this.anchois, y: '+=16', duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  buildSwimmer() {
    const s = this.add.graphics();
    const navy = 0x16294a;
    s.fillStyle(navy, 1);
    s.fillPoints([{x:-4,y:0},{x:-18,y:2},{x:-32,y:8},{x:-44,y:8},{x:-45,y:13},{x:-32,y:13},{x:-17,y:12},{x:-3,y:6}], true);
    s.fillPoints([{x:-4,y:4},{x:-16,y:10},{x:-30,y:17},{x:-42,y:19},{x:-41,y:24},{x:-28,y:22},{x:-14,y:16},{x:-2,y:10}], true);
    s.fillStyle(0x54687f, 1);
    s.fillPoints([{x:-45,y:8},{x:-53,y:6},{x:-52,y:13},{x:-45,y:12}], true);
    s.fillPoints([{x:-42,y:19},{x:-50,y:19},{x:-48,y:26},{x:-42,y:23}], true);
    s.fillStyle(navy, 1);
    s.fillPoints([{x:-6,y:-2},{x:4,y:-8},{x:16,y:-10},{x:26,y:-8},{x:30,y:-1},{x:20,y:3},{x:8,y:5},{x:-4,y:6}], true);
    s.fillPoints([{x:24,y:-8},{x:32,y:-14},{x:40,y:-18},{x:46,y:-19},{x:47,y:-13},{x:41,y:-12},{x:33,y:-7},{x:28,y:-3}], true);
    s.fillCircle(14, -16, 9);
    s.fillStyle(0xe9f1fb, 1);
    s.slice(14, -16, 9, Math.PI, Math.PI * 2, false); s.fillPath();
    s.fillStyle(0xc8563b, 1); s.fillCircle(13, -24, 1.8);
    s.fillStyle(0xcfe6ff, 1); s.fillCircle(20, -14.5, 1.4);
    s.lineStyle(1.2, 0x9fc8ee, .8);
    s.beginPath();
    s.moveTo(-44, 8); s.lineTo(-30, 6); s.lineTo(-16, 2); s.lineTo(-4, -2); s.lineTo(6, -8); s.lineTo(16, -10); s.lineTo(26, -8);
    s.strokePath();
    this.swimmer.add(s);
    this.swimmer.setScale(2);
  }

  // ───────────────────────── déroulé ─────────────────────────
  refreshHud() {
    $('score').textContent = this.score.toLocaleString('fr-FR');
    $('balles').innerHTML = Array.from({ length: 3 },
      (_, i) => `<i class="${i < this.lives ? '' : 'off'}"></i>`).join('');
    const chip = $('serie');
    chip.textContent = 'SÉRIE ×' + Math.max(this.serie, 1);
    chip.classList.toggle('on', this.serie >= 2);
  }

  launch(dx, dy) {
    const len = Math.hypot(dx, dy);
    const sp = Math.min(len * LAUNCH_K, SPEED_MAX);
    this.vel = { x: dx / len * sp, y: dy / len * sp };
    this.stateName = 'flying';
    this.launchFactor = this.potFactor();
    this.flyT = 0;
    this.minD = 9999;
    this.bounced = false;
    this.sharkHit = false;
    this.trace = [];
    $('hint').style.opacity = 0;
    this.trail.emitParticleAt(this.ball.x, this.ball.y, 6);
  }

  currentNow() {
    const d = this.mod;
    if (!d.curBase) return 0;
    const turb = d.turb ? (0.5 + Math.sin(this.flyT * 2.6 + d.curPhase)) : 1;
    return d.curBase * d.curDir * turb;
  }

  physStep(p, v, dt, current) {
    v.x += current * dt;
    v.y += G * dt;
    const f = Math.exp(-DRAG * dt);
    v.x *= f; v.y *= f;
    p.x += v.x * dt; p.y += v.y * dt;
  }

  segDist(a, b, p) {
    const abx = b.x - a.x, aby = b.y - a.y;
    const l2 = abx * abx + aby * aby;
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2));
    return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
  }

  cavityWorld() {
    const m = this.cavity.getWorldTransformMatrix();
    return { x: m.tx, y: m.ty, r: this.cavBase * this.mod.cavScale };
  }

  update(_, dms) {
    if (!this.mod) return;
    const dt = Math.min(dms / 1000, 0.033);

    // pression temporelle : le potentiel fond quand on attend
    if (this.stateName === 'ready' || this.stateName === 'aiming') {
      this.readyT += dt;
      const f = this.potFactor();
      $('pot').textContent = Math.round(this.mod.potBase * f * (this.mod.signe ? 3 : 1)).toLocaleString('fr-FR');
      if (f < 1 && !this.impatient) {
        this.impatient = true;
        $('modif').textContent = 'L’ANCHOSIFFLE S’IMPATIENTE — LE POTENTIEL FOND';
      }
    }

    // filets de courant visibles (dérivent à la vitesse réelle du courant, turbulence comprise)
    const curNow = this.stateName === 'flying' ? this.currentNow()
      : this.mod.curBase * this.mod.curDir * (this.mod.turb ? (0.5 + Math.sin((this.waveT || 0) * 2.6 + this.mod.curPhase)) : 1);
    this.flowX += curNow * dt * .9;
    this.flowGfx.clear();
    if (this.mod.curBase) {
      this.flowGfx.lineStyle(2, 0x9fc8ee, .14);
      for (const s of this.flowSeeds) {
        const x = ((s.off + this.flowX) % (W + 120) + (W + 120)) % (W + 120) - 60;
        this.flowGfx.beginPath();
        this.flowGfx.moveTo(x, s.y);
        this.flowGfx.lineTo(x + s.len * Math.sign(curNow || 1), s.y);
        this.flowGfx.strokePath();
      }
    }

    this.waveT = (this.waveT || 0) + dt;
    this.waveGfx.clear();
    this.waveGfx.lineStyle(3, 0xe6f1fc, .8);
    this.waveGfx.beginPath();
    for (let x = 0; x <= W; x += 12) {
      const y = SURF + Math.sin(x / 46 + this.waveT * 1.8) * 4;
      x === 0 ? this.waveGfx.moveTo(x, y) : this.waveGfx.lineTo(x, y);
    }
    this.waveGfx.strokePath();

    this.spinA += dt * .5;
    this.spinGfx.clear();
    const cw = this.cavityWorld();
    this.spinGfx.lineStyle(2, 0xe8c766, .8);
    for (let i = 0; i < 10; i++) {
      const a = this.spinA + i * Math.PI / 5;
      this.spinGfx.beginPath();
      this.spinGfx.arc(cw.x, cw.y, cw.r + 12, a, a + .22);
      this.spinGfx.strokePath();
    }

    this.ghostGfx.clear();
    if (this.ghost) {
      this.ghostGfx.lineStyle(2.4, 0xaebdd0, .32);
      for (let i = 0; i + 1 < this.ghost.length; i += 2) {
        this.ghostGfx.beginPath();
        this.ghostGfx.moveTo(this.ghost[i].x, this.ghost[i].y);
        this.ghostGfx.lineTo(this.ghost[i + 1].x, this.ghost[i + 1].y);
        this.ghostGfx.strokePath();
      }
      const e = this.ghost[this.ghost.length - 1];
      if (e) {
        this.ghostGfx.lineStyle(3, 0xaebdd0, .45);
        this.ghostGfx.beginPath();
        this.ghostGfx.moveTo(e.x - 8, e.y - 8); this.ghostGfx.lineTo(e.x + 8, e.y + 8);
        this.ghostGfx.moveTo(e.x + 8, e.y - 8); this.ghostGfx.lineTo(e.x - 8, e.y + 8);
        this.ghostGfx.strokePath();
      }
    }

    this.ballGlow.setPosition(this.ball.x, this.ball.y);
    if (this.stateName === 'aiming') this.drawAim();

    if (this.stateName === 'flying') {
      this.flyT += dt;
      const prev = { x: this.ball.x, y: this.ball.y };
      this.physStep(this.ball, this.vel, dt, this.currentNow());
      this.ball.rotation += dt * 2.4;
      if (Math.random() < .35) this.trail.emitParticleAt(this.ball.x - 6, this.ball.y, 1);
      if (Math.random() < .5) this.trace.push({ x: this.ball.x, y: this.ball.y });

      // requin-marteau : déflecteur
      if (this.mod.shark && !this.sharkHit) {
        const sx = (this.ball.x - this.shark.x - 70) / 80, sy = (this.ball.y - this.shark.y - 16) / 30;
        if (sx * sx + sy * sy < 1) {
          this.sharkHit = true;
          this.vel.y = Math.abs(this.vel.y) * .3 + 170;
          this.vel.x *= .3;
          this.cameras.main.shake(110, .005);
          this.trail.emitParticleAt(this.ball.x, this.ball.y, 10);
        }
      }

      // plan de la raquette : cavité / cadre / à côté
      const c = this.cavityWorld();
      const crossed = (prev.x - c.x) * (this.ball.x - c.x) <= 0 && prev.x !== this.ball.x;
      if (crossed) {
        const t = (c.x - prev.x) / (this.ball.x - prev.x);
        const yc = prev.y + t * (this.ball.y - prev.y);
        const dy = Math.abs(yc - c.y);
        this.minD = Math.min(this.minD, dy);
        if (dy < c.r - 2) { this.success(dy, c); return; }
        if (!this.bounced && Math.abs(yc - this.racket.y) < 100) {
          this.bounced = true;
          this.ball.x = c.x - Math.sign(this.vel.x) * 24;
          this.ball.y = yc;
          this.vel.x = -this.vel.x * .4;
          this.vel.y *= .55;
          this.cameras.main.shake(90, .004);
          this.tweens.add({ targets: this.racket, angle: '+=5', duration: 90, yoyo: true });
          this.trail.emitParticleAt(this.ball.x, this.ball.y, 8);
        }
      }
      const past = this.ball.x > this.racket.x + 150 && this.vel.y > 0 && this.ball.y > this.racket.y + 150;
      if (this.ball.y > H - 60 || this.ball.x > W + 80 || this.ball.x < -80 || this.flyT > 3.5 || past) this.miss();
    }
  }

  drawAim() {
    const g = this.aimGfx;
    g.clear();
    const dx = this.aimStart.x - this.aimCur.x, dy = this.aimStart.y - this.aimCur.y;
    g.lineStyle(4, 0x4fa3d8, .85);
    g.beginPath(); g.moveTo(this.ball.x, this.ball.y); g.lineTo(this.aimCur.x, this.aimCur.y); g.strokePath();
    g.lineStyle(3, 0xeef5ff, .9); g.strokeCircle(this.aimCur.x, this.aimCur.y, 20);
    const len = Math.hypot(dx, dy);
    if (len < 24) return;
    const sp = Math.min(len * LAUNCH_K, SPEED_MAX);
    const p = { x: this.ball.x, y: this.ball.y };
    const v = { x: dx / len * sp, y: dy / len * sp };
    // aperçu EN EAU CALME (le courant n'est pas compensé : c'est au joueur de le lire), très tronqué
    g.fillStyle(0xeef5ff, .95);
    const steps = 60, shown = Math.floor(steps * .26);
    for (let i = 0; i < steps; i++) {
      this.physStep(p, v, 1 / 45, 0);
      if (i % 4 === 0 && i < shown) g.fillCircle(p.x, p.y, 4.5 - (i / steps) * 2.5);
    }
  }

  success(d, c) {
    this.stateName = 'pause';
    this.serie += 1;
    this.hits += 1;
    this.bestSerie = Math.max(this.bestSerie, this.serie);
    const centered = d < c.r * .35;
    const base = this.mod.potBase + Math.round(300 * (1 - d / c.r));
    const pts = Math.round(base * this.launchFactor * (centered ? 1.2 : 1)) * this.serie * (this.mod.signe ? 3 : 1);
    this.score += pts;
    this.burst.emitParticleAt(c.x, c.y, this.mod.signe ? 60 : 26);
    this.cameras.main.flash(280, 232, 199, 102);
    this.cameras.main.shake(200, .008);
    this.tweens.add({ targets: this.cavGlow, scale: 3, alpha: .9, duration: 160, yoyo: true });
    const chip = $('serie');
    chip.classList.add('pop'); setTimeout(() => chip.classList.remove('pop'), 300);
    this.showStamp(this.mod.signe ? 'TIR SIGNÉ HOMOLOGUÉ' : 'HOMOLOGUÉ',
      `+${pts.toLocaleString('fr-FR')} PTS` + (centered ? ' · PASSAGE CENTRÉ ×1,2' : ''), false);
    this.ball.setVisible(false);
    this.time.delayedCall(1350, () => this.nextShot());
  }

  miss() {
    this.stateName = 'pause';
    this.serie = 0;
    this.lives -= 1;
    this.ghost = this.trace.slice();
    this.showStamp('LA BALLE COULE',
      this.lives > 0 ? `récupération en apnée — ${this.lives} balle${this.lives > 1 ? 's' : ''} restante${this.lives > 1 ? 's' : ''}` : 'stock de balles épuisé', true);
    this.tweens.add({ targets: this.ball, alpha: 0, duration: 500 });
    this.time.delayedCall(1100, () => this.lives > 0 ? this.nextShot() : this.endSession());
  }

  showStamp(t, pts, isMiss) {
    $('stampText').textContent = t;
    $('stampText').classList.toggle('miss', isMiss);
    $('stampPts').textContent = pts;
    $('stampLayer').classList.add('show');
    setTimeout(() => $('stampLayer').classList.remove('show'), 1050);
  }

  nextShot() {
    this.tir += 1;
    this.setupShot();
    this.resetBall();
  }

  resetBall() {
    this.ball.setPosition(this.ballHome.x, this.ballHome.y);
    this.ball.setAlpha(1).setVisible(true);
    this.ball.rotation = 0;
    this.stateName = 'ready';
  }

  endSession() {
    this.stateName = 'over';
    this.refreshHud();
    $('endScore').textContent = this.score.toLocaleString('fr-FR');
    $('endSub').textContent =
      `Tir atteint : n°${this.tir} · ${this.hits} homologué${this.hits > 1 ? 's' : ''} · meilleure série ×${Math.max(this.bestSerie, 1)}. ` +
      `Procès-verbal transmis au greffe de la F.I.S.T.`;
    $('endLayer').classList.add('show');
  }

  restart() {
    $('endLayer').classList.remove('show');
    this.rng = mulberry32(Date.now() & 0xffffffff);
    this.tir = 1;
    this.score = 0; this.serie = 0; this.hits = 0; this.bestSerie = 0;
    this.lives = 3;
    this.ghost = null;
    this.bassin = -1;
    this.setupShot();
    this.resetBall();
    $('hint').style.opacity = 1;
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#050e1e',
  width: W,
  height: H,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: Main,
});
