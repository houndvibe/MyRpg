// Фигурка героя на карте. Стоит — поза анфас с листа HERO_SHEET и лёгкое «дыхание»; идёт — цикл ходьбы в профиль,
// бежит (Shift) — цикл бега (листы HERO_MOTION); влево — зеркально.
// Кадры ставятся опорой в точку героя (у каждого кадра своя), поэтому не прыгают: у позы стоя — центр подставки,
// у ходьбы и бега — низ ног по y и середина головы по x (находятся при загрузке листа).
import * as Phaser from 'phaser';
import { HERO_MOTION as M, HERO_SHEET as H, type MapLight } from '../config/assets';
import { FEEL } from '../config/feel';

/** Рамка кадра в листе и опора: x, y, w, h, опора x, опора y (пиксели листа). */
type Rect = readonly [number, number, number, number, number, number];
type Motion = keyof typeof M;

export class MapHero {
  readonly sprite: Phaser.GameObjects.Sprite;
  /** Постановочный свет (addLight): тень на земле и кайма со стороны источника; dir — к источнику (единичный), strength — 0…1. */
  private light: { cfg: MapLight; dir: [number, number]; strength: number; shadow: Phaser.GameObjects.Sprite; rim: Phaser.GameObjects.Sprite } | null = null;
  private walking = false;
  private running = false;
  private facing = 1;
  private walkTime = 0;
  private idleTime = 0;
  private idleScale: number;
  /** Масштаб ходьбы и бега — один: рост героя по средней высоте кадра ходьбы (бег на тех же ячейках — того же размера). */
  private motionScale: number;
  private frames: Record<Motion, Rect[]>;

  /** heightPx — рост фигурки в px мира (на карте локации и на карте мира разный). */
  constructor(scene: Phaser.Scene, heightPx: number) {
    ensureHeroFrames(scene);
    this.frames = { walk: motionFrames(scene, 'walk'), run: motionFrames(scene, 'run') };
    this.idleScale = heightPx / H.idle[3];
    this.motionScale = heightPx / avg(this.frames.walk.map((r) => r[3]));
    this.sprite = scene.add.sprite(0, 0, H.key, 'idle');
    this.showIdle();
  }

  /**
   * Включить свет карты (MapView.light): тень и кайма — копии кадра в контейнере героя под фигуркой.
   * Источник на карте (at) — направление и сила обновляются aimLight по месту героя.
   */
  addLight(scene: Phaser.Scene, container: Phaser.GameObjects.Container, cfg: MapLight): void {
    const L = FEEL.map.light;
    const shadow = scene.add.sprite(0, 0, this.sprite.texture.key).setTint(0x000000).setTintMode(Phaser.TintModes.FILL);
    const rim = scene.add.sprite(0, 0, this.sprite.texture.key).setTint(cfg.rimColor ?? L.rimColor).setTintMode(Phaser.TintModes.FILL);
    container.addAt([shadow, rim], 0);
    const d = cfg.dir ?? [0, -1];
    const len = Math.hypot(d[0], d[1]) || 1;
    this.light = { cfg, dir: [d[0] / len, d[1] / len], strength: 1, shadow, rim };
    this.syncLight();
  }

  /** Герой в точке (x, y — пиксели подложки): у источника на карте — направление к нему и сила по расстоянию. */
  aimLight(x: number, y: number): void {
    const l = this.light;
    if (!l?.cfg.at) return;
    const dx = l.cfg.at[0] - x;
    const dy = l.cfg.at[1] - y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1) l.dir = [dx / dist, dy / dist];
    const min = FEEL.map.light.minStrength;
    l.strength = l.cfg.range ? Phaser.Math.Clamp(1 - (1 - min) * (dist / l.cfg.range), min, 1) : 1;
  }

  /** Начал или закончил идти. */
  setWalking(on: boolean): void {
    if (on === this.walking) return;
    this.walking = on;
    this.walkTime = 0;
    if (on) this.showMotion(0);
    else this.showIdle();
  }

  /** Бежит (зажат Shift) — на ходу цикл бега вместо ходьбы. */
  setRunning(on: boolean): void {
    if (on === this.running) return;
    this.running = on;
    this.walkTime = 0;
  }

  /** Каждый кадр: на месте — дыхание, на ходу — кадр ходьбы или бега по времени; dx — сдвиг героя за кадр по горизонтали. */
  update(deltaMs: number, dx: number): void {
    if (!this.walking) {
      // Дыхание: растяжение по высоте от подставки вверх, плавно туда и обратно.
      const B = FEEL.map.hero.breath;
      this.idleTime += deltaMs;
      const t = 0.5 - 0.5 * Math.cos((this.idleTime / B.periodMs) * Math.PI * 2);
      this.sprite.scaleY = this.idleScale * (1 + (B.scale - 1) * t);
      this.syncLight();
      return;
    }
    if (Math.abs(dx) > 0.01) this.facing = dx < 0 ? -1 : 1;
    this.walkTime += deltaMs / 1000;
    const fps = this.running ? FEEL.map.hero.runFps : FEEL.map.hero.walkFps;
    this.showMotion(Math.floor(this.walkTime * fps));
  }

  private showIdle(): void {
    this.setFrame(H.key, 'idle', H.idle, this.idleScale, false);
    this.idleTime = 0;
  }

  private showMotion(n: number): void {
    const m: Motion = this.running ? 'run' : 'walk';
    const list = this.frames[m];
    const i = n % list.length;
    this.setFrame(cutKey(m), `${m}${i}`, list[i], this.motionScale, this.facing < 0);
  }

  /** Кадр с опорой; при зеркале опора отражается тоже. */
  private setFrame(key: string, name: string, r: Rect, scale: number, flip: boolean): void {
    const [x, y, w, h, pedX, pedY] = r;
    const ox = (pedX - x) / w;
    this.sprite.setTexture(key, name).setFlipX(flip).setOrigin(flip ? 1 - ox : ox, (pedY - y) / h).setScale(scale);
    this.syncLight();
  }

  /**
   * Тень и кайма повторяют кадр. Тень: перевёрнута вниз от ног, сплющена до shadowLength роста и повёрнута прочь от источника.
   * Тон героя: лицом к свету — светлее, спиной — темнее, анфас (стоит) — между.
   */
  private syncLight(): void {
    if (!this.light) return;
    const L = FEEL.map.light;
    const s = this.sprite;
    const { cfg, dir, strength, shadow, rim } = this.light;
    for (const o of [shadow, rim]) o.setTexture(s.texture.key, s.frame.name).setFlipX(s.flipX).setOrigin(s.originX, s.originY);
    rim.setScale(s.scaleX, s.scaleY).setPosition(dir[0] * L.rimOffset, dir[1] * L.rimOffset).setAlpha(L.rimAlpha * strength);
    // Перевёрнутая вниз фигурка смотрит головой вниз (90°); поворот — к направлению тени (прочь от источника).
    shadow.setScale(s.scaleX, -s.scaleY * L.shadowLength).setRotation(Math.atan2(-dir[1], -dir[0]) - Math.PI / 2).setAlpha(L.shadowAlpha * strength);
    const tint = !this.walking ? (cfg.idleTint ?? L.idleTint) : (this.facing > 0) === (dir[0] > 0) ? (cfg.litTint ?? L.litTint) : (cfg.shadeTint ?? L.shadeTint);
    s.setTint(lerpColor(0xffffff, tint, strength));
  }
}

const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
/** Цвет между a и b (t = 0 — a, 1 — b), по каналам. */
function lerpColor(a: number, b: number, t: number): number {
  const ch = (sh: number) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
const cutKey = (m: Motion) => `${M[m].key}_cut`;
/** Найденные рамки и опоры кадров ходьбы и бега (на игру — один раз). */
const found: Partial<Record<Motion, Rect[]>> = {};

/** Поза стоя с листа героя добавляется один раз на игру. */
export function ensureHeroFrames(scene: Phaser.Scene): void {
  const tex = scene.textures.get(H.key);
  if (tex.has('idle')) return;
  tex.add('idle', 0, H.idle[0], H.idle[1], H.idle[2], H.idle[3]);
  tex.firstFrame = '__BASE'; // Phaser делает первый добавленный кадр кадром по умолчанию
}

/**
 * Кадры листа ходьбы или бега: фон вырезается (белый — заливкой от краёв ячейки, мягко по краю фигуры), в каждой ячейке —
 * рамка по непрозрачным пикселям и опора (низ ног; по x — середина головы, верхние 12% фигуры). Результат — холст-текстура
 * `<key>_cut` с кадрами `walk0…` / `run0…`.
 */
function motionFrames(scene: Phaser.Scene, m: Motion): Rect[] {
  if (found[m]) return found[m]!;
  const S = M[m];
  const key = cutKey(m);
  const src = scene.textures.get(S.key).getSourceImage() as HTMLImageElement;
  const W = src.width;
  const Hh = src.height;
  const t = scene.textures.exists(key) ? (scene.textures.get(key) as Phaser.Textures.CanvasTexture) : scene.textures.createCanvas(key, W, Hh)!;
  const c = t.getContext();
  c.clearRect(0, 0, W, Hh);
  c.drawImage(src, 0, 0);
  const img = c.getImageData(0, 0, W, Hh);
  const d = img.data;
  // Белый фон: заливка от краёв листа по почти белым непрозрачным пикселям (белое внутри фигуры — воротник — не трогается).
  const bright = (i: number) => d[i * 4 + 3] > 0 && Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) > 232;
  const bg = new Uint8Array(W * Hh);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (Hh - 1) * W + x);
  for (let y = 0; y < Hh; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (bg[i] || !(d[i * 4 + 3] < 16 || bright(i))) continue;
    bg[i] = 1;
    const x = i % W;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (i >= W) stack.push(i - W);
    if (i < W * (Hh - 1)) stack.push(i + W);
  }
  for (let i = 0; i < W * Hh; i++) {
    if (bg[i]) d[i * 4 + 3] = 0;
    else if (d[i * 4 + 3] > 0) {
      // Край фигуры на белом: светлые пиксели рядом с фоном — полупрозрачные, без белой каймы.
      const x = i % W;
      const nearBg = (x > 0 && bg[i - 1]) || (x < W - 1 && bg[i + 1]) || (i >= W && bg[i - W]) || (i < W * (Hh - 1) && bg[i + W]);
      if (nearBg) {
        const lum = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
        if (lum > 150) d[i * 4 + 3] = Math.round(d[i * 4 + 3] * (1 - (lum - 150) / 105) * 0.9);
      }
    }
  }
  c.putImageData(img, 0, 0);
  t.refresh();
  // Рамки и опоры по ячейкам.
  const cw = W / S.cols;
  const ch = Hh / S.rows;
  const rects: Rect[] = [];
  for (let n = 0; n < S.count; n++) {
    const cx0 = Math.round((n % S.cols) * cw);
    const cy0 = Math.round(Math.floor(n / S.cols) * ch);
    const cx1 = Math.round(cx0 + cw);
    const cy1 = Math.round(cy0 + ch);
    let x0 = cx1, y0 = cy1, x1 = cx0, y1 = cy0;
    for (let y = cy0; y < cy1; y++)
      for (let x = cx0; x < cx1; x++)
        if (d[(y * W + x) * 4 + 3] > 40) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    // Середина головы: средний x непрозрачных пикселей в верхних 12% фигуры.
    const headBottom = y0 + Math.max(4, Math.round((y1 - y0) * 0.12));
    let sx = 0, sn = 0;
    for (let y = y0; y <= headBottom; y++)
      for (let x = x0; x <= x1; x++)
        if (d[(y * W + x) * 4 + 3] > 40) {
          sx += x;
          sn++;
        }
    const px = sn ? sx / sn : (x0 + x1) / 2;
    const r: Rect = [x0, y0, x1 - x0 + 1, y1 - y0 + 1, px, y1 + 1];
    rects.push(r);
    if (!t.has(`${m}${n}`)) t.add(`${m}${n}`, 0, r[0], r[1], r[2], r[3]);
  }
  t.firstFrame = '__BASE';
  found[m] = rects;
  return rects;
}
