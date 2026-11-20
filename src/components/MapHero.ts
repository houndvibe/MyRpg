// Фигурка героя на карте — миниатюра на подставке с листа HERO_SHEET (assets.ts).
// Стоит — поза анфас и лёгкое «дыхание»; идёт — цикл ходьбы в профиль, влево — зеркально.
// Кадры ставятся центром подставки в точку героя (у каждого кадра своя опора), поэтому не прыгают.
import * as Phaser from 'phaser';
import { HERO_SHEET as H } from '../config/assets';
import { FEEL } from '../config/feel';

type Rect = readonly [number, number, number, number, number, number];

export class MapHero {
  readonly sprite: Phaser.GameObjects.Sprite;
  private walking = false;
  private facing = 1;
  private walkTime = 0;
  private idleTime = 0;
  private idleScale: number;
  private walkScale: number;

  /** heightPx — рост фигурки в px мира (на карте локации и на карте мира разный). */
  constructor(scene: Phaser.Scene, heightPx: number) {
    ensureHeroFrames(scene);
    const px = heightPx;
    this.idleScale = px / H.idle[3];
    this.walkScale = px / avg(H.walk.map((r) => r[3]));
    this.sprite = scene.add.sprite(0, 0, H.key, 'idle');
    this.showIdle();
  }

  /** Начал или закончил идти. */
  setWalking(on: boolean): void {
    if (on === this.walking) return;
    this.walking = on;
    this.walkTime = 0;
    if (on) this.showWalk(0);
    else this.showIdle();
  }

  /** Каждый кадр: на месте — дыхание, на ходу — кадр ходьбы по времени; dx — сдвиг героя за кадр по горизонтали. */
  update(deltaMs: number, dx: number): void {
    if (!this.walking) {
      // Дыхание: растяжение по высоте от подставки вверх, плавно туда и обратно.
      const B = FEEL.map.hero.breath;
      this.idleTime += deltaMs;
      const t = 0.5 - 0.5 * Math.cos((this.idleTime / B.periodMs) * Math.PI * 2);
      this.sprite.scaleY = this.idleScale * (1 + (B.scale - 1) * t);
      return;
    }
    if (Math.abs(dx) > 0.01) this.facing = dx < 0 ? -1 : 1;
    this.walkTime += deltaMs / 1000;
    this.showWalk(Math.floor(this.walkTime * FEEL.map.hero.walkFps) % H.walk.length);
  }

  private showIdle(): void {
    this.setFrame('idle', H.idle, this.idleScale, false);
    this.idleTime = 0;
  }

  private showWalk(i: number): void {
    this.setFrame(`walk${i}`, H.walk[i], this.walkScale, this.facing < 0);
  }

  /** Кадр с опорой в центре подставки; при зеркале опора отражается тоже. */
  private setFrame(name: string, r: Rect, scale: number, flip: boolean): void {
    const [x, y, w, h, pedX, pedY] = r;
    const ox = (pedX - x) / w;
    this.sprite.setFrame(name).setFlipX(flip).setOrigin(flip ? 1 - ox : ox, (pedY - y) / h).setScale(scale);
  }
}

const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

/** Кадры листа героя (поза, ходьба, портрет) добавляются один раз на игру. */
export function ensureHeroFrames(scene: Phaser.Scene): void {
  const tex = scene.textures.get(H.key);
  if (tex.has('idle')) return;
  tex.add('idle', 0, H.idle[0], H.idle[1], H.idle[2], H.idle[3]);
  H.walk.forEach((r, i) => tex.add(`walk${i}`, 0, r[0], r[1], r[2], r[3]));
  tex.add('portrait', 0, ...H.portrait);
  tex.firstFrame = '__BASE'; // Phaser делает первый добавленный кадр кадром по умолчанию
}
