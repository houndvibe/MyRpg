// Сумка поверх карты (клавиша I): саквояж слева (сетка: перетаскивание, ПКМ — поворот, двойной клик — основное оружие,
// за сумку — выбросить), справа досье на листе бумаги (components/Dossier.ts): «Ведомость снаряжения» или карточка
// предмета под курсором; при наведении соседи предмета связаны нитями, при перетаскивании досье заранее показывает,
// что предмет получит на новом месте. Под досье — латунные жетоны букв QTE (порядок — дедукция): перетащить жетон
// на другой или кликнуть по двум — поменять местами; буквы в пуле яркие и отделены чертой. Внизу — строка подсказок,
// во время перетаскивания — то, что нужно сейчас. Карта за окном размыта и затемнена. Появление: саквояж выезжает снизу,
// лист выскальзывает справа; закрытие (close) — обратно. Создавать, пока сцена строит интерфейс (видит только ui-камера).
import * as Phaser from 'phaser';
import { addBagUnderlay } from './BagUnderlay';
import { Dossier, type CardOptions } from './Dossier';
import { GridView } from './GridView';
import { itemKey, MAP_LAYOUT } from '../config/assets';
import { FEEL } from '../config/feel';
import { ITEMS } from '../data/items';
import { canBeMain, deduction, qtePool, removeItem, run, setMain, swapQteLetters } from '../state';
import { canPlace, MASK, type OwnedItem } from '../systems/backpack';
import { computePower } from '../systems/synergy';
import { addText, C, CATEGORY_COLORS, H, neighborLinks, SERIF_BOLD, SERIF_ITALIC, W } from '../ui';

/** Глубина окна — выше надписи «где герой» и портрета. */
const DEPTH = 40;
const VIGNETTE = 'bag_vignette';
/** Счётчик снимков фона: у каждого открытия своя текстура (прошлая ещё может догорать при закрытии). */
let backdropCount = 0;

type Hint = [key: string, label: string][];
const HINT_IDLE: Hint = [
  ['ЛКМ', 'тащить'],
  ['ПКМ', 'повернуть'],
  ['2×ЛКМ', 'основное оружие'],
  ['I', 'закрыть'],
];
const HINT_DRAG: Hint = [
  ['ПКМ', 'повернуть'],
  ['', 'отпустить за сумкой — выбросить'],
];
const HINT_LETTER: Hint = [['', 'отпустите на другой букве — поменяются местами']];

interface Token {
  cont: Phaser.GameObjects.Container;
  disc: Phaser.GameObjects.Graphics;
  text: Phaser.GameObjects.Text;
  /** Место жетона в ряду (центр). */
  x: number;
  y: number;
}

export class BagWindow {
  private scene: Phaser.Scene;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private grid!: GridView<OwnedItem>;
  private underlay!: Phaser.GameObjects.Image;
  private dossier!: Dossier;
  private shade: Phaser.GameObjects.GameObject[] = [];
  /** Размытый снимок карты под окном (карта под сумкой не рисуется); своя текстура на каждое открытие. */
  private backdrop: Phaser.GameObjects.Image | null = null;
  private backdropKey = `bag_backdrop_${++backdropCount}`;
  /** Ведомость после ухода мыши с предмета — с задержкой (FEEL.map.bag.ledgerDelayMs). */
  private ledgerTimer: Phaser.Time.TimerEvent | null = null;
  private hover: OwnedItem | null = null;
  private note = '';
  /** Последний предпросмотр перетаскивания (чтобы не перерисовывать досье на каждый пиксель). */
  private dragKey = '';
  private hintBox!: Phaser.GameObjects.Container;
  private lettersTitle!: Phaser.GameObjects.Text;
  private tokens: Token[] = [];
  private divider!: Phaser.GameObjects.Graphics;
  private picked: number | null = null;
  private letterDrag: { i: number; dx: number; moved: boolean; downX: number } | null = null;
  private closing = false;

  /**
   * Окно строится через кадр: сначала снимок экрана без сумки (из него — размытый фон), потом всё остальное.
   * Так фон — одна неподвижная картинка, а карта под сумкой не рисуется и не размывается каждый кадр.
   */
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    scene.game.renderer.snapshot((snap) => {
      if (this.closing || !scene.sys.isActive() || !(snap instanceof HTMLImageElement)) return;
      this.build(snap);
    });
  }

  private build(snap: HTMLImageElement): void {
    const scene = this.scene;
    const L = MAP_LAYOUT.bag;
    const F = FEEL.map.bag;
    // Карта за окном: размытый снимок, затемнение и виньетка.
    const t = scene.textures.createCanvas(this.backdropKey, W, H)!;
    const c = t.getContext();
    c.fillStyle = '#000';
    c.fillRect(0, 0, W, H);
    c.filter = `blur(${F.blur}px)`;
    const m = F.blur * 2;
    c.drawImage(snap, -m, -m, W + m * 2, H + m * 2);
    t.refresh();
    this.backdrop = scene.add.image(0, 0, this.backdropKey).setOrigin(0).setDepth(DEPTH - 1);
    this.shade = [scene.add.rectangle(0, 0, W, H, 0x000000, F.shade).setOrigin(0), scene.add.image(0, 0, ensureVignette(scene)).setOrigin(0).setDisplaySize(W, H).setAlpha(F.vignette)];
    for (const o of this.shade) (o as Phaser.GameObjects.Rectangle).setDepth(DEPTH);
    const g = L.grid;
    this.underlay = addBagUnderlay(scene, g.x, g.y, g.cell, MASK.cols, MASK.rows, DEPTH + 1);
    this.grid = new GridView<OwnedItem>(scene, {
      x: g.x,
      y: g.y,
      cell: g.cell,
      mask: MASK,
      bare: true,
      mode: 'edit',
      items: () => run.items,
      look: (it) => ({ w: ITEMS[it.id].w, h: ITEMS[it.id].h, label: ITEMS[it.id].name, color: CATEGORY_COLORS[ITEMS[it.id].category], charges: it.charges ?? null, image: itemKey(it.id) }),
      onHover: (it) => this.setHover(it),
      canPlace: (it, col, row, rotated) => canPlace(run.items, it.id, rotated, col, row, it.uid),
      onPlace: (it, col, row, rotated) => Object.assign(it, { col, row, rotated }),
      onDropOutside: (it) => removeItem(it.uid),
      onDoubleClick: (it) => {
        this.note = canBeMain(it) ? '' : `${ITEMS[it.id].name} не может быть основным: нужно оружие с парированием.`;
        if (canBeMain(it)) setMain(it.uid);
        this.refresh();
      },
      onChange: () => this.refresh(),
      onDrag: (s) => this.onDrag(s),
    });
    this.grid.setDepth(DEPTH + 2);
    this.dossier = new Dossier(scene).setDepth(DEPTH + 1);
    this.hintBox = scene.add.container(L.hint.x, L.hint.y).setDepth(DEPTH + 1);
    this.objects = [this.backdrop, ...this.shade, this.underlay, this.grid, this.dossier, this.hintBox, ...this.addLetters()];
    this.setHint(HINT_IDLE);
    this.refresh();
    this.animateIn();
  }

  // ─── Появление и закрытие ────────────────────────────────────────────────

  private animateIn(): void {
    const F = FEEL.map.bag;
    const tw = this.scene.tweens;
    // Снимок проявляется поверх живой карты; проявился — карту можно не рисовать.
    tw.add({
      targets: this.backdrop!.setAlpha(0),
      alpha: 1,
      duration: F.openMs,
      onComplete: () => {
        this.scene.cameras.main.setVisible(false);
        this.prepareCards();
      },
    });
    for (const o of this.shade) {
      const t = o as Phaser.GameObjects.Image;
      const a = t.alpha;
      tw.add({ targets: t.setAlpha(0), alpha: a, duration: F.openMs });
    }
    for (const o of [this.underlay, this.grid]) {
      const y = o.y;
      o.setY(y + F.bagRise).setAlpha(0);
      tw.add({ targets: o, y, duration: F.openMs, ease: 'Back.easeOut' });
      tw.add({ targets: o, alpha: 1, duration: F.openMs * 0.6 });
    }
    const d = this.dossier;
    const x = d.x;
    d.setX(x + F.sheetSlide).setAngle(F.sheetTilt).setAlpha(0);
    tw.add({ targets: d, x, angle: 0, duration: F.openMs, delay: F.openMs * 0.15, ease: 'Cubic.easeOut' });
    tw.add({ targets: d, alpha: 1, duration: F.openMs * 0.5, delay: F.openMs * 0.15 });
    const rest = [this.hintBox, this.lettersTitle, ...this.tokens.map((t) => t.cont), this.divider];
    for (const o of rest) tw.add({ targets: o.setAlpha(0), alpha: 1, duration: F.openMs, delay: F.openMs * 0.3 });
  }

  /** Закрыть: всё уезжает обратно, размытие снимается; done — когда окно убрано. */
  close(done?: () => void): void {
    if (this.closing) return;
    this.closing = true;
    // Ещё не построено (снимок не пришёл) — закрывать нечего.
    if (!this.backdrop) {
      done?.();
      return;
    }
    const F = FEEL.map.bag;
    const tw = this.scene.tweens;
    // Закрыли посреди появления — недоигранное появление снимается, закрытие идёт от того места, где всё сейчас.
    tw.killTweensOf(this.objects);
    this.ledgerTimer?.remove();
    this.scene.cameras.main.setVisible(true);
    tw.add({ targets: [this.underlay, this.grid], y: `+=${F.bagRise}`, alpha: 0, duration: F.closeMs, ease: 'Cubic.easeIn' });
    tw.add({ targets: this.dossier, x: `+=${F.sheetSlide}`, angle: F.sheetTilt, alpha: 0, duration: F.closeMs, ease: 'Cubic.easeIn' });
    const rest = [this.backdrop, ...this.shade, this.hintBox, this.lettersTitle, ...this.tokens.map((t) => t.cont), this.divider];
    tw.add({
      targets: rest,
      alpha: 0,
      duration: F.closeMs,
      onComplete: () => {
        this.destroy();
        done?.();
      },
    });
  }

  // ─── Досье ───────────────────────────────────────────────────────────────

  /** Карточки всех предметов — заранее, по одной за кадр: первое наведение на предмет потом без рывка. */
  private prepareCards(): void {
    const items = run.items.filter((i) => i.inGrid);
    items.forEach((it, i) =>
      this.scene.time.delayedCall(i * 20, () => {
        if (this.closing || !this.objects.length) return;
        this.dossier.prepareItem(it, computePower(run.items), run.items, this.cardOptions(it));
      }),
    );
  }

  /** Что показать в карточке предмета при наведении (тот же набор — та же запомненная страница). */
  private cardOptions(it: OwnedItem): CardOptions {
    return { main: run.mainUid === it.uid, canBeMain: canBeMain(it), note: this.note };
  }

  /** Наведение: предмет — сразу; ушла мышь — ведомость чуть позже (переход между предметами не перерисовывает её). */
  private setHover(it: OwnedItem | null): void {
    this.ledgerTimer?.remove();
    this.ledgerTimer = null;
    if (it) {
      this.hover = it;
      this.refresh();
      return;
    }
    this.ledgerTimer = this.scene.time.delayedCall(FEEL.map.bag.ledgerDelayMs, () => {
      this.ledgerTimer = null;
      this.hover = null;
      this.refresh();
    });
  }

  /** Перетаскивание: досье показывает предмет на новом месте; подсказка — что делать сейчас. */
  private onDrag(s: { it: OwnedItem; col: number; row: number; rotated: boolean; inside: boolean; ok: boolean } | null): void {
    if (!s) {
      this.dragKey = '';
      this.setHint(HINT_IDLE);
      return;
    }
    const key = `${s.it.uid}:${s.col}:${s.row}:${s.rotated}:${s.inside}:${s.ok}`;
    if (key === this.dragKey) return;
    if (!this.dragKey) this.setHint(HINT_DRAG);
    this.dragKey = key;
    if (s.inside && s.ok) {
      const moved = run.items.map((i) => (i.uid === s.it.uid ? { ...i, col: s.col, row: s.row, rotated: s.rotated } : i));
      const power = computePower(moved);
      this.dossier.showItem(moved.find((i) => i.uid === s.it.uid)!, power, moved, { main: run.mainUid === s.it.uid, canBeMain: canBeMain(s.it), preview: 'ok' });
    } else {
      this.dossier.showItem(s.it, computePower(run.items), run.items, { main: run.mainUid === s.it.uid, canBeMain: canBeMain(s.it), preview: s.inside ? 'bad' : 'drop' });
    }
  }

  /** Метки соседства, основное оружие, отключённые, нити наведения и досье. */
  private refresh(): void {
    const power = computePower(run.items);
    this.grid.setMain(run.mainUid);
    for (const it of run.items) {
      const p = power.powers.get(it.uid);
      if (!p) continue;
      this.grid.setBadges(it.uid, p.received.filter((e) => e.good && !e.inactive).length, p.received.filter((e) => !e.good && !e.inactive).length);
      this.grid.setDisabled(it.uid, p.disabled);
    }
    const it = this.hover && run.items.includes(this.hover) && this.hover.inGrid ? this.hover : null;
    this.grid.setLinks(it?.uid ?? null, it ? neighborLinks(it.uid, power) : []);
    if (it) this.dossier.showItem(it, power, run.items, this.cardOptions(it));
    else this.dossier.showLedger(run.items, run.mainUid, power);
    if (!it) this.note = '';
  }

  // ─── Подсказки ───────────────────────────────────────────────────────────

  /** Строка подсказок по центру: клавиши — латунные плашки, рядом подпись. */
  private setHint(items: Hint): void {
    const box = this.hintBox;
    box.removeAll(true);
    const parts: Phaser.GameObjects.GameObject[] = [];
    let x = 0;
    items.forEach(([key, label], i) => {
      if (i) {
        parts.push(addText(this.scene, x + 14, 0, '·', 20, C.dim).setOrigin(0.5));
        x += 28;
      }
      if (key) {
        const t = addText(this.scene, 0, 0, key, 16, '#2b1a0e', { fontFamily: SERIF_BOLD }).setOrigin(0.5);
        const w = Math.max(30, t.width + 16);
        const cap = this.scene.add.graphics();
        cap.fillStyle(0xc9a050, 1).fillRoundedRect(x, -14, w, 28, 6).lineStyle(1.5, 0x5a3d14, 1).strokeRoundedRect(x, -14, w, 28, 6);
        t.setPosition(x + w / 2, 0);
        parts.push(cap, t);
        x += w + 8;
      }
      const l = addText(this.scene, x, 0, label, 19, C.text, { fontFamily: SERIF_ITALIC }).setOrigin(0, 0.5);
      parts.push(l);
      x += l.width;
    });
    box.add(parts);
    for (const p of parts) (p as unknown as Phaser.GameObjects.Components.Transform).x -= x / 2;
  }

  // ─── Буквы QTE ───────────────────────────────────────────────────────────

  /** Ряд латунных жетонов: перетащить на другой или кликнуть по двум — поменять местами. */
  private addLetters(): Phaser.GameObjects.GameObject[] {
    const L = MAP_LAYOUT.bag.letters;
    const r = L.row;
    this.lettersTitle = addText(this.scene, L.title.x, L.title.y, '', 20, C.accent, { fontFamily: SERIF_ITALIC }).setOrigin(0.5).setDepth(DEPTH + 1);
    this.divider = this.scene.add.graphics().setDepth(DEPTH + 1);
    this.tokens = run.qteOrder.map((_, i) => {
      const cont = this.scene.add.container(0, 0).setDepth(DEPTH + 2);
      const disc = this.scene.add.graphics();
      const text = addText(this.scene, 0, 0, '', 24, '#2b1a0e', { fontFamily: SERIF_BOLD }).setOrigin(0.5);
      cont.add([disc, text]);
      cont.setSize(r.d, r.d).setInteractive({ useHandCursor: true });
      cont.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (p.button !== 0) return;
        this.letterDrag = { i, dx: p.x - cont.x, moved: false, downX: p.x };
      });
      return { cont, disc, text, x: 0, y: r.y };
    });
    this.scene.input.on('pointermove', this.onLetterMove, this);
    this.scene.input.on('pointerup', this.onLetterUp, this);
    this.refreshLetters();
    return [this.lettersTitle, this.divider, ...this.tokens.map((t) => t.cont)];
  }

  private onLetterMove(p: Phaser.Input.Pointer): void {
    const d = this.letterDrag;
    if (!d || this.closing) return;
    if (!d.moved && Math.abs(p.x - d.downX) < FEEL.dragThreshold) return;
    if (!d.moved) {
      d.moved = true;
      this.picked = null;
      this.tokens[d.i].cont.setDepth(DEPTH + 3).setScale(1.12);
      this.setHint(HINT_LETTER);
    }
    this.tokens[d.i].cont.setPosition(p.x - d.dx, this.tokens[d.i].y - 6);
  }

  private onLetterUp(p: Phaser.Input.Pointer): void {
    const d = this.letterDrag;
    if (!d || p.button !== 0) return;
    this.letterDrag = null;
    if (!d.moved) {
      this.pickLetter(d.i);
      return;
    }
    this.setHint(HINT_IDLE);
    const t = this.tokens[d.i];
    t.cont.setDepth(DEPTH + 2).setScale(1);
    let best = d.i;
    for (let j = 0; j < this.tokens.length; j++) if (Math.abs(this.tokens[j].x - t.cont.x) < Math.abs(this.tokens[best].x - t.cont.x)) best = j;
    if (best !== d.i) swapQteLetters(d.i, best);
    this.refreshLetters();
  }

  private pickLetter(i: number): void {
    if (this.picked === null) this.picked = i;
    else {
      if (this.picked !== i) swapQteLetters(this.picked, i);
      this.picked = null;
    }
    this.refreshLetters();
  }

  /** Жетоны по местам: в пуле — яркая латунь, вне пула — тусклые за чертой; выбранный для обмена — со светлым ободком. */
  private refreshLetters(): void {
    const r = MAP_LAYOUT.bag.letters.row;
    const pool = qtePool().length;
    this.lettersTitle.setText(`Буквы проверок · дедукция ${deduction()} · в пуле ${pool}`);
    let x = r.x + r.d / 2;
    this.tokens.forEach((t, i) => {
      if (i === pool) x += r.poolGap;
      t.x = x;
      t.cont.setPosition(x, t.y);
      const inPool = i < pool;
      const rad = r.d / 2;
      t.disc.clear();
      t.disc.fillStyle(0x000000, 0.4).fillCircle(2, 3, rad);
      t.disc.fillStyle(inPool ? 0xc9a050 : 0x6e5a36, 1).fillCircle(0, 0, rad);
      t.disc.lineStyle(2, inPool ? 0x5a3d14 : 0x3a2c18, 1).strokeCircle(0, 0, rad - 1).strokeCircle(0, 0, rad - 6);
      if (this.picked === i) t.disc.lineStyle(3, 0xfff1c8, 1).strokeCircle(0, 0, rad + 3);
      t.text.setText(run.qteOrder[i]).setColor(inPool ? '#2b1a0e' : '#2a2118');
      t.cont.setAlpha(inPool ? 1 : 0.75);
      x += r.d + r.gap;
    });
    this.divider.clear();
    if (pool < this.tokens.length) {
      const dx = this.tokens[pool].x - r.d / 2 - r.poolGap / 2;
      this.divider.lineStyle(2, 0xe0b65a, 0.8).lineBetween(dx, r.y - r.d / 2 - 4, dx, r.y + r.d / 2 + 4);
    }
  }

  destroy(): void {
    this.scene.input.off('pointermove', this.onLetterMove, this);
    this.scene.input.off('pointerup', this.onLetterUp, this);
    this.ledgerTimer?.remove();
    this.scene.tweens.killTweensOf(this.objects);
    this.scene.cameras.main.setVisible(true);
    for (const o of this.objects) o.destroy();
    this.objects = [];
    if (this.scene.textures.exists(this.backdropKey)) this.scene.textures.remove(this.backdropKey);
  }
}

/** Виньетка: радиальный градиент от прозрачного центра к чёрным краям — один раз на игру. */
function ensureVignette(scene: Phaser.Scene): string {
  if (scene.textures.exists(VIGNETTE)) return VIGNETTE;
  const t = scene.textures.createCanvas(VIGNETTE, 480, 270)!;
  const c = t.getContext();
  const g = c.createRadialGradient(240, 135, 60, 240, 135, 280);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  c.fillStyle = g;
  c.fillRect(0, 0, 480, 270);
  t.refresh();
  return VIGNETTE;
}

