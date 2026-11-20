// Правила соседства предметов в инвентаре героя. Числа — в src/config/balance.ts (SYNERGY).
// Новое правило добавляется одной записью, логику (src/systems/synergy.ts) трогать не нужно.
//
// Правило: «источник» действует на соседа-«цель». Пара соседей проверяется в обе стороны:
// если оба предмета подходят и как источник, и как цель, эффект получают оба.
import { SYNERGY } from '../config/balance';
import type { ItemCategory, ItemId } from './items';
import type { TagId } from './tags';

/** Кому подходит правило: по тегу, категории или конкретному предмету. */
export interface Selector {
  tag?: TagId;
  category?: ItemCategory;
  item?: ItemId;
}

/**
 * Виды эффектов (движок их все умеет, даже если правил с ними сейчас нет):
 * boost     — прибавка к характеристике цели (доля: 0.5 = +50%, −0.5 = −50%).
 *             stat 'damage' — только урон; 'all' — урон и лечение.
 *             aura: true — прибавка умножается на силу ауры источника (её усиливает auraBoost).
 * auraBoost — усиливает ауру цели-амулета.
 * disable   — цель отключена (сильнее любых бонусов), label — подпись («Сгорит»).
 * poison    — лечение цели превращается в урон по герою.
 * explode   — с шансом chance цель взрывается в начале боя: урон damage герою, все заряды теряются.
 * slow      — цель бьёт реже: к её перезарядке +seconds (складывается от каждого соседа).
 */
export type SynergyEffect =
  | { kind: 'boost'; stat: 'damage' | 'all'; amount: number; aura?: boolean }
  | { kind: 'auraBoost'; amount: number }
  | { kind: 'disable'; label: string }
  | { kind: 'poison' }
  | { kind: 'explode'; chance: number; damage: number }
  | { kind: 'slow'; seconds: number };

export interface SynergyRule {
  id: string;
  /** Короткое название для подсказки: «Алхимия к оружию». */
  title: string;
  source: Selector;
  target: Selector;
  effect: SynergyEffect;
}

export const SYNERGIES: SynergyRule[] = [
  { id: 'alchemy_weapon', title: 'Алхимия к оружию', source: { category: 'alchemy' }, target: { category: 'weapon' }, effect: { kind: 'boost', stat: 'damage', amount: SYNERGY.alchemyWeapon } },
  // Личные ауры амулетов.
  {
    id: 'whetstone_aura', title: 'аура точильного камня',
    source: { item: 'whetstone' },
    target: { category: 'weapon' },
    effect: { kind: 'boost', stat: 'damage', amount: SYNERGY.whetstoneAura, aura: true },
  },
];
