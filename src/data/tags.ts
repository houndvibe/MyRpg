// Теги предметов — для правил соседства (src/data/synergies.ts: Selector.tag). Новый тег — id в TagId и запись в TAGS.

export type TagId = 'heal' | 'elixir';

export interface TagDef {
  id: TagId;
  /** Название для подсказок: «соседнее Лечение +25% к урону». */
  name: string;
}

export const TAGS: Record<TagId, TagDef> = {
  heal: { id: 'heal', name: 'Лечение' },
  elixir: { id: 'elixir', name: 'Эликсир' },
};
