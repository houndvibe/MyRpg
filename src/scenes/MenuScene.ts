// Главное меню: «Игровой режим» — карта, «Режим отладки» — экран инвентаря и боя.
import * as Phaser from 'phaser';
import { MENU_LAYOUT as L } from '../config/assets';
import { addText, Button, C, stopGameMusic } from '../ui';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    stopGameMusic(this);
    addText(this, L.title.x, L.title.y, 'MyRpg', 96, C.accent).setOrigin(0.5);
    addText(this, L.subtitle.x, L.subtitle.y, 'прототип', 26, C.dim).setOrigin(0.5);

    const b = L.buttons;
    new Button(this, b.x, b.y, b.w, b.h, 'Игровой режим', () => this.scene.start('Map', {}), 34);
    new Button(this, b.x, b.y + b.step, b.w, b.h, 'Режим отладки', () => this.scene.start('Main'), 34);
  }
}
