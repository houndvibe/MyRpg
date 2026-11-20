// Предметы врагов: имена, формы, категория и приоритет. Числа (урон, перезарядка, заряды) — в src/config/balance.ts.
// Сумка врага — маленькая сетка с фиксированной раскладкой (src/data/enemies.ts). Соседство в сумке врага не считается.
// Враг делает одно действие за раз: копит замах до перезарядки первого доступного предмета (по priority, с зарядами)
// и бьёт им. Удар летит кружком на поле атак — его можно парировать.

export type EnemyItemId = 'cow_pie' | 'pitchfork';

export type EnemyItemCategory = 'weapon' | 'throw';

export const ENEMY_CATEGORY_NAMES: Record<EnemyItemCategory, string> = {
  weapon: 'Оружие',
  throw: 'Снаряд',
};

export interface EnemyItemDef {
  id: EnemyItemId;
  name: string;
  category: EnemyItemCategory;
  /** Форма в клетках без поворота (сетка сумки врага). */
  w: number;
  h: number;
  /** Порядок в сумке: меньше — раньше. Снаряды с зарядами — раньше основного оружия. */
  priority: number;
  /** Пропущенный удар оставляет пятно на поле и на герое (коровья лепёшка; только вид, на бой не влияет). */
  stain?: true;
}

export const ENEMY_ITEMS: Record<EnemyItemId, EnemyItemDef> = {
  cow_pie: { id: 'cow_pie', name: 'Коровья лепёшка', category: 'throw', w: 1, h: 1, priority: 1, stain: true },
  pitchfork: { id: 'pitchfork', name: 'Вилы', category: 'weapon', w: 1, h: 3, priority: 9 },
};

export const ENEMY_ITEM_IDS = Object.keys(ENEMY_ITEMS) as EnemyItemId[];
