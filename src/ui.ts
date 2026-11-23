// Общие элементы интерфейса прототипа: цвета, текст, кнопка, описания предметов словами.
// Шрифт интерфейса системный (FONT); досье сумки — антиквой Old Standard (SERIF) тёмными чернилами (INK).
import * as Phaser from 'phaser';
import { ENEMY_ITEM_STATS, ENEMY_STAT_MULT, HERO_HP, ITEM_STATS, PARRY_DAMAGE_MULT, type ItemStats } from './config/balance';
import { enemyKey, FONTS, MUSIC } from './config/assets';
import { FEEL } from './config/feel';
import { ENEMIES, type EnemyId } from './data/enemies';
import { ENEMY_CATEGORY_NAMES, ENEMY_ITEMS, type EnemyItemId } from './data/enemyItems';
import { CATEGORY_NAMES, ITEMS, type ItemCategory, type ItemId, type ParryPerkId } from './data/items';
import type { OwnedItem } from './systems/backpack';
import { auraText, computePower, gearSummary, type ItemPower } from './systems/synergy';

export type MusicTrack = keyof typeof MUSIC;

/** Трек, который сейчас должен звучать (живёт, пока открыта игра). */
let currentTrack: MusicTrack = 'game';

/**
 * Музыка игрового режима (звук общий для сцен): track — какой трек звучит (нет — тот же, что сейчас: бой с собеседником
 * не меняет музыку). Повторный вызов не перезапускает трек. Другой трек звучал — плавная смена (FEEL.music.crossfadeMs):
 * новый нарастает, старые стихают и останавливаются. Вызов в каждом create сцены добивает смену, если прошлую сцену
 * закрыли посреди затухания.
 */
export function playGameMusic(scene: Phaser.Scene, track: MusicTrack = currentTrack): void {
  const F = FEEL.music;
  currentTrack = track;
  const sounds = (Object.keys(MUSIC) as MusicTrack[]).map((id) => ({ id, m: scene.sound.get(MUSIC[id].key) as Phaser.Sound.WebAudioSound | null }));
  const switching = sounds.some((s) => s.id !== track && s.m?.isPlaying);
  for (const { id, m } of sounds) {
    if (id === track) continue;
    if (!m?.isPlaying) continue;
    scene.tweens.killTweensOf(m);
    scene.tweens.add({ targets: m, volume: 0, duration: F.crossfadeMs, onComplete: () => m.stop() });
  }
  const key = MUSIC[track].key;
  if (!scene.cache.audio.exists(key)) return;
  const m = (scene.sound.get(key) ?? scene.sound.add(key, { loop: true, volume: 0 })) as Phaser.Sound.WebAudioSound;
  scene.tweens.killTweensOf(m);
  if (!m.isPlaying) {
    m.setVolume(0);
    m.play();
  }
  scene.tweens.add({ targets: m, volume: F.volume, duration: switching ? F.crossfadeMs : F.fadeInMs });
}

/** Музыка стихает и останавливается (меню, режим отладки). */
export function stopGameMusic(scene: Phaser.Scene): void {
  for (const t of Object.values(MUSIC)) {
    const m = scene.sound.get(t.key) as Phaser.Sound.WebAudioSound | null;
    if (!m?.isPlaying) continue;
    scene.tweens.killTweensOf(m);
    scene.tweens.add({ targets: m, volume: 0, duration: FEEL.music.fadeOutMs, onComplete: () => m.stop() });
  }
}

/** Расстояние от точки (x, y) до отрезка (x1, y1)–(x2, y2): клинок парирования задел кружок, если оно не больше радиуса. */
export function segmentDist(x1: number, y1: number, x2: number, y2: number, x: number, y: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const k = Phaser.Math.Clamp(((x - x1) * dx + (y - y1) * dy) / len2, 0, 1);
  return Math.hypot(x - (x1 + k * dx), y - (y1 + k * dy));
}

let walkCursorCss: string | null = null;

/**
 * CSS-курсор «сюда можно идти» — след ноги (подошва, пятка, пять пальцев), нарисованный на холсте один раз.
 * Горячая точка — середина следа. Для setDefaultCursor; если холст недоступен — обычная «рука».
 */
export function walkCursor(): string {
  if (walkCursorCss) return walkCursorCss;
  const F = FEEL.walkCursor;
  const n = F.size;
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const g = c.getContext('2d');
  if (!g) return (walkCursorCss = 'pointer');
  g.translate(n / 2, n / 2);
  g.rotate((F.tilt * Math.PI) / 180);
  const u = n / 32;
  const blob = (x: number, y: number, rx: number, ry: number) => {
    g.beginPath();
    g.ellipse(x * u, y * u, rx * u, ry * u, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  };
  g.fillStyle = F.fill;
  g.strokeStyle = F.stroke;
  g.lineWidth = 1.6 * u;
  blob(0, 1, 5.6, 8); // подошва
  blob(0, 11, 4.2, 3.6); // пятка
  blob(-4.6, -9.4, 1.8, 2.1); // пальцы — от большого к мизинцу
  blob(-1.2, -11.2, 1.6, 1.9);
  blob(2, -10.6, 1.45, 1.7);
  blob(4.6, -8.8, 1.3, 1.5);
  blob(6.4, -6.4, 1.15, 1.3);
  return (walkCursorCss = `url(${c.toDataURL('image/png')}) ${n / 2} ${n / 2}, pointer`);
}

export const W = 1920;
export const H = 1080;
export const FONT = 'Arial, Helvetica, sans-serif';
/** Антиква досье (FONTS в assets.ts): обычная, курсив, жирная; запасной — Georgia. */
export const SERIF = `${FONTS.serif.key}, Georgia, serif`;
export const SERIF_ITALIC = `${FONTS.serifItalic.key}, Georgia, serif`;
export const SERIF_BOLD = `${FONTS.serifBold.key}, Georgia, serif`;

/** Чернила и сургуч на бумаге (досье, жетоны): основной текст, бледный, хорошее, плохое, золото основного оружия. */
export const INK = {
  text: '#2b1a0e',
  soft: '#6b4a2e',
  good: '#2f5a1f',
  bad: '#8a1c1c',
  gold: '#8a6414',
  line: 0x4a2e18,
  goodN: 0x2f5a1f,
  badN: 0x8a1c1c,
};

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

/**
 * Картинка с чёрным фоном вокруг (пергамент, лист досье): почти чёрные пиксели — в прозрачность, края плавно
 * (ярче cut[0] — прозрачно, до cut[1] — плавно). Текстура outKey создаётся один раз на игру; возвращает её ключ.
 */
export function cutBlackBackground(scene: Phaser.Scene, srcKey: string, outKey: string, cut: [number, number]): string {
  if (scene.textures.exists(outKey)) return outKey;
  const src = scene.textures.get(srcKey).getSourceImage() as HTMLImageElement;
  const t = scene.textures.createCanvas(outKey, src.width, src.height)!;
  const c = t.getContext();
  c.drawImage(src, 0, 0);
  const data = c.getImageData(0, 0, src.width, src.height);
  const d = data.data;
  const [lo, hi] = cut;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(d[i], d[i + 1], d[i + 2]);
    if (v < hi) d[i + 3] = Math.round((255 * Math.max(0, v - lo)) / (hi - lo));
  }
  c.putImageData(data, 0, 0);
  t.refresh();
  return outKey;
}

/** Нить соседства между двумя предметами в сетке: от кого, кому, подпись («+25% к урону»), хорошая ли, действует ли. */
export interface NeighborLink {
  from: number;
  to: number;
  label: string;
  good: boolean;
  inactive: boolean;
}

/** Нити соседства для предмета uid: что ему дают соседи и что он даёт соседям (по расчёту power). */
export function neighborLinks(uid: number, power = computePower([])): NeighborLink[] {
  return power.effects
    .filter((e) => (e.target === uid || e.source === uid) && e.source !== e.target)
    .map((e) => ({ from: e.source, to: e.target, label: e.label, good: e.good, inactive: !!e.inactive }));
}

/**
 * Сила снаряжения словами (панель описания инвентаря, пока ничего не под курсором): здоровье, урон и лечение в секунду,
 * основное оружие, отключённые и взрывоопасные предметы.
 */
export function describeGear(items: OwnedItem[], mainUid: number | null, power = computePower(items)): string {
  const s = gearSummary(items, power);
  const main = items.find((i) => i.uid === mainUid);
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
  return lines.filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== '')).join('\n');
}
