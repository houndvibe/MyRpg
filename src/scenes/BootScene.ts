// Загрузка арта: портреты врагов, подложка карты, здания, анимация таверны, лист героя, окно взаимодействия (ключи и пути — assets.ts).
// Нет файла — портрет заменяет серая плашка с именем (рисуется там, где портрет нужен).
import * as Phaser from 'phaser';
import { MUSIC, PLACE_IMAGES, PLACE_SIDEBAR, placeKey, CARRIAGE_SHEET, HERO_BAG, DIALOG_BACKGROUNDS, DIALOG_LAYOUT, enemyKey, enemyPortraitPath, HERO_SHEET, itemImagePath, itemKey, MAP_LAYOUT, NPC_PORTRAITS } from '../config/assets';
import { ENEMY_IDS } from '../data/enemies';
import { ITEM_IDS } from '../data/items';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.setPath('assets/');
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (f: Phaser.Loader.File) => console.warn(`[assets] нет файла ${f.src}`));
    for (const id of ENEMY_IDS) this.load.image(enemyKey(id), enemyPortraitPath(id));
    for (const id of ITEM_IDS) this.load.image(itemKey(id), itemImagePath(id));
    for (const v of [...Object.values(MAP_LAYOUT.locations), MAP_LAYOUT.world]) this.load.image(v.key, v.path);
    this.load.image(HERO_SHEET.key, HERO_SHEET.path);
    this.load.image(MAP_LAYOUT.portrait.key, MAP_LAYOUT.portrait.path);
    for (const b of MAP_LAYOUT.portraitBars) this.load.image(b.key, b.path);
    this.load.image(CARRIAGE_SHEET.key, CARRIAGE_SHEET.path);
    this.load.image(PLACE_SIDEBAR.panel.key, PLACE_SIDEBAR.panel.path);
    for (const t of Object.values(MUSIC)) this.load.audio(t.key, t.path);
    for (const id of PLACE_IMAGES) this.load.image(placeKey(id), `places/${id}.webp`);
    this.load.image(HERO_BAG.key, HERO_BAG.path);
    this.load.image(DIALOG_LAYOUT.heroPortrait.anim.key, DIALOG_LAYOUT.heroPortrait.anim.path);
    this.load.image(DIALOG_LAYOUT.frame.key, DIALOG_LAYOUT.frame.path);
    for (const p of Object.values(NPC_PORTRAITS)) this.load.image(p.anim.key, p.anim.path);
    for (const b of Object.values(DIALOG_BACKGROUNDS)) this.load.image(b.key, b.path);
  }

  create(): void {
    this.scene.start('Menu');
  }
}
