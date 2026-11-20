// Состояние прототипа: предметы героя в инвентаре и основное оружие. Перенесено из state.ts Людъмака только нужное
// для боя: основное оружие, расход зарядов. Ночей, заказов, монет, магазина и обучения нет.
import { ITEM_STATS, START_ITEMS } from './config/balance';
import type { EnemyId } from './data/enemies';
import { ENEMY_IDS } from './data/enemies';
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
}

export const run: RunState = { items: [], nextUid: 1, mainUid: null, enemy: ENEMY_IDS[0] };

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
