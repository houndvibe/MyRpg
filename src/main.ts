import * as Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { BootScene } from './scenes/BootScene';
import { MainScene } from './scenes/MainScene';
import { H, W } from './ui';

new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  backgroundColor: '#14121a',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W, height: H },
  // В Phaser 3 округление координат было включено по умолчанию, в Phaser 4 — нет; без него мелкий текст мылится.
  roundPixels: true,
  disableContextMenu: true,
  // Boot (портреты врагов) → Main (инвентарь, выбор врага) ⇄ Battle.
  scene: [BootScene, MainScene, BattleScene],
});
