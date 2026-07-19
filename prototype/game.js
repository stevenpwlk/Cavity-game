/* CAVITÉ — Prototype P1 · geste de tir, physique aquatique, juice minimal
   Design interne 780×1240 (unités = 2× la maquette), Scale.FIT portrait. */

const W = 780, H = 1240;
const SURF = 150;                 // ligne de flottaison
const G = 300;                    // gravité sous-marine (px/s²)
const DRAG = 0.32;                // traînée de l'eau
const LAUNCH_K = 3.6;             // drag → vitesse
const SPEED_MAX = 1500;

const MODS = [
  { pill: 'PREMIER TIR — RAQUETTE FIXE',      current: 0,   drift: false, cavScale: 1 },
  { pill: 'NOUVEAUTÉ — COURANT 1/3',          current: 40,  drift: false, cavScale: 1 },
  { pill: 'NOUVEAUTÉ — COURANT RENFORCÉ 2/3', current: 90,  drift: false, cavScale: 1 },
  { pill: 'NOUVEAUTÉ — RAQUETTE DÉRIVANTE',   current: 40,  drift: true,  cavScale: 1 },
  { pill: 'NOUVEAUTÉ — CAVITÉ RÉDUITE',       current: 90,  drift: true,  cavScale: 0.72 },
];

const $ = id => document.getElementById(id);

class Main extends Phaser.Scene {
  create() {
    this.makeTextures();
    this.drawArena();

    // ─── raquette-cible ───
    this.cavBase = 38;
    this.racket = this.add.container(600, 520);
    this.buildRacket();
    this.bobT = this.tweens.add({ targets: this.racket, y: '+=16', angle: -2,
      duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

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

    // bulles de traînée de la balle
    this.trail = this.add.particles(0, 0, 'bubble', {
      speed: { min: 8, max: 30 }, angle: { min: 250, max: 290 },
      scale: { start: .5, end: .1 }, alpha: { start: .5, end: 0 },
      lifespan: 900, frequency: -1,
    });

    // burst doré du succès
    this.burst = this.add.particles(0, 0, 'gold', {
      speed: { min: 60, max: 320 }, scale: { start: .9, end: 0 },
      alpha: { start: 1, end: 0 }, lifespan: 700, frequency: -1,
      blendMode: Phaser.BlendModes.ADD,
    });

    // ambiance : particules en suspension
    this.add.particles(0, 0, 'dot', {
      x: { min: 0, max: W }, y: { min: SURF + 40, max: H - 80 },
      speedY: { min: -14, max: -5 }, speedX: { min: -6, max: 10 },
      scale: { min: .2, max: .5 }, alpha: { start: .16, end: 0 },
      lifespan: 9000, frequency: 320,
    });

    // ─── calques dynamiques ───
    this.waveGfx = this.add.graphics();
    this.ghostGfx = this.add.graphics();
    this.aimGfx = this.add.graphics();
    this.spinGfx = this.add.graphics();
    this.spinA = 0;

    // ─── état ───
    this.stateName = 'ready';   // ready | aiming | flying | pause | over
    this.ballIndex = 0;
    this.score = 0;
    this.serie = 0;
    this.hits = 0;
    this.bestSerie = 0;
    this.trace = [];
    this.ghost = null;
    this.applyMod();
    this.refreshHud();

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

    // accès de test/debug
    window.__scene = this;
    window.__C = { G, DRAG, LAUNCH_K, SPEED_MAX };
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
  drawArena() {
    const g = this.add.graphics();
    // ciel d'arène
    g.fillStyle(0x0c2140, 1); g.fillRect(0, 0, W, SURF);
    // tribunes silhouettées
    g.fillStyle(0x060f20, 1); this.band(g, 40, 96);
    g.fillStyle(0x081426, 1); this.band(g, 92, 132);
    // bokeh public (graine fixe)
    const rnd = new Phaser.Math.RandomDataGenerator(['fist']);
    const cols = [0xe4c05c, 0xe9f1fb, 0x4fa3d8, 0xc8563b];
    for (let i = 0; i < 42; i++) {
      g.fillStyle(rnd.pick(cols), rnd.realInRange(.25, .6));
      g.fillCircle(rnd.between(10, W - 10), rnd.between(48, 124), rnd.realInRange(1.6, 3.2));
    }
    // projecteurs
    for (const mx of [120, 660]) {
      g.fillStyle(0x040b18, 1);
      g.fillRect(mx - 3, 24, 6, SURF - 24);
      g.fillRoundedRect(mx - 24, 14, 48, 14, 6);
      g.fillStyle(0xffe9ad, 1);
      for (const dx of [-13, 0, 13]) g.fillCircle(mx + dx, 21, 4);
    }
    const cone = this.add.graphics();
    cone.fillStyle(0xdceeff, .05);
    cone.fillTriangle(120 - 16, 30, 120 + 16, 30, 260, H * .55);
    cone.fillTriangle(660 - 16, 30, 660 + 16, 30, 520, H * .5);
    cone.setBlendMode(Phaser.BlendModes.ADD);
    // eau
    g.fillGradientStyle(0x1c4e7c, 0x1c4e7c, 0x081c36, 0x081c36, 1);
    g.fillRect(0, SURF, W, H - SURF);
    // halo lumineux côté cible
    this.add.image(600, 420, 'glow').setScale(6.5).setTint(0x9fc8ee).setAlpha(.10).setBlendMode(Phaser.BlendModes.ADD);
    // lignes de carrelage municipal
    g.lineStyle(1, 0xe9f1fb, .05);
    for (let y = SURF + 110; y < H - 120; y += 112) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.strokePath(); }
    for (let x = 96; x < W; x += 196) { g.beginPath(); g.moveTo(x, SURF); g.lineTo(x, H - 140); g.strokePath(); }
    // flotteurs de ligne d'eau
    for (let i = 0; i < 12; i++) {
      g.fillStyle(i % 2 ? 0xc8563b : 0xe9f1fb, .8);
      g.fillCircle(30 + i * 44, SURF, 4.5);
    }
    // échelle municipale
    g.lineStyle(5, 0x8fa2ba, .5);
    g.beginPath(); g.moveTo(706, SURF); g.lineTo(706, SURF + 190); g.moveTo(734, SURF); g.lineTo(734, SURF + 190);
    for (let y = SURF + 46; y <= SURF + 190; y += 50) { g.moveTo(700, y); g.lineTo(740, y); }
    g.strokePath();
    // bouée + filin de la cible
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
    // ombre
    // manche bois
    r.fillStyle(0x8f6238, 1); r.fillRoundedRect(-11, 86, 22, 104, 10);
    r.fillStyle(0xb98b5e, 1); r.fillRoundedRect(-11, 86, 22, 52, 10);
    r.lineStyle(2, 0x5f3f26, .7);
    for (let y = 104; y <= 176; y += 18) { r.beginPath(); r.moveTo(-11, y); r.lineTo(11, y + 4); r.strokePath(); }
    // tête
    r.fillStyle(0x040c1a, .3); r.fillEllipse(0, 0, 164, 192);
    r.lineStyle(9, 0xcbd6e4, 1); r.strokeEllipse(0, 0, 164, 192);
    r.lineStyle(2, 0x7e93ac, .7); r.strokeEllipse(0, 0, 144, 172);
    // cordage
    r.lineStyle(1.2, 0xa9bcd2, .5);
    for (let x = -64; x <= 64; x += 16) {
      const half = Math.sqrt(Math.max(0, 1 - (x / 70) ** 2)) * 84;
      r.beginPath(); r.moveTo(x, -half); r.lineTo(x, half); r.strokePath();
    }
    for (let y = -72; y <= 72; y += 16) {
      const half = Math.sqrt(Math.max(0, 1 - (y / 86) ** 2)) * 70;
      r.beginPath(); r.moveTo(-half, y); r.lineTo(half, y); r.strokePath();
    }
    // reflet de jante
    r.lineStyle(3, 0xeef5ff, .6);
    r.beginPath(); r.arc(0, 0, 88, Math.PI * 1.05, Math.PI * 1.5, false); r.strokePath();
    this.racket.add(r);
    this.racket.rotation = -0.14;

    // cavité (groupe séparé pour pouvoir la réduire)
    this.cavity = this.add.container(-12, -16);
    this.cavGlow = this.add.image(0, 0, 'glow').setScale(1.5).setTint(0xe8c766).setAlpha(.5).setBlendMode(Phaser.BlendModes.ADD);
    const hole = this.add.graphics();
    hole.fillStyle(0x020a16, 1); hole.fillCircle(0, 0, this.cavBase);
    hole.lineStyle(7, 0xe8c766, 1); hole.strokeCircle(0, 0, this.cavBase);
    this.cavity.add([this.cavGlow, hole]);
    this.racket.add(this.cavity);
    this.tweens.add({ targets: this.cavGlow, alpha: .25, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    // sceau
    const seal = this.add.graphics();
    seal.fillStyle(0xe4c05c, 1); seal.fillCircle(20, 94, 8);
    seal.lineStyle(2, 0xa8862f, 1); seal.strokeCircle(20, 94, 8);
    this.racket.add(seal);
  }

  buildSwimmer() {
    const s = this.add.graphics();
    const navy = 0x16294a;
    // jambes
    s.fillStyle(navy, 1);
    s.fillPoints([{x:-8,y:0},{x:-36,y:4},{x:-88,y:16},{x:-90,y:26},{x:-34,y:22},{x:-6,y:12}], true);
    s.fillPoints([{x:-8,y:8},{x:-32,y:20},{x:-84,y:38},{x:-82,y:48},{x:-28,y:36},{x:-4,y:20}], true);
    s.fillStyle(0x54687f, 1);
    s.fillPoints([{x:-88,y:16},{x:-104,y:12},{x:-102,y:26},{x:-88,y:26}], true);
    s.fillPoints([{x:-84,y:38},{x:-100,y:38},{x:-96,y:52},{x:-80,y:48}], true);
    // torse + bras tendu
    s.fillStyle(navy, 1);
    s.fillPoints([{x:-12,y:-4},{x:8,y:-16},{x:32,y:-20},{x:52,y:-16},{x:60,y:-2},{x:40,y:6},{x:16,y:10},{x:-8,y:12}], true);
    s.fillPoints([{x:48,y:-16},{x:64,y:-28},{x:84,y:-36},{x:92,y:-38},{x:94,y:-26},{x:78,y:-22},{x:58,y:-8}], true);
    // tête + bonnet + lunettes
    s.fillCircle(28, -32, 18);
    s.fillStyle(0xe9f1fb, 1);
    s.slice(28, -32, 18, Math.PI, Math.PI * 2, false); s.fillPath();
    s.fillStyle(0xc8563b, 1); s.fillCircle(26, -47, 4);
    s.fillStyle(0xcfe6ff, 1); s.fillCircle(40, -29, 3);
    // liseré de lumière dorsal
    s.lineStyle(2.4, 0x9fc8ee, .8);
    s.beginPath();
    s.moveTo(-88, 16); s.lineTo(-36, 4); s.lineTo(-8, -2); s.lineTo(10, -14); s.lineTo(34, -20); s.lineTo(52, -16);
    s.strokePath();
    this.swimmer.add(s);
  }

  // ───────────────────────── déroulé ─────────────────────────
  applyMod() {
    this.mod = MODS[this.ballIndex];
    $('modif').textContent = this.mod.pill;
    const lvl = this.mod.current === 0 ? 0 : (this.mod.current <= 40 ? 1 : 2);
    $('courant').style.opacity = lvl ? 1 : 0;
    $('courantVal').textContent = lvl + '/3';
    this.cavity.setScale(this.mod.cavScale);
    if (this.mod.drift && !this.driftT) {
      this.driftT = this.tweens.add({ targets: this.racket, x: '-=110',
        duration: 3400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    if (!this.mod.drift && this.driftT) { this.driftT.stop(); this.driftT = null; this.racket.x = 600; }
  }

  refreshHud() {
    $('score').textContent = this.score.toLocaleString('fr-FR');
    $('ballNo').textContent = Math.min(this.ballIndex + 1, 5) + '/5';
    // balles restantes pleines, tirées vides
    $('balles').innerHTML = Array.from({ length: 5 },
      (_, i) => `<i class="${i < 5 - this.ballIndex ? '' : 'off'}"></i>`).join('');
    const chip = $('serie');
    chip.textContent = 'SÉRIE ×' + Math.max(this.serie, 1);
    chip.classList.toggle('on', this.serie >= 2);
  }

  launch(dx, dy) {
    const len = Math.hypot(dx, dy);
    const sp = Math.min(len * LAUNCH_K, SPEED_MAX);
    this.vel = { x: dx / len * sp, y: dy / len * sp };
    this.stateName = 'flying';
    this.flyT = 0;
    this.minD = 9999;
    this.bounced = false;
    this.trace = [];
    $('hint').style.opacity = 0;
    this.trail.emitParticleAt(this.ball.x, this.ball.y, 6);
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
    const dt = Math.min(dms / 1000, 0.033);
    // surface animée
    this.waveT = (this.waveT || 0) + dt;
    this.waveGfx.clear();
    this.waveGfx.lineStyle(3, 0xe6f1fc, .8);
    this.waveGfx.beginPath();
    for (let x = 0; x <= W; x += 12) {
      const y = SURF + Math.sin(x / 46 + this.waveT * 1.8) * 4;
      x === 0 ? this.waveGfx.moveTo(x, y) : this.waveGfx.lineTo(x, y);
    }
    this.waveGfx.strokePath();

    // couronne pointillée de la cavité
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

    // trace fantôme
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
      this.physStep(this.ball, this.vel, dt, this.mod.current);
      this.ball.rotation += dt * 2.4;
      if (Math.random() < .35) this.trail.emitParticleAt(this.ball.x - 6, this.ball.y, 1);
      if (Math.random() < .5) this.trace.push({ x: this.ball.x, y: this.ball.y });

      // physique « de profil » : la raquette est un plan vertical au niveau de la cavité.
      // Au franchissement du plan : cavité -> homologué · cadre -> rebond · sinon la balle passe.
      const c = this.cavityWorld();
      const crossed = (prev.x - c.x) * (this.ball.x - c.x) <= 0 && prev.x !== this.ball.x;
      if (crossed) {
        const t = (c.x - prev.x) / (this.ball.x - prev.x);
        const yc = prev.y + t * (this.ball.y - prev.y);
        const dy = Math.abs(yc - c.y);
        this.minD = Math.min(this.minD ?? 9999, dy);
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
    // élastique
    g.lineStyle(4, 0x4fa3d8, .85);
    g.beginPath(); g.moveTo(this.ball.x, this.ball.y); g.lineTo(this.aimCur.x, this.aimCur.y); g.strokePath();
    g.lineStyle(3, 0xeef5ff, .9); g.strokeCircle(this.aimCur.x, this.aimCur.y, 20);
    // aperçu tronqué : 42 % de la simulation
    const len = Math.hypot(dx, dy);
    if (len < 24) return;
    const sp = Math.min(len * LAUNCH_K, SPEED_MAX);
    const p = { x: this.ball.x, y: this.ball.y };
    const v = { x: dx / len * sp, y: dy / len * sp };
    g.fillStyle(0xeef5ff, .95);
    const steps = 60, shown = Math.floor(steps * .42);
    for (let i = 0; i < steps; i++) {
      this.physStep(p, v, 1 / 45, this.mod.current);
      if (i % 4 === 0 && i / 4 < shown / 4) g.fillCircle(p.x, p.y, 4.5 - (i / steps) * 2.5);
    }
  }

  success(d, c) {
    this.stateName = 'pause';
    this.serie += 1;
    this.hits += 1;
    this.bestSerie = Math.max(this.bestSerie, this.serie);
    const centered = d < c.r * .35;
    const pts = Math.round((500 + Math.round(200 * (1 - d / c.r))) * (centered ? 1.2 : 1)) * this.serie;
    this.score += pts;
    this.burst.emitParticleAt(c.x, c.y, 26);
    this.cameras.main.flash(280, 232, 199, 102);
    this.cameras.main.shake(200, .008);
    this.tweens.add({ targets: this.cavGlow, scale: 3, alpha: .9, duration: 160, yoyo: true });
    const chip = $('serie');
    chip.classList.add('pop'); setTimeout(() => chip.classList.remove('pop'), 300);
    this.showStamp('HOMOLOGUÉ', `+${pts.toLocaleString('fr-FR')} PTS` + (centered ? ' · PASSAGE CENTRÉ ×1,2' : ''), false);
    this.ball.setVisible(false);
    this.time.delayedCall(1350, () => this.nextBall());
  }

  miss() {
    this.stateName = 'pause';
    this.serie = 0;
    this.ghost = this.trace.slice();
    this.showStamp('LA BALLE COULE', 'récupération en apnée — art. 1', true);
    this.tweens.add({ targets: this.ball, alpha: 0, duration: 500 });
    this.time.delayedCall(1100, () => this.nextBall());
  }

  showStamp(t, pts, isMiss) {
    $('stampText').textContent = t;
    $('stampText').classList.toggle('miss', isMiss);
    $('stampPts').textContent = pts;
    $('stampLayer').classList.add('show');
    setTimeout(() => $('stampLayer').classList.remove('show'), 1050);
  }

  nextBall() {
    this.ballIndex += 1;
    if (this.ballIndex >= 5) return this.endSession();
    this.applyMod();
    this.resetBall();
    this.refreshHud();
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
      `${this.hits} tir${this.hits > 1 ? 's' : ''} homologué${this.hits > 1 ? 's' : ''} sur 5 · plus longue série ×${Math.max(this.bestSerie, 1)}. ` +
      `Procès-verbal transmis au greffe de la F.I.S.T.`;
    $('endLayer').classList.add('show');
  }

  restart() {
    $('endLayer').classList.remove('show');
    this.ballIndex = 0; this.score = 0; this.serie = 0; this.hits = 0; this.bestSerie = 0;
    this.ghost = null;
    this.applyMod();
    this.resetBall();
    this.refreshHud();
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
