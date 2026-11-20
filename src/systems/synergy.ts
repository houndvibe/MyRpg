// Расчёт соседства предметов в инвентаре героя. Без Phaser — используется инвентарём и боем.
// Вход — предметы героя (учитываются только лежащие в сетке). Выход — итоговые характеристики каждого
// предмета и список применённых эффектов с источниками.
import { BATTLE_TICK, ITEM_STATS, MIN_COOLDOWN, SYNERGY_STACK, type ItemStats } from '../config/balance';
import { CATEGORY_NAMES, ITEMS, type ItemId } from '../data/items';
import { SYNERGIES, type Selector, type SynergyRule } from '../data/synergies';
import { TAGS } from '../data/tags';
import { cellsOf, footprint, type OwnedItem } from './backpack';

/** Характеристики, которые растут от 'all'. */
const EFFECT_STATS = ['damage', 'heal'] as const;

export interface AppliedEffect {
  rule: SynergyRule;
  source: number;
  target: number;
  /** Короткая подпись для метки: «+25% урон», «+10% урон, лечение», «Сгорит». */
  label: string;
  /** Хорошо для цели или плохо. */
  good: boolean;
  /** Бонус есть, но не действует (правила стака): причина для подсказки. На итог и метки не влияет. */
  inactive?: string;
}

export interface ItemPower {
  uid: number;
  /** Характеристики предмета без соседей. */
  base: ItemStats;
  /** Итог с соседями. */
  final: ItemStats;
  disabled: boolean;
  /** Отключён не соседом, а извне (BlockRule в computePower): причина для подсказки. */
  blockedBy: string | null;
  poisoned: boolean;
  /** Шанс взрыва в начале боя (0 — не взорвётся) и урон герою от взрыва. */
  explodeChance: number;
  explodeDamage: number;
  /** Сила ауры амулета: 1 + усиления от соседей. */
  aura: number;
  /** Эффекты, которые получил этот предмет. */
  received: AppliedEffect[];
}

export interface PowerResult {
  powers: Map<number, ItemPower>;
  effects: AppliedEffect[];
}

/** Предмет — источник ауры (правило boost с aura). Аура не усиливает ауру (гайд 2.1): такие не дают auraBoost. */
function isAuraSource(id: ItemId): boolean {
  return SYNERGIES.some((r) => r.effect.kind === 'boost' && !!r.effect.aura && matches(r.source, id));
}

/** Страховочный кап на сумму положительных бонусов соседства (гайд 2.1): сверх capSoft — с долей overShare, не выше capHard. */
export function capBonus(x: number): number {
  const C = SYNERGY_STACK;
  return Math.min(C.capHard, Math.min(x, C.capSoft) + C.overShare * Math.max(0, x - C.capSoft));
}

/** Перезарядка по правилам гайда (1.3): кратна тику боя и не меньше MIN_COOLDOWN. */
function legalCooldown(sec: number): number {
  return Math.max(MIN_COOLDOWN, Math.round(sec / BATTLE_TICK) * BATTLE_TICK);
}

export function matches(sel: Selector, id: ItemId): boolean {
  const d = ITEMS[id];
  if (sel.item && sel.item !== id) return false;
  if (sel.tag && !d.tags.includes(sel.tag)) return false;
  if (sel.category && sel.category !== d.category) return false;
  return true;
}

/** Соседи по стороне клетки (без диагоналей). Каждая пара — один раз, даже если касается несколькими клетками. */
export function adjacency(items: OwnedItem[]): Map<number, number[]> {
  const owner = new Map<string, number>();
  for (const it of items) {
    const f = footprint(it.id, it.rotated);
    for (const [c, r] of cellsOf(it, f.w, f.h)) owner.set(`${c},${r}`, it.uid);
  }
  const adj = new Map<number, Set<number>>(items.map((it) => [it.uid, new Set<number>()]));
  for (const it of items) {
    const f = footprint(it.id, it.rotated);
    for (const [c, r] of cellsOf(it, f.w, f.h)) {
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const other = owner.get(`${c + dc},${r + dr}`);
        if (other !== undefined && other !== it.uid) adj.get(it.uid)!.add(other);
      }
    }
  }
  return new Map([...adj].map(([k, v]) => [k, [...v]]));
}

const pct = (x: number) => `${x > 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)}%`;

/** Как называется характеристика в метке соседства. */
const STAT_NAMES: Record<(typeof EFFECT_STATS)[number], string> = {
  damage: 'урон',
  heal: 'лечение',
};

/** Что именно усиливает прибавка у этого предмета: «урон» или все его характеристики («урон, лечение»). */
function boostWhat(base: ItemStats, stat: 'damage' | 'all'): string {
  if (stat === 'damage') return STAT_NAMES.damage;
  return EFFECT_STATS.filter((k) => !!base[k]).map((k) => STAT_NAMES[k]).join(', ');
}

/** Есть ли у характеристик цели то, на что действует прибавка. */
function hasStat(s: ItemStats, stat: 'damage' | 'all'): boolean {
  return stat === 'damage' ? !!s.damage : EFFECT_STATS.some((k) => !!s[k]);
}

/** Внешний запрет предмета: причина (её видно в подсказке) или null — предмет работает. */
export type BlockRule = (id: ItemId) => string | null;

/**
 * Итоговые характеристики всех предметов в сетке с учётом уровня и соседей.
 * blocked — внешние запреты (например, от врага): такой предмет отключён и ни на кого не влияет.
 */
export function computePower(allItems: OwnedItem[], blocked?: BlockRule): PowerResult {
  const items = allItems.filter((i) => i.inGrid);
  const byUid = new Map(items.map((i) => [i.uid, i]));
  const adj = adjacency(items);
  const powers = new Map<number, ItemPower>();
  for (const it of items) {
    const base: ItemStats = { ...ITEM_STATS[it.id] };
    const blockedBy = blocked?.(it.id) ?? null;
    powers.set(it.uid, {
      uid: it.uid,
      base,
      final: { ...base },
      disabled: blockedBy !== null,
      blockedBy,
      poisoned: false,
      explodeChance: 0,
      explodeDamage: 0,
      aura: 1,
      received: [],
    });
  }
  const effects: AppliedEffect[] = [];
  const add = (rule: SynergyRule, source: number, target: number, label: string, good: boolean, inactive?: string) => {
    const e: AppliedEffect = { rule, source, target, label, good, inactive };
    effects.push(e);
    powers.get(target)!.received.push(e);
  };
  /** Все пары (источник, цель) по правилу; disabledOk — могут ли действовать отключённые источники. */
  const pairs = (rule: SynergyRule, disabledOk: boolean): [OwnedItem, OwnedItem][] => {
    const out: [OwnedItem, OwnedItem][] = [];
    for (const s of items) {
      const sp = powers.get(s.uid)!;
      // Запрещённый извне предмет не влияет ни на кого, даже отключениями.
      if (!matches(rule.source, s.id) || sp.blockedBy !== null || (!disabledOk && sp.disabled)) continue;
      for (const t of adj.get(s.uid)!) {
        const target = byUid.get(t)!;
        if (matches(rule.target, target.id)) out.push([s, target]);
      }
    }
    return out;
  };

  // 1. Отключения: отключённый предмет дальше ни на кого не влияет.
  for (const rule of SYNERGIES) {
    if (rule.effect.kind !== 'disable') continue;
    for (const [s, t] of pairs(rule, true)) {
      powers.get(t.uid)!.disabled = true;
      add(rule, s.uid, t.uid, rule.effect.label, false);
    }
  }
  // 2. Отравление, взрыв, усиление ауры.
  for (const rule of SYNERGIES) {
    const ef = rule.effect;
    if (ef.kind !== 'poison' && ef.kind !== 'explode' && ef.kind !== 'auraBoost') continue;
    for (const [s, t] of pairs(rule, false)) {
      const p = powers.get(t.uid)!;
      if (ef.kind === 'poison') {
        if (!p.base.heal) continue;
        p.poisoned = true;
        add(rule, s.uid, t.uid, 'Отравлена', false);
      } else if (ef.kind === 'explode') {
        p.explodeChance = Math.max(p.explodeChance, ef.chance);
        p.explodeDamage = Math.max(p.explodeDamage, ef.damage);
        add(rule, s.uid, t.uid, `Может взорваться (${Math.round(ef.chance * 100)}%)`, false);
      } else {
        if (!isAuraSource(t.id)) continue; // усиливать нечего
        if (isAuraSource(s.id)) {
          add(rule, s.uid, t.uid, `${pct(ef.amount)} к ауре`, true, 'аура не усиливает ауру');
          continue;
        }
        p.aura += ef.amount;
        add(rule, s.uid, t.uid, `${pct(ef.amount)} к ауре`, true);
      }
    }
  }
  // 3. Прибавки — «увеличение» (гайд 1.2): складываются в одну сумму и применяются к базе. Правила стака (гайд 2.1):
  //    одно правило от нескольких соседей не складывается — работает сильнейший источник; положительных бонусов
  //    действует не больше SYNERGY_STACK.maxAuras сильнейших; сумма положительных проходит через кап; штрафы — все.
  type Boost = { rule: SynergyRule; source: number; amount: number; stat: 'damage' | 'all'; label: string };
  const boosts = new Map<number, Boost[]>(items.map((i) => [i.uid, []]));
  for (const rule of SYNERGIES) {
    const ef = rule.effect;
    if (ef.kind !== 'boost') continue;
    for (const [s, t] of pairs(rule, false)) {
      const p = powers.get(t.uid)!;
      if (!hasStat(p.base, ef.stat)) continue;
      // Аура: × усиления от соседей.
      const amount = ef.aura ? ef.amount * powers.get(s.uid)!.aura : ef.amount;
      boosts.get(t.uid)!.push({ rule, source: s.uid, amount, stat: ef.stat, label: `${pct(amount)} ${boostWhat(p.base, ef.stat)}` });
    }
  }
  for (const p of powers.values()) {
    const list = boosts.get(p.uid)!;
    // Сильнейший источник каждого правила.
    const best = new Map<string, Boost>();
    for (const b of list) {
      const cur = best.get(b.rule.id);
      if (!cur || Math.abs(b.amount) > Math.abs(cur.amount)) best.set(b.rule.id, b);
    }
    const positive = [...best.values()].filter((b) => b.amount > 0).sort((a, b) => b.amount - a.amount);
    const active = new Set<Boost>([...positive.slice(0, SYNERGY_STACK.maxAuras), ...[...best.values()].filter((b) => b.amount <= 0)]);
    const sum = { damage: { pos: 0, neg: 0 }, all: { pos: 0, neg: 0 } };
    for (const b of list) {
      if (!active.has(b)) {
        const why = best.get(b.rule.id) !== b ? 'такой же бонус от другого соседа сильнее' : `действуют только ${SYNERGY_STACK.maxAuras} сильнейших бонуса`;
        add(b.rule, b.source, p.uid, b.label, b.amount > 0, why);
        continue;
      }
      if (b.amount > 0) sum[b.stat].pos += b.amount;
      else sum[b.stat].neg += b.amount;
      add(b.rule, b.source, p.uid, b.label, b.amount > 0);
    }
    for (const k of EFFECT_STATS) {
      if (p.base[k] === undefined) continue;
      const pos = sum.all.pos + (k === 'damage' ? sum.damage.pos : 0);
      const neg = sum.all.neg + (k === 'damage' ? sum.damage.neg : 0);
      p.final[k] = Math.max(0, p.base[k]! * (1 + capBonus(pos) + neg));
    }
  }
  // 4. Замедление от соседей: к перезарядке цели — сумма от каждого соседа.
  const slowBy = new Map<number, number>();
  for (const rule of SYNERGIES) {
    const ef = rule.effect;
    if (ef.kind !== 'slow') continue;
    for (const [s, t] of pairs(rule, false)) {
      const p = powers.get(t.uid)!;
      if (!p.base.cooldown) continue;
      slowBy.set(t.uid, (slowBy.get(t.uid) ?? 0) + ef.seconds);
      add(rule, s.uid, t.uid, `+${ef.seconds} с к перезарядке`, false);
    }
  }
  for (const p of powers.values()) {
    if (p.base.cooldown === undefined) continue;
    p.final.cooldown = legalCooldown(p.base.cooldown + (slowBy.get(p.uid) ?? 0));
  }
  return { powers, effects };
}

/** «Сила снаряжения»: то же, что увидит бой. Активные предметы (эликсиры) в «в секунду» не входят. */
export interface GearSummary {
  dps: number;
  healPerSec: number;
  /** Урон себе в секунду: отравленная еда. */
  selfPerSec: number;
  disabled: ItemId[];
  explosive: { id: ItemId; chance: number }[];
}

export function gearSummary(allItems: OwnedItem[], result: PowerResult): GearSummary {
  const sum: GearSummary = { dps: 0, healPerSec: 0, selfPerSec: 0, disabled: [], explosive: [] };
  for (const it of allItems.filter((i) => i.inGrid)) {
    const p = result.powers.get(it.uid)!;
    if (p.disabled) {
      sum.disabled.push(it.id);
      continue;
    }
    if (p.explodeChance > 0) sum.explosive.push({ id: it.id, chance: p.explodeChance });
    const s = p.final;
    if (ITEMS[it.id].mode !== 'passive' || !s.cooldown) continue;
    if (s.damage) sum.dps += s.damage / s.cooldown;
    if (s.heal) {
      if (p.poisoned) sum.selfPerSec += s.heal / s.cooldown;
      else sum.healPerSec += s.heal / s.cooldown;
    }
  }
  return sum;
}

/** Название цели правила для подсказки: тег, категория или предмет — по-русски. */
function targetName(sel: Selector): string {
  if (sel.tag) return TAGS[sel.tag].name;
  if (sel.category) return CATEGORY_NAMES[sel.category];
  return sel.item ? ITEMS[sel.item].name : '';
}

/** Описание ауры предмета-источника для подсказки: «соседнее Оружие +10% к урону». */
export function auraText(id: ItemId): string | null {
  const rule = SYNERGIES.find((r) => r.source.item === id && r.effect.kind === 'boost');
  if (!rule || rule.effect.kind !== 'boost') return null;
  const target = targetName(rule.target);
  return `аура: соседнее ${target} ${pct(rule.effect.amount)} к ${rule.effect.stat === 'damage' ? 'урону' : 'эффекту'}`;
}
