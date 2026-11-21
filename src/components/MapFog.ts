// Туман войны на карте локации: тёмная пелена с облаками поверх нераскрытой карты. Где герой был, пелена стёрта мягкой
// кистью (места — run.revealed, пиксели подложки). Пелена — RenderTexture в уменьшенном разрешении (FEEL.map.fogOfWar.resolution),
// растянутая на весь мир карты: края получаются мягкими сами.
import * as Phaser from 'phaser';
import { FEEL } from '../config/feel';
import { FX_SOFT } from './MapAmbience';

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

  /** Место открыто настолько, что видна метка и по дороге можно кликнуть (пиксели подложки). */
  isOpen(x: number, y: number): boolean {
    const r = this.radius * FEEL.map.fogOfWar.visible;
    return this.points.some(([px, py]) => Math.hypot(px - x, py - y) <= r);
  }
}
