// Заслоны на карте локации — здания и деревья, за которыми герой может пройти (MapView.occluders, assets.ts).
// Каждый заслон вырезается из подложки по контуру (деревья — ещё и без пикселей тумана вокруг) и кладётся поверх карты
// на то же место. Глубина заслона — по его основанию (ниже на карте — ближе к зрителю); герой рядом с заслонами
// встаёт в тот же ряд глубин по своим ногам, поэтому за деревом скрыт, перед ним — поверх. Там, где заслон закрывает
// героя, поверх виден его золотой силуэт. Задетое дерево качается от героя, с лиственных падают листья.
// Глубины, силуэт, качание, листья — FEEL.map.occluders / silhouette / sway / leaves.
import * as Phaser from 'phaser';
import type { MapOccluder } from '../config/assets';
import { FEEL } from '../config/feel';
import { FX_SOFT } from './MapAmbience';
import type { FogShape } from './MapFog';

interface Occ {
  def: MapOccluder;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Опора — вокруг неё качается (основание ствола), пиксели подложки. */
  px: number;
  py: number;
  image: Phaser.GameObjects.Image;
  silhouette: Phaser.GameObjects.RenderTexture;
  outside: Phaser.GameObjects.Image;
  fade: number;
  depth: number;
  /** Качание: время с толчка (мс), направление (+1 — от героя вправо), когда можно снова. */
  swayT: number;
  swayDir: number;
  swayReadyAt: number;
  /** Подсветка под мышью (только у заслонов с hover): копия здания сложением; glow — её видимость 0…1. */
  glowImage: Phaser.GameObjects.Image | null;
  glow: number;
}

export class MapOccluders {
  private list: Occ[] = [];
  private silSprite: Phaser.GameObjects.Sprite | null = null;
  private leaves: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private clock = 0;
  /** Заслон под мышью (номер) или −1. */
  private hovered = -1;

  /** k — масштаб карты (px мира на px подложки), mapKey — подложка, mapH — её высота (для ряда глубин). */
  constructor(private scene: Phaser.Scene, private k: number, private mapKey: string, private mapH: number, defs: MapOccluder[]) {
    defs.forEach((d, i) => {
      this.list.push(this.build(d, i));
      if (d.trunk) this.trunks.push({ ...d.trunk, i });
    });
    if (defs.some((d) => d.leaves !== undefined)) {
      const L = FEEL.map.leaves;
      this.leaves = scene.add.particles(0, 0, FX_SOFT, {
        emitting: false,
        lifespan: { min: L.lifeMs[0], max: L.lifeMs[1] },
        speedX: { min: -L.drift, max: L.drift },
        speedY: { min: 4, max: 14 },
        gravityY: L.gravity,
        scaleX: { min: L.size[0], max: L.size[1] },
        scaleY: { min: L.size[0] * 0.6, max: L.size[1] * 0.6 },
        rotate: { min: 0, max: 360 },
        alpha: { start: 1, end: 0, ease: 'Quad.easeIn' },
      });
    }
  }

  /** Контур заслона i для тумана: текстура выреза и её рамка (пиксели подложки). */
  shapeOf(i: number): FogShape | null {
    const o = this.list[i];
    return o ? { key: o.image.texture.key, x0: o.x0, y0: o.y0, w: o.x1 - o.x0, h: o.y1 - o.y0 } : null;
  }

  /**
   * Мышь над точкой карты (x, y — пиксели подложки; null — не над картой): подсвечивается заслон с hover, если точка — на нём
   * (по непрозрачным пикселям выреза) и он открыт (isOpen — открыт ли из-под тумана войны). true — мышь над таким заслоном.
   */
  hoverAt(p: { x: number; y: number } | null, isOpen: (x: number, y: number) => boolean): boolean {
    this.hovered = -1;
    if (p)
      this.list.forEach((o, i) => {
        if (this.hovered >= 0 || !o.def.hover || p.x < o.x0 || p.x >= o.x1 || p.y < o.y0 || p.y >= o.y1) return;
        if (!isOpen((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2)) return;
        if (this.scene.textures.getPixelAlpha(Math.floor(p.x - o.x0), Math.floor(p.y - o.y0), o.image.texture.key) > 40) this.hovered = i;
      });
    return this.hovered >= 0;
  }

  /** Точка заслона под мышью (MapOccluder.poi) — клик ведёт туда; null — мышь не над таким заслоном. */
  get hoveredPoi(): string | null {
    return this.hovered >= 0 ? (this.list[this.hovered].def.poi ?? null) : null;
  }

  /** Есть ли заслоны на карте. */
  get any(): boolean {
    return this.list.length > 0;
  }

  /** Стволы деревьев — препятствия (пиксели подложки). i — номер заслона (для качания). */
  readonly trunks: { x: number; y: number; r: number; i: number }[] = [];

  /** Глубина в ряду заслонов по y основания (пиксели подложки): ниже на карте — больше. */
  depthAt(y: number): number {
    const D = FEEL.map.occluders;
    return D.band[0] + (D.band[1] - D.band[0]) * Phaser.Math.Clamp(y / this.mapH, 0, 1);
  }

  /** Толкнули дерево i (герой в точке heroX): качнётся от героя, если не качалось только что. */
  shake(i: number, heroX: number): void {
    const o = this.list[i];
    if (!o || this.clock < o.swayReadyAt) return;
    const S = FEEL.map.sway;
    o.swayT = 0;
    o.swayDir = heroX <= o.px ? 1 : -1;
    o.swayReadyAt = this.clock + S.cooldownMs;
    if (o.def.leaves !== undefined && this.leaves) {
      const L = FEEL.map.leaves;
      this.leaves.setDepth(o.depth + 0.0002).setParticleTint(o.def.leaves);
      for (let n = 0; n < L.count; n++) {
        // Листья — из кроны (верхняя половина заслона).
        const x = Phaser.Math.FloatBetween(o.x0 + (o.x1 - o.x0) * 0.2, o.x1 - (o.x1 - o.x0) * 0.2) * this.k;
        const y = Phaser.Math.FloatBetween(o.y0, o.y0 + (o.py - o.y0) * 0.45) * this.k;
        this.leaves.emitParticleAt(x, y, 1);
      }
    }
  }

  /**
   * Каждый кадр: глубина героя (рядом с заслонами — по ногам в их ряду, иначе heroDepth), силуэт за заслонами, качание.
   * heroX/heroY — ноги героя (px мира), heroH — рост (px мира), sprite — кадр героя.
   */
  update(delta: number, hero: Phaser.GameObjects.Container, dust: Phaser.GameObjects.Particles.ParticleEmitter, heroH: number, sprite: Phaser.GameObjects.Sprite): void {
    if (!this.list.length) return;
    this.clock += delta;
    const k = this.k;
    const x = hero.x / k;
    const y = hero.y / k;
    const h = heroH / k;
    const D = FEEL.map.occluders;
    const S = FEEL.map.silhouette;
    const W = FEEL.map.sway;
    let near = false;
    for (const o of this.list) {
      // Качание: затухающие колебания вокруг основания.
      let angle = 0;
      if (o.swayT < W.ms) {
        o.swayT += delta;
        const t = Math.min(1, o.swayT / W.ms);
        angle = o.swayDir * Phaser.Math.DegToRad(W.angle) * Math.sin(t * Math.PI * 2 * W.cycles) * (1 - t) * (1 - t);
      }
      o.image.setRotation(angle);
      o.silhouette.setRotation(angle);
      if (o.glowImage) {
        const G = FEEL.map.hoverGlow;
        o.glow = Phaser.Math.Clamp(o.glow + (this.hovered === this.list.indexOf(o) ? 1 : -1) * (delta / G.fadeMs), 0, 1);
        o.glowImage.setRotation(angle).setAlpha(G.alpha * o.glow).setVisible(o.glow > 0);
      }
      // Герой рядом (его рамка задевает рамку заслона) — сортировка по глубине; за заслоном — выше основания.
      const overlap = x + D.heroHalfW > o.x0 && x - D.heroHalfW < o.x1 && y > o.y0 && y - h < o.y1;
      near ||= overlap;
      const behind = overlap && y < o.py;
      o.fade = Phaser.Math.Clamp(o.fade + (behind ? 1 : -1) * (delta / S.fadeMs), 0, 1);
      o.silhouette.setVisible(o.fade > 0);
      if (o.fade <= 0) continue;
      // Силуэт: кадр героя, залитый цветом, в системе заслона (повёрнутой вместе с ним); вне заслона — стёрт.
      const sil = (this.silSprite ??= new Phaser.GameObjects.Sprite(this.scene, 0, 0, sprite.texture.key).setTint(S.color).setTintMode(Phaser.TintModes.FILL));
      sil.setTexture(sprite.texture.key, sprite.frame.name).setFlipX(sprite.flipX).setOrigin(sprite.originX, sprite.originY).setScale(sprite.scaleX, sprite.scaleY).setRotation(-angle);
      const dx = hero.x - o.px * k;
      const dy = hero.y - o.py * k;
      const c = Math.cos(-angle);
      const s = Math.sin(-angle);
      o.silhouette.clear().draw(sil, (o.px - o.x0) * k + dx * c - dy * s, (o.py - o.y0) * k + dx * s + dy * c).erase(o.outside, 0, 0).render();
      o.silhouette.setAlpha(S.alpha * o.fade);
    }
    const depth = near ? this.depthAt(y) + 0.0001 : D.hero;
    hero.setDepth(depth);
    dust.setDepth(depth - 0.00005);
  }

  /** Заслон: вырезан из подложки по контуру (у деревьев — без тумана вокруг) в свою текстуру, один раз на игру. */
  private build(def: MapOccluder, i: number): Occ {
    const scene = this.scene;
    const k = this.k;
    const key = `${this.mapKey}_occluder${i}`;
    const xs = def.poly.map((p) => p[0]);
    const ys = def.poly.map((p) => p[1]);
    const x0 = Math.floor(Math.min(...xs));
    const y0 = Math.floor(Math.min(...ys));
    const x1 = Math.ceil(Math.max(...xs));
    const y1 = Math.ceil(Math.max(...ys));
    const w = x1 - x0;
    const h = y1 - y0;
    if (!scene.textures.exists(key)) {
      const src = scene.textures.get(this.mapKey).getSourceImage() as HTMLImageElement;
      const t = scene.textures.createCanvas(key, w, h)!;
      const c = t.getContext();
      c.beginPath();
      def.poly.forEach(([x, y], j) => (j ? c.lineTo(x - x0, y - y0) : c.moveTo(x - x0, y - y0)));
      c.closePath();
      c.clip();
      c.drawImage(src, -x0, -y0);
      if (def.trim) {
        // Без тумана: серо-голубые светлые пиксели вокруг дерева — прозрачные (дерево — тёмная хвоя, листва, кора);
        // у лиственных — всё, кроме листвы и коры.
        const img = c.getImageData(0, 0, w, h);
        const d = img.data;
        for (let p = 0; p < d.length; p += 4) {
          const r = d[p], g = d[p + 1], b = d[p + 2];
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          const lum = 0.3 * r + 0.59 * g + 0.11 * b;
          if (def.trim === 'leafy') {
            // Лиственное: только листва (красная, оранжевая) и светлая кора.
            const foliage = (r > 90 && r > 1.5 * g && r > 1.25 * b) || (r > 120 && g > 40 && g < 0.8 * r && b < 0.5 * r);
            const bark = lum > 95 && r >= b - 5 && mx - mn < 100;
            if (!foliage && !bark) d[p + 3] = 0;
          } else if (lum > FEEL.map.occluders.fogLum && (mx - mn) / (mx || 1) < 0.3 && b >= r - 8) d[p + 3] = 0;
        }
        c.putImageData(img, 0, 0);
      }
      t.refresh();
      // «Снаружи»: прямоугольник заслона минус сам заслон (по его прозрачности) — им силуэт стирается до формы заслона.
      const o = scene.textures.createCanvas(`${key}_outside`, w, h)!;
      const oc = o.getContext();
      oc.fillStyle = '#ffffff';
      oc.fillRect(0, 0, w, h);
      oc.globalCompositeOperation = 'destination-out';
      oc.drawImage(t.getSourceImage() as HTMLCanvasElement, 0, 0);
      o.refresh();
    }
    const px = def.pivot?.[0] ?? (x0 + x1) / 2;
    const py = def.baseY;
    const depth = this.depthAt(py);
    const ox = (px - x0) / w;
    const oy = (py - y0) / h;
    const image = scene.add.image(px * k, py * k, key).setOrigin(ox, oy).setScale(k).setDepth(depth);
    const silhouette = scene.add.renderTexture(px * k, py * k, Math.ceil(w * k), Math.ceil(h * k)).setOrigin(ox, oy).setDepth(depth + 0.0001).setVisible(false);
    const outside = new Phaser.GameObjects.Image(scene, 0, 0, `${key}_outside`).setOrigin(0).setScale(k);
    // Подсветка под мышью: та же картинка, залитая тёплым цветом, сложением — здание светлеет и теплеет.
    const G = FEEL.map.hoverGlow;
    const glowImage = def.hover ? scene.add.image(px * k, py * k, key).setOrigin(ox, oy).setScale(k).setDepth(depth + 0.00005).setTint(G.tint).setTintMode(Phaser.TintModes.FILL).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setVisible(false) : null;
    return { def, x0, y0, x1, y1, px, py, image, silhouette, outside, fade: 0, depth, swayT: Infinity, swayDir: 1, swayReadyAt: 0, glowImage, glow: 0 };
  }
}
