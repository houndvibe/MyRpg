// Сумка поверх карты (клавиша I): тот же инвентарь, что в режиме отладки, — сетка в сумке-подложке (перетаскивание,
// ПКМ — поворот, двойной клик — основное оружие, за сетку — выбросить), справа панель описания: предмет под курсором
// или сила снаряжения. Внизу справа — порядок букв QTE (дедукция): клик по букве, клик по другой — поменять местами;
// подсвечены буквы, что сейчас в пуле. Закрывается на I или Esc. Создавать, пока сцена строит интерфейс (видит только ui-камера).
import * as Phaser from 'phaser';
import { addBagUnderlay } from './BagUnderlay';
import { GridView } from './GridView';
import { itemKey, MAP_LAYOUT } from '../config/assets';
import { FEEL } from '../config/feel';
import { ITEMS } from '../data/items';
import { canBeMain, deduction, qtePool, removeItem, run, setMain, swapQteLetters } from '../state';
import { canPlace, MASK, type OwnedItem } from '../systems/backpack';
import { computePower } from '../systems/synergy';
import { addText, C, CATEGORY_COLORS, describeGear, describeOwnedItem, H, W } from '../ui';

/** Глубина окна — выше надписи «где герой» и портрета. */
const DEPTH = 40;

export class BagWindow {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private grid: GridView<OwnedItem>;
  private info: Phaser.GameObjects.Text;
  private hoverText: string | null = null;
  private note = '';
  private scene: Phaser.Scene;
  /** Порядок букв QTE: подпись и плашки; выбранная для обмена плашка (индекс). */
  private lettersTitle!: Phaser.GameObjects.Text;
  private letterTiles: { box: Phaser.GameObjects.Rectangle; text: Phaser.GameObjects.Text }[] = [];
  private picked: number | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const L = MAP_LAYOUT.bag;
    const F = FEEL.map.bag;
    const shade = scene.add.rectangle(0, 0, W, H, 0x000000, F.shade).setOrigin(0).setDepth(DEPTH);
    const g = L.grid;
    const underlay = addBagUnderlay(scene, g.x, g.y, g.cell, MASK.cols, MASK.rows, DEPTH + 1);
    this.grid = new GridView<OwnedItem>(scene, {
      x: g.x,
      y: g.y,
      cell: g.cell,
      mask: MASK,
      bare: true,
      mode: 'edit',
      items: () => run.items,
      look: (it) => ({ w: ITEMS[it.id].w, h: ITEMS[it.id].h, label: ITEMS[it.id].name, color: CATEGORY_COLORS[ITEMS[it.id].category], charges: it.charges ?? null, image: itemKey(it.id) }),
      onHover: (it) => this.setHover(it ? describeOwnedItem(it, computePower(run.items).powers, run.items) : null),
      canPlace: (it, col, row, rotated) => canPlace(run.items, it.id, rotated, col, row, it.uid),
      onPlace: (it, col, row, rotated) => Object.assign(it, { col, row, rotated }),
      onDropOutside: (it) => removeItem(it.uid),
      onDoubleClick: (it) => {
        this.note = canBeMain(it) ? '' : `${ITEMS[it.id].name} не может быть основным: нужно оружие с парированием.`;
        if (canBeMain(it)) setMain(it.uid);
        this.refresh();
      },
      onChange: () => this.refresh(),
    });
    this.grid.setDepth(DEPTH + 2);
    const title = addText(scene, L.title.x, L.title.y, 'Сумка', 40, C.accent).setDepth(DEPTH + 1);
    const inf = L.info;
    const panel = scene.add.rectangle(inf.x, inf.y, inf.w, inf.h, C.panel).setOrigin(0).setStrokeStyle(2, C.border).setDepth(DEPTH + 1);
    this.info = addText(scene, inf.x + 20, inf.y + 18, '', 20, C.text, { wordWrap: { width: inf.w - 40 }, lineSpacing: 6 }).setDepth(DEPTH + 1);
    const help = addText(
      scene,
      L.help.x,
      L.help.y,
      'ЛКМ — тащить, ПКМ — повернуть, за сетку — выбросить.\nДвойной клик по оружию — основное. I или Esc — закрыть.\nБуквы QTE: клик по двум — поменять местами; в пуле — с рамкой.',
      18,
      C.dim,
      { lineSpacing: 6 },
    ).setDepth(DEPTH + 1);
    this.objects = [shade, underlay, this.grid, title, panel, this.info, help, ...this.addLetters()];
    for (const o of this.objects) {
      const t = o as unknown as Phaser.GameObjects.Components.Alpha;
      const a = t.alpha;
      t.setAlpha(0);
      scene.tweens.add({ targets: o, alpha: a, duration: F.fadeMs });
    }
    this.refresh();
  }

  /** Ряд букв QTE: клик выбирает букву, клик по другой — меняет их местами. */
  private addLetters(): Phaser.GameObjects.GameObject[] {
    const L = MAP_LAYOUT.bagLetters;
    const r = L.row;
    this.lettersTitle = addText(this.scene, L.title.x, L.title.y, '', 20, C.text).setDepth(DEPTH + 1);
    const out: Phaser.GameObjects.GameObject[] = [this.lettersTitle];
    this.letterTiles = run.qteOrder.map((_, i) => {
      const x = r.x + i * (r.tile + r.gap) + r.tile / 2;
      const y = r.y + r.tile / 2;
      const box = this.scene.add.rectangle(x, y, r.tile, r.tile, C.cell).setStrokeStyle(2, C.border).setDepth(DEPTH + 1).setInteractive({ useHandCursor: true });
      const text = addText(this.scene, x, y, '', 26, C.text).setOrigin(0.5).setDepth(DEPTH + 2);
      box.on('pointerdown', (p: Phaser.Input.Pointer) => p.button === 0 && this.pickLetter(i));
      out.push(box, text);
      return { box, text };
    });
    this.refreshLetters();
    return out;
  }

  private pickLetter(i: number): void {
    if (this.picked === null) this.picked = i;
    else {
      if (this.picked !== i) swapQteLetters(this.picked, i);
      this.picked = null;
    }
    this.refreshLetters();
  }

  /** Буквы в пуле — золотая рамка, вне пула — тусклые; выбранная — светлая заливка. */
  private refreshLetters(): void {
    const pool = qtePool().length;
    this.lettersTitle.setText(`Буквы QTE · дедукция ${deduction()} · в пуле ${pool}`);
    this.letterTiles.forEach(({ box, text }, i) => {
      const inPool = i < pool;
      box.setFillStyle(this.picked === i ? C.btnOn : C.cell).setStrokeStyle(2, inPool ? 0xe0b65a : C.border);
      text.setText(run.qteOrder[i]).setColor(inPool ? C.text : C.dim);
    });
  }

  private setHover(text: string | null): void {
    this.hoverText = text;
    this.refresh();
  }

  /** Метки соседства, основное оружие, отключённые предметы и панель описания — как в режиме отладки. */
  private refresh(): void {
    const power = computePower(run.items);
    this.grid.setMain(run.mainUid);
    for (const it of run.items) {
      const p = power.powers.get(it.uid);
      if (!p) continue;
      this.grid.setBadges(it.uid, p.received.filter((e) => e.good && !e.inactive).length, p.received.filter((e) => !e.good && !e.inactive).length);
      this.grid.setDisabled(it.uid, p.disabled);
    }
    const text = this.hoverText ?? describeGear(run.items, run.mainUid, power);
    this.info.setText(this.note ? `${text}\n\n${this.note}` : text);
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
  }
}
