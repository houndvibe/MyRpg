// Диалоги в точках карты. Пробный — мельник на мельнице: тестовый текст, ветки ни на что не влияют.
// Узел — реплика собеседника и варианты ответа; next — ключ следующего узла, 'close' (закрыть окно) или 'battle'
// (бой с собеседником: Dialog.battle — с каким врагом драться и на какой узел вернуться после победы и поражения).

import type { EnemyId } from './enemies';
import type { PoiId } from './map';

export interface DialogChoice {
  text: string;
  next: string;
}

export interface DialogNode {
  text: string;
  choices: DialogChoice[];
}

export interface Dialog {
  /** Имя собеседника — на плашке рамки. */
  speaker: string;
  /** Ключ портрета собеседника (NPC_PORTRAITS в assets.ts). */
  portrait: 'miller';
  /** Фон на время разговора (DIALOG_BACKGROUNDS в assets.ts). */
  background: 'mill';
  start: string;
  nodes: Record<string, DialogNode>;
  /** Бой по варианту 'battle': враг (сумка, здоровье, механика; имя и портрет — собеседника), узлы после победы и поражения. */
  battle?: { enemy: EnemyId; won: string; lost: string };
}

export const DIALOGS = {
  miller: {
    speaker: 'Мельник',
    portrait: 'miller',
    background: 'mill',
    start: 'start',
    battle: { enemy: 'krestyanin', won: 'won', lost: 'lost' },
    nodes: {
      start: {
        text: 'Чего надо? Жернова сами себя не повернут. Пришёл за мукой — плати, пришёл по делу — говори быстро.',
        choices: [
          { text: 'Говорят, у тебя в амбаре завелись крысы.', next: 'rats' },
          { text: 'Сколько стоит мешок муки?', next: 'flour' },
          { text: 'Что слышно в округе?', next: 'news' },
          { text: 'Мельник, го поборемся.', next: 'challenge' },
          { text: 'Ничего. Я пойду.', next: 'close' },
        ],
      },
      rats: {
        text: 'Крысы? Если бы крысы… По ночам под колесом что-то скребётся. Собаки туда не идут, воют. Глянешь — заплачу.',
        choices: [
          { text: 'Ладно, посмотрю.', next: 'accept' },
          { text: 'В другой раз.', next: 'start' },
        ],
      },
      accept: {
        text: 'Вот и славно. Фонарь возьми — под колесом темно, как у чёрта за пазухой.',
        choices: [{ text: 'До встречи.', next: 'close' }],
      },
      flour: {
        text: 'Три медяка мешок. Тебе — четыре: больно ты подозрительный, с этой твоей железкой за поясом.',
        choices: [
          { text: 'Грабёж средь бела дня.', next: 'start' },
          { text: 'Подумаю.', next: 'start' },
        ],
      },
      challenge: {
        text: 'Ну го.',
        choices: [{ text: '⚔ В бой!', next: 'battle' }],
      },
      won: {
        text: 'Ох… ну и рука у тебя. Ладно, твоя взяла — заходи, коли что.',
        choices: [
          { text: 'Ещё поговорим.', next: 'start' },
          { text: 'Бывай.', next: 'close' },
        ],
      },
      lost: {
        text: 'Ха! Молод ещё с мельником тягаться. Отлежись — и приходи.',
        choices: [
          { text: 'Давай ещё раз!', next: 'battle' },
          { text: 'В другой раз.', next: 'close' },
        ],
      },
      news: {
        text: 'Староста опять пьёт. На западном тракте видели волков. А в пещере за горой кто-то по ночам жжёт костры. Тебе-то что?',
        choices: [{ text: 'Просто спросил.', next: 'start' }],
      },
    },
  },
} satisfies Record<string, Dialog>;

export type DialogId = keyof typeof DIALOGS;

/** Какой диалог открывается, когда герой приходит в точку (или кликает по ней, стоя в ней). */
export const POI_DIALOGS: Partial<Record<PoiId, DialogId>> = {
  mill: 'miller',
};
