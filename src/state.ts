// Состояние прототипа: предметы героя в инвентаре и основное оружие. Перенесено из state.ts Людъмака только нужное
// для боя: основное оружие, расход зарядов. Заказов, монет, магазина и обучения нет; ночи — свои (свечи и ночлег).
import { ACTION_CANDLES, BELT_CANDLES, CANDLES_PER_NIGHT, CARRIAGE_CANDLES, COACHMAN_TRIBUTE, DEDUCTION_BASE, ITEM_STATS, QTE_POOL_MIN, ROOM_STATS, START_GOLD, START_ITEMS } from './config/balance';
import { QTE_LETTERS, type QteLetter } from './data/checks';
import type { TutorialId } from './data/tutorials';
import type { EnemyId } from './data/enemies';
import { ENEMY_IDS } from './data/enemies';
import { LOCATIONS, POIS, START_LOCATION, START_POI, type LocationId, type PoiId } from './data/map';
import { CARRIAGE, type ActionKind, type RoomId, type SleepPlace } from './data/night';
import { ITEMS, type ItemId } from './data/items';
import { findSpot, type OwnedItem } from './systems/backpack';

export interface RunState {
  /** Предметы в инвентаре (все в сетке: зоны «вне сумок» в прототипе нет). */
  items: OwnedItem[];
  nextUid: number;
  /** Основное оружие (uid): курсор и перк парирования в бою. */
  mainUid: number | null;
  /** Враг, выбранный на главном экране. */
  enemy: EnemyId;
  /** Игровой режим: локация, где герой, и точка в ней (живут, пока открыта игра). */
  location: LocationId;
  mapPoi: PoiId;
  /** Герой остановился посреди дороги (клик по дороге): дорога и расстояние от её начала; null — стоит в точке mapPoi. */
  mapRoad: { road: number; d: number } | null;
  /** Туман войны: где герой уже был в каждой локации — точки (пиксели подложки), вокруг которых карта открыта. */
  revealed: Partial<Record<LocationId, [number, number][]>>;
  /** Ночь по счёту (с 1) и свечи, что остались на неё (docs/gameplay.md). */
  night: number;
  candles: number;
  /** Свечи открыты игроку (data/night.ts, CANDLES_UNLOCK_AT). До этого свеча скрыта, действия бесплатны. */
  candlesOn: boolean;
  /** Золото героя. Каждый новый день кучер берёт дань (COACHMAN_TRIBUTE); не хватает — прощает. */
  gold: number;
  /** Где стоит карета (ночлег в ней): в прологе — в Чаще, после первой ночи на постоялом дворе — у ворот (CARRIAGE). */
  carriageAt: PoiId;
  /** Герой уже проходил через ворота города (LocationDef.gate): с этого момента в городе звучит его музыка. */
  gatePassed: boolean;
  /** Порядок букв QTE, который выбрал игрок (от удобной к неудобной): в пул идут верхние (qtePool). */
  qteOrder: QteLetter[];
  /** Пройденные проверки (PoiCheck.id) — их кнопки больше не показываются. */
  checksDone: string[];
  /** Пройденные обучения (data/tutorials.ts) — больше не показываются. */
  tutorialsSeen: TutorialId[];
}

export const run: RunState = {
  items: [],
  nextUid: 1,
  mainUid: null,
  enemy: ENEMY_IDS[0],
  location: START_LOCATION,
  mapPoi: START_POI,
  mapRoad: null,
  revealed: {},
  night: 1,
  candles: CANDLES_PER_NIGHT,
  candlesOn: false,
  gold: START_GOLD,
  carriageAt: CARRIAGE.start,
  gatePassed: false,
  qteOrder: [...QTE_LETTERS],
  checksDone: [],
  tutorialsSeen: [],
};

// Стартовый набор, как в Людъмаке: стартовое оружие сразу основное.
for (const id of START_ITEMS) addItem(id);
run.mainUid = run.items.find((i) => ITEMS[i.id].parryPerk)?.uid ?? null;

/** Положить новый предмет в первое свободное место. false — места нет. */
export function addItem(id: ItemId): boolean {
  const spot = findSpot(run.items, id);
  if (!spot) return false;
  run.items.push({ uid: run.nextUid++, id, inGrid: true, col: spot.col, row: spot.row, rotated: spot.rotated, charges: ITEM_STATS[id].charges });
  return true;
}

/** Убрать предмет из инвентаря; основное оружие перестаёт быть основным. */
export function removeItem(uid: number): void {
  const i = run.items.findIndex((it) => it.uid === uid);
  if (i >= 0) run.items.splice(i, 1);
  if (run.mainUid === uid) run.mainUid = null;
}

/** Может ли предмет быть основным оружием: есть перк парирования (parryPerk). */
export function canBeMain(item: OwnedItem): boolean {
  return !!ITEMS[item.id].parryPerk && item.inGrid;
}

export function setMain(uid: number | null): void {
  run.mainUid = uid;
}

/** Тратит заряд предмета (активного или хлеба). Последний заряд — предмет исчезает навсегда. */
export function spendCharge(uid: number): void {
  const item = run.items.find((i) => i.uid === uid);
  if (!item || !item.charges) return;
  item.charges--;
  if (item.charges <= 0) removeItem(uid);
}

// ─── Ночь: свечи и ночлег ────────────────────────────────────────────────────

/** Цена действия в точке, свечей: база + пояс × надбавка. В локации без ночлега поясов нет. */
export function actionCost(poi: PoiId, kind: ActionKind): number {
  const p = POIS[poi];
  const belt = LOCATIONS[p.loc].lodging ? (p.belt ?? 0) : 0;
  return ACTION_CANDLES[kind] + belt * BELT_CANDLES;
}

/** Открыть свечи: с этого момента действия стоят свечей, на эту ночь — полные. */
export function unlockCandles(): void {
  run.candlesOn = true;
  run.candles = CANDLES_PER_NIGHT;
}

/** Потратить свечи на действие. false — не хватает (ничего не списано). Свечи ещё не открыты — бесплатно. */
export function spendCandles(n: number): boolean {
  if (!run.candlesOn) return true;
  if (run.candles < n) return false;
  run.candles -= n;
  return true;
}

/** Можно ли снять комнату: хватает золота на саму комнату (дань кучеру может и не хватить — он простит). */
export function canTakeRoom(room: RoomId): boolean {
  return run.gold >= ROOM_STATS[room].price;
}

/**
 * Сон на ночлеге (комната или карета): день проходит, оставшиеся свечи сгорают, новая ночь со свечами по месту.
 * Сначала платится комната, потом дань кучеру; на дань не хватает — кучер прощает (долг не копится).
 * Первая ночь на постоялом дворе — карета переезжает из Чащи к воротам.
 * Лечение — здоровье героя между боями пока не хранится (каждый бой с полным), лечить нечего.
 * Возвращает, сколько золота взял кучер (0 — простил).
 */
export function sleep(place: SleepPlace): { tribute: number } {
  run.night++;
  if (place === 'carriage') run.candles = CANDLES_PER_NIGHT + CARRIAGE_CANDLES;
  else {
    run.gold -= ROOM_STATS[place].price;
    run.candles = CANDLES_PER_NIGHT + ROOM_STATS[place].candles;
    if (run.carriageAt === CARRIAGE.start) run.carriageAt = CARRIAGE.city;
  }
  const tribute = run.gold >= COACHMAN_TRIBUTE ? COACHMAN_TRIBUTE : 0;
  run.gold -= tribute;
  return { tribute };
}

// ─── Небоевые проверки: дедукция и пул QTE ───────────────────────────────────

/** Дедукция героя. Предметов и бафов, которые её дают, пока нет. */
export function deduction(): number {
  return DEDUCTION_BASE;
}

/** Пул букв QTE: верхние буквы порядка игрока — при дедукции 1 все, каждый +1 — на одну меньше, не меньше QTE_POOL_MIN. */
export function qtePool(): QteLetter[] {
  const n = Math.max(QTE_POOL_MIN, run.qteOrder.length - (deduction() - 1));
  return run.qteOrder.slice(0, n);
}

/** Поменять местами две буквы в порядке игрока (по индексам). */
export function swapQteLetters(a: number, b: number): void {
  const o = run.qteOrder;
  [o[a], o[b]] = [o[b], o[a]];
}

/** Поместится ли предмет в сумку (есть свободное место). */
export function canAddItem(id: ItemId): boolean {
  return !!findSpot(run.items, id);
}
