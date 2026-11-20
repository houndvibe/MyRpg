// Режим отладки (бывший главный экран прототипа): инвентарь 5×5 (соседство, основное оружие), выдача любого предмета героя,
// выбор врага и кнопка «В бой».
import * as Phaser from 'phaser';
import { GridView } from '../components/GridView';
import { addBagUnderlay } from '../components/BagUnderlay';
import { itemKey, MAIN_LAYOUT as L } from '../config/assets';
import { ENEMY_STAT_MULT, ENEMY_STATS, HERO_HP } from '../config/balance';
import { ENEMIES, ENEMY_IDS, type EnemyId } from '../data/enemies';
import { ITEM_IDS, ITEMS } from '../data/items';
import { canBeMain, addItem, removeItem, run, setMain } from '../state';
import { canPlace, MASK, type OwnedItem } from '../systems/backpack';
import { computePower, gearSummary } from '../systems/synergy';
import { addPortrait, addText, Button, C, CATEGORY_COLORS, describeEnemyItem, describeItem, describeOwnedItem, H } from '../ui';

export class MainScene extends Phaser.Scene {
  private grid!: GridView<OwnedItem>;
  private info!: Phaser.GameObjects.Text;
  private message!: Phaser.GameObjects.Text;
  private enemyButtons = new Map<EnemyId, Button>();
  private portrait: Phaser.GameObjects.GameObject | null = null;
  private bagText!: Phaser.GameObjects.Text;
  /** Что сейчас под курсором (иначе в панели — сила снаряжения). */
  private hoverText: string | null = null;

  constructor() {
    super('Main');
  }

  create(): void {
    this.enemyButtons = new Map();
    this.portrait = null;
    this.hoverText = null;
    addText(this, L.title.x, L.title.y, 'Режим отладки: инвентарь и бой', 40, C.accent);
    const mb = L.menuButton;
    new Button(this, mb.x, mb.y, mb.w, mb.h, '← Меню', () => this.scene.start('Menu'), 22);

    // ─── Инвентарь ───
    // Инвентарь — сетка в сумке: картинка-подложка, сетка поверх без своих клеток.
    const g = L.grid;
    addBagUnderlay(this, g.x, g.y, g.cell, MASK.cols, MASK.rows);
    this.grid = new GridView<OwnedItem>(this, {
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
        if (canBeMain(it)) setMain(it.uid);
        else this.say(`${ITEMS[it.id].name} не может быть основным: нужно оружие с парированием`);
        this.refresh();
      },
      onChange: () => this.refresh(),
    });
    addText(
      this,
      L.help.x,
      L.help.y,
      [
        'ЛКМ — тащить, ПКМ — повернуть.',
        'За сетку — выбросить.',
        'Двойной клик по оружию — основное.',
      ].join('\n'),
      17,
      C.dim,
      { lineSpacing: 6, wordWrap: { width: g.cell * MASK.cols } },
    );
    this.message = addText(this, L.help.x, L.help.y + 88, '', 19, C.bad, { wordWrap: { width: g.cell * MASK.cols } });

    // ─── Описание ───
    const inf = L.info;
    this.add.rectangle(inf.x, inf.y, inf.w, inf.h, C.panel).setOrigin(0).setStrokeStyle(2, C.border);
    this.info = addText(this, inf.x + 20, inf.y + 18, '', 20, C.text, { wordWrap: { width: inf.w - 40 }, lineSpacing: 6 });

    // ─── Выдача предметов ───
    const pk = L.picker;
    addText(this, pk.x, pk.y - 40, 'Выдать предмет', 26, C.text);
    ITEM_IDS.forEach((id, i) => {
      const d = ITEMS[id];
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = pk.x + col * (pk.btnW + pk.gap) + pk.btnW / 2;
      const y = pk.listY + row * (pk.btnH + pk.gap) + pk.btnH / 2;
      new Button(this, x, y, pk.btnW, pk.btnH, `${d.name}  ${d.w}×${d.h}`, () => {
        if (addItem(id)) this.say('');
        else this.say(`Нет места для: ${d.name} (${d.w}×${d.h})`);
        this.grid.rebuild();
        this.refresh();
      }, 19).onHover((on) => this.setHover(on ? describeItem(id) : null));
    });

    // ─── Выбор врага ───
    const E = L.enemy;
    this.add.rectangle(0, E.y - 20, 1920, H - E.y + 20, 0x1b1822).setOrigin(0);
    addText(this, 80, E.y, 'Враг', 26, C.text);
    const eb = E.buttons;
    ENEMY_IDS.forEach((id, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const b = new Button(this, eb.x + col * (eb.w + eb.gap) + eb.w / 2, eb.y + row * (eb.h + eb.gap) + eb.h / 2, eb.w, eb.h, ENEMIES[id].name, () => this.selectEnemy(id), 22);
      this.enemyButtons.set(id, b);
    });
    this.bagText = addText(this, E.bag.x, E.bag.y, '', 17, C.text, { wordWrap: { width: E.bag.w }, lineSpacing: 4 });
    const f = E.fight;
    // {} — отладочный бой: без данных Phaser отдал бы сцене прошлые (например, бой с собеседником).
    new Button(this, f.x, f.y, f.w, f.h, 'В бой', () => this.scene.start('Battle', {}), 40);

    this.selectEnemy(run.enemy);
    this.refresh();
  }

  private selectEnemy(id: EnemyId): void {
    run.enemy = id;
    for (const [e, b] of this.enemyButtons) b.setSelected(e === id);
    this.portrait?.destroy();
    const p = L.enemy.portrait;
    this.portrait = addPortrait(this, p.x, p.y, p.w, p.h, id);
    const def = ENEMIES[id];
    const hp = Math.round(ENEMY_STATS[id].hp * ENEMY_STAT_MULT);
    const bag = [...new Set(def.bag.map((b) => b.item))].map((it) => `• ${describeEnemyItem(it)}`);
    this.bagText.setText([`${def.name}: здоровье ${hp}, сумка ${def.bagCols}×${def.bagRows}`, ...bag].join('\n'));
  }

  private say(text: string): void {
    this.message.setText(text);
  }

  private setHover(text: string | null): void {
    this.hoverText = text;
    this.refresh();
  }

  /** Метки соседства на предметах, основное оружие и панель описания. */
  private refresh(): void {
    const power = computePower(run.items);
    this.grid.setMain(run.mainUid);
    for (const it of run.items) {
      const p = power.powers.get(it.uid);
      if (!p) continue;
      this.grid.setBadges(it.uid, p.received.filter((e) => e.good && !e.inactive).length, p.received.filter((e) => !e.good && !e.inactive).length);
      this.grid.setDisabled(it.uid, p.disabled);
    }
    if (this.hoverText !== null) {
      this.info.setText(this.hoverText);
      return;
    }
    const s = gearSummary(run.items, power);
    const main = run.items.find((i) => i.uid === run.mainUid);
    const r = (n: number) => (Math.round(n * 10) / 10).toString();
    const lines = [
      'Сила снаряжения',
      '',
      `Здоровье героя: ${HERO_HP}`,
      `Урон в секунду: ${r(s.dps)}`,
      `Лечение в секунду: ${r(s.healPerSec)}`,
      s.selfPerSec ? `Урон себе в секунду: ${r(s.selfPerSec)}` : '',
      '',
      main ? `Основное оружие: ${ITEMS[main.id].name}` : 'Основного оружия нет — в бою атаки не отбить.',
      s.disabled.length ? `Отключены: ${s.disabled.map((id) => ITEMS[id].name).join(', ')}` : '',
      s.explosive.length ? `Могут взорваться в начале боя: ${s.explosive.map((e) => `${ITEMS[e.id].name} (${Math.round(e.chance * 100)}%)`).join(', ')}` : '',
      '',
      'Наведи на предмет — его характеристики и что ему дают соседи.',
    ];
    this.info.setText(lines.filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== '')).join('\n'));
  }
}
