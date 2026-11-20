// Атмосфера карты по набору AmbienceProfile (assets.ts): дым из нарисованных труб, огни окон, рябь и блики воды, туман,
// тени облаков и облака над картой, птицы, северное сияние, болотные огоньки, искры костров, блики на реках; снегопад — addSnow.
// Места — в пикселях подложки, силы — FEEL.map. Без арта и фильтров: текстуры рисуются кодом.
import * as Phaser from 'phaser';
import type { MapView } from '../config/assets';
import { FEEL } from '../config/feel';

/** Мягкое круглое пятно (белое, красится tint) — для дыма, тумана, теней, огней, пыли и бликов. */
export const FX_SOFT = 'fx_soft';
/** Силуэт птицы — галочка. */
const FX_BIRD = 'fx_bird';

/** Текстуры эффектов рисуются один раз на холсте. */
export function ensureFxTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(FX_SOFT)) {
    const s = 64;
    const t = scene.textures.createCanvas(FX_SOFT, s, s)!;
    const c = t.getContext();
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    t.refresh();
  }
  if (!scene.textures.exists(FX_BIRD)) {
    const t = scene.textures.createCanvas(FX_BIRD, 32, 16)!;
    const c = t.getContext();
    c.strokeStyle = '#ffffff';
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(2, 4);
    c.quadraticCurveTo(10, 3, 16, 11);
    c.quadraticCurveTo(22, 3, 30, 4);
    c.stroke();
    t.refresh();
  }
}

const rnd = ([a, b]: [number, number] | readonly [number, number]) => Phaser.Math.FloatBetween(a, b);

interface Drifter {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  /** Где двигаться: прямоугольник в мировых px, выходя за край — возвращается с другой стороны. */
  zone: { x: number; y: number; w: number; h: number };
}

/**
 * Создаёт слои атмосферы карты view. Возвращает функцию обновления на кадр (дрейф облаков, тумана и сияния, волна воды).
 * Глубины: тени облаков 2, сияние 2.5, туман 3, вода 3.5, дым, окна, огоньки, искры 4 — под маршрутом (5) и метками (7);
 * облака над картой и птицы — 9.
 */
export function addMapAmbience(scene: Phaser.Scene, view: MapView): (deltaMs: number) => void {
  ensureFxTextures(scene);
  const F = FEEL.map;
  const A = view.ambience;
  const k = view.scale;
  const src = scene.textures.get(view.key).getSourceImage();
  const worldW = src.width * k;
  const worldH = src.height * k;
  const drifters: Drifter[] = [];
  const updaters: ((dt: number, t: number) => void)[] = [];

  // Тени облаков: большие тёмные пятна медленно идут по всей карте.
  if (A.clouds) {
    const C = F.clouds;
    for (let i = 0; i < C.count; i++) {
      const img = scene.add.image(Phaser.Math.Between(0, worldW), Phaser.Math.Between(0, worldH), FX_SOFT)
        .setDisplaySize(rnd(C.w), rnd(C.h)).setTint(0x000000).setAlpha(C.alpha).setDepth(2).setScrollFactor(C.scrollFactor);
      const sp = rnd(C.speed);
      drifters.push({ img, vx: sp, vy: sp * 0.25, zone: { x: -600, y: -400, w: worldW + 1200, h: worldH + 800 } });
    }
  }

  // Облака над картой: светлые полупрозрачные пятна ближе к камере (сильнее параллакс).
  if (A.cloudLayer) {
    const C = F.cloudLayer;
    for (let i = 0; i < C.count; i++) {
      const img = scene.add.image(Phaser.Math.Between(0, worldW), Phaser.Math.Between(0, worldH), FX_SOFT)
        .setDisplaySize(rnd(C.w), rnd(C.h)).setAlpha(C.alpha).setDepth(9).setScrollFactor(C.scrollFactor);
      const sp = rnd(C.speed);
      drifters.push({ img, vx: sp, vy: sp * 0.15, zone: { x: -800, y: -400, w: worldW + 1600, h: worldH + 800 } });
    }
  }

  // Северное сияние: вытянутые зелёные полосы с осветлением переливаются и медленно плывут.
  if (A.aurora) {
    const Au = F.aurora;
    const R = A.aurora;
    for (let i = 0; i < Au.count; i++) {
      const img = scene.add.image((R.x + Math.random() * R.w) * k, (R.y + Math.random() * R.h) * k, FX_SOFT)
        .setDisplaySize(rnd(Au.w) * k, rnd(Au.h) * k).setTint(Au.colors[i % Au.colors.length])
        .setBlendMode(Phaser.BlendModes.ADD).setAlpha(Au.alpha[0]).setDepth(2.5);
      scene.tweens.add({ targets: img, alpha: Au.alpha[1], duration: rnd(Au.periodMs), yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Math.random() * 2000 });
      drifters.push({ img, vx: Au.drift * k * (Math.random() < 0.5 ? -1 : 1), vy: 0, zone: { x: (R.x - 200) * k, y: R.y * k, w: (R.w + 400) * k, h: R.h * k } });
    }
  }

  // Туман: светлые полосы дрейфуют внутри своих зон (там, где он нарисован).
  if (A.fog) {
    const G = F.fog;
    for (const z of A.fog) {
      const zone = { x: z.x * k - G.w / 2, y: z.y * k, w: z.w * k + G.w, h: z.h * k };
      for (let i = 0; i < G.perZone; i++) {
        const img = scene.add.image(zone.x + Math.random() * zone.w, zone.y + Math.random() * zone.h, FX_SOFT)
          .setDisplaySize(G.w * Phaser.Math.FloatBetween(0.7, 1.2), G.h * Phaser.Math.FloatBetween(0.7, 1.2))
          .setAlpha(G.alpha).setDepth(3).setScrollFactor(G.scrollFactor);
        drifters.push({ img, vx: rnd(G.drift) * (Math.random() < 0.5 ? -1 : 1), vy: 0, zone });
      }
    }
  }

  // Дым из труб, где он нарисован: поднимается, сносится ветром, тает.
  const S = F.smoke;
  for (const [x, y] of A.chimneys ?? []) {
    scene.add.particles(x * k, y * k, FX_SOFT, {
      frequency: S.frequency,
      lifespan: S.lifespan,
      speedX: { min: -3, max: 3 },
      speedY: { min: -S.rise[1], max: -S.rise[0] },
      accelerationX: S.wind,
      scale: { start: S.scale[0], end: S.scale[1] },
      alpha: { start: S.alpha, end: 0 },
      tint: S.tint,
      advance: S.lifespan,
    }).setDepth(4);
  }

  // Огни в окнах: тёплые пятна мерцают каждое в своём ритме.
  const Wn = F.windows;
  for (const [x, y] of A.windows ?? []) {
    const g = scene.add.image(x * k, y * k, FX_SOFT).setDisplaySize(Wn.size, Wn.size).setTint(Wn.color)
      .setBlendMode(Phaser.BlendModes.ADD).setAlpha(Wn.alpha[0]).setDepth(4);
    scene.tweens.add({ targets: g, alpha: Wn.alpha[1], duration: rnd(Wn.periodMs), yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Math.random() * 1000 });
  }

  // Болотные огоньки: голубые пятна блуждают на месте и мерцают.
  const Wi = F.wisps;
  for (const [x, y] of A.wisps ?? []) {
    const g = scene.add.image(x * k, y * k, FX_SOFT).setDisplaySize(Wi.size, Wi.size).setTint(Wi.color)
      .setBlendMode(Phaser.BlendModes.ADD).setAlpha(Wi.alpha[0]).setDepth(4);
    const wander = () => {
      if (!g.active) return;
      scene.tweens.add({
        targets: g,
        x: x * k + Phaser.Math.Between(-Wi.wander, Wi.wander),
        y: y * k + Phaser.Math.Between(-Wi.wander, Wi.wander) * 0.6,
        alpha: rnd(Wi.alpha),
        duration: rnd(Wi.periodMs),
        ease: 'Sine.easeInOut',
        onComplete: wander,
      });
    };
    wander();
  }

  // Искры костров: летят вверх, гаснут.
  const Em = F.embers;
  for (const [x, y] of A.embers ?? []) {
    scene.add.particles(x * k, y * k, FX_SOFT, {
      frequency: Em.frequency,
      lifespan: { min: Em.lifespan[0], max: Em.lifespan[1] },
      speedX: { min: -12, max: 12 },
      speedY: { min: -Em.rise[1], max: -Em.rise[0] },
      scale: { start: rnd(Em.scale), end: 0 },
      alpha: { start: 1, end: 0 },
      tint: Em.tint,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(4);
  }

  // Блики на реках: вода находится по цвету в своей зоне, короткие вспышки в случайных точках воды.
  if (A.rivers) {
    const water = findWater(src as HTMLImageElement, A.rivers);
    const Rv = F.rivers;
    if (water.length) {
      scene.add.particles(0, 0, FX_SOFT, {
        frequency: Rv.frequency,
        lifespan: Rv.lifespan,
        emitZone: {
          type: 'random',
          source: {
            getRandomPoint: (pt: Phaser.Types.Math.Vector2Like) => {
              const i = Math.floor(Math.random() * (water.length / 2)) * 2;
              return Object.assign(pt, { x: water[i] * k, y: water[i + 1] * k });
            },
          },
        },
        scaleX: { start: Rv.scale, end: 0 },
        scaleY: { start: Rv.scale * 0.35, end: 0 },
        alpha: { start: Rv.alpha, end: 0 },
        blendMode: Phaser.BlendModes.ADD,
      }).setDepth(3.6);
    }
  }

  // Пруд: кусок подложки на «ленте» (Rope), её точки качаются волной — рябь. Сверху — короткие блики.
  if (A.pond) {
    const P = A.pond;
    const Wt = F.water;
    const tex = scene.textures.get(view.key);
    if (!tex.has('pond')) {
      tex.add('pond', 0, P.x, P.y, P.w, P.h);
      tex.firstFrame = '__BASE'; // Phaser делает первый добавленный кадр кадром по умолчанию — иначе подложка рисовалась бы куском пруда
    }
    const segments = 24;
    const initial = Array.from({ length: segments + 1 }, (_, i) => ({ x: -P.w / 2 + (i * P.w) / segments, y: 0 }));
    const rope = scene.add.rope((P.x + P.w / 2) * k, (P.y + P.h / 2) * k, view.key, 'pond', initial, true).setScale(k).setDepth(3.5);
    const ropePoints = rope.points as Phaser.Types.Math.Vector2Like[];
    const baseY = ropePoints.map((p) => p.y);
    scene.add.particles(0, 0, FX_SOFT, {
      frequency: Wt.sparkFrequency,
      lifespan: Wt.sparkLifespan,
      emitZone: {
        type: 'random',
        source: { getRandomPoint: (pt: Phaser.Types.Math.Vector2Like) => Object.assign(pt, { x: (P.x + Math.random() * P.w) * k, y: (P.y + Math.random() * P.h) * k }) },
      },
      scaleX: { start: Wt.sparkScale, end: 0 },
      scaleY: { start: Wt.sparkScale * 0.35, end: 0 },
      alpha: { start: Wt.sparkAlpha, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(3.6);
    updaters.push((_dt, t) => {
      for (let i = 0; i < ropePoints.length; i++) ropePoints[i].y = baseY[i] + Math.sin(t * Wt.speed + (i / Wt.waveLength) * Math.PI * 2) * Wt.amplitude;
      rope.setDirty();
    });
  }

  // Птицы: изредка стайка пролетает через видимую часть карты.
  if (A.birdsY) {
    const B = F.birds;
    const Y = A.birdsY;
    const flock = () => {
      const cam = scene.cameras.main;
      const leftToRight = Math.random() < 0.5;
      const n = Phaser.Math.Between(B.count[0], B.count[1]);
      const y0 = Phaser.Math.Between(Y[0] * k, Y[1] * k);
      const x0 = leftToRight ? cam.scrollX - 200 : cam.scrollX + cam.width + 200;
      const dist = cam.width + 600;
      for (let i = 0; i < n; i++) {
        const bird = scene.add.image(x0 - (leftToRight ? 1 : -1) * i * 34, y0 + (i % 2 ? 1 : -1) * i * 9, FX_BIRD)
          .setDisplaySize(B.size * 2.2, B.size).setTint(0x1d1a22).setAlpha(B.alpha).setDepth(9).setScrollFactor(B.scrollFactor)
          .setFlipX(!leftToRight);
        scene.tweens.add({ targets: bird, scaleY: bird.scaleY * 0.35, duration: B.flapMs, yoyo: true, repeat: -1, delay: Math.random() * B.flapMs });
        scene.tweens.add({
          targets: bird,
          x: bird.x + (leftToRight ? dist : -dist),
          y: bird.y + Phaser.Math.Between(-60, 30),
          duration: (dist / B.speed) * 1000,
          onComplete: () => bird.destroy(),
        });
      }
      scene.time.delayedCall(rnd(B.everyMs), flock);
    };
    scene.time.delayedCall(rnd(B.everyMs) / 3, flock);
  }

  let t = 0;
  return (deltaMs: number) => {
    const dt = deltaMs / 1000;
    t += dt;
    for (const d of drifters) {
      d.img.x += d.vx * dt;
      d.img.y += d.vy * dt;
      const z = d.zone;
      if (d.img.x > z.x + z.w) d.img.x = z.x;
      else if (d.img.x < z.x) d.img.x = z.x + z.w;
      if (d.img.y > z.y + z.h) d.img.y = z.y;
    }
    for (const u of updaters) u(dt, t);
  };
}

/** Снегопад во весь экран (закреплён на экране — сцена рисует его камерой интерфейса). Глубина — под интерфейсом. */
export function addSnow(scene: Phaser.Scene, w: number, h: number, depth: number): Phaser.GameObjects.Particles.ParticleEmitter {
  ensureFxTextures(scene);
  const Sn = FEEL.map.snow;
  return scene.add.particles(0, 0, FX_SOFT, {
    frequency: Sn.frequency,
    lifespan: (h / Sn.fall[0]) * 1000,
    x: { min: -40, max: w + 40 },
    y: -10,
    speedY: { min: Sn.fall[0], max: Sn.fall[1] },
    speedX: { min: -Sn.wind, max: Sn.wind },
    scale: { min: Sn.scale[0], max: Sn.scale[1] },
    alpha: { start: Sn.alpha, end: Sn.alpha * 0.6 },
    advance: (h / Sn.fall[0]) * 1000,
  }).setScrollFactor(0).setDepth(depth);
}

/** Пиксели воды в зоне (синий заметно больше красного) — плоский список x, y; не больше 6000 точек. */
function findWater(img: HTMLImageElement, r: { x: number; y: number; w: number; h: number }): number[] {
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  const g = c.getContext('2d')!;
  g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  const d = g.getImageData(0, 0, r.w, r.h).data;
  const out: number[] = [];
  for (let y = 0; y < r.h; y += 3)
    for (let x = 0; x < r.w; x += 3) {
      const i = (y * r.w + x) * 4;
      const red = d[i];
      const grn = d[i + 1];
      const blu = d[i + 2];
      if (blu > 100 && blu - red > 40 && blu - grn > 0) out.push(r.x + x, r.y + y);
    }
  // Прореживаем до 6000 точек.
  const n = out.length / 2;
  if (n <= 6000) return out;
  const step = n / 6000;
  const thin: number[] = [];
  for (let j = 0; j < 6000; j++) {
    const i = Math.floor(j * step) * 2;
    thin.push(out[i], out[i + 1]);
  }
  return thin;
}
