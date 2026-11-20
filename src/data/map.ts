// Карты игрового режима: локации (у каждой своя подложка, точки интереса и дороги) и карта мира между ними (data/world.ts).
// Координаты — в пикселях подложки своей локации; на экране карта увеличена (MAP_LAYOUT.locations[…].scale в assets.ts).
// Развилки — служебные узлы дорог, игрок туда не ходит. У каждой локации есть точка выхода (exit) на краю карты —
// через неё герой уходит на карту мира и приходит из неё.

export type LocationId = 'fortress' | 'severland';

/** Крепость на перевале. */
type FortressPoi = 'mine' | 'tower' | 'cave' | 'market' | 'church' | 'inn' | 'west' | 'hut' | 'shrine' | 'mill';
/** Северляндия. */
type SeverlandPoi =
  | 's_cross' | 's_fishers' | 's_kremlin' | 's_harbor' | 's_elder' | 's_forge'
  | 's_stones' | 's_skete' | 's_camp' | 's_rotten' | 's_south';
export type PoiId = FortressPoi | SeverlandPoi;

export interface Poi {
  id: PoiId;
  loc: LocationId;
  /** Название — видно при наведении и в надписи «Вы здесь». Рабочее, правится свободно. */
  name: string;
  x: number;
  y: number;
}

/** Участок дороги между двумя узлами (точкой или развилкой): ломаная от a до b включительно. */
export interface Road {
  a: string;
  b: string;
  points: [number, number][];
}

export interface LocationDef {
  id: LocationId;
  name: string;
  /** Где герой появляется при первом входе в игровой режим (важно только у стартовой локации). */
  start: PoiId;
  /** Точка выхода на карту мира (на краю карты, где дорога уходит за край). */
  exit: PoiId;
  junctions: Record<string, { x: number; y: number }>;
  roads: Road[];
}

export const POIS: Record<PoiId, Poi> = {
  // ─── Крепость на перевале (подложка maps/valley.webp, 1536×1024) ───
  mine: { id: 'mine', loc: 'fortress', name: 'Шахта', x: 413, y: 219 },
  tower: { id: 'tower', loc: 'fortress', name: 'Сторожевая башня', x: 775, y: 200 },
  cave: { id: 'cave', loc: 'fortress', name: 'Пещера', x: 1249, y: 274 },
  market: { id: 'market', loc: 'fortress', name: 'Рынок', x: 522, y: 486 },
  church: { id: 'church', loc: 'fortress', name: 'Церковь', x: 877, y: 440 },
  inn: { id: 'inn', loc: 'fortress', name: 'Постоялый двор', x: 1075, y: 462 },
  west: { id: 'west', loc: 'fortress', name: 'Западный тракт', x: 255, y: 523 },
  hut: { id: 'hut', loc: 'fortress', name: 'Избушка', x: 305, y: 808 },
  shrine: { id: 'shrine', loc: 'fortress', name: 'Капище', x: 780, y: 922 },
  mill: { id: 'mill', loc: 'fortress', name: 'Мельница', x: 1160, y: 822 },
  // ─── Северляндия (подложка maps/severland.webp, 2000×1333; снято с docs/maps/severland-markup.webp) ───
  s_cross: { id: 's_cross', loc: 'severland', name: 'Поклонный крест', x: 652, y: 326 },
  s_fishers: { id: 's_fishers', loc: 'severland', name: 'Рыбацкая слобода', x: 232, y: 394 },
  s_kremlin: { id: 's_kremlin', loc: 'severland', name: 'Ледяной кремль', x: 1396, y: 408 },
  s_harbor: { id: 's_harbor', loc: 'severland', name: 'Зимняя гавань', x: 1671, y: 506 },
  s_elder: { id: 's_elder', loc: 'severland', name: 'Изба старосты', x: 753, y: 534 },
  s_forge: { id: 's_forge', loc: 'severland', name: 'Кузня', x: 266, y: 653 },
  s_stones: { id: 's_stones', loc: 'severland', name: 'Камни предков', x: 434, y: 812 },
  s_skete: { id: 's_skete', loc: 'severland', name: 'Островной скит', x: 1273, y: 823 },
  s_camp: { id: 's_camp', loc: 'severland', name: 'Стан у прорубей', x: 1095, y: 1048 },
  s_rotten: { id: 's_rotten', loc: 'severland', name: 'Гнилая изба', x: 660, y: 1169 },
  s_south: { id: 's_south', loc: 'severland', name: 'Южный тракт', x: 1206, y: 1312 },
};

export const LOCATIONS: Record<LocationId, LocationDef> = {
  fortress: {
    id: 'fortress',
    name: 'Крепость на перевале',
    start: 'inn',
    exit: 'west',
    // Дороги сняты с разметки старой карты (docs/maps/village-markup.webp) и сверены с maps/valley.webp — она нарисована
    // по той же раскладке.
    junctions: {
      j1: { x: 750, y: 286 },
      j2: { x: 758, y: 358 },
      j3: { x: 742, y: 426 },
      j4: { x: 814, y: 474 },
      j5: { x: 834, y: 498 },
      j6: { x: 802, y: 578 },
      j7: { x: 774, y: 710 },
      j8: { x: 946, y: 826 },
    },
    roads: [
      { a: 'tower', b: 'j1', points: [[775, 200], [736, 262], [750, 286]] },
      { a: 'j1', b: 'j2', points: [[750, 286], [766, 314], [766, 338], [758, 358]] },
      { a: 'j1', b: 'mine', points: [[750, 286], [722, 263], [670, 250], [506, 250], [482, 244], [413, 219]] },
      { a: 'j2', b: 'j3', points: [[758, 358], [732, 390], [731, 410], [742, 426]] },
      { a: 'j2', b: 'cave', points: [[758, 358], [770, 351], [854, 338], [894, 334], [962, 334], [1022, 317], [1090, 306], [1110, 306], [1142, 296], [1174, 293], [1249, 274]] },
      { a: 'j3', b: 'j4', points: [[742, 426], [786, 443], [814, 474]] },
      { a: 'j3', b: 'market', points: [[742, 426], [726, 428], [682, 452], [654, 458], [600, 472], [522, 486]] },
      { a: 'j4', b: 'j5', points: [[814, 474], [820, 490], [834, 498]] },
      { a: 'j4', b: 'church', points: [[814, 474], [819, 458], [830, 448], [846, 440], [877, 440]] },
      { a: 'j5', b: 'inn', points: [[834, 498], [866, 486], [926, 486], [987, 474], [1075, 462]] },
      { a: 'j5', b: 'j6', points: [[834, 498], [820, 514], [812, 562], [802, 578]] },
      { a: 'west', b: 'j6', points: [[255, 523], [314, 524], [394, 560], [502, 588], [546, 608], [594, 618], [674, 618], [710, 610], [750, 610], [774, 601], [802, 578]] },
      { a: 'j6', b: 'j7', points: [[802, 578], [804, 598], [825, 626], [825, 654], [818, 666], [774, 710]] },
      { a: 'hut', b: 'j7', points: [[305, 808], [490, 842], [506, 841], [518, 836], [558, 802], [618, 780], [638, 768], [682, 764], [726, 746], [774, 710]] },
      { a: 'j7', b: 'j8', points: [[774, 710], [776, 722], [782, 728], [834, 756], [874, 788], [930, 815], [946, 826]] },
      { a: 'mill', b: 'j8', points: [[1160, 822], [1062, 846], [994, 840], [974, 832], [946, 826]] },
      { a: 'j8', b: 'shrine', points: [[946, 826], [949, 838], [945, 846], [910, 880], [882, 892], [842, 895], [780, 922]] },
    ],
  },
  severland: {
    id: 'severland',
    name: 'Северляндия',
    start: 's_south',
    exit: 's_south',
    // Дороги сняты программно с разметки docs/maps/severland-markup.webp (зелёные линии), точки — красные.
    junctions: {
      s_j1: { x: 426, y: 468 },
      s_j2: { x: 1364, y: 474 },
      s_j3: { x: 459, y: 602 },
      s_j4: { x: 775, y: 722 },
      s_j5: { x: 517, y: 614 },
      s_j6: { x: 643, y: 710 },
      s_j7: { x: 989, y: 937 },
      s_j8: { x: 960, y: 1097 },
      s_j9: { x: 956, y: 1128 },
    },
    roads: [
      { a: 's_cross', b: 's_j1', points: [[652, 326], [648, 338], [550, 366], [458, 442], [432, 454], [426, 468]] },
      { a: 's_fishers', b: 's_j1', points: [[232, 394], [306, 444], [426, 468]] },
      { a: 's_kremlin', b: 's_j2', points: [[1396, 408], [1368, 448], [1364, 474]] },
      { a: 's_j2', b: 's_harbor', points: [[1364, 474], [1458, 460], [1622, 490], [1671, 506]] },
      { a: 's_j1', b: 's_j3', points: [[426, 468], [462, 530], [459, 602]] },
      { a: 's_j2', b: 's_j4', points: [[1364, 474], [1208, 534], [1026, 616], [886, 656], [844, 676], [775, 722]] },
      { a: 's_elder', b: 's_j5', points: [[753, 534], [680, 552], [517, 614]] },
      { a: 's_j3', b: 's_forge', points: [[459, 602], [337, 673], [266, 653]] },
      { a: 's_j3', b: 's_j5', points: [[459, 602], [517, 614]] },
      { a: 's_j5', b: 's_j6', points: [[517, 614], [526, 642], [550, 666], [643, 710]] },
      { a: 's_j6', b: 's_stones', points: [[643, 710], [630, 738], [588, 764], [490, 800], [434, 812]] },
      { a: 's_j6', b: 's_j4', points: [[643, 710], [775, 722]] },
      { a: 's_j4', b: 's_j7', points: [[775, 722], [770, 754], [778, 790], [832, 854], [989, 937]] },
      { a: 's_skete', b: 's_j7', points: [[1273, 823], [1218, 848], [1148, 880], [1048, 904], [989, 937]] },
      { a: 's_j7', b: 's_j8', points: [[989, 937], [986, 972], [956, 1054], [950, 1094], [960, 1097]] },
      { a: 's_camp', b: 's_j8', points: [[1095, 1048], [1063, 1064], [1032, 1080], [960, 1097]] },
      { a: 's_j8', b: 's_j9', points: [[960, 1097], [956, 1128]] },
      { a: 's_j9', b: 's_south', points: [[956, 1128], [976, 1156], [1056, 1222], [1206, 1312]] },
      { a: 's_j9', b: 's_rotten', points: [[956, 1128], [906, 1136], [862, 1164], [798, 1186], [708, 1196], [660, 1169]] },
    ],
  },
};

export const LOCATION_IDS = Object.keys(LOCATIONS) as LocationId[];

/** Точки локации. */
export const poisOf = (loc: LocationId): PoiId[] => (Object.keys(POIS) as PoiId[]).filter((id) => POIS[id].loc === loc);

/** Где герой в начале игрового режима. */
export const START_LOCATION: LocationId = 'fortress';
export const START_POI: PoiId = LOCATIONS[START_LOCATION].start;
