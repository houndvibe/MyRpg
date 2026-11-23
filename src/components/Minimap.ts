// Мини-карта локации (клавиша Tab): карта на пергаменте по центру экрана поверх игры (карта слегка просвечивает
// бумагой), игра при этом идёт.
// На ней тот же туман войны (те же открытые места, что у MapFog, и здания, открытые по контуру), открытые точки
// с названиями, пульсирующая точка героя, цель пути и маршрут. Мышь проходит насквозь — карта ничего не перехватывает.
// Раскладка — MAP_LAYOUT.minimap (assets.ts), прозрачность и размеры — FEEL.minimap. Сцена рисует её камерой интерфейса.
import * as Phaser from 'phaser';
import { MAP_LAYOUT } from '../config/assets';
import { FEEL } from '../config/feel';
import { addText, C, cutBlackBackground } from '../ui';
import { FX_SOFT } from './MapAmbience';
import type { FogShape } from './MapFog';

/** Точка карты для мини-карты: где (пиксели подложки) и название. */
export interface MinimapPoint {
  id: string;
  name: string;
  x: number;
  y: number;
}

export class Minimap {
  private root: Phaser.GameObjects.Container;
  /** Пелена тумана (вне экрана) и итог: подложка с пеленой поверх — одна картинка, она и полупрозрачна. */
  private fogRt: Phaser.GameObjects.RenderTexture;
  private comp: Phaser.GameObjects.RenderTexture;
  private bg: Phaser.GameObjects.Image;
  private brush: Phaser.GameObjects.Image;
  private route: Phaser.GameObjects.Graphics;
  private ring: Phaser.GameObjects.Arc;
  private hero: Phaser.GameObjects.Arc;
  private heroGlow: Phaser.GameObjects.Image;
  private marks: { p: MinimapPoint; dot: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text }[] = [];
  /** Пикселей мини-карты на пиксель подложки; левый верхний угол карты на экране. */
  private s: number;
  private x0: number;
  private y0: number;
  /** Сколько открытых мест было при последней перерисовке тумана (изменилось — перерисовать). */
  private drawnPoints = -1;
  private wanted = false;
  private clock = 0;

  /**
   * mapKey, mapW, mapH — подложка и её размер; fogRadius — радиус кисти тумана этой карты (пиксели подложки);
   * points — точки локации (подписи появятся, когда их место открыто).
   */
  constructor(private scene: Phaser.Scene, mapKey: string, mapW: number, mapH: number, fogRadius: number, points: MinimapPoint[]) {
    const L = MAP_LAYOUT.minimap;
    const F = FEEL.minimap;
    this.s = L.h / mapH;
    const w = mapW * this.s;
    const h = L.h;
    this.x0 = L.x - w / 2;
    this.y0 = L.y - h / 2;
    // Пергамент: карта вписана в его внутреннюю рамку (inner) по центру — отсюда масштаб и положение листа.
    const P = L.paper;
    const kp = Math.min(P.inner.w / mapW, P.inner.h / mapH);
    const ps = this.s / kp;
    const px = this.x0 - (P.inner.x + (P.inner.w - mapW * kp) / 2) * ps;
    const py = this.y0 - (P.inner.y + (P.inner.h - mapH * kp) / 2) * ps;
    const paperKey = cutBlackBackground(scene, P.key, 'ui_minimap_paper_cut', F.paperCut as [number, number]);
    const paper = scene.add.image(px, py, paperKey).setOrigin(0).setScale(ps);
    this.bg = new Phaser.GameObjects.Image(scene, 0, 0, mapKey, '__BASE').setOrigin(0).setScale(this.s);
    // Пелена — холст на сцене, но невидимый: сам не выводится, только рисуется в итог.
    this.fogRt = scene.add.renderTexture(0, 0, Math.ceil(w), Math.ceil(h)).setOrigin(0).setVisible(false);
    this.comp = scene.add.renderTexture(this.x0, this.y0, Math.ceil(w), Math.ceil(h)).setOrigin(0).setAlpha(F.mapAlpha);
    this.brush = new Phaser.GameObjects.Image(scene, 0, 0, FX_SOFT).setOrigin(0.5);
    const d = fogRadius * 2 * this.s;
    this.brush.setDisplaySize(d, d);
    const frame = scene.add.rectangle(this.x0, this.y0, w, h).setOrigin(0).setStrokeStyle(F.frameWidth, F.frameColor, 0.9);
    this.route = scene.add.graphics();
    this.ring = scene.add.circle(0, 0, F.ringRadius).setStrokeStyle(2, FEEL.map.routeColor, 1).setVisible(false);
    for (const p of points) {
      const dot = scene.add.circle(this.x0 + p.x * this.s, this.y0 + p.y * this.s, F.pointRadius, FEEL.map.markerFill).setStrokeStyle(2, FEEL.map.markerStroke);
      const label = addText(scene, dot.x, dot.y - F.pointRadius - 3, p.name, F.labelSize, C.text, { stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5, 1);
      this.marks.push({ p, dot, label });
    }
    this.heroGlow = scene.add.image(0, 0, FX_SOFT).setTint(F.heroColor).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(F.heroGlow, F.heroGlow);
    this.hero = scene.add.circle(0, 0, F.heroRadius, F.heroColor).setStrokeStyle(2, 0x000000, 0.8);
    this.root = scene.add.container(0, 0, [paper, this.comp, frame, this.route, this.ring, ...this.marks.flatMap((m) => [m.dot, m.label]), this.heroGlow, this.hero]);
    this.root.setScrollFactor(0).setDepth(F.depth).setAlpha(0).setVisible(false);
  }

  /** Включена ли (Tab). */
  get open(): boolean {
    return this.wanted;
  }

  toggle(): void {
    this.wanted = !this.wanted;
  }

  close(): void {
    this.wanted = false;
  }

  /**
   * Каждый кадр. shown — можно ли сейчас показывать (нет разговора, сумки, паузы…); hero — герой (пиксели подложки);
   * fogPoints — открытые места тумана (null — тумана нет); shapes — здания, открытые по контуру (середина места и форма);
   * isOpen — открыто ли место (для точек); route — оставшийся путь героя (пиксели подложки), goal — цель или null.
   */
  update(
    delta: number,
    shown: boolean,
    hero: { x: number; y: number },
    fogPoints: [number, number][] | null,
    shapes: { x: number; y: number; shape: FogShape }[],
    isOpen: (x: number, y: number) => boolean,
    route: { x: number; y: number }[],
    goal: { x: number; y: number } | null,
  ): void {
    const F = FEEL.minimap;
    const visible = this.wanted && shown;
    const target = visible ? F.alpha : 0;
    const a = this.root.alpha + Math.sign(target - this.root.alpha) * Math.min(Math.abs(target - this.root.alpha), (delta / F.fadeMs) * F.alpha);
    this.root.setAlpha(a).setVisible(a > 0.001);
    if (!this.root.visible) return;
    this.clock += delta;
    // Туман: перерисовать, если открылись новые места.
    const n = fogPoints ? fogPoints.length : 0;
    if (n !== this.drawnPoints) {
      this.drawnPoints = n;
      this.drawFog(fogPoints, shapes);
      for (const m of this.marks) {
        const on = !fogPoints || isOpen(m.p.x, m.p.y);
        m.dot.setVisible(on);
        m.label.setVisible(on);
      }
    }
    // Герой — пульсирующая точка.
    const hx = this.x0 + hero.x * this.s;
    const hy = this.y0 + hero.y * this.s;
    const pulse = 0.5 + 0.5 * Math.sin((this.clock / F.heroPulseMs) * Math.PI * 2);
    this.hero.setPosition(hx, hy).setScale(1 + 0.25 * pulse);
    this.heroGlow.setPosition(hx, hy).setAlpha(0.35 + 0.4 * pulse);
    // Маршрут и цель.
    const g = this.route.clear();
    if (route.length >= 2) {
      g.lineStyle(F.routeWidth, FEEL.map.routeColor, 0.85);
      g.beginPath();
      route.forEach((p, i) => (i ? g.lineTo(this.x0 + p.x * this.s, this.y0 + p.y * this.s) : g.moveTo(this.x0 + p.x * this.s, this.y0 + p.y * this.s)));
      g.strokePath();
    }
    this.ring.setVisible(!!goal);
    if (goal) this.ring.setPosition(this.x0 + goal.x * this.s, this.y0 + goal.y * this.s).setScale(1 + 0.2 * pulse);
  }

  /** Пелена во весь размер, открытые места стёрты мягкой кистью (как у MapFog), здания — по контуру; затем итог: подложка + пелена. */
  private drawFog(points: [number, number][] | null, shapes: { x: number; y: number; shape: FogShape }[]): void {
    const rt = this.fogRt.clear();
    if (!points) {
      this.comp.clear().draw(this.bg, 0, 0).render();
      return;
    }
    // Пелена — маска: где она осталась, карта стирается до чистого пергамента; открытые места проступают с мягким краем.
    const Fo = FEEL.map.fogOfWar;
    rt.fill(0x000000, 1);
    for (const [x, y] of points) for (let i = 0; i < Fo.strength; i++) rt.erase(this.brush, x * this.s, y * this.s);
    const temp: Phaser.GameObjects.Image[] = [];
    for (const sh of shapes) {
      if (!points.some(([px, py]) => px === sh.x && py === sh.y)) continue;
      const S = sh.shape;
      const m = FEEL.map.focus.shapeMargin;
      const img = new Phaser.GameObjects.Image(this.scene, 0, 0, S.key).setOrigin(0.5).setDisplaySize(S.w * this.s * m, S.h * this.s * m);
      for (let i = 0; i < 3; i++) rt.erase(img, (S.x0 + S.w / 2) * this.s, (S.y0 + S.h / 2) * this.s);
      temp.push(img);
    }
    rt.render();
    // Кисти-формы уничтожаются только после отрисовки: команды холста выполняются в render().
    for (const t of temp) t.destroy();
    this.comp.clear().draw(this.bg, 0, 0).erase(this.fogRt, 0, 0).render();
  }
}
