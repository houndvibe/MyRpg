// Общие элементы интерфейса прототипа: цвета, текст, кнопка, описания предметов словами.
// Ни картинок, ни шрифтов: всё рисуется фигурами и системным шрифтом.
import * as Phaser from 'phaser';
import { ENEMY_ITEM_STATS, ENEMY_STAT_MULT, ITEM_STATS, PARRY_DAMAGE_MULT, type ItemStats } from './config/balance';
import { enemyKey } from './config/assets';
import { ENEMIES, type EnemyId } from './data/enemies';
import { ENEMY_CATEGORY_NAMES, ENEMY_ITEMS, type EnemyItemId } from './data/enemyItems';
import { CATEGORY_NAMES, ITEMS, type ItemCategory, type ItemId, type ParryPerkId } from './data/items';
import type { OwnedItem } from './systems/backpack';
import { auraText, type ItemPower } from './systems/synergy';

export const W = 1920;
export const H = 1080;
export const FONT = 'Arial, Helvetica, sans-serif';

export const C = {
  bg: 0x14121a,
  panel: 0x231f2b,
  border: 0x4a4357,
  btn: 0x3a3346,
  btnHover: 0x52486a,
  btnOff: 0x26222d,
  btnOn: 0x6b5a2a,
  cell: 0x2c2836,
  cellLine: 0x4a4357,
  text: '#ece6d6',
  dim: '#8f889c',
  accent: '#e0b65a',
  good: '#7fd47f',
  bad: '#e06060',
  block: '#7fb6e0',
};

/** Цвет плитки предмета по категории (картинок предметов в прототипе нет). */
export const CATEGORY_COLORS: Record<ItemCategory, number> = {
  weapon: 0x7a4a3a,
  amulet: 0x6a4f86,
  alchemy: 0x3d7360,
  food: 0x7a6a35,
};

export function addText(scene: Phaser.Scene, x: number, y: number, text: string, size = 22, color = C.text, style: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, color, ...style });
}

/** Прямоугольная кнопка с подписью. x, y — центр. */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;
  private enabled = true;
  private selected = false;
  private hover = false;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string, onClick: () => void, size = 22) {
    super(scene, x, y);
    this.bg = scene.add.rectangle(0, 0, w, h, C.btn).setStrokeStyle(2, C.border);
    this.label = addText(scene, 0, 0, text, size, C.text, { align: 'center' }).setOrigin(0.5);
    this.add([this.bg, this.label]);
    this.setSize(w, h);
    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on('pointerover', () => {
      this.hover = true;
      this.paint();
    });
    this.bg.on('pointerout', () => {
      this.hover = false;
      this.paint();
    });
    this.bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.button === 0 && this.enabled) onClick();
    });
    scene.add.existing(this);
  }

  /** Наведение на кнопку (для подсказок). */
  onHover(fn: (on: boolean) => void): this {
    this.bg.on('pointerover', () => fn(true));
    this.bg.on('pointerout', () => fn(false));
    return this;
  }

  setLabel(text: string): this {
    this.label.setText(text);
    return this;
  }

  setEnabled(on: boolean): this {
    this.enabled = on;
    this.paint();
    return this;
  }

  setSelected(on: boolean): this {
    this.selected = on;
    this.paint();
    return this;
  }

  private paint(): void {
    const fill = !this.enabled ? C.btnOff : this.selected ? C.btnOn : this.hover ? C.btnHover : C.btn;
    this.bg.setFillStyle(fill);
    this.label.setColor(this.enabled ? C.text : C.dim);
  }
}

/**
 * Портрет врага, вписанный в w×h с центром (x, y). Нет картинки — тёмная плашка с именем.
 * Возвращает объект, который можно двигать и красить.
 */
export function addPortrait(scene: Phaser.Scene, x: number, y: number, w: number, h: number, enemy: EnemyId): Phaser.GameObjects.Image | Phaser.GameObjects.Container {
  const key = enemyKey(enemy);
  if (scene.textures.exists(key)) {
    const img = scene.add.image(x, y, key);
    return img.setScale(Math.min(w / img.width, h / img.height));
  }
  const box = scene.add.container(x, y);
  box.add(scene.add.rectangle(0, 0, w, h, C.panel).setStrokeStyle(2, C.border));
  box.add(addText(scene, 0, 0, ENEMIES[enemy].name, 22, C.dim, { align: 'center', wordWrap: { width: w - 10 } }).setOrigin(0.5));
  return box.setSize(w, h);
}

/**
 * Сколько реально выйдет за срабатывание (гайд 1.1): бой дробный с переносом остатка, поэтому 37.5 — это удары
 * по 37 и 38. Целое число показывается как есть, дробное — диапазоном «37–38».
 */
export function hitRange(x: number): string {
  const lo = Math.floor(x + 1e-9);
  return x - lo < 1e-9 ? `${lo}` : `${lo}–${lo + 1}`;
}

/** Перк основного оружия словами. */
const PARRY_PERK_TEXT: Record<ParryPerkId, string> = {
  sword: `парированный удар слабее на ${Math.round((1 - PARRY_DAMAGE_MULT) * 100)}%`,
};

/** Характеристики строкой: «урон 6 · раз в 1.5 с». */
export function statsLine(id: ItemId, s: ItemStats, charges?: number): string {
  const d = ITEMS[id];
  const parts: string[] = [];
  if (s.damage) parts.push(`урон ${hitRange(s.damage)}`);
  if (s.heal) parts.push(`лечение ${hitRange(s.heal)}`);
  const aura = auraText(id);
  if (aura) parts.push(aura);
  if (d.parryPerk) parts.push(`основное оружие: ${PARRY_PERK_TEXT[d.parryPerk]}`);
  if (d.mode === 'passive' && s.cooldown) parts.push(`раз в ${s.cooldown} с`);
  if (d.mode === 'active') parts.push(`зарядов: ${charges ?? s.charges} (кончатся — предмет исчезнет)`);
  else if (s.charges) parts.push(`срабатываний: ${charges ?? s.charges} (кончатся — предмет исчезнет)`);
  return parts.join(' · ');
}

/** Предмет из списка выдачи: «Оружие · 1×3 · урон 6 · раз в 1.5 с». */
export function describeItem(id: ItemId): string {
  const d = ITEMS[id];
  return `${d.name} — ${CATEGORY_NAMES[d.category]}, ${d.w}×${d.h}\n${statsLine(id, ITEM_STATS[id])}`;
}

/**
 * Подсказка для предмета героя: имя, база, итог с соседями и построчно — от кого что пришло.
 * powers/items — текущий расчёт соседства (без них — только база).
 */
export function describeOwnedItem(it: OwnedItem, powers?: Map<number, ItemPower>, items: OwnedItem[] = []): string {
  const d = ITEMS[it.id];
  const head = `${d.name} — ${CATEGORY_NAMES[d.category]}`;
  const p = powers?.get(it.uid);
  const base = p?.base ?? ITEM_STATS[it.id];
  const lines = [head, `База: ${statsLine(it.id, base, it.charges)}`];
  if (!p) return lines.join('\n');
  if (p.received.some((e) => e.rule.effect.kind === 'boost')) lines.push(`Итог: ${statsLine(it.id, p.final, it.charges)}`);
  for (const e of p.received) {
    const src = items.find((i) => i.uid === e.source);
    lines.push(`   ${src ? ITEMS[src.id].name : '?'} (${e.rule.title}): ${e.label}${e.inactive ? ` — не действует: ${e.inactive}` : ''}`);
  }
  if (p.blockedBy) lines.push(`ОТКЛЮЧЁН: ${p.blockedBy} — в бою не срабатывает.`);
  else if (p.disabled) lines.push('ОТКЛЮЧЁН: в бою не срабатывает.');
  if (p.poisoned) lines.push('ОТРАВЛЕН: лечение ранит героя.');
  return lines.join('\n');
}

/** «Снаряд · урон 2 · раз в 1.5 с · зарядов: 2» — с учётом силы врагов (ENEMY_STAT_MULT). */
export function describeEnemyItem(id: EnemyItemId): string {
  const d = ENEMY_ITEMS[id];
  const s = ENEMY_ITEM_STATS[id];
  const parts: string[] = [ENEMY_CATEGORY_NAMES[d.category], `урон ${hitRange(s.damage * ENEMY_STAT_MULT)}`, `${s.cooldown} с на замах`];
  if (s.charges) parts.push(`зарядов: ${s.charges}`);
  return `${d.name}: ${parts.join(' · ')}`;
}
