// Карета героя на карте мира — миниатюра на подставке с листа CARRIAGE_SHEET (assets.ts): 8 кадров езды лицом вправо.
// Стоит — первый кадр; едет — кадры по кругу, влево — зеркально. У каждого кадра своя опора (центр подставки) —
// кадры нарисованы с небольшим разбросом, без поправки карета подрагивала бы. Тот же интерфейс, что у MapHero.
import * as Phaser from 'phaser';
import { CARRIAGE_SHEET as S } from '../config/assets';
import { FEEL } from '../config/feel';

export class MapCarriage {
  readonly sprite: Phaser.GameObjects.Sprite;
  private walking = false;
  private facing = 1;
  private walkTime = 0;
  private scale: number;

  /** widthPx — ширина кареты с подставкой в px мира. */
  constructor(scene: Phaser.Scene, widthPx: number) {
    ensureCarriageFrames(scene);
    this.scale = widthPx / S.contentW;
    this.sprite = scene.add.sprite(0, 0, S.key, 'c0');
    this.show(0);
  }

  setWalking(on: boolean): void {
    if (on === this.walking) return;
    this.walking = on;
    this.walkTime = 0;
    this.show(0);
  }

  /** Каждый кадр: в пути — кадр езды по времени; dx — сдвиг по горизонтали за кадр (куда смотреть). */
  update(deltaMs: number, dx: number): void {
    if (!this.walking) return;
    if (Math.abs(dx) > 0.01) this.facing = dx < 0 ? -1 : 1;
    this.walkTime += deltaMs / 1000;
    this.show(Math.floor(this.walkTime * FEEL.world.carriage.fps) % S.pivots.length);
  }

  /** Кадр с опорой в центре подставки; при зеркале опора отражается тоже. */
  private show(i: number): void {
    const [px, py] = S.pivots[i];
    const flip = this.facing < 0;
    const ox = px / S.cell;
    this.sprite.setFrame(`c${i}`).setFlipX(flip).setOrigin(flip ? 1 - ox : ox, py / S.cell).setScale(this.scale);
  }
}

/** Кадры листа кареты (ячейки cell × cell, слева направо, сверху вниз) — один раз на игру. */
function ensureCarriageFrames(scene: Phaser.Scene): void {
  const tex = scene.textures.get(S.key);
  if (tex.has('c0')) return;
  S.pivots.forEach((_, i) => tex.add(`c${i}`, 0, (i % S.cols) * S.cell, Math.floor(i / S.cols) * S.cell, S.cell, S.cell));
  tex.firstFrame = '__BASE';
}
