// Небоевые проверки (docs/gameplay.md): действие в точке решается QTE — буквы из пула героя по очереди, на каждую своё окно.
// Ошибка или пропуск — провал (частичного результата нет); попробовать ещё раз можно, снова за свечи.
// Числа (букв в проверке, окно, дедукция) — в balance.ts.

import type { ItemId } from './items';
import type { PoiId } from './map';
import type { ActionKind } from './night';

/** Исходный пул букв QTE (дедукция 1). Без WASD, I, M и цифр — они заняты управлением. Ловится физическая клавиша. */
export const QTE_LETTERS = ['Q', 'E', 'R', 'F', 'G', 'H', 'J', 'K', 'L', 'Z'] as const;
export type QteLetter = (typeof QTE_LETTERS)[number];

export type CheckDifficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTY_NAMES: Record<CheckDifficulty, string> = { easy: 'лёгкая', medium: 'средняя', hard: 'сложная' };

/** Проверка в точке: кнопка в меню точки; успех — награда, один раз (дальше кнопки нет). */
export interface PoiCheck {
  id: string;
  poi: PoiId;
  /** Подпись кнопки (к ней дописывается цена в свечах). */
  label: string;
  /** Вид действия — от него база цены в свечах (ACTION_CANDLES). */
  kind: ActionKind;
  difficulty: CheckDifficulty;
  reward: { item: ItemId };
  /** Текст после успеха и после провала. */
  success: string;
  fail: string;
}

export const POI_CHECKS: PoiCheck[] = [
  {
    id: 'chasha_hut_search',
    poi: 'c_hut',
    label: 'Обыскать лачугу',
    kind: 'search',
    difficulty: 'easy',
    reward: { item: 'bread' },
    success: 'Под лавкой, в тряпице, — краюха хлеба. Чёрствая, но есть можно.',
    fail: 'Пыль, тряпьё и мышиный помёт. Не то. Может, со второго раза.',
  },
];
