// Меню паузы на карте (Esc): затемнение экрана, панель с заголовком и кнопками «Настройки», «Показывать обучение» и «Выход».
// «Показывать обучение» — переключатель (run.showTutorials), остальные кнопки пока ничего не делают. Закреплено на экране; сцена рисует его камерой интерфейса.
// Раскладка — MAP_LAYOUT.pause (assets.ts), время и затемнение — FEEL.pause.
import * as Phaser from 'phaser';
import { MAP_LAYOUT } from '../config/assets';
import { FEEL } from '../config/feel';
import { run } from '../state';
import { addText, Button, C, H, W } from '../ui';

export class PauseMenu {
  private root: Phaser.GameObjects.Container;

  constructor(private scene: Phaser.Scene, depth = 40) {
    const P = MAP_LAYOUT.pause;
    const F = FEEL.pause;
    // Затемнение ловит клики — карта под ним их не получает.
    const dim = scene.add.rectangle(0, 0, W, H, 0x000000, F.dimAlpha).setOrigin(0).setInteractive();
    const panel = scene.add.rectangle(P.panel.x, P.panel.y, P.panel.w, P.panel.h, C.panel, 0.97).setStrokeStyle(3, 0xe0b65a, 0.9);
    const title = addText(scene, P.panel.x, P.title.y, 'Пауза', 44, C.accent).setOrigin(0.5);
    const B = P.buttons;
    const at = (i: number) => B.y + i * (B.h + B.gap);
    const tutLabel = () => `Показывать обучение: ${run.showTutorials ? 'да' : 'нет'}`;
    const tut: Button = new Button(scene, P.panel.x, at(1), B.w, B.h, tutLabel(), () => {
      run.showTutorials = !run.showTutorials;
      tut.setLabel(tutLabel()).setSelected(run.showTutorials);
    }, 26).setSelected(run.showTutorials);
    const buttons = [new Button(scene, P.panel.x, at(0), B.w, B.h, 'Настройки', () => {}, 26), tut, new Button(scene, P.panel.x, at(2), B.w, B.h, 'Выход', () => {}, 26)];
    this.root = scene.add.container(0, 0, [dim, panel, title, ...buttons]).setScrollFactor(0).setDepth(depth).setAlpha(0);
    scene.tweens.add({ targets: this.root, alpha: 1, duration: F.fadeMs });
  }

  /** Убрать меню (с коротким затуханием). */
  close(): void {
    const root = this.root;
    root.each((o: Phaser.GameObjects.GameObject) => o.disableInteractive());
    this.scene.tweens.add({ targets: root, alpha: 0, duration: FEEL.pause.fadeMs, onComplete: () => root.destroy() });
  }
}
