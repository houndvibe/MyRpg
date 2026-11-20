// Занавес облаков для перехода между картой локации и картой мира: мягкие пятна наплывают с краёв экрана и закрывают
// всё (под ними — сплошная заливка, чтобы не осталось просветов), потом расходятся. Закреплён на экране (scrollFactor 0);
// сцена рисует его камерой интерфейса. Числа — FEEL.transition.
import * as Phaser from 'phaser';
import { FEEL } from '../config/feel';
import { H, W } from '../ui';
import { ensureFxTextures, FX_SOFT } from './MapAmbience';

interface Blob {
  img: Phaser.GameObjects.Image;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
}

export class CloudCurtain {
  private blobs: Blob[] = [];
  private fill: Phaser.GameObjects.Rectangle;

  /** covered — создать уже закрытым (новая сцена после подъёма или спуска). */
  constructor(private scene: Phaser.Scene, covered: boolean, depth = 40) {
    ensureFxTextures(scene);
    const C = FEEL.transition.clouds;
    this.fill = scene.add.rectangle(0, 0, W, H, C.tints[0], covered ? 1 : 0).setOrigin(0).setScrollFactor(0).setDepth(depth);
    // Пятна сеткой 4×3 с разбросом — вместе закрывают экран; выезжают из-за краёв по лучу от центра.
    for (let i = 0; i < C.count; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4) % 3;
      const inX = ((col + 0.5) / 4) * W + Phaser.Math.Between(-140, 140);
      const inY = ((row + 0.5) / 3) * H + Phaser.Math.Between(-110, 110);
      const ang = Math.atan2(inY - H / 2, inX - W / 2) + Phaser.Math.FloatBetween(-0.3, 0.3);
      const far = W * 0.9;
      const size = Phaser.Math.Between(C.size[0], C.size[1]);
      const img = scene.add.image(covered ? inX : W / 2 + Math.cos(ang) * far, covered ? inY : H / 2 + Math.sin(ang) * far, FX_SOFT)
        .setDisplaySize(size, size * Phaser.Math.FloatBetween(0.6, 0.9)).setTint(C.tints[i % C.tints.length])
        .setAlpha(covered ? 1 : 0).setScrollFactor(0).setDepth(depth + 0.1 + (i % 3) * 0.01);
      this.blobs.push({ img, inX, inY, outX: W / 2 + Math.cos(ang) * far, outY: H / 2 + Math.sin(ang) * far });
    }
  }

  /** Облака сходятся за ms; в конце экран закрыт целиком. */
  close(ms: number, onDone?: () => void): void {
    for (const b of this.blobs) {
      this.scene.tweens.add({ targets: b.img, x: b.inX, y: b.inY, alpha: 1, duration: ms * Phaser.Math.FloatBetween(0.75, 1), ease: 'Sine.easeOut' });
    }
    this.scene.tweens.add({ targets: this.fill, fillAlpha: 1, delay: ms * 0.55, duration: ms * 0.45, onComplete: () => onDone?.() });
  }

  /** Облака расходятся за ms: сначала уходит заливка, потом пятна разъезжаются за края и тают. */
  open(ms: number, onDone?: () => void): void {
    this.scene.tweens.add({ targets: this.fill, fillAlpha: 0, duration: ms * 0.35 });
    let left = this.blobs.length;
    for (const b of this.blobs) {
      this.scene.tweens.add({
        targets: b.img,
        x: b.outX,
        y: b.outY,
        alpha: 0,
        delay: ms * 0.1 * Math.random(),
        duration: ms * Phaser.Math.FloatBetween(0.7, 0.9),
        ease: 'Sine.easeIn',
        onComplete: () => {
          if (--left === 0) onDone?.();
        },
      });
    }
  }
}
