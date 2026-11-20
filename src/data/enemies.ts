// Враги: имя и сумка — маленькая сетка с фиксированной раскладкой.
// Здоровье — в src/config/balance.ts (ENEMY_STATS), числа предметов — там же (ENEMY_ITEM_STATS).
// Порядок использования предметов задаёт их priority (src/data/enemyItems.ts), раскладка на него не влияет.
// Новый враг — id в EnemyId, запись в ENEMIES, здоровье в ENEMY_STATS и (по желанию) портрет portraits/enemies/{id}.webp.
import type { EnemyItemId } from './enemyItems';

export type EnemyId = 'krestyanin';

export interface BagSlot {
  item: EnemyItemId;
  /** Левая верхняя клетка. */
  col: number;
  row: number;
  /** Повёрнут на 90°: ширина и высота меняются местами. */
  rotated?: boolean;
}

export interface EnemyDef {
  id: EnemyId;
  name: string;
  /** Размер сетки сумки в клетках. */
  bagCols: number;
  bagRows: number;
  /** Раскладка. Один и тот же предмет можно положить несколько раз (несколько лепёшек). */
  bag: BagSlot[];
}

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  krestyanin: {
    id: 'krestyanin',
    name: 'Крестьянин с вилами',
    bagCols: 2,
    bagRows: 3,
    bag: [
      { item: 'pitchfork', col: 0, row: 0 },
      { item: 'cow_pie', col: 1, row: 0 },
      { item: 'cow_pie', col: 1, row: 1 },
      { item: 'cow_pie', col: 1, row: 2 },
    ],
  },
};

export const ENEMY_IDS = Object.keys(ENEMIES) as EnemyId[];
