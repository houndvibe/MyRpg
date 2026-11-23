// Туман войны на карте локации: тёмная пелена с облаками поверх нераскрытой карты. Где герой был, пелена стёрта мягкой
// кистью (места — run.revealed, пиксели подложки). Пелена — RenderTexture в уменьшенном разрешении (FEEL.map.fogOfWar.resolution),
// растянутая на весь мир карты: края получаются мягкими сами.
import * as Phaser from 'phaser';
import { FEEL } from '../config/feel';
import { FX_SOFT } from './MapAmbience';

/** Форма для стирания тумана: текстура (непрозрачное — стереть) и её рамка на подложке (пиксели подложки). */
export interface FogShape {
  key: string;
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export class MapFog {
  private rt: Phaser.GameObjects.RenderTexture;
  private brush: Phaser.GameObjects.Image;
  /** Пикселей пелены на пиксель подложки. */
  private s: number;

  /**
   * @param k масштаб карты (пиксели мира на пиксель подложки)
   * @param points где герой уже был — эти места сразу открыты
   * @param radius радиус кисти, пиксели подложки (у карты свой — MapView.fogRadius)
   */
  constructor(scene: Phaser.Scene, worldW: number, worldH: number, k: number, private points: [number, number][], private radius = FEEL.map.fogOfWar.radius) {
    const F = FEEL.map.fogOfWar;
    this.s = k * F.resolution;
    const w = Math.ceil(worldW * F.resolution);
    const h = Math.ceil(worldH * F.resolution);
    this.rt = scene.add.renderTexture(0, 0, w, h).setOrigin(0).setScale(1 / F.resolution).setDepth(4.8);
    this.rt.fill(F.color, F.alpha);
    // Облака — светлые мягкие пятна, разбросанные по пелене.
    for (let i = 0; i < F.clouds; i++) {
      const size = Phaser.Math.Between(F.cloudSize[0], F.cloudSize[1]) * F.resolution;
      this.rt.stamp(FX_SOFT, undefined, Math.random() * w, Math.random() * h, {
        scaleX: (size / 64) * Phaser.Math.FloatBetween(1, 1.8),
        scaleY: size / 64,
        tint: F.cloudTint,
        alpha: Phaser.Math.FloatBetween(F.cloudAlpha[0], F.cloudAlpha[1]),
      });
    }
    this.brush = new Phaser.GameObjects.Image(scene, 0, 0, FX_SOFT).setOrigin(0.5);
    const d = radius * 2 * this.s;
    this.brush.setDisplaySize(d, d);
    for (const [x, y] of points) this.stampAt(x, y);
    this.rt.render();
  }

  private stampAt(x: number, y: number): void {
    for (let i = 0; i < FEEL.map.fogOfWar.strength; i++) this.rt.erase(this.brush, x * this.s, y * this.s);
  }

  /**
   * Герой в точке (пиксели подложки): если отошёл от ближайшего открытого места дальше шага — открыть здесь.
   * true — открыли новое место (стоит обновить видимость меток).
   */
  reveal(x: number, y: number): boolean {
    const F = FEEL.map.fogOfWar;
    const step = Math.min(F.step, this.radius / 4); // узкая кисть — метки чаще, коридор без разрывов
    if (this.points.some(([px, py]) => Math.hypot(px - x, py - y) < step)) return false;
    this.points.push([x, y]);
    this.stampAt(x, y);
    this.rt.render();
    return true;
  }

  /**
   * Туман над местом (x, y, пиксели подложки) рассеивается кругом радиусом r за ms: кисть растёт от середины, пелена тает
   * понемногу каждый кадр. Место запоминается сеткой открытых точек (при следующем входе на карту оно сразу открыто).
   * false — место уже открыто так раньше, ничего не делали.
   */
  dissolve(scene: Phaser.Scene, x: number, y: number, r: number, ms: number, delayMs = 0, shape: FogShape | null = null): boolean {
    if (this.points.some(([px, py]) => px === x && py === y)) return false;
    if (shape) return this.dissolveShape(scene, x, y, shape, ms, delayMs);
    // Сетка открытых точек по кругу: шаг — полрадиуса кисти, чтобы при пересборке тумана круг открылся без дыр.
    const step = this.radius / 2;
    this.points.push([x, y]);
    for (let gy = -r; gy <= r; gy += step) for (let gx = -r; gx <= r; gx += step) if ((gx || gy) && Math.hypot(gx, gy) <= r - this.radius * 0.5) this.points.push([Math.round(x + gx), Math.round(y + gy)]);
    const brush = new Phaser.GameObjects.Image(scene, 0, 0, FX_SOFT).setOrigin(0.5);
    const p = { t: 0 };
    scene.tweens.add({
      targets: p,
      t: 1,
      delay: delayMs,
      duration: ms,
      ease: 'Sine.easeOut',
      onUpdate: (_tw, _target, _key, _v, _prev) => {
        // Кисть растёт с трети радиуса до полного (с запасом на мягкий край), каждый кадр стирает немного.
        const d = r * 2.4 * (0.35 + 0.65 * p.t) * this.s;
        brush.setDisplaySize(d, d).setAlpha(0.06 + 0.1 * p.t);
        this.rt.erase(brush, x * this.s, y * this.s);
        this.rt.render();
      },
      onComplete: () => {
        brush.setDisplaySize(r * 2.4 * this.s, r * 2.4 * this.s).setAlpha(1);
        this.rt.erase(brush, x * this.s, y * this.s);
        this.rt.render();
        brush.destroy();
      },
    });
    return true;
  }

  /**
   * Туман тает по форме (контур здания): форма понемногу стирается каждый кадр. Запоминается только середина места
   * (по ней при следующем входе на карту форма стирается сразу — stampShape).
   */
  private dissolveShape(scene: Phaser.Scene, x: number, y: number, shape: FogShape, ms: number, delayMs: number): boolean {
    this.points.push([x, y]);
    const brush = this.shapeBrush(scene, shape);
    const p = { t: 0 };
    scene.tweens.add({
      targets: p,
      t: 1,
      delay: delayMs,
      duration: ms,
      ease: 'Sine.easeOut',
      onUpdate: () => {
        brush.setAlpha(0.05 + 0.1 * p.t);
        this.rt.erase(brush, brush.getData('x'), brush.getData('y'));
        this.rt.render();
      },
      onComplete: () => {
        this.stampWith(brush);
        brush.destroy();
      },
    });
    return true;
  }

  /** Место с формой уже открыто раньше (его середина — среди открытых точек): стереть форму сразу. */
  stampShape(scene: Phaser.Scene, x: number, y: number, shape: FogShape): void {
    if (!this.points.some(([px, py]) => px === x && py === y)) return;
    const brush = this.shapeBrush(scene, shape);
    this.stampWith(brush);
    brush.destroy();
  }

  /** Кисть-форма в координатах пелены: по середине рамки, чуть шире самой формы (FEEL.map.focus.shapeMargin). */
  private shapeBrush(scene: Phaser.Scene, s: FogShape): Phaser.GameObjects.Image {
    const m = FEEL.map.focus.shapeMargin;
    // Кисть стоит в (0, 0): erase прибавляет переданное место к её собственному.
    const b = new Phaser.GameObjects.Image(scene, 0, 0, s.key).setOrigin(0.5).setDisplaySize(s.w * this.s * m, s.h * this.s * m);
    return b.setData('x', (s.x0 + s.w / 2) * this.s).setData('y', (s.y0 + s.h / 2) * this.s);
  }

  private stampWith(brush: Phaser.GameObjects.Image): void {
    brush.setAlpha(1);
    for (let i = 0; i < 3; i++) this.rt.erase(brush, brush.getData('x'), brush.getData('y'));
    this.rt.render();
  }

  /** Открытые места (пиксели подложки) — для мини-карты. */
  get openPoints(): [number, number][] {
    return this.points;
  }

  /** Место открыто настолько, что видна метка и по дороге можно кликнуть (пиксели подложки). */
  isOpen(x: number, y: number): boolean {
    const r = this.radius * FEEL.map.fogOfWar.visible;
    return this.points.some(([px, py]) => Math.hypot(px - x, py - y) <= r);
  }
}
