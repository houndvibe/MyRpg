// Одна сетка с предметами для всех мест (как в Людъмаке, но без картинок): предмет — цветная плитка с названием.
// Режимы: 'edit' — инвентарь на главном экране (перетаскивание, поворот ПКМ, двойной клик — основное,
// вынести за сетку — выбросить); 'battle' — инвентарь в бою (клик применяет активный предмет); 'view' — сумка врага.
import * as Phaser from 'phaser';
import { FEEL } from '../config/feel';
import type { Mask, Placement } from '../systems/backpack';
import { addText, C } from '../ui';

export type GridMode = 'edit' | 'battle' | 'view';

/** Как выглядит предмет: размер без поворота, подпись, цвет плитки и заряды. */
export interface PieceLook {
  w: number;
  h: number;
  label: string;
  color: number;
  /** Заряды (null — без счёта). */
  charges?: number | null;
}

export interface GridConfig<T extends Placement> {
  x: number;
  y: number;
  cell: number;
  mask: Mask;
  mode: GridMode;
  items: () => T[];
  look: (it: T) => PieceLook;
  onHover?: (it: T | null) => void;
  /** Клик по предмету (бой: применить активный). */
  onClick?: (it: T) => void;
  /** Двойной клик (инвентарь: сделать основным). */
  onDoubleClick?: (it: T) => void;
  /** Инвентарь: можно ли положить предмет сюда. */
  canPlace?: (it: T, col: number, row: number, rotated: boolean) => boolean;
  onPlace?: (it: T, col: number, row: number, rotated: boolean) => void;
  /** Предмет отпустили за пределами сетки. */
  onDropOutside?: (it: T) => void;
  /** Поворот не удался (не помещается) — для звука или подсказки. */
  onChange?: () => void;
}

interface Piece<T> {
  it: T;
  cont: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  shade: Phaser.GameObjects.Rectangle;
  border: Phaser.GameObjects.Rectangle;
  charges: Phaser.GameObjects.Text;
  badges: Phaser.GameObjects.Container;
  color: number;
  /** Текущий размер в клетках (с поворотом). */
  w: number;
  h: number;
  main: boolean;
  ready: boolean;
  disabled: boolean;
  removing: boolean;
}

interface Drag<T> {
  piece: Piece<T>;
  /** Сдвиг курсора от левого верхнего угла плитки. */
  dx: number;
  dy: number;
  rotated: boolean;
  started: boolean;
  downX: number;
  downY: number;
}

export class GridView<T extends Placement> extends Phaser.GameObjects.Container {
  private cfg: GridConfig<T>;
  private pieces = new Map<number, Piece<T>>();
  private ghost: Phaser.GameObjects.Rectangle;
  private drag: Drag<T> | null = null;
  private lastClick = { uid: -1, at: 0 };
  private mainUid: number | null = null;

  constructor(scene: Phaser.Scene, cfg: GridConfig<T>) {
    super(scene, cfg.x, cfg.y);
    this.cfg = cfg;
    const { cell, mask } = cfg;
    const cells = scene.add.graphics();
    for (let r = 0; r < mask.rows; r++) {
      for (let c = 0; c < mask.cols; c++) {
        if (!mask.open[r][c]) continue;
        cells.fillStyle(C.cell, 1).fillRect(c * cell, r * cell, cell, cell);
        cells.lineStyle(2, C.cellLine, 1).strokeRect(c * cell, r * cell, cell, cell);
      }
    }
    this.ghost = scene.add.rectangle(0, 0, cell, cell, 0x7fd47f, 0.25).setOrigin(0).setVisible(false);
    this.add([cells, this.ghost]);
    scene.add.existing(this);
    this.rebuild();
    if (cfg.mode === 'edit') {
      scene.input.on('pointermove', this.onMove, this);
      scene.input.on('pointerup', this.onUp, this);
      scene.input.on('pointerdown', this.onSceneDown, this);
      this.once(Phaser.GameObjects.Events.DESTROY, () => {
        scene.input.off('pointermove', this.onMove, this);
        scene.input.off('pointerup', this.onUp, this);
        scene.input.off('pointerdown', this.onSceneDown, this);
      });
    }
  }

  get widthPx(): number {
    return this.cfg.mask.cols * this.cfg.cell;
  }

  get heightPx(): number {
    return this.cfg.mask.rows * this.cfg.cell;
  }

  /** Перерисовать все предметы по текущему списку. */
  rebuild(): void {
    for (const p of this.pieces.values()) p.cont.destroy();
    this.pieces.clear();
    for (const it of this.cfg.items()) if (it.inGrid) this.pieces.set(it.uid, this.makePiece(it));
    this.setMain(this.mainUid);
  }

  private makePiece(it: T): Piece<T> {
    const { cell } = this.cfg;
    const look = this.cfg.look(it);
    const w = it.rotated ? look.h : look.w;
    const h = it.rotated ? look.w : look.h;
    const pw = w * cell;
    const ph = h * cell;
    const cont = this.scene.add.container(it.col * cell, it.row * cell);
    const bg = this.scene.add.rectangle(3, 3, pw - 6, ph - 6, look.color).setOrigin(0).setStrokeStyle(2, 0x000000, 0.6);
    const shade = this.scene.add.rectangle(3, 3, pw - 6, 0, 0x000000, 0.55).setOrigin(0);
    const label = addText(this.scene, pw / 2, ph / 2, look.label, Math.max(13, Math.round(cell * 0.17)), C.text, {
      align: 'center',
      wordWrap: { width: pw - 12 },
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5);
    const charges = addText(this.scene, pw - 8, ph - 5, look.charges != null ? `${look.charges}` : '', Math.round(cell * 0.2), C.text, {
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(1, 1);
    const border = this.scene.add.rectangle(1, 1, pw - 2, ph - 2).setOrigin(0).setStrokeStyle(4, 0xe0b65a).setVisible(false);
    const badges = this.scene.add.container(0, 0);
    cont.add([bg, shade, label, charges, badges, border]);
    this.add(cont);
    const piece: Piece<T> = { it, cont, bg, shade, border, charges, badges, color: look.color, w, h, main: false, ready: false, disabled: false, removing: false };
    if (this.cfg.mode !== 'view' || this.cfg.onHover) {
      cont.setInteractive(new Phaser.Geom.Rectangle(0, 0, pw, ph), Phaser.Geom.Rectangle.Contains);
      if (this.cfg.mode !== 'view') cont.input!.cursor = 'pointer';
      cont.on('pointerover', () => {
        if (!this.drag?.started) this.cfg.onHover?.(it);
      });
      cont.on('pointerout', () => {
        if (!this.drag?.started) this.cfg.onHover?.(null);
      });
      cont.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPieceDown(piece, p));
    }
    return piece;
  }

  // ─── Состояние предметов (бой) ───────────────────────────────────────────

  setMain(uid: number | null): void {
    this.mainUid = uid;
    for (const p of this.pieces.values()) {
      p.main = p.it.uid === uid;
      this.paintBorder(p);
    }
  }

  /** Активный предмет можно нажать — светлая рамка. */
  setReady(uid: number, on: boolean): void {
    const p = this.pieces.get(uid);
    if (!p || p.ready === on) return;
    p.ready = on;
    this.paintBorder(p);
  }

  private paintBorder(p: Piece<T>): void {
    p.border.setVisible(p.main || p.ready).setStrokeStyle(p.main ? 5 : 3, p.main ? 0xe0b65a : 0xcfe6ff);
  }

  /** Отключённый предмет — серый. */
  setDisabled(uid: number, on: boolean): void {
    const p = this.pieces.get(uid);
    if (!p || p.disabled === on) return;
    p.disabled = on;
    p.bg.setFillStyle(on ? 0x444444 : p.color);
    p.cont.setAlpha(on ? 0.6 : 1);
  }

  /** Перезарядка: 0 — только сработал (затемнён целиком), 1 — готов. */
  setProgress(uid: number, ratio: number): void {
    const p = this.pieces.get(uid);
    if (!p) return;
    const full = p.h * this.cfg.cell - 6;
    p.shade.height = full * (1 - Phaser.Math.Clamp(ratio, 0, 1));
  }

  setCharges(uid: number, n: number | null): void {
    this.pieces.get(uid)?.charges.setText(n !== null && Number.isFinite(n) ? `${n}` : '');
  }

  /** Метки соседства в левом нижнем углу: сколько хороших (зелёный) и плохих (красный) эффектов получил предмет. */
  setBadges(uid: number, good: number, bad: number): void {
    const p = this.pieces.get(uid);
    if (!p) return;
    p.badges.removeAll(true);
    const r = Math.round(this.cfg.cell * 0.13);
    let x = 6 + r;
    const y = p.h * this.cfg.cell - 6 - r;
    for (const [n, color] of [
      [good, 0x3f9a3f],
      [bad, 0xb03a3a],
    ] as const) {
      if (!n) continue;
      p.badges.add(this.scene.add.circle(x, y, r, color).setStrokeStyle(2, 0x000000));
      p.badges.add(addText(this.scene, x, y, `${n}`, Math.round(r * 1.3), C.text).setOrigin(0.5));
      x += r * 2 + 4;
    }
  }

  /** Вспышка при срабатывании: плитка на миг белеет и качается. */
  flash(uid: number): void {
    const p = this.pieces.get(uid);
    if (!p || p.removing) return;
    p.bg.setFillStyle(0xffffff);
    this.scene.time.delayedCall(90, () => p.bg.active && p.bg.setFillStyle(p.disabled ? 0x444444 : p.color));
    this.scene.tweens.killTweensOf(p.cont);
    p.cont.setScale(1);
    this.scene.tweens.add({ targets: p.cont, scale: 1.05, duration: 70, yoyo: true });
  }

  /** Предмет исчез (кончились заряды): растворяется. */
  removePiece(uid: number): void {
    const p = this.pieces.get(uid);
    if (!p || p.removing) return;
    p.removing = true;
    this.pieces.delete(uid);
    p.cont.disableInteractive();
    this.scene.tweens.add({ targets: p.cont, alpha: 0, duration: 400, onComplete: () => p.cont.destroy() });
  }

  // ─── Ввод ────────────────────────────────────────────────────────────────

  private onPieceDown(piece: Piece<T>, p: Phaser.Input.Pointer): void {
    if (p.button !== 0) return; // ПКМ — поворот (onSceneDown)
    if (this.cfg.mode === 'battle') {
      this.cfg.onClick?.(piece.it);
      return;
    }
    if (this.cfg.mode !== 'edit') return;
    const now = this.scene.time.now;
    if (this.lastClick.uid === piece.it.uid && now - this.lastClick.at < FEEL.doubleClickMs) {
      this.lastClick = { uid: -1, at: 0 };
      this.cfg.onDoubleClick?.(piece.it);
      return;
    }
    this.lastClick = { uid: piece.it.uid, at: now };
    const local = this.toLocal(p);
    this.drag = { piece, dx: local.x - piece.cont.x, dy: local.y - piece.cont.y, rotated: piece.it.rotated, started: false, downX: p.x, downY: p.y };
  }

  private toLocal(p: { x: number; y: number }): { x: number; y: number } {
    return { x: p.x - this.x, y: p.y - this.y };
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const d = this.drag;
    if (!d) return;
    if (!d.started) {
      if (Math.hypot(p.x - d.downX, p.y - d.downY) < FEEL.dragThreshold) return;
      d.started = true;
      this.cfg.onHover?.(null);
      d.piece.cont.setDepth(10);
      this.bringToTop(d.piece.cont);
    }
    const local = this.toLocal(p);
    d.piece.cont.setPosition(local.x - d.dx, local.y - d.dy);
    this.updateGhost(p);
  }

  /** Куда ляжет перетаскиваемый предмет: клетка под его левым верхним углом. */
  private target(): { col: number; row: number } {
    const d = this.drag!;
    const { cell } = this.cfg;
    return { col: Math.round(d.piece.cont.x / cell), row: Math.round(d.piece.cont.y / cell) };
  }

  private outside(p: { x: number; y: number }): boolean {
    const l = this.toLocal(p);
    return l.x < 0 || l.y < 0 || l.x > this.widthPx || l.y > this.heightPx;
  }

  private updateGhost(p: { x: number; y: number }): void {
    const d = this.drag!;
    const { cell } = this.cfg;
    const t = this.target();
    if (this.outside(p)) {
      this.ghost.setVisible(false);
      return;
    }
    const ok = this.cfg.canPlace?.(d.piece.it, t.col, t.row, d.rotated) ?? false;
    this.ghost
      .setVisible(true)
      .setPosition(t.col * cell, t.row * cell)
      .setSize(d.piece.w * cell, d.piece.h * cell)
      .setFillStyle(ok ? 0x7fd47f : 0xe06060, 0.3);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const d = this.drag;
    if (!d || p.button !== 0) return;
    this.ghost.setVisible(false);
    if (!d.started) {
      this.drag = null;
      return;
    }
    const t = this.target();
    this.drag = null;
    if (this.outside(p)) this.cfg.onDropOutside?.(d.piece.it);
    else if (this.cfg.canPlace?.(d.piece.it, t.col, t.row, d.rotated)) this.cfg.onPlace?.(d.piece.it, t.col, t.row, d.rotated);
    this.rebuild();
    this.cfg.onChange?.();
  }

  /** ПКМ: поворот перетаскиваемого предмета или предмета под курсором (если помещается повёрнутым). */
  private onSceneDown(p: Phaser.Input.Pointer): void {
    if (p.button !== 2) return;
    const d = this.drag;
    if (d?.started) {
      d.rotated = !d.rotated;
      const piece = d.piece;
      [piece.w, piece.h] = [piece.h, piece.w];
      const { cell } = this.cfg;
      piece.bg.setSize(piece.w * cell - 6, piece.h * cell - 6);
      piece.border.setSize(piece.w * cell - 2, piece.h * cell - 2);
      piece.shade.setSize(piece.w * cell - 6, 0);
      piece.badges.setVisible(false);
      piece.cont.each((o: Phaser.GameObjects.GameObject) => {
        if (!(o instanceof Phaser.GameObjects.Text)) return;
        if (o.originX === 0.5) o.setPosition((piece.w * cell) / 2, (piece.h * cell) / 2).setWordWrapWidth(piece.w * cell - 12);
        else if (o.originX === 1) o.setPosition(piece.w * cell - 8, piece.h * cell - 5);
      });
      d.dx = (piece.w * cell) / 2;
      d.dy = (piece.h * cell) / 2;
      this.onMove(p);
      return;
    }
    const local = this.toLocal(p);
    const { cell } = this.cfg;
    for (const q of this.pieces.values()) {
      if (local.x < q.cont.x || local.x >= q.cont.x + q.w * cell || local.y < q.cont.y || local.y >= q.cont.y + q.h * cell) continue;
      const it = q.it;
      if (this.cfg.canPlace?.(it, it.col, it.row, !it.rotated)) {
        this.cfg.onPlace?.(it, it.col, it.row, !it.rotated);
        this.rebuild();
        this.cfg.onChange?.();
      } else {
        q.bg.setFillStyle(0xe06060);
        this.scene.time.delayedCall(200, () => q.bg.active && q.bg.setFillStyle(q.color));
      }
      return;
    }
  }
}
