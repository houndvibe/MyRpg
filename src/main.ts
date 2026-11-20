import * as Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { BootScene } from './scenes/BootScene';
import { MainScene } from './scenes/MainScene';
import { MapScene } from './scenes/MapScene';
import { MenuScene } from './scenes/MenuScene';
import * as state from './state';
import { H, W } from './ui';

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  backgroundColor: '#14121a',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W, height: H },
  // В Phaser 3 округление координат было включено по умолчанию, в Phaser 4 — нет; без него мелкий текст мылится.
  roundPixels: true,
  disableContextMenu: true,
  // Boot (арт) → Menu → Map (игровой режим) или Main (режим отладки: инвентарь, выбор врага) ⇄ Battle.
  scene: [BootScene, MenuScene, MapScene, MainScene, BattleScene],
});

/**
 * Отладочный доступ из консоли браузера — только в `npm run dev`, в сборку для игроков не попадает.
 *   __dev.game                    — экземпляр Phaser.Game (сцены: __dev.game.scene.getScene('Battle'));
 *   __dev.state                   — тот же модуль state.ts, что у игры (run, addItem, removeItem, setMain…);
 *   __dev.advance(seconds)        — прогнать игру вперёд кадрами по 1/60 с, даже когда вкладка скрыта и кадры не идут.
 *   __dev.fps()                   — текущий FPS игры (цель — 60 на обычном ноутбуке).
 */
if (import.meta.env.DEV) {
  let clock = performance.now();
  const advance = (seconds: number): void => {
    const frame = 1000 / 60;
    for (let i = 0; i < Math.round((seconds * 1000) / frame); i++) {
      clock += frame;
      game.step(clock, frame);
    }
  };
  (window as unknown as { __dev: unknown }).__dev = { game, state, advance, fps: () => Math.round(game.loop.actualFps) };
}
