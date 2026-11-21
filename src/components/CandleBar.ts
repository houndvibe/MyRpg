// Свеча у портрета на карте: сколько свечей осталось на ночь (run.candles). Полоса hud_bar_candle — готовая картинка
// свечи в рамке; сгоревшая часть сверху закрывается тёмной заливкой, огонёк (кодом) стоит на уровне воска и мерцает.
// Полная свеча — картинка как есть, со своим огоньком; ноль — свеча закрыта целиком, огонька нет. Над полосой — число,
// над портретом — золото героя (появляется вместе со свечой).
// Где на картинке воск — MAP_LAYOUT.candleWax, цвета и размеры — FEEL.map.candle.
import * as Phaser from 'phaser';
import { CANDLES_PER_NIGHT } from '../config/balance';
import { MAP_LAYOUT } from '../config/assets';
import { FEEL } from '../config/feel';
import { run } from '../state';
import { addText, C } from '../ui';
import { FX_SOFT } from './MapAmbience';

export class CandleBar {
  /** Всё, что рисует свеча (прячется вместе с портретом). */
  readonly objects: Phaser.GameObjects.GameObject[];
  private burnt: Phaser.GameObjects.Rectangle;
  private glow: Phaser.GameObjects.Image;
  private flame: Phaser.GameObjects.Ellipse;
  private count: Phaser.GameObjects.Text;
  /** Золото героя (run.gold) — над портретом. */
  private gold: Phaser.GameObjects.Text;

  /** bar — картинка полосы (origin 0.5 × 1, уже поставлена и отмасштабирована). */
  constructor(scene: Phaser.Scene, private bar: Phaser.GameObjects.Image) {
    const F = FEEL.map.candle;
    const Wx = MAP_LAYOUT.candleWax;
    const s = bar.scaleY;
    const left = bar.x - (bar.width / 2) * bar.scaleX + Wx.x * bar.scaleX;
    const depth = bar.depth + 0.1;
    this.burnt = scene.add.rectangle(left, this.y(Wx.flameTop), Wx.w * bar.scaleX, 0, F.burnt, F.burntAlpha).setOrigin(0).setDepth(depth);
    this.glow = scene.add.image(left + (Wx.w * bar.scaleX) / 2, 0, FX_SOFT).setTint(0xffa040).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.8).setDisplaySize(F.glow, F.glow).setDepth(depth);
    this.flame = scene.add.ellipse(this.glow.x, 0, F.flameW, F.flameH, 0xffd27a).setDepth(depth + 0.01);
    scene.tweens.add({ targets: this.flame, scaleY: 0.82, scaleX: 1.1, duration: F.flickerMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    scene.tweens.add({ targets: this.glow, alpha: 0.55, duration: F.flickerMs * 1.7, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const top = bar.y - bar.height * s;
    this.count = addText(scene, bar.x, top - Wx.countDy, '', 28, C.accent, { stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5, 1).setDepth(depth);
    const G = MAP_LAYOUT.gold;
    this.gold = addText(scene, G.x, G.y, '', 26, C.accent, { stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5, 1).setDepth(depth);
    this.objects = [this.burnt, this.glow, this.flame, this.count, this.gold];
    this.refresh();
  }

  /** Y экрана для строки картинки полосы. */
  private y(row: number): number {
    return this.bar.y - (this.bar.height - row) * this.bar.scaleY;
  }

  /** Перерисовать по run.candles. Полная свеча — по большему из «на ночь» и текущего (комфортная комната даёт +1). */
  refresh(): void {
    const Wx = MAP_LAYOUT.candleWax;
    const max = Math.max(CANDLES_PER_NIGHT, run.candles);
    const left = Math.max(0, run.candles) / max;
    const full = left >= 1;
    const level = this.y(Wx.waxTop + (Wx.bottom - Wx.waxTop) * (1 - left));
    this.burnt.setSize(this.burnt.width, full ? 0 : level - this.burnt.y);
    const lit = !full && run.candles > 0;
    this.glow.setVisible(lit).setY(level);
    this.flame.setVisible(lit).setY(level - FEEL.map.candle.flameH * 0.4);
    this.count.setText(String(run.candles));
    this.gold.setText(`Золото: ${run.gold}`);
  }

  /** Показать или спрятать свечу вместе с картинкой полосы (пока свечи не открыты — полосы-свечи нет совсем). */
  setVisible(on: boolean): void {
    this.bar.setVisible(on);
    for (const o of this.objects) (o as Phaser.GameObjects.Image).setVisible(on);
    if (on) this.refresh();
  }
}
