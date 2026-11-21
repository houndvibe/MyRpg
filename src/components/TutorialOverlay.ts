// Пошаговое обучение поверх экрана: всё затемнено, кроме подсвеченной области (прямоугольник с пульсирующей золотой
// рамкой), рядом — панель подсказки с текстом и кнопкой «Далее» (или пробел / Enter). Шаг без кнопки ждёт действия
// игрока — его отслеживает тот, кто показывает обучение. Затемнение не ловит клики: под ним игра получает ввод как обычно.
// Время и цвета — FEEL.tutorial, раскладка подсказки — MAP_LAYOUT.tutorialTip. Создавать, пока сцена строит интерфейс.
import * as Phaser from 'phaser';
import { MAP_LAYOUT } from '../config/assets';
import { FEEL } from '../config/feel';
import { addText, Button, C, H, W } from '../ui';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class TutorialOverlay {
  private dims: Phaser.GameObjects.Rectangle[];
  private frame: Phaser.GameObjects.Rectangle;
  private panel: Phaser.GameObjects.Rectangle;
  private text: Phaser.GameObjects.Text;
  private button: Button | null = null;
  private onNext: (() => void) | null = null;
  private readonly onKey = (e: KeyboardEvent) => {
    if ((e.code === 'Space' || e.code === 'Enter') && this.onNext) {
      e.preventDefault();
      this.onNext();
    }
  };

  constructor(private scene: Phaser.Scene, private depth: number) {
    const F = FEEL.tutorial;
    this.dims = [0, 1, 2, 3].map(() => scene.add.rectangle(0, 0, 1, 1, 0x000000, F.dim).setOrigin(0).setDepth(depth));
    this.frame = scene.add.rectangle(0, 0, 1, 1).setOrigin(0).setStrokeStyle(3, F.frame, 1).setDepth(depth);
    scene.tweens.add({ targets: this.frame, alpha: 0.35, duration: F.pulseMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.panel = scene.add.rectangle(0, 0, 1, 1, C.panel, 0.97).setOrigin(0).setStrokeStyle(2, F.frame).setDepth(depth + 1);
    const T = MAP_LAYOUT.tutorialTip;
    this.text = addText(scene, 0, 0, '', 22, C.text, { wordWrap: { width: T.w - T.pad * 2 }, lineSpacing: 6 }).setDepth(depth + 2);
    window.addEventListener('keydown', this.onKey);
  }

  /**
   * Показать шаг: подсветить area (null — затемнено всё), рядом текст; button — подпись кнопки (null — шаг ждёт действия
   * игрока, кнопки нет), onNext — что делать по кнопке.
   */
  show(area: Rect | null, text: string, button: string | null, onNext: (() => void) | null): void {
    const F = FEEL.tutorial;
    const T = MAP_LAYOUT.tutorialTip;
    // Затемнение — четыре прямоугольника вокруг проёма.
    const a = area ? { x: area.x - F.pad, y: area.y - F.pad, w: area.w + F.pad * 2, h: area.h + F.pad * 2 } : { x: W / 2, y: H / 2, w: 0, h: 0 };
    const [top, bottom, left, right] = this.dims;
    top.setPosition(0, 0).setSize(W, Math.max(0, a.y));
    bottom.setPosition(0, a.y + a.h).setSize(W, Math.max(0, H - a.y - a.h));
    left.setPosition(0, a.y).setSize(Math.max(0, a.x), a.h);
    right.setPosition(a.x + a.w, a.y).setSize(Math.max(0, W - a.x - a.w), a.h);
    this.frame.setVisible(!!area).setPosition(a.x, a.y).setSize(a.w, a.h);
    // Подсказка: справа от проёма, если помещается, иначе слева; без проёма — по центру экрана.
    this.text.setText(text);
    this.button?.destroy();
    this.button = null;
    const bh = button ? T.button.h + T.pad : 0;
    const ph = this.text.height + T.pad * 2 + bh;
    let px = W / 2 - T.w / 2;
    let py = H / 2 - ph / 2;
    if (area) {
      px = a.x + a.w + T.gap + T.w <= W - 20 ? a.x + a.w + T.gap : Math.max(20, a.x - T.gap - T.w);
      py = Phaser.Math.Clamp(a.y + a.h / 2 - ph / 2, 20, H - ph - 20);
    }
    this.panel.setPosition(px, py).setSize(T.w, ph);
    this.text.setPosition(px + T.pad, py + T.pad);
    this.onNext = button ? onNext : null;
    if (button && onNext) {
      this.button = new Button(this.scene, px + T.w - T.pad - T.button.w / 2, py + ph - T.pad - T.button.h / 2, T.button.w, T.button.h, `${button} ▸`, onNext, 22);
      this.button.setDepth(this.depth + 2);
    }
    for (const o of [this.panel, this.text, ...(this.button ? [this.button] : [])]) {
      o.setAlpha(0);
      this.scene.tweens.add({ targets: o, alpha: 1, duration: F.fadeMs });
    }
  }

  /** Сменить только текст (шаг тот же, например «сначала зажмите букву»). */
  setText(text: string): void {
    const T = MAP_LAYOUT.tutorialTip;
    this.text.setText(text);
    this.panel.setSize(T.w, this.text.height + T.pad * 2 + (this.button ? T.button.h + T.pad : 0));
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey);
    this.scene.tweens.killTweensOf(this.frame);
    for (const o of [...this.dims, this.frame, this.panel, this.text]) o.destroy();
    this.button?.destroy();
  }
}
