// Загрузка: из всего арта Людъмака в прототипе только портреты врагов (ключи и пути — assets.ts).
// Нет файла — портрет заменяет серая плашка с именем (рисуется там, где портрет нужен).
import * as Phaser from 'phaser';
import { enemyKey, enemyPortraitPath } from '../config/assets';
import { ENEMY_IDS } from '../data/enemies';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.setPath('assets/');
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (f: Phaser.Loader.File) => console.warn(`[assets] нет файла ${f.src}`));
    for (const id of ENEMY_IDS) this.load.image(enemyKey(id), enemyPortraitPath(id));
  }

  create(): void {
    this.scene.start('Main');
  }
}
