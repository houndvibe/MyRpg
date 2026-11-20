// Модификаторы врагов: приставка к имени. Числа — в src/config/balance.ts (MODIFIER_STATS).
// Как модификатор действует в бою — src/systems/battle.ts. В прототипе модификаторы не выдаются (бой с mod: null).
import { MODIFIER_STATS as M } from '../config/balance';
import { ENEMIES, type EnemyId } from './enemies';

export type ModifierId = 'drunk';

export interface ModifierDef {
  id: ModifierId;
  /** Название для подсказки: «Пьяный». */
  name: string;
  /** Приставка перед именем врага («Пьяный крестьянин») или окончание после него. */
  prefix?: string;
  suffix?: string;
}

export const MODIFIERS: Record<ModifierId, ModifierDef> = {
  drunk: { id: 'drunk', name: 'Пьяный', prefix: 'Пьяный' },
};

/** Имя врага с модификатором: «Пьяный крестьянин с вилами». */
export function enemyName(id: EnemyId, mod: ModifierId | null): string {
  const base = ENEMIES[id].name;
  if (!mod) return base;
  const m = MODIFIERS[mod];
  if (m.prefix) return `${m.prefix} ${base[0].toLowerCase()}${base.slice(1)}`;
  return `${base} ${m.suffix}`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Что модификатор делает, одной строкой. Числа берутся из balance.ts. */
export function modifierEffect(mod: ModifierId): string {
  switch (mod) {
    case 'drunk':
      return `урон его предметов +${pct(M.drunkDamage)}, каждый удар с шансом ${pct(M.drunkMiss)} промахивается`;
  }
}
