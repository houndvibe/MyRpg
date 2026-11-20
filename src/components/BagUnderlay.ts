// Подложка-сумка под инвентарём героя: картинка HERO_BAG (assets.ts) ставится так, что нарисованные на ней ячейки
// совпадают с игровой сеткой (у сетки тогда режим bare — без своих клеток). Масштаб по осям свой: ячейки на картинке
// не строго квадратные (разница ~3%, на глаз не видна).
import * as Phaser from 'phaser';
import { HERO_BAG as B } from '../config/assets';

/** Сумка под сеткой cols × rows клеток cell px с левым верхним углом (x, y). Глубина — под сеткой. */
export function addBagUnderlay(scene: Phaser.Scene, x: number, y: number, cell: number, cols: number, rows: number, depth = 0): Phaser.GameObjects.Image {
  const sx = (cols * cell) / B.grid.w;
  const sy = (rows * cell) / B.grid.h;
  return scene.add.image(x - B.grid.x * sx, y - B.grid.y * sy, B.key).setOrigin(0).setScale(sx, sy).setDepth(depth);
}
