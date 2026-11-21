// Логика боя без Phaser и графики. Сцена двигает время (step), передаёт нажатия (useActive, parry) и рисует события (drain).
// По гайду (docs/balance-guide.md): бой идёт фиксированным тиком BATTLE_TICK (1.3); урон и лечение дробные, округление
// вниз только при списании здоровья, остаток переносится на следующее срабатывание того же предмета (1.1);
// затяжной бой заканчивается нарастающим уроном врага FATIGUE (2.6).
// Характеристики предметов героя — итоговые с учётом соседства (src/systems/synergy.ts);
// когда предмет исчезает, соседство пересчитывается сразу. Бой — с одним врагом (с модификатором или без).
import {
  BATTLE_TICK,
  ENEMY_ITEM_STATS,
  ENEMY_STAT_MULT,
  ENEMY_STATS,
  FATIGUE,
  HERO_HP,
  MODIFIER_STATS,
  PARRY_DAMAGE_MULT,
  type EnemyItemStats,
  type ItemStats,
} from '../config/balance';
import { FEEL } from '../config/feel';
import { ENEMIES, type EnemyId } from '../data/enemies';
import { ENEMY_ITEMS, type EnemyItemDef, type EnemyItemId } from '../data/enemyItems';
import { ITEMS, type ItemDef, type ItemId } from '../data/items';
import type { ModifierId } from '../data/modifiers';
import type { OwnedItem, Placement } from './backpack';
import { computePower, type AppliedEffect, type ItemPower } from './synergy';

/** Источник случайности (0..1): Math.random или генератор с зерном. */
export type Rng = () => number;

/** Множитель урона предметов врага от модификатора (пьяный). */
export function enemyDamageMult(mod: ModifierId | null): number {
  return mod === 'drunk' ? 1 + MODIFIER_STATS.drunkDamage : 1;
}

export interface HeroSlot {
  item: OwnedItem;
  def: ItemDef;
  /** Итоговые характеристики (с соседями). */
  stats: ItemStats;
  disabled: boolean;
  poisoned: boolean;
  /** Таймер перезарядки пассивного предмета. */
  timer: number;
  /** Оставшиеся заряды (Infinity — без счёта). */
  charges: number;
}

export interface EnemySlot extends Placement {
  def: EnemyItemDef;
  stats: EnemyItemStats;
  /** Infinity — без ограничения зарядов. */
  charges: number;
}

export interface EnemyState {
  id: EnemyId;
  mod: ModifierId | null;
  hp: number;
  maxHp: number;
  /** Подготовка текущего действия. */
  actionTimer: number;
  slots: EnemySlot[];
  /** Слоты в порядке использования: priority, при равенстве — порядок в раскладке. */
  order: EnemySlot[];
}

/** Что произошло за шаг — сцена превращает это во вспышки, цифры и надписи. */
export type BattleEvent =
  | { type: 'heroItem'; uid: number; name: string; active: boolean }
  | { type: 'heroCharge'; uid: number; left: number }
  | { type: 'enemyItem'; uid: number; name: string }
  | { type: 'enemyCharge'; uid: number; left: number }
  | { type: 'enemyHit'; taken: number; item: ItemId }
  /** self — урон себе (взрыв, отравленная еда); parried — удар врага был отбит. */
  | { type: 'heroHit'; taken: number; self: boolean; parried?: boolean }
  | { type: 'heroHeal'; amount: number }
  // Соседство: сгорел (disable), снова работает, отравлен, взорвался в начале боя, потерял бонус соседа, отключён извне
  | { type: 'burned'; uid: number; name: string; reason: string }
  | { type: 'enabled'; uid: number; name: string }
  | { type: 'poisoned'; uid: number; name: string }
  | { type: 'explode'; uid: number; name: string; damage: number }
  | { type: 'bonusLost'; uid: number; name: string }
  | { type: 'blocked'; uid: number; name: string; reason: string }
  // Модификатор «Пьяный»: удар промахнулся
  | { type: 'enemyMiss'; name: string }
  /** Затяжной бой: урон врага вырос (bonus — прибавка к урону, 0.1 = +10%). */
  | { type: 'fatigue'; bonus: number }
  // Парирование: атака врага появилась на поле (windup) и пришла (strike: окно закрылось или игрок отбил)
  | { type: 'windup'; id: number; uid: number; item: EnemyItemId; kind: AttackKind }
  | { type: 'strike'; id: number; parried: boolean };

/** Вид кружка атаки на поле. Сейчас один — обычный удар на месте; новые рисунки атак добавляются сюда. */
export type AttackKind = 'hit';

/** Атака врага «в полёте»: кружок висит, удар придёт, когда left (сек реального времени) дойдёт до нуля. */
export interface PendingAttack {
  id: number;
  slot: EnemySlot;
  left: number;
  total: number;
  kind: AttackKind;
}

/** fight — идёт бой; won — враг повержен; lost — герой погиб. */
export type BattleStatus = 'fight' | 'won' | 'lost';

export interface BattleConfig {
  /** Предметы героя в сетке. Сам бой их не меняет: расход зарядов и взрывы сообщает событиями. */
  items: OwnedItem[];
  enemy: EnemyId;
  /** Модификатор врага (нет — без модификатора). */
  mod?: ModifierId | null;
  rng?: Rng;
  /** Здоровье героя в начале боя. Нет — полное (HERO_HP). */
  heroHp?: number;
  /** Основное оружие (uid): курсор и парирование. Нет — парировать нельзя. */
  mainUid?: number | null;
}

export class BattleSim {
  readonly enemyId: EnemyId;
  readonly mod: ModifierId | null;
  private rng: Rng;

  readonly heroMaxHp = HERO_HP;
  heroHp: number;
  /** Предметы героя, которые ещё в инвентаре. */
  items: OwnedItem[];
  /** Итоговые характеристики и эффекты соседства — для подсказок. */
  powers = new Map<number, ItemPower>();
  /** Эффекты соседства — для меток на предметах. */
  effects: AppliedEffect[] = [];
  slots: HeroSlot[] = [];
  enemy!: EnemyState;
  status: BattleStatus = 'fight';
  /** Атаки врага в полёте (окно парирования). Смерть врага их отменяет. */
  pending: PendingAttack[] = [];
  private nextPendingId = 1;
  private events: BattleEvent[] = [];
  /** Время боя (игровое), сек — для затяжного боя. */
  time = 0;
  /** Накопленное и ещё не отработанное тиками время: игровое и реальное (окна парирования). */
  private gameAcc = 0;
  private realAcc = 0;
  /** Перенос остатков дробного урона и лечения: ключ — предмет и вид, значение — остаток меньше 1. */
  private carry = new Map<string, number>();
  private fatigueShown = 0;
  /** Основное оружие (uid) — курсор и парирование. */
  readonly mainUid: number | null;

  constructor(cfg: BattleConfig) {
    this.enemyId = cfg.enemy;
    this.mod = cfg.mod ?? null;
    this.heroHp = Math.min(this.heroMaxHp, Math.max(1, cfg.heroHp ?? this.heroMaxHp));
    this.mainUid = cfg.mainUid ?? null;
    this.rng = cfg.rng ?? Math.random;
    this.items = [...cfg.items];
    this.slots = this.items.map((item) => ({
      item,
      def: ITEMS[item.id],
      stats: { price: 0 }, // заполнит recompute()
      disabled: false,
      poisoned: false,
      timer: 0,
      charges: item.charges ?? Infinity, // без зарядов (трость) — срабатывает без счёта
    }));
    this.spawn();
    this.explodeAtStart();
  }

  /** Основное оружие в бою, если оно есть и работает (не отключено). null — парировать нельзя. */
  get mainSlot(): HeroSlot | null {
    const s = this.slots.find((x) => x.item.uid === this.mainUid);
    return s && !s.disabled && s.def.parryPerk ? s : null;
  }

  /** Пассивные предметы с перезарядкой (срабатывают сами). */
  get passives(): HeroSlot[] {
    return this.slots.filter((s) => s.def.mode === 'passive');
  }

  get actives(): HeroSlot[] {
    return this.slots.filter((s) => s.def.mode === 'active');
  }

  /** Забрать события, накопленные с прошлого вызова. */
  drain(): BattleEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ─── Соседство ───────────────────────────────────────────────────────────

  /** Пересчитать соседство по оставшимся предметам и сообщить, что изменилось (initial — начало боя). */
  private recompute(initial = false): void {
    const power = computePower(this.items);
    this.powers = power.powers;
    this.effects = power.effects;
    for (const slot of this.slots) {
      const p = this.powers.get(slot.item.uid)!;
      const was = { disabled: slot.disabled, stats: slot.stats };
      slot.stats = p.final;
      slot.disabled = p.disabled;
      slot.poisoned = p.poisoned;
      const name = slot.def.name;
      const uid = slot.item.uid;
      if (initial) {
        if (p.blockedBy) {
          this.events.push({ type: 'blocked', uid, name, reason: p.blockedBy });
        } else if (p.disabled) {
          const by = p.received.find((e) => e.rule.effect.kind === 'disable');
          this.events.push({ type: 'burned', uid, name, reason: by?.label ?? 'Отключён' });
        }
        if (p.poisoned) this.events.push({ type: 'poisoned', uid, name });
        continue;
      }
      if (!was.disabled && p.disabled && p.blockedBy) this.events.push({ type: 'blocked', uid, name, reason: p.blockedBy });
      else if (was.disabled && !p.disabled) this.events.push({ type: 'enabled', uid, name });
      else if (!p.disabled && statsWeaker(p.final, was.stats)) this.events.push({ type: 'bonusLost', uid, name });
    }
  }

  /** Предметы с шансом взрыва (правило explode) могут взорваться в начале боя: урон герою, все заряды теряются. */
  private explodeAtStart(): void {
    let removed = false;
    for (const slot of [...this.slots]) {
      const p = this.powers.get(slot.item.uid)!;
      if (p.disabled || p.explodeChance <= 0 || this.rng() >= p.explodeChance) continue;
      this.heroHp = Math.max(1, this.heroHp - p.explodeDamage); // взрыв не убивает в начале боя
      this.events.push({ type: 'explode', uid: slot.item.uid, name: slot.def.name, damage: p.explodeDamage });
      this.events.push({ type: 'heroHit', taken: p.explodeDamage, self: true });
      this.removeSlot(slot);
      removed = true;
    }
    if (removed) this.recompute();
  }

  private removeSlot(slot: HeroSlot): void {
    this.slots = this.slots.filter((s) => s !== slot);
    this.items = this.items.filter((i) => i.uid !== slot.item.uid);
  }

  /** Вывести врага: здоровье и сумка с учётом силы врагов; пересчитать соседство героя (о сгоревшем и отравленном — события). */
  private spawn(): void {
    const id = this.enemyId;
    const def = ENEMIES[id];
    const hp = Math.round(ENEMY_STATS[id].hp * ENEMY_STAT_MULT);
    const slots: EnemySlot[] = def.bag.map((b, i) => {
      const stats = ENEMY_ITEM_STATS[b.item];
      return {
        uid: i,
        inGrid: true,
        col: b.col,
        row: b.row,
        rotated: b.rotated ?? false,
        def: ENEMY_ITEMS[b.item],
        stats: { ...stats },
        charges: stats.charges ?? Infinity,
      };
    });
    const order = [...slots].sort((a, b) => a.def.priority - b.def.priority || a.uid - b.uid);
    this.enemy = { id, mod: this.mod, hp, maxHp: hp, actionTimer: 0, slots, order };
    for (const p of this.passives) p.timer = 0;
    this.recompute(true);
  }

  // ─── Время ───────────────────────────────────────────────────────────────

  /**
   * Продвинуть бой: dt — игровое время (с ускорением), realDt — реальное (окна парирования от ускорения не зависят).
   * Время копится и отрабатывается тиками BATTLE_TICK. Без realDt — бой на ×1 (для будущих симуляций).
   */
  step(dt: number, realDt = dt): void {
    if (this.status !== 'fight') return;
    this.gameAcc += dt;
    this.realAcc += realDt;
    const T = BATTLE_TICK - EPS;
    while (this.status === 'fight' && (this.realAcc >= T || this.gameAcc >= T)) {
      if (this.realAcc >= T) {
        this.realAcc -= BATTLE_TICK;
        this.tickWindows();
      }
      if (this.status === 'fight' && this.gameAcc >= T) {
        this.gameAcc -= BATTLE_TICK;
        this.tickGame();
      }
    }
  }

  /** Доля полёта атаки 0..1 с учётом ещё не отработанного реального времени — для плавной отрисовки кружка. */
  progress(p: PendingAttack): number {
    return Math.min(1, Math.max(0, 1 - (p.left - this.realAcc) / p.total));
  }

  /** Прибавка к урону врага от затяжного боя: +stepBonus за каждые stepSec после startSec. */
  get fatigueBonus(): number {
    const F = FATIGUE;
    return this.time < F.startSec ? 0 : Math.floor((this.time - F.startSec) / F.stepSec + EPS) * F.stepBonus;
  }

  /** Тик реального времени: атаки в полёте; окно закрылось — удар. */
  private tickWindows(): void {
    for (const p of [...this.pending]) {
      p.left -= BATTLE_TICK;
      if (p.left > EPS) continue;
      this.strike(p, false);
      if (this.checkEnd()) return;
    }
  }

  /** Тик игрового времени: предметы героя по перезарядке, замах врага, затяжной бой. */
  private tickGame(): void {
    this.time += BATTLE_TICK;
    const bonus = this.fatigueBonus;
    if (bonus > this.fatigueShown + EPS) {
      this.fatigueShown = bonus;
      this.events.push({ type: 'fatigue', bonus });
    }
    for (const p of this.passives) {
      if (p.disabled || !p.stats.cooldown) continue; // отключённое и амулеты без своего действия не тикают
      p.timer += BATTLE_TICK;
      if (p.timer >= p.stats.cooldown - EPS) {
        p.timer = Math.max(0, p.timer - p.stats.cooldown);
        this.events.push({ type: 'heroItem', uid: p.item.uid, name: p.def.name, active: false });
        this.applyHero(p);
        if (Number.isFinite(p.charges)) this.spendHeroCharge(p); // хлеб съедается
        if (this.checkEnd()) return;
      }
    }
    const next = this.nextAction();
    if (next) {
      this.enemy.actionTimer += BATTLE_TICK;
      if (this.enemy.actionTimer >= next.stats.cooldown - EPS) {
        this.enemy.actionTimer = 0;
        this.useEnemyItem(next);
      }
    }
  }

  /** Списать дробное значение: вниз до целого, остаток копится в carry по ключу и идёт в следующее срабатывание. */
  private whole(key: string, raw: number): number {
    const total = raw + (this.carry.get(key) ?? 0);
    const out = Math.floor(total + EPS);
    this.carry.set(key, Math.max(0, total - out));
    return out;
  }

  // ─── Герой ───────────────────────────────────────────────────────────────

  /** Игрок отбил кружок атаки основным оружием: удар приходит сразу, ослабленный (PARRY_DAMAGE_MULT). */
  parry(id: number): boolean {
    const p = this.pending.find((a) => a.id === id);
    if (!p || !this.mainSlot || this.status !== 'fight') return false;
    this.strike(p, true);
    this.checkEnd();
    return true;
  }

  /** Применить активный предмет героя. false — нельзя (не бой, отключён, нет зарядов, не активный). */
  useActive(uid: number): boolean {
    const slot = this.actives.find((a) => a.item.uid === uid);
    if (!slot || this.status !== 'fight' || slot.disabled || slot.charges <= 0) return false;
    this.events.push({ type: 'heroItem', uid, name: slot.def.name, active: true });
    this.applyHero(slot);
    this.spendHeroCharge(slot);
    this.checkEnd();
    return true;
  }

  /** Потратить заряд предмета героя; последний — предмет исчезает, его влияние на соседей пропадает сразу. */
  private spendHeroCharge(slot: HeroSlot): void {
    slot.charges--;
    this.events.push({ type: 'heroCharge', uid: slot.item.uid, left: slot.charges });
    if (slot.charges <= 0) {
      this.removeSlot(slot);
      this.recompute();
    }
  }

  private applyHero(slot: HeroSlot): void {
    const { def, stats: s } = slot;
    if (s.damage) this.damageEnemy(this.whole(`d${slot.item.uid}`, s.damage), def.id);
    if (s.heal) {
      const heal = this.whole(`h${slot.item.uid}`, s.heal);
      if (slot.poisoned) {
        // Отравленная еда: лечение превращается в урон по герою.
        const dmg = heal;
        this.heroHp = Math.max(0, this.heroHp - dmg);
        this.events.push({ type: 'heroHit', taken: dmg, self: true });
      } else {
        const amount = Math.min(heal, this.heroMaxHp - this.heroHp);
        this.heroHp += amount;
        this.events.push({ type: 'heroHeal', amount });
      }
    }
  }

  private damageEnemy(dmg: number, item: ItemId): void {
    this.enemy.hp = Math.max(0, this.enemy.hp - dmg);
    this.events.push({ type: 'enemyHit', taken: dmg, item });
  }

  // ─── Враг ────────────────────────────────────────────────────────────────

  /** Следующее действие врага: первый предмет с зарядами по порядку использования. */
  nextAction(): EnemySlot | null {
    return this.enemy.order.find((s) => s.charges > 0) ?? null;
  }

  /** Враг бьёт предметом: удар не приходит сразу — кружок на поле, окно парирования (реальное время), потом strike. */
  private useEnemyItem(slot: EnemySlot): void {
    this.events.push({ type: 'enemyItem', uid: slot.uid, name: slot.def.name });
    if (Number.isFinite(slot.charges)) {
      slot.charges--;
      this.events.push({ type: 'enemyCharge', uid: slot.uid, left: slot.charges });
    }
    const p: PendingAttack = { id: this.nextPendingId++, slot, left: FEEL.parry.window, total: FEEL.parry.window, kind: 'hit' };
    this.pending.push(p);
    this.events.push({ type: 'windup', id: p.id, uid: slot.uid, item: slot.def.id, kind: p.kind });
  }

  /** Удар кружка: окно закрылось или игрок отбил. Пьяный бросает кубик на промах в момент удара. */
  private strike(p: PendingAttack, parried: boolean): void {
    this.pending = this.pending.filter((a) => a !== p);
    this.events.push({ type: 'strike', id: p.id, parried });
    if (this.mod === 'drunk' && this.rng() < MODIFIER_STATS.drunkMiss) {
      this.events.push({ type: 'enemyMiss', name: p.slot.def.name });
      return;
    }
    const raw = p.slot.stats.damage * ENEMY_STAT_MULT * enemyDamageMult(this.mod) * (1 + this.fatigueBonus) * (parried ? PARRY_DAMAGE_MULT : 1);
    const dmg = this.whole(`e${p.slot.uid}`, raw);
    this.heroHp = Math.max(0, this.heroHp - dmg);
    this.events.push({ type: 'heroHit', taken: dmg, self: false, parried });
  }

  // ─── Исход ───────────────────────────────────────────────────────────────

  /** true — бой закончен: враг повержен (won) или герой погиб (lost). */
  private checkEnd(): boolean {
    if (this.enemy.hp <= 0) {
      this.status = 'won';
      this.pending = []; // убитый враг уже не ударит: его атаки в полёте отменяются
      return true;
    }
    if (this.heroHp <= 0) {
      this.status = 'lost';
      return true;
    }
    return false;
  }
}

/** Допуск сравнения дробного времени (накопление 0.1 даёт ошибки округления). */
const EPS = 1e-6;

/** Какая-то из характеристик стала меньше (пропал бонус соседа). */
function statsWeaker(now: ItemStats, before: ItemStats): boolean {
  return (['damage', 'heal'] as const).some((k) => (now[k] ?? 0) < (before[k] ?? 0) - 1e-9);
}
