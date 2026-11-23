// Предметы героя: имена, формы, теги. Все числа (цены, урон, перезарядки, заряды) — в src/config/balance.ts.
// Новый предмет — id в ItemId, запись в ITEMS и числа в ITEM_STATS.
import type { TagId } from './tags';

export type ItemId = 'cane' | 'bread' | 'healing_elixir' | 'whetstone';

/** passive — срабатывает сам по перезарядке; active — нажатие в бою, тратит заряд. */
export type ItemMode = 'passive' | 'active';

/** Категория предмета — его основной тип: цвет плитки, связки соседства (Алхимия к оружию, аура камня на Оружие). */
export type ItemCategory = 'weapon' | 'amulet' | 'alchemy' | 'food';

export const CATEGORY_NAMES: Record<ItemCategory, string> = {
  weapon: 'Оружие',
  amulet: 'Амулет',
  alchemy: 'Алхимия',
  food: 'Еда',
};

export interface ItemDef {
  id: ItemId;
  name: string;
  mode: ItemMode;
  category: ItemCategory;
  /** Теги — для правил соседства (src/data/synergies.ts). */
  tags: TagId[];
  /** Форма в клетках без поворота: ширина × высота. */
  w: number;
  h: number;
  /** Редкость 1–3 (в Людъмаке — частота в магазине). В прототипе не используется. */
  tier: ItemTier;
  /**
   * Может быть основным оружием: курсор в бою, им парируют. Значение — перк парирования; сейчас один:
   * sword — парированный удар слабее на базовые PARRY_DAMAGE_MULT, без особого эффекта.
   */
  parryPerk?: ParryPerkId;
  /** Строка в досье сумки (курсивом внизу карточки): опись бесёнка — привирает и язвит. Черновик, правит дизайнер. */
  flavor?: string;
}

export type ParryPerkId = 'sword';

export type ItemTier = 1 | 2 | 3;

export const ITEMS: Record<ItemId, ItemDef> = {
  // Трость с железным наконечником — заменила стальной меч, характеристики те же (по решению дизайнера).
  cane: {
    id: 'cane',
    name: 'Трость',
    mode: 'passive',
    category: 'weapon',
    tags: [],
    w: 1,
    h: 3,
    tier: 1,
    parryPerk: 'sword',
    flavor: '«Для прогулок», — уверяют его превосходительство. Так и записываю: для прогулок. Тамбовский упырь, впрочем, с тех пор и сам ходит с палочкой.',
  },
  bread: {
    id: 'bread',
    name: 'Краюха хлеба',
    mode: 'passive',
    category: 'food',
    tags: ['heal'],
    w: 1,
    h: 1,
    tier: 1,
    flavor: 'Краюха ржаного, казённая, одна штука. В отчёт пойдёт как «провиант на роту». Мелочь, а приятно.',
  },
  healing_elixir: {
    id: 'healing_elixir',
    name: 'Лечебный эликсир',
    mode: 'active',
    category: 'alchemy',
    tags: ['elixir'],
    w: 1,
    h: 1,
    tier: 2,
    flavor: 'Склянка от уездного аптекаря. Пахнет полынью и враньём. Помогает, если не нюхать.',
  },
  whetstone: {
    id: 'whetstone',
    name: 'Точильный камень',
    mode: 'passive',
    category: 'amulet',
    tags: [],
    w: 1,
    h: 1,
    tier: 1,
    flavor: 'Его превосходительство точат им наконечник трости, а я — перья. Оба, заметьте, исключительно по службе.',
  },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
