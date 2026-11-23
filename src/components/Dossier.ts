// Досье в сумке (BagWindow): лист бумаги справа от саквояжа, на нём чернилами антиквой — «Ведомость снаряжения»
// (пока мышь не на предмете) или карточка предмета: картинка, имя, категория и теги, характеристики с иконками,
// соседи (что дают ему и что даёт он), состояние и строка бесёнка внизу. Во время перетаскивания карточка
// показывает предмет так, как он встанет на новое место (предпросмотр соседства).
// Раскладка — MAP_LAYOUT.bag.dossier (лист и поле текста в пикселях листа). Контейнер стоит центром листа:
// так лист наклоняется и выезжает вокруг своей середины.
import * as Phaser from 'phaser';
import { HERO_HP, ITEM_STATS, PARRY_DAMAGE_MULT } from '../config/balance';
import { itemKey, MAP_LAYOUT } from '../config/assets';
import { FEEL } from '../config/feel';
import { CATEGORY_NAMES, ITEMS } from '../data/items';
import { TAGS } from '../data/tags';
import type { OwnedItem } from '../systems/backpack';
import { auraText, gearSummary, type PowerResult } from '../systems/synergy';
import { cutBlackBackground, hitRange, INK, SERIF, SERIF_BOLD, SERIF_ITALIC } from '../ui';

const PAPER_CUT = 'ui_dossier_paper_cut';

/** Чернильные значки характеристик (рисуются кодом). */
type Icon = 'damage' | 'cooldown' | 'heal' | 'charges' | 'hp' | 'aura' | 'parry' | 'self';

/** Что показать в карточке предмета сверх его описи. */
export interface CardOptions {
  main: boolean;
  /** Может быть основным, но не основной — подсказка про двойной клик. */
  canBeMain: boolean;
  /** Перетаскивание: 'ok' — так встанет сюда, 'bad' — сюда не помещается, 'drop' — за сумкой (выбросить). */
  preview?: 'ok' | 'bad' | 'drop' | null;
  /** Пометка внизу (например, «не может быть основным»). */
  note?: string;
}

export class Dossier extends Phaser.GameObjects.Container {
  /** Текущая страница листа и все запомненные (см. changed). */
  private sheet: Phaser.GameObjects.Container;
  private pages = new Map<string, Phaser.GameObjects.Container>();
  private shown = '';
  /** Размер листа на экране. */
  readonly w: number;
  readonly h: number;
  /** Поле текста (в координатах контейнера) и правая граница заголовка (обходит орла). */
  private cx: number;
  private cy: number;
  private cw: number;
  private ch: number;
  private headW: number;
  private headH: number;

  constructor(scene: Phaser.Scene) {
    const L = MAP_LAYOUT.bag.dossier;
    const key = cutBlackBackground(scene, L.paper.key, PAPER_CUT, FEEL.map.bag.paperCut);
    const src = scene.textures.get(key).getSourceImage();
    const k = L.h / src.height;
    const w = src.width * k;
    const h = L.h;
    super(scene, L.x + w / 2, L.y + h / 2);
    this.w = w;
    this.h = h;
    const paper = scene.add.image(-w / 2, -h / 2, key).setOrigin(0).setScale(k);
    this.cx = -w / 2 + L.content.x * k;
    this.cy = -h / 2 + L.content.y * k;
    this.cw = L.content.w * k;
    this.ch = L.content.h * k;
    this.headW = (L.eagle.x - L.content.x) * k - 12;
    this.headH = (L.eagle.y + L.eagle.h - L.content.y) * k;
    this.sheet = scene.add.container(this.cx, this.cy);
    this.add([paper, this.sheet]);
    scene.add.existing(this);
  }

  // ─── Ведомость снаряжения ────────────────────────────────────────────────

  /** Сила снаряжения: здоровье, урон и лечение в секунду крупно, основное оружие, предупреждения. */
  showLedger(items: OwnedItem[], mainUid: number | null, power: PowerResult): void {
    const s = gearSummary(items, power);
    if (!this.changed(`L|${mainUid}|${items.map((i) => i.id).join(',')}|${JSON.stringify(s)}`)) return;
    const r = (n: number) => (Math.round(n * 10) / 10).toString();
    let y = this.text(0, 0, 'Ведомость снаряжения', 30, INK.text, SERIF_BOLD, this.headW).height + 4;
    y += this.text(0, y, 'Опись имущества его превосходительства', 17, INK.soft, SERIF_ITALIC, this.headW).height;
    y = Math.max(y, this.headH * 0.6) + 12;
    y = this.rule(y) + 18;
    const rows: [Icon, string, string, string][] = [
      ['hp', `${HERO_HP}`, 'здоровье героя', INK.text],
      ['damage', r(s.dps), 'урона в секунду', INK.text],
      ['heal', r(s.healPerSec), 'лечения в секунду', INK.text],
    ];
    if (s.selfPerSec) rows.push(['self', r(s.selfPerSec), 'урона себе в секунду', INK.bad]);
    for (const [icon, value, label, color] of rows) {
      this.icon(icon, 0, y + 4, 34, color === INK.bad ? INK.badN : INK.line);
      const v = this.text(50, y - 4, value, 38, color, SERIF_BOLD);
      this.text(50 + v.width + 12, y + 14, label, 20, INK.soft, SERIF);
      y += 58;
    }
    y = this.rule(y + 4) + 16;
    y += this.text(0, y, 'Основное оружие', 18, INK.soft, SERIF_ITALIC).height + 8;
    const main = items.find((i) => i.uid === mainUid);
    if (main) {
      this.thumb(main, 0, y, 64);
      this.text(80, y + 16, ITEMS[main.id].name, 26, INK.gold, SERIF_BOLD);
      y += 76;
    } else {
      y += this.text(0, y, 'Нет — в бою атаки не отбить. Двойной клик по оружию в сумке — сделать основным.', 19, INK.bad, SERIF, this.cw).height + 10;
    }
    const warn: string[] = [];
    if (s.disabled.length) warn.push(`Отключены: ${s.disabled.map((id) => ITEMS[id].name).join(', ')}.`);
    if (s.explosive.length) warn.push(`Могут взорваться в начале боя: ${s.explosive.map((e) => `${ITEMS[e.id].name} (${Math.round(e.chance * 100)}%)`).join(', ')}.`);
    for (const line of warn) y += this.text(0, y, line, 18, INK.bad, SERIF, this.cw).height + 6;
    const tip = this.text(0, 0, 'Наведите на предмет — его опись и что ему дают соседи.', 17, INK.soft, SERIF_ITALIC, this.cw);
    tip.setY(this.ch - tip.height);
  }

  // ─── Карточка предмета ───────────────────────────────────────────────────

  /** Карточка предмета it по расчёту power (во время перетаскивания — расчёт с предметом на новом месте). */
  showItem(it: OwnedItem, power: PowerResult, items: OwnedItem[], o: CardOptions): void {
    const d = ITEMS[it.id];
    const p = power.powers.get(it.uid);
    const fx = power.effects.filter((e) => e.source === it.uid || e.target === it.uid).map((e) => `${e.source}>${e.target}:${e.label}:${e.inactive ?? ''}`);
    const stateKey = p ? `${JSON.stringify(p.final)}|${p.disabled}|${p.blockedBy}|${p.poisoned}` : '';
    if (!this.changed(`I|${it.uid}|${it.charges}|${stateKey}|${fx.join(';')}|${JSON.stringify(o)}`)) return;
    const base = p?.base ?? ITEM_STATS[it.id];
    const fin = p?.final ?? base;
    // Шапка: картинка, имя, категория; теги и «основное» — плашками.
    const box = 100;
    this.thumb(it, 0, 0, box);
    const nameW = this.headW - box - 16;
    const name = this.text(box + 16, 2, d.name, 30, INK.text, SERIF_BOLD, nameW);
    const sub = `${CATEGORY_NAMES[d.category]} · ${d.w}×${d.h} · ${d.mode === 'active' ? 'по нажатию в бою' : 'срабатывает сам'}`;
    const subT = this.text(box + 16, name.y + name.height + 2, sub, 17, INK.soft, SERIF_ITALIC, nameW);
    let cx = box + 16;
    let chipY = subT.y + subT.height + 8;
    const chips: [string, string][] = d.tags.map((t) => [TAGS[t].name, INK.soft]);
    if (o.main) chips.unshift(['основное оружие', INK.gold]);
    for (const [label, color] of chips) {
      const w = this.chip(cx, chipY, label, color);
      cx += w + 8;
      if (cx > nameW + box) {
        cx = box + 16;
        chipY += 30;
      }
    }
    let y = Math.max(box, chips.length ? chipY + 26 : subT.y + subT.height) + 14;
    y = this.rule(y) + 14;
    if (o.preview) {
      const msg = o.preview === 'ok' ? 'Если положить сюда:' : o.preview === 'bad' ? 'Сюда не помещается.' : 'Отпустите — предмет будет выброшен.';
      y += this.text(0, y, msg, 19, o.preview === 'ok' ? INK.good : INK.bad, SERIF_ITALIC, this.cw).height + 10;
    }
    // Характеристики: значок, подпись, число справа (с соседями — было/стало).
    const row = (icon: Icon, label: string, value?: string, was?: string, color: string = INK.text) => {
      this.icon(icon, 0, y + 2, 24, INK.line);
      const lab = this.text(36, y, label, 20, INK.text, SERIF, value ? this.cw - 150 : this.cw - 36);
      if (value) {
        const v = this.text(this.cw, y - 1, value, 22, color, SERIF_BOLD).setOrigin(1, 0);
        if (was) this.text(v.x - v.width - 10, y + 3, `было ${was}`, 16, INK.soft, SERIF_ITALIC).setOrigin(1, 0);
      }
      y += Math.max(32, lab.height + 8);
    };
    const changed = (a?: number, b?: number) => a !== undefined && b !== undefined && Math.abs(a - b) > 1e-9;
    if (fin.damage) row('damage', 'Урон', hitRange(fin.damage), changed(base.damage, fin.damage) ? hitRange(base.damage!) : undefined, changed(base.damage, fin.damage) ? INK.good : INK.text);
    if (fin.heal) row('heal', 'Лечение', hitRange(fin.heal), changed(base.heal, fin.heal) ? hitRange(base.heal!) : undefined, changed(base.heal, fin.heal) ? INK.good : INK.text);
    if (d.mode === 'passive' && base.cooldown) row('cooldown', 'Срабатывает раз в', `${base.cooldown} с`);
    if (d.mode === 'active') row('charges', 'Зарядов, потом исчезнет', `${it.charges ?? base.charges}`);
    else if (base.charges) row('charges', 'Срабатываний, потом исчезнет', `${it.charges ?? base.charges}`);
    const aura = auraText(it.id);
    if (aura) row('aura', aura.replace(/^аура: /, 'Аура: '));
    if (d.parryPerk) row('parry', `Им парируют: отбитый удар слабее на ${Math.round((1 - PARRY_DAMAGE_MULT) * 100)}%`);
    // Соседи: что дают ему и что даёт он.
    const got = p?.received ?? [];
    const gives = power.effects.filter((e) => e.source === it.uid && e.target !== it.uid);
    if (got.length || gives.length) {
      y += 6;
      y += this.text(0, y, 'Соседи', 18, INK.soft, SERIF_ITALIC).height + 4;
      const nameOf = (uid: number) => {
        const x = items.find((i) => i.uid === uid);
        return x ? ITEMS[x.id].name : '?';
      };
      for (const e of got) {
        const off = e.inactive ? ` — не действует: ${e.inactive}` : '';
        y += this.text(0, y, `• ${e.label} от «${nameOf(e.source)}» (${e.rule.title})${off}`, 18, e.inactive ? INK.soft : e.good ? INK.good : INK.bad, SERIF, this.cw).height + 4;
      }
      for (const e of gives) {
        const off = e.inactive ? ` — не действует: ${e.inactive}` : '';
        y += this.text(0, y, `• даёт «${nameOf(e.target)}»: ${e.label}${off}`, 18, e.inactive ? INK.soft : e.good ? INK.good : INK.bad, SERIF, this.cw).height + 4;
      }
    }
    // Состояние.
    const state: string[] = [];
    if (p?.blockedBy) state.push(`Отключён: ${p.blockedBy} — в бою не срабатывает.`);
    else if (p?.disabled) state.push('Отключён: в бою не срабатывает.');
    if (p?.poisoned) state.push('Отравлен: лечение ранит героя.');
    for (const s of state) y += this.text(0, y + 6, s, 19, INK.bad, SERIF_BOLD, this.cw).height + 8;
    // Низ листа: строка бесёнка, над ней подсказки.
    let bottom = this.ch;
    if (d.flavor) {
      const f = this.text(0, 0, d.flavor, 18, INK.soft, SERIF_ITALIC, this.cw, 4);
      f.setY(bottom - f.height);
      bottom = f.y - 8;
      this.rule(bottom, 0.35);
      bottom -= 12;
    }
    const hints = [o.note, !o.main && o.canBeMain && !o.preview ? 'Двойной клик — сделать основным оружием.' : ''].filter(Boolean) as string[];
    for (const h of hints.reverse()) {
      const t = this.text(0, 0, h, 17, o.note === h ? INK.bad : INK.soft, SERIF_ITALIC, this.cw);
      t.setY(bottom - t.height);
      bottom = t.y - 4;
    }
  }

  /** Приготовить карточку заранее (страница запоминается), не меняя того, что сейчас на листе. */
  prepareItem(it: OwnedItem, power: PowerResult, items: OwnedItem[], o: CardOptions): void {
    const key = this.shown;
    const sheet = this.sheet;
    this.showItem(it, power, items, o);
    // Пару кадров страница рисуется почти прозрачной — текстуры текста уходят в видеокарту заранее, потом прячется.
    const page = this.sheet.setAlpha(0.004);
    this.sheet = sheet.setVisible(true);
    this.shown = key;
    this.scene.time.delayedCall(40, () => {
      if (page.active && page !== this.sheet) page.setVisible(false);
      if (page.active) page.setAlpha(1);
    });
  }

  // ─── Рисование ───────────────────────────────────────────────────────────

  /**
   * Страницы листа по ключу содержимого: показанная однажды страница (ведомость, карточка предмета в этом состоянии)
   * запоминается и при повторе просто показывается — создавать тексты заново дорого. Старые вытесняются
   * (FEEL.map.bag.pageCache). Возвращает true, если страницы ещё не было: тогда this.sheet — новая пустая, её рисуют.
   */
  private changed(key: string): boolean {
    if (key === this.shown) return false;
    this.sheet.setVisible(false);
    this.shown = key;
    const cached = this.pages.get(key);
    if (cached) {
      this.sheet = cached.setVisible(true).setAlpha(1);
      return false;
    }
    this.sheet = this.scene.add.container(this.cx, this.cy);
    this.add(this.sheet);
    this.pages.set(key, this.sheet);
    for (const [k, page] of this.pages) {
      if (this.pages.size <= FEEL.map.bag.pageCache) break;
      if (page === this.sheet) continue;
      page.destroy();
      this.pages.delete(k);
    }
    return true;
  }

  private text(x: number, y: number, s: string, size: number, color: string, font: string, wrap?: number, lineSpacing = 2): Phaser.GameObjects.Text {
    const t = this.scene.add.text(x, y, s, { fontFamily: font, fontSize: `${size}px`, color, lineSpacing, ...(wrap ? { wordWrap: { width: wrap, useAdvancedWrap: true } } : {}) });
    this.sheet.add(t);
    return t;
  }

  /** Двойная чернильная черта на всю ширину поля; возвращает её низ. */
  private rule(y: number, alpha = 0.7): number {
    const g = this.scene.add.graphics();
    g.lineStyle(1.5, INK.line, alpha).lineBetween(0, y, this.cw, y).lineBetween(0, y + 4, this.cw, y + 4);
    this.sheet.add(g);
    return y + 4;
  }

  /** Плашка-тег: подпись в рамке со скруглёнными углами; возвращает ширину. */
  private chip(x: number, y: number, label: string, color: string): number {
    const t = this.text(x + 10, y + 3, label, 15, color, SERIF_ITALIC);
    const g = this.scene.add.graphics();
    g.lineStyle(1.5, Phaser.Display.Color.HexStringToColor(color).color, 0.9).strokeRoundedRect(x, y, t.width + 20, 24, 10);
    this.sheet.add(g);
    return t.width + 20;
  }

  /** Картинка предмета, вписанная в квадрат size (нет картинки — плашка с именем), в тонкой рамке. */
  private thumb(it: OwnedItem, x: number, y: number, size: number): void {
    const g = this.scene.add.graphics();
    g.fillStyle(INK.line, 0.08).fillRect(x, y, size, size).lineStyle(1.5, INK.line, 0.45).strokeRect(x, y, size, size);
    this.sheet.add(g);
    const key = itemKey(it.id);
    if (this.scene.textures.exists(key)) {
      const img = this.scene.add.image(x + size / 2, y + size / 2, key);
      img.setScale(Math.min((size - 10) / img.width, (size - 10) / img.height));
      this.sheet.add(img);
    } else this.text(x + size / 2, y + size / 2, ITEMS[it.id].name, 14, INK.text, SERIF, size - 8).setOrigin(0.5);
  }

  /** Чернильный значок size×size с левым верхним углом (x, y). */
  private icon(kind: Icon, x: number, y: number, s: number, color: number): void {
    const g = this.scene.add.graphics({ x, y });
    g.fillStyle(color, 1).lineStyle(Math.max(2, s / 12), color, 1);
    const u = s / 24;
    switch (kind) {
      case 'damage': // клинок наискось с гардой
        g.lineStyle(3.2 * u, color, 1).lineBetween(5 * u, 19 * u, 20 * u, 4 * u);
        g.lineStyle(2.4 * u, color, 1).lineBetween(4 * u, 13 * u, 11 * u, 20 * u);
        g.fillCircle(3.5 * u, 20.5 * u, 2 * u);
        break;
      case 'cooldown': // песочные часы
        g.lineBetween(5 * u, 3 * u, 19 * u, 3 * u).lineBetween(5 * u, 21 * u, 19 * u, 21 * u);
        g.fillTriangle(7 * u, 5 * u, 17 * u, 5 * u, 12 * u, 12 * u);
        g.fillTriangle(12 * u, 13 * u, 7 * u, 19 * u, 17 * u, 19 * u);
        break;
      case 'heal': // крест
        g.fillRect(9.5 * u, 3 * u, 5 * u, 18 * u).fillRect(3 * u, 9.5 * u, 18 * u, 5 * u);
        break;
      case 'hp': // сердце
        g.fillCircle(8 * u, 9 * u, 5.2 * u).fillCircle(16 * u, 9 * u, 5.2 * u);
        g.fillTriangle(3 * u, 11 * u, 21 * u, 11 * u, 12 * u, 21 * u);
        break;
      case 'charges': // три капли-заряда
        for (const cx of [6, 12, 18]) g.fillCircle(cx * u, 14 * u, 3.2 * u).fillTriangle((cx - 3) * u, 13 * u, (cx + 3) * u, 13 * u, cx * u, 6 * u);
        break;
      case 'aura': // солнце с лучами
        g.fillCircle(12 * u, 12 * u, 4.5 * u);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.lineBetween(12 * u + Math.cos(a) * 7 * u, 12 * u + Math.sin(a) * 7 * u, 12 * u + Math.cos(a) * 10.5 * u, 12 * u + Math.sin(a) * 10.5 * u);
        }
        break;
      case 'parry': // щит
        g.fillTriangle(4 * u, 9 * u, 20 * u, 9 * u, 12 * u, 22 * u).fillRect(4 * u, 3 * u, 16 * u, 6.5 * u);
        break;
      case 'self': // капля крови
        g.fillCircle(12 * u, 15 * u, 6 * u).fillTriangle(6.4 * u, 13 * u, 17.6 * u, 13 * u, 12 * u, 2 * u);
        break;
    }
    this.sheet.add(g);
  }
}
