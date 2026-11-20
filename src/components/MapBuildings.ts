// Здания на точках карты: нарезка листа MAP_BUILDINGS (assets.ts), анимация таверны по кругу,
// подсветка при наведении (копия здания с ADD поверх — без фильтров) и попадание мышью по непрозрачным пикселям.
import * as Phaser from 'phaser';
import { MAP_BUILDINGS as B } from '../config/assets';
import { FEEL } from '../config/feel';
import { poisOf, POIS, type LocationId, type PoiId } from '../data/map';

const INN_ANIM = 'map_inn_idle';

interface Building {
  id: PoiId;
  /** Само здание и его светлая копия для подсветки. */
  img: Phaser.GameObjects.Sprite;
  glow: Phaser.GameObjects.Sprite;
  baseScale: number;
}

export class MapBuildings {
  private list: Building[] = [];

  /** Здания точек локации loc (у кого есть запись в MAP_BUILDINGS.place); k — увеличение подложки. */
  constructor(private scene: Phaser.Scene, loc: LocationId, k: number) {
    this.ensureFrames();
    for (const id of poisOf(loc)) {
      const place = B.place[id];
      if (!place) continue;
      const anim = id === 'inn';
      const key = anim ? B.innAnim.key : B.sheet.key;
      const frame = anim ? 0 : id;
      const contentW = anim ? B.innAnim.contentW : B.frames[id]![2];
      const originY = anim ? B.innAnim.bottom / B.innAnim.frameH : 1;
      const x = (POIS[id].x + place.dx) * k;
      const y = (POIS[id].y + place.dy) * k;
      const scale = (place.width * k) / contentW;
      const img = scene.add.sprite(x, y, key, frame).setOrigin(0.5, originY).setScale(scale).setDepth(4.5);
      const glow = scene.add.sprite(x, y, key, frame).setOrigin(0.5, originY).setScale(scale).setDepth(4.51)
        .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      if (anim) {
        img.play(INN_ANIM);
        img.on(Phaser.Animations.Events.ANIMATION_UPDATE, (_a: unknown, f: Phaser.Animations.AnimationFrame) => glow.setFrame(f.textureFrame));
      }
      this.list.push({ id, img, glow, baseScale: scale });
    }
  }

  /** Кадры зданий на листе и анимация таверны создаются один раз на игру. */
  private ensureFrames(): void {
    const tex = this.scene.textures.get(B.sheet.key);
    if (!tex.has('mine')) {
      for (const [id, [x, y, w, h]] of Object.entries(B.frames)) tex.add(id, 0, x, y, w, h);
      tex.firstFrame = '__BASE'; // Phaser делает первый добавленный кадр кадром по умолчанию
    }
    if (!this.scene.anims.exists(INN_ANIM)) {
      this.scene.anims.create({
        key: INN_ANIM,
        frames: this.scene.anims.generateFrameNumbers(B.innAnim.key, { start: 0, end: B.innAnim.frames - 1 }),
        frameRate: B.innAnim.fps,
        repeat: -1,
      });
    }
  }

  /** Здание под точкой мира (по непрозрачному пикселю), верхнее — если перекрываются. */
  at(wx: number, wy: number): PoiId | null {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const { id, img } = this.list[i];
      const f = img.frame;
      const lx = (wx - img.x) / img.scaleX + img.originX * f.width;
      const ly = (wy - img.y) / img.scaleY + img.originY * f.height;
      if (lx < 0 || ly < 0 || lx >= f.width || ly >= f.height) continue;
      if (this.scene.textures.getPixelAlpha(Math.floor(lx), Math.floor(ly), img.texture.key, f.name) > 40) return id;
    }
    return null;
  }

  /** Верх здания точки в мировых px (для подписи) или null, если здания нет. */
  top(id: PoiId): number | null {
    const b = this.list.find((x) => x.id === id);
    return b ? b.img.y - b.img.displayHeight * b.img.originY : null;
  }

  /** Подсветка здания при наведении: светлее и чуть больше. */
  setHover(id: PoiId | null): void {
    const H = FEEL.map.buildingHover;
    for (const b of this.list) {
      const on = b.id === id;
      this.scene.tweens.killTweensOf([b.img, b.glow]);
      this.scene.tweens.add({ targets: [b.img, b.glow], scale: b.baseScale * (on ? H.scale : 1), duration: H.ms, ease: 'Sine.easeOut' });
      this.scene.tweens.add({ targets: b.glow, alpha: on ? H.brighten : 0, duration: H.ms });
    }
  }
}
