// Анимированный портрет (раскадровка PortraitAnim из assets.ts): один проход со скоростью FEEL.dialog.portraitAnim.fps,
// потом пауза на первом кадре (случайно в диапазоне holdMs). Общий для окна разговора и боя с собеседником.
import * as Phaser from 'phaser';
import type { PortraitAnim } from '../config/assets';
import { FEEL } from '../config/feel';

export class PortraitPlayer {
  private t = 0;
  private hold: number;
  private count: number;

  /** Портрет низом в (x, y), вписан по высоте h; первая пауза случайная, чтобы двое не моргали разом. */
  constructor(scene: Phaser.Scene, anim: PortraitAnim, x: number, y: number, h: number, readonly img = scene.add.image(x, y, ensurePortraitFrames(scene, anim), 'p0')) {
    this.count = anim.cols * anim.rows;
    img.setOrigin(0.5, 1).setScale(h / anim.frameH);
    const Pa = FEEL.dialog.portraitAnim;
    this.hold = Phaser.Math.Between(Pa.holdMs[0] / 2, Pa.holdMs[1]);
  }

  update(deltaMs: number): void {
    if (this.hold > 0) {
      this.hold -= deltaMs;
      return;
    }
    const Pa = FEEL.dialog.portraitAnim;
    this.t += deltaMs;
    const i = Math.floor((this.t * Pa.fps) / 1000);
    if (i >= this.count) {
      this.t = 0;
      this.hold = Phaser.Math.Between(Pa.holdMs[0], Pa.holdMs[1]);
      this.img.setFrame('p0');
    } else this.img.setFrame(`p${i}`);
  }
}

/**
 * Кадры раскадровки портрета (p0…pN) — один раз на игру. С fade лист копируется на холст и края каждого кадра
 * плавно уходят в прозрачность; возвращает ключ текстуры, из которой брать кадры.
 */
export function ensurePortraitFrames(scene: Phaser.Scene, anim: PortraitAnim): string {
  const key = anim.fade > 0 ? `${anim.key}_soft` : anim.key;
  if (scene.textures.exists(key) && scene.textures.get(key).has('p0')) return key;
  const src = scene.textures.get(anim.key).getSourceImage() as HTMLImageElement;
  const cw = src.width / anim.cols;
  const ch = src.height / anim.rows;
  if (anim.fade > 0) {
    const t = scene.textures.createCanvas(key, src.width, src.height)!;
    const c = t.getContext();
    c.drawImage(src, 0, 0);
    c.globalCompositeOperation = 'destination-out';
    for (let col = 0; col < anim.cols; col++) {
      const x0 = col * cw;
      const left = c.createLinearGradient(x0, 0, x0 + anim.fade, 0);
      left.addColorStop(0, 'rgba(0,0,0,1)');
      left.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = left;
      c.fillRect(x0, 0, anim.fade, src.height);
      const x1 = x0 + cw;
      const right = c.createLinearGradient(x1, 0, x1 - anim.fade, 0);
      right.addColorStop(0, 'rgba(0,0,0,1)');
      right.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = right;
      c.fillRect(x1 - anim.fade, 0, anim.fade, src.height);
    }
    t.refresh();
  }
  const tex = scene.textures.get(key);
  for (let i = 0; i < anim.cols * anim.rows; i++) {
    const x = Math.round((i % anim.cols) * cw);
    const y = Math.round(Math.floor(i / anim.cols) * ch);
    tex.add(`p${i}`, 0, x, y, Math.floor(cw), anim.frameH);
  }
  tex.firstFrame = '__BASE';
  return key;
}
