// Игровой режим: карта локации или карта мира — одна сцена, вид выбирается данными сцены ({ world: true } — мир).
// Карта локации: точки интереса (data/map.ts), клик по точке или любому месту дороги, или WASD — герой идёт по дорогам,
// цель можно сменить на ходу; в точке слева выезжает её меню (PlaceSidebar): картинка, описание, действия — разговор
// (POI_DIALOGS), путь на карту мира (точка выхода), «Уйти»; туман войны (MapFog).
// Карта мира: медальоны локаций (data/world.ts), клик — герой идёт по дорогам мира, по приходу — спуск в локацию
// (в её точку выхода). Камера следит за героем; карту можно тянуть мышью (с инерцией) и приближать колёсиком.
// M — подъём «за облака» на карту мира и обратно; приблизили мир до упора — тоже спуск в локацию героя (CloudCurtain).
// Ночь (docs/gameplay.md): действия в точках стоят свечей (свеча у портрета — CandleBar); в локации с ночлегом в путь —
// только с ночлега, после сна («Отдохнуть и в дорогу…»), M там не поднимает на карту мира.
// Две камеры: main — карта (прокрутка и зум), ui — интерфейс поверх (полоса сверху, портрет, облака перехода, снег).
// Метки, подписи, пунктир и кольца — одного размера на экране при любом зуме (делятся на зум каждый кадр).
import * as Phaser from 'phaser';
import { CandleBar } from '../components/CandleBar';
import { PauseMenu } from '../components/PauseMenu';
import { CloudCurtain } from '../components/CloudCurtain';
import { BagWindow } from '../components/BagWindow';
import { DialogWindow } from '../components/DialogWindow';
import { QteWindow } from '../components/QteWindow';
import { PlaceSidebar, type PlaceAction } from '../components/PlaceSidebar';
import { addMapAmbience, addSnow, FX_SOFT } from '../components/MapAmbience';
import { MapCarriage } from '../components/MapCarriage';
import { MapFog } from '../components/MapFog';
import { MapHero } from '../components/MapHero';
import { MapOccluders } from '../components/MapOccluders';
import { Minimap } from '../components/Minimap';
import type { FogShape } from '../components/MapFog';
import { MAP_LAYOUT as L, PLACE_SIDEBAR, type MapView } from '../config/assets';
import { CANDLES_PER_NIGHT, CARRIAGE_CANDLES, COACHMAN_TRIBUTE, ROOM_STATS } from '../config/balance';
import { FEEL } from '../config/feel';
import { DIALOGS, POI_DIALOGS, type DialogId } from '../data/dialogs';
import { LOCATIONS, poisOf, POIS, WORLD_LOCATION_IDS, worldOf, type LocationId, type PoiId } from '../data/map';
import { PLACE_STUBS } from '../data/places';
import { POI_CHECKS, type PoiCheck } from '../data/checks';
import { ITEMS } from '../data/items';
import { CANDLES_UNLOCK_AT, CARRIAGE, ROOM_IDS, ROOMS, TRIBUTE_FORGIVEN, type SleepPlace } from '../data/night';
import { WORLD_NODES } from '../data/world';
import { actionCost, addItem, canAddItem, canTakeRoom, qtePool, run, sleep, spendCandles, unlockCandles } from '../state';
import { insidePoly, locationGraph, routeLength, worldGraph, type Leg, type MapGraph, type MapPos, type Pt } from '../systems/map';
import { addText, C, H, playGameMusic, W, walkCursor, type MusicTrack } from '../ui';

/** Узел-метка на карте: точка интереса локации или локация на карте мира (координаты — пиксели подложки). */
interface MapNode {
  id: string;
  name: string;
  x: number;
  y: number;
}

/** Метка на карте: кружок, свечение под ним; hover — увеличение при наведении (твинится, умножается на 1/зум). */
interface Marker extends MapNode {
  wx: number;
  wy: number;
  dot: Phaser.GameObjects.Arc;
  glow: Phaser.GameObjects.Image;
  hover: { s: number };
}

/** Данные сцены. world — карта мира; arrive — пришли переходом (облака закрыты); dialog/node — вернулись из боя. */
interface MapData {
  world?: boolean;
  arrive?: 'ascend' | 'descend';
  dialog?: DialogId;
  node?: string;
}

/** Цель «место на дороге» (клик по дороге): target равен ей, само место — targetRoad. */
const ROAD = '@road';

/** Масштаб каждой карты, на котором ушли, — живёт, пока открыта игра. */
const savedZoom = new Map<string, number>();

export class MapScene extends Phaser.Scene {
  private isWorld = false;
  private arrive: MapData['arrive'];
  private view!: MapView;
  private graph!: MapGraph;
  private k = 1;
  private minZoom = 1;
  private maxZoom = 1;
  private markers: Marker[] = [];
  /** Герой: контейнер в точке на земле с фигуркой внутри (камера следит за ним, пыль идёт за ним). */
  private hero!: Phaser.GameObjects.Container;
  /** Фигурка героя на карте локации, карета — на карте мира. */
  private figure!: MapHero | MapCarriage;
  /** Здания и деревья-заслоны карты (MapView.occluders): глубина по основанию, силуэт героя, качание деревьев. */
  private occl!: MapOccluders;
  /** Мини-карта на Tab (только у карт с MapView.minimap) и здания, открытые по контуру, — для её тумана. */
  private minimap: Minimap | null = null;
  private fogShapes: { x: number; y: number; shape: FogShape }[] = [];
  /** Свободный ход в лесу: куда идёт по клику (пиксели подложки), что потом (выйдя на тропу — идти туда по дорогам). */
  private freeGoal: Pt | null = null;
  private freeThen: MapPos | null = null;
  /** Идёт по дорогам к краю леса, чтобы дальше по прямой в лес к этой точке. */
  private pendingFree: Pt | null = null;
  /** Сколько мс идёт по клику в лесу, почти не двигаясь (упёрся). */
  private freeStuck = 0;
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private routeLine!: Phaser.GameObjects.Graphics;
  private ring!: Phaser.GameObjects.Arc;
  private ringPulse = { s: 1 };
  private hereRing!: Phaser.GameObjects.Arc;
  private tooltip!: Phaser.GameObjects.Container;
  private tooltipText!: Phaser.GameObjects.Text;
  private tooltipBox!: Phaser.GameObjects.Rectangle;
  /** Опора подписи: точка в мире и сдвиг вверх в px экрана. */
  private tooltipAnchor = { x: 0, y: 0, dy: 0 };
  private location!: Phaser.GameObjects.Text;
  private locationShade!: Phaser.GameObjects.Image;
  private hovered: string | null = null;
  private ambience: (deltaMs: number) => void = () => {};
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  /** Пока true, всё созданное — интерфейс (видит только ui-камера). */
  private buildingUi = false;
  /** Открытое окно взаимодействия — пока оно есть, карта не получает ввод. */
  private dialog: DialogWindow | null = null;
  /** Открытое меню паузы (Esc) — карта стоит и не получает ввод. */
  private pause: PauseMenu | null = null;
  /** Кадр, в котором окно разговора закрылось по Esc, — тот же Esc не открывает паузу и не закрывает вернувшееся меню точки. */
  private dialogClosedFrame = -1;
  /** Идёт QTE небоевой проверки — карта не получает ввод. */
  private qte: QteWindow | null = null;
  /** Открытая сумка (клавиша I) — пока она есть, карта не получает ввод и герой стоит. */
  private bag: BagWindow | null = null;
  /** Портрет в углу карты — прячется, пока открыто окно взаимодействия. */
  private cornerPortrait: Phaser.GameObjects.GameObject[] = [];
  /** Свеча у портрета — свечи на ночь (прячется вместе с портретом). */
  private candleBar!: CandleBar;
  /** Подсказка внизу экрана (одна за раз). */
  private hint: Phaser.GameObjects.Text | null = null;
  /** Боковое меню точки, где стоит герой (слева, на всю высоту). */
  private sidebar!: PlaceSidebar;
  private curtain!: CloudCurtain;
  /** Идёт переход за облака — ввод закрыт. */
  private transitioning = false;
  /** Щелчки колёсика за краем зума подряд: сколько и когда был последний. */
  private overscroll = { n: 0, t: 0 };

  /** Текущий путь: отрезки дорог, пройдено (в пикселях подложки), цель. Пусто — герой стоит в своём узле. */
  private legs: Leg[] = [];
  private walked = 0;
  private target: string | null = null;
  /** Цель — место на дороге (target === ROAD). */
  private targetRoad: { road: number; d: number } | null = null;
  /** Туман войны (у локаций с fogOfWar), иначе null. */
  private fog: MapFog | null = null;
  /** Клавиши WASD (у карты мира не используются). */
  private keys: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key> | null = null;
  /** Shift — бег (FEEL.map.sprint), только на карте локации. */
  private shift: Phaser.Input.Keyboard.Key | null = null;
  /** Герой идёт по клавишам; keySign — в какую сторону по текущей дороге шёл. */
  private keyWalking = false;
  private keySign: 1 | -1 = 1;
  /** Время с начала сцены, с — для бегущего пунктира. */
  private clock = 0;

  /** Перетаскивание карты: где нажали и какая была прокрутка; dragging — сдвиг уже больше порога. */
  private press: { x: number; y: number; scrollX: number; scrollY: number } | null = null;
  private dragging = false;
  /** Скорость перетаскивания (px экрана в мс) — после отпускания карта ещё немного едет. */
  private velocity = { x: 0, y: 0 };
  private lastMove = { x: 0, y: 0, t: 0 };
  /** Камера ведёт героя (после клика по точке); перетаскивание или зум к курсору это снимают. */
  private following = true;
  /** Зум: к какому масштабу едем; anchor — точка экрана, под которой мир стоит на месте (null — зум вокруг героя). */
  private zoomTarget = 1;
  private zoomAnchor: { sx: number; sy: number; wx: number; wy: number } | null = null;
  /** Зум до наезда на героя при открытии меню точки (null — возвращать нечего). */
  private zoomBeforeSidebar: number | null = null;

  /** Вернулись из боя с собеседником: открыть его разговор с этого узла. */
  private resume: { dialog: DialogId; node: string } | null = null;

  constructor() {
    super('Map');
  }

  init(data?: MapData): void {
    this.isWorld = !!data?.world;
    this.arrive = data?.arrive;
    this.resume = data?.dialog && data.node ? { dialog: data.dialog, node: data.node } : null;
  }

  /** Узел, где стоит герой: точка локации или (на карте мира) его локация. */
  private get here(): string {
    return this.isWorld ? worldOf(run.location) : run.mapPoi;
  }

  /** Герой стоит посреди дороги (только на карте локации). */
  private get onRoad(): boolean {
    return !this.isWorld && !!run.mapRoad;
  }

  /** Где стоит герой: в узле или посреди дороги. */
  private get herePos(): MapPos {
    return this.onRoad ? { ...run.mapRoad! } : { node: this.here };
  }

  /** Ушли посреди пути — герой остаётся там, куда шёл (в точке или на месте дороги). */
  private settleAtTarget(): void {
    if (!this.target || this.isWorld) return;
    if (this.targetRoad) run.mapRoad = { ...this.targetRoad };
    else {
      run.mapPoi = this.target as PoiId;
      run.mapRoad = null;
    }
  }

  private nodes(): MapNode[] {
    if (this.isWorld) return WORLD_LOCATION_IDS.map((id) => ({ id, name: LOCATIONS[id].name, ...WORLD_NODES[id] }));
    return poisOf(run.location).map((id) => ({ id, name: POIS[id].name, x: POIS[id].x, y: POIS[id].y }));
  }

  // ─── Свободный ход в лесу (LOCATIONS[…].free) ─────────────────────────────

  /** Зоны свободного хода текущей карты. */
  private get zones(): [number, number][][] {
    return this.isWorld ? [] : (LOCATIONS[run.location].free ?? []);
  }

  private inZone(p: Pt): boolean {
    return this.zones.some((z) => insidePoly(p, z));
  }

  /** Расстояние от точки до ближайшей зоны (0 — внутри), пиксели подложки. */
  private zoneDist(p: Pt): number {
    let best = Infinity;
    for (const z of this.zones) {
      if (insidePoly(p, z)) return 0;
      for (let i = 0, j = z.length - 1; i < z.length; j = i++) {
        const [ax, ay] = z[j];
        const [bx, by] = z[i];
        const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
        const t = Math.min(1, Math.max(0, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / len2));
        best = Math.min(best, Math.hypot(ax + (bx - ax) * t - p.x, ay + (by - ay) * t - p.y));
      }
    }
    return best;
  }

  /** Где стоит герой — точка подложки (в лесу, в узле или на дороге). */
  private heroPoint(): Pt {
    return run.mapFree ? { ...run.mapFree } : this.graph.pointAt(this.herePos);
  }

  /** Можно стоять: в лесу или у его края возле тропы (полоса exitDist — переход между лесом и тропой). */
  private freeOk(p: Pt): boolean {
    const F = FEEL.map.forest;
    return this.inZone(p) || (this.zoneDist(p) <= F.exitDist && this.graph.nearestOnRoad(p).dist <= F.exitDist);
  }

  /** Стволы: точка выталкивается из круга ствола (герой скользит вдоль), задетое дерево качается. */
  private pushOffTrunks(n: Pt): Pt {
    const F = FEEL.map.forest;
    let q = n;
    for (const t of this.occl.trunks) {
      const dx = q.x - t.x;
      const dy = q.y - t.y;
      const d = Math.hypot(dx, dy);
      const R = t.r + F.heroR;
      if (d < R + F.touch) this.occl.shake(t.i, q.x);
      if (d < R) q = d > 1e-3 ? { x: t.x + (dx / d) * R, y: t.y + (dy / d) * R } : { x: t.x + R, y: t.y };
    }
    return q;
  }

  /**
   * Шаг в лесу в сторону v (единичный вектор) на len px подложки: стволы обходятся, у края — скольжение вдоль или стоп.
   * allowExit — у тропы шаг к ней выводит на тропу (клавиши). Возвращает пройденное и вышел ли на тропу.
   */
  private freeMove(v: Pt, len: number, allowExit: boolean): { moved: number; exited: boolean } {
    const p = run.mapFree!;
    let n = this.pushOffTrunks({ x: p.x + v.x * len, y: p.y + v.y * len });
    if (!this.freeOk(n)) {
      const a = this.pushOffTrunks({ x: p.x + v.x * len, y: p.y });
      const b = this.pushOffTrunks({ x: p.x, y: p.y + v.y * len });
      n = Math.abs(v.x) > 0.2 && this.freeOk(a) ? a : Math.abs(v.y) > 0.2 && this.freeOk(b) ? b : p;
    }
    const moved = Math.hypot(n.x - p.x, n.y - p.y);
    // У самой тропы и подходя к ней (тропа идёт по краю леса, местами — внутри зоны) — шаг на тропу.
    if (allowExit) {
      const near = this.graph.nearestOnRoad(n);
      if (near.dist <= FEEL.map.forest.snap && near.dist < this.graph.nearestOnRoad(p).dist) {
        this.leaveForest(near);
        return { moved, exited: true };
      }
    }
    run.mapFree = { x: n.x, y: n.y };
    this.hero.setPosition(n.x * this.k, n.y * this.k);
    if (this.fog?.reveal(n.x, n.y)) this.refreshMarkers();
    return { moved, exited: false };
  }

  /** Из леса на тропу — в место near (дорога и расстояние от её начала). */
  private leaveForest(near: { road: number; d: number }): void {
    run.mapFree = null;
    this.storePos({ road: near.road, d: near.d });
    const pt = this.graph.pointOnRoad(near.road, near.d);
    this.hero.setPosition(pt.x * this.k, pt.y * this.k);
  }

  /** Пойти по прямой по лесу к точке goal (пиксели подложки); then — потом, выйдя на тропу, идти туда по дорогам. */
  private startFreeWalk(goal: Pt, then: MapPos | null): void {
    this.closeSidebar();
    this.freeGoal = goal;
    this.freeThen = then;
    this.freeStuck = 0;
    this.velocity = { x: 0, y: 0 };
    this.zoomAnchor = null;
    this.following = true;
    this.cameras.main.startFollow(this.hero, false, FEEL.map.followLerp, FEEL.map.followLerp);
    const ring = then ? this.graph.pointAt(then) : goal;
    this.ring.setPosition(ring.x * this.k, ring.y * this.k).setVisible(true);
    this.figure.setWalking(true);
    this.dust.emitting = true;
    this.refreshMarkers();
    this.refreshLocation();
  }

  /** Кадр хода по клику в лесу. Возвращает сдвиг по x. */
  private freeWalk(delta: number): number {
    const g = this.freeGoal!;
    const p = run.mapFree!;
    const x0 = this.hero.x;
    const step = (this.walkSpeed / this.k) * (delta / 1000);
    const dist = Math.hypot(g.x - p.x, g.y - p.y);
    if (dist <= step) {
      this.freeMove({ x: (g.x - p.x) / (dist || 1), y: (g.y - p.y) / (dist || 1) }, dist, false);
      this.arriveFree();
    } else {
      const r = this.freeMove({ x: (g.x - p.x) / dist, y: (g.y - p.y) / dist }, step, false);
      // Упёрся (ствол, край зоны) — постоял немного и встал.
      this.freeStuck = r.moved < step * 0.3 ? this.freeStuck + delta : 0;
      if (this.freeStuck > FEEL.map.forest.stuckMs) this.arriveFree();
    }
    return this.hero.x - x0;
  }

  /** Дошёл по лесу (или упёрся): стоит; если дальше путь по дорогам — выходит на ближайшую тропу и идёт. */
  private arriveFree(): void {
    const then = this.freeThen;
    this.freeGoal = null;
    this.freeThen = null;
    this.ring.setVisible(false);
    this.figure.setWalking(false);
    this.dust.emitting = false;
    if (then && run.mapFree) {
      this.leaveForest(this.graph.nearestOnRoad(run.mapFree));
      this.go(then);
      return;
    }
    this.refreshMarkers();
    this.refreshLocation();
  }

  /** Клик по лесу: в лесу — по прямой туда; на тропе — по дорогам к ближайшему к точке месту тропы, оттуда — в лес. */
  private goFree(pt: Pt): void {
    if (this.target) {
      this.storePos(this.graph.alongRoute(this.legs, this.walked).pos);
      this.target = null;
      this.targetRoad = null;
      this.legs = [];
    }
    if (run.mapFree) return this.startFreeWalk(pt, null);
    const near = this.graph.nearestOnRoad(pt);
    this.go({ road: near.road, d: near.d }, pt);
  }

  private nodeName(id: string): string {
    return this.isWorld ? LOCATIONS[id as LocationId].name : POIS[id as PoiId].name;
  }

  create(): void {
    const F = FEEL.map;
    playGameMusic(this, this.musicTrack());
    this.view = this.isWorld ? L.world : L.locations[run.location];
    this.graph = this.isWorld ? worldGraph() : locationGraph(run.location);
    const k = (this.k = this.view.scale);
    this.markers = [];
    this.legs = [];
    this.walked = 0;
    this.target = null;
    this.targetRoad = null;
    this.hovered = null;
    this.press = null;
    this.dragging = false;
    this.velocity = { x: 0, y: 0 };
    this.clock = 0;
    this.following = true;
    this.zoomAnchor = null;
    this.ringPulse = { s: 1 };
    this.dialog = null;
    this.pause = null;
    this.qte = null;
    this.bag = null;
    this.transitioning = false;
    this.overscroll = { n: 0, t: 0 };

    // Камера интерфейса: всё, что не интерфейс, она не рисует; интерфейс не рисует основная.
    const cam = this.cameras.main;
    this.uiCam = this.cameras.add(0, 0, W, H);
    this.buildingUi = false;
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, (go: Phaser.GameObjects.GameObject) => {
      // Пока открыта сумка или идёт QTE, всё новое — тоже интерфейс (сетка пересоздаёт предметы, QTE создаёт кружки и искры).
      if (this.buildingUi || this.bag || this.qte) cam.ignore(go);
      else this.uiCam.ignore(go);
    });

    const bg = this.add.image(0, 0, this.view.key, '__BASE').setOrigin(0).setScale(k);
    const worldW = bg.width * k;
    const worldH = bg.height * k;
    cam.setBounds(0, 0, worldW, worldH);
    // Зум: минимум — карта целиком по ширине или высоте (у локации — не дальше FEEL.map.zoom.min);
    // максимум — у локации общий, у мира — от минимума.
    const fit = Math.max(W / worldW, H / worldH);
    this.minZoom = this.isWorld ? fit : Math.max(fit, F.zoom.min);
    this.maxZoom = this.isWorld ? this.minZoom * FEEL.world.maxZoomMult : F.zoom.max;
    this.ambience = addMapAmbience(this, this.view);
    this.fog = null;
    if (!this.isWorld && this.view.fogOfWar) {
      const pts = (run.revealed[run.location] ??= []);
      const p = this.heroPoint();
      if (!pts.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < FEEL.map.fogOfWar.step)) pts.push([p.x, p.y]);
      this.fog = new MapFog(this, worldW, worldH, k, pts, this.view.fogRadius);
    }

    // Заслоны: здания и деревья, вырезанные из подложки, поверх карты — за ними герой прячется.
    this.occl = new MapOccluders(this, k, this.view.key, bg.height, this.view.occluders ?? []);
    // Места особой камеры, где туман уже растаял по контуру здания, — открыть их сразу.
    this.fogShapes = [];
    for (const f of this.view.focus ?? []) {
      const shape = f.shape !== undefined ? this.occl.shapeOf(f.shape) : null;
      if (shape) {
        this.fog?.stampShape(this, f.x, f.y, shape);
        this.fogShapes.push({ x: f.x, y: f.y, shape });
      }
    }
    this.freeGoal = null;
    this.freeThen = null;
    this.pendingFree = null;

    this.routeLine = this.add.graphics().setDepth(5);
    this.ring = this.add.circle(0, 0, F.ringRadius).setStrokeStyle(4, F.routeColor, 1).setDepth(6).setVisible(false);
    this.tweens.add({ targets: this.ringPulse, s: 1.35, duration: F.ringPulseMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: this.ring, alpha: 0.35, duration: F.ringPulseMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // Метки-медальоны: мягкое свечение в покое, вразнобой.
    const Gl = F.markerGlow;
    for (const n of this.nodes()) {
      const wx = n.x * k;
      const wy = n.y * k;
      const glow = this.add.image(wx, wy, FX_SOFT).setTint(Gl.color).setBlendMode(Phaser.BlendModes.ADD).setAlpha(Gl.alpha[0]).setDepth(6.5);
      this.tweens.add({ targets: glow, alpha: Gl.alpha[1], duration: Gl.periodMs / 2, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Math.random() * Gl.periodMs });
      const dot = this.add.circle(wx, wy, F.markerRadius, F.markerFill).setStrokeStyle(F.markerStrokeWidth, F.markerStroke).setDepth(7);
      this.markers.push({ ...n, wx, wy, dot, glow, hover: { s: 1 } });
    }
    this.hereRing = this.add.circle(0, 0, F.markerRadius + 8).setStrokeStyle(2, F.markerStroke, 0.9).setDepth(7);

    // Герой: фигурка на подставке (components/MapHero.ts); на карте мира — карета (MapCarriage). Пыль из-под ног на ходу.
    const start = this.heroPoint();
    this.figure = this.isWorld ? new MapCarriage(this, FEEL.world.carriage.width) : new MapHero(this, F.hero.height);
    this.hero = this.add.container(start.x * k, start.y * k, [this.figure.sprite]).setDepth(8);
    // Свет на героя (луна и т. п.): тень от источника, кайма, тон по повороту.
    if (this.view.light && this.figure instanceof MapHero) this.figure.addLight(this, this.hero, this.view.light);
    const D = F.dust;
    this.dust = this.add.particles(0, 0, FX_SOFT, {
      frequency: D.frequency,
      lifespan: D.lifespan,
      speed: { min: 6, max: 18 },
      scale: { start: D.scale[0], end: D.scale[1] },
      alpha: { start: D.alpha, end: 0 },
      tint: D.tint,
      emitting: false,
    }).setDepth(7.5);
    this.dust.startFollow(this.hero);

    // Подпись точки — плашка с каймой, плавно появляется.
    const T = F.tooltip;
    this.tooltipText = addText(this, 0, 0, '', 24, C.text).setOrigin(0.5);
    this.tooltipBox = this.add.rectangle(0, 0, 10, 10, T.fill, T.fillAlpha).setStrokeStyle(2, T.stroke, 0.9);
    this.tooltip = this.add.container(0, 0, [this.tooltipBox, this.tooltipText]).setDepth(10).setAlpha(0);

    // Интерфейс поверх карты — только для ui-камеры. Снег — тоже на экране, под интерфейсом.
    this.buildingUi = true;
    if (this.view.ambience.snow) addSnow(this, W, H, 15);
    // Где герой — в правом нижнем углу, под текстом мягкое затемнение (растягивается по тексту в refreshLocation).
    this.locationShade = this.add.image(0, 0, FX_SOFT).setTint(0x000000).setAlpha(FEEL.map.locationShade.alpha).setDepth(20);
    this.location = addText(this, L.locationText.x, L.locationText.y, '', 28, C.accent).setOrigin(1, 1).setDepth(21);
    this.addPortrait();
    // Мини-карта (Tab) — у карт локаций, где она включена.
    this.minimap = !this.isWorld && this.view.minimap ? new Minimap(this, this.view.key, bg.width, bg.height, this.view.fogRadius ?? F.fogOfWar.radius, poisOf(run.location).map((id) => ({ id, name: POIS[id].name, x: POIS[id].x, y: POIS[id].y }))) : null;
    this.sidebar = new PlaceSidebar(this);
    this.curtain = new CloudCurtain(this, !!this.arrive);
    this.buildingUi = false;

    // Камера: следит за героем. Вход из меню — проявление и лёгкий наезд к масштабу, на котором ушли;
    // вход переходом — облака расходятся (подъём: от локации к панораме; спуск: сверху к карте локации).
    cam.startFollow(this.hero, false, 1, 1);
    const Tr = FEEL.transition;
    if (this.arrive === 'ascend') {
      // Карта мира: от локации героя камера отъезжает к центру — открывается вся панорама.
      this.zoomTarget = this.minZoom;
      cam.setZoom(this.maxZoom);
      cam.centerOn(this.hero.x, this.hero.y);
      cam.stopFollow();
      this.following = false;
      cam.zoomTo(this.minZoom, Tr.openMs * 1.3, 'Cubic.easeOut');
      cam.pan(worldW / 2, worldH / 2, Tr.openMs * 1.3, 'Cubic.easeOut');
      this.curtain.open(Tr.openMs);
    } else if (this.arrive === 'descend') {
      this.zoomTarget = Phaser.Math.Clamp(savedZoom.get(this.view.key) ?? this.startZoom(), this.minZoom, this.maxZoom);
      cam.setZoom(this.minZoom).zoomTo(this.zoomTarget, Tr.openMs * 1.3, 'Cubic.easeOut');
      this.curtain.open(Tr.openMs);
    } else {
      const I = F.intro;
      this.zoomTarget = Phaser.Math.Clamp(savedZoom.get(this.view.key) ?? this.startZoom(), this.minZoom, this.maxZoom);
      cam.setZoom(Math.min(this.zoomTarget * I.fromZoom, this.maxZoom * I.fromZoom)).zoomTo(this.zoomTarget, I.zoomMs, 'Cubic.easeOut');
      cam.fadeIn(I.fadeMs);
      this.uiCam.fadeIn(I.fadeMs);
      if (this.isWorld) {
        cam.stopFollow();
        this.following = false;
        cam.centerOn(worldW / 2, worldH / 2);
      }
    }

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('wheel', this.onWheel, this);
    this.keyWalking = false;
    this.keys = this.isWorld ? null : (this.input.keyboard!.addKeys('W,A,S,D') as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>);
    this.shift = this.isWorld ? null : this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    // M — карта мира: из локации подъём за облака, на карте мира — спуск обратно в локацию героя (если он не в пути).
    // I — сумка; Esc тоже закрывает её.
    this.input.keyboard!.on('keydown-I', () => (this.qte ? undefined : this.bag ? this.closeBag() : this.openBag()));
    // Esc: закрыть открытое (сумку, меню точки), а если ничего не открыто — меню паузы (и обратно).
    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.qte || this.dialog || this.transitioning || this.dialogClosedFrame === this.game.loop.frame) return;
      if (this.minimap?.open && !this.pause && !this.bag) this.minimap.close();
      else if (this.pause) this.closePause();
      else if (this.bag) this.closeBag();
      else if (this.sidebar.openFor) this.closeSidebar();
      else this.openPause();
    });
    // Tab — мини-карта локации (игра не останавливается).
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TAB).on('down', () => {
      if (!this.transitioning) this.minimap?.toggle();
    });
    this.input.keyboard!.on('keydown-M', () => {
      if (this.busy) return;
      if (!this.isWorld && this.lodging) this.showHint(`В путь — только с ночлега: «${POIS[this.lodging].name}» → «Отдохнуть и в дорогу…»`);
      else if (!this.isWorld) this.ascend();
      else if (!this.target) this.descend(run.location);
    });
    // Ушли посреди пути — в следующий раз герой стоит там, куда шёл. Масштаб запоминается.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.settleAtTarget();
      if (!this.transitioning) savedZoom.set(this.view.key, this.zoomTarget);
      this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE);
      this.input.setDefaultCursor('default');
    });
    this.refreshMarkers();
    this.refreshLocation();
    this.applyScreenSizes();
    if (this.resume) this.openDialog(this.resume.node);
    // Пришли (с карты мира, из Чащи) прямо в точку открытия свечей.
    const at = this.heroPoint();
    this.checkCandleUnlock(at.x, at.y);
  }

  /** Мини-карта: видна, если включена и ничто другое не открыто; туман, точки, герой, маршрут и цель. */
  private updateMinimap(delta: number): void {
    const mm = this.minimap;
    if (!mm) return;
    const shown = !this.dialog && !this.bag && !this.pause && !this.qte && !this.transitioning;
    const hero = { x: this.hero.x / this.k, y: this.hero.y / this.k };
    let route: Pt[] = [];
    let goal: Pt | null = null;
    if (this.freeGoal) {
      route = [hero, this.freeGoal];
      goal = this.freeThen ? this.graph.pointAt(this.freeThen) : this.freeGoal;
    } else if (this.target) {
      route = this.graph.remainingPoints(this.legs, this.walked);
      if (this.pendingFree) route.push(this.pendingFree);
      goal = this.pendingFree ?? (this.targetRoad ? this.graph.pointOnRoad(this.targetRoad.road, this.targetRoad.d) : this.graph.nodePoint(this.target));
    }
    mm.update(delta, shown, hero, this.fog ? this.fog.openPoints : null, this.fogShapes, (x, y) => !this.fog || this.fog.isOpen(x, y), route, goal);
  }

  /** Первый вход на карту: мир — целиком, локация — ровно посередине между наибольшим отдалением и наибольшим приближением. */
  private startZoom(): number {
    return this.isWorld ? this.minZoom : (this.minZoom + this.maxZoom) / 2;
  }

  private openPause(): void {
    this.setHover(null);
    this.velocity = { x: 0, y: 0 };
    this.buildingUi = true;
    this.pause = new PauseMenu(this);
    this.buildingUi = false;
  }

  private closePause(): void {
    this.pause?.close();
    this.pause = null;
  }

  /** Портрет героя в левом нижнем углу, без рамки: низ картинки — у края экрана; слева от него три полосы в том же масштабе. */
  private addPortrait(): void {
    const P = L.portrait;
    const img = this.add.image(P.x, P.bottom, P.key).setOrigin(0.5, 1).setDepth(21);
    const scale = P.h / img.height;
    img.setScale(scale);
    const bars = L.portraitBars.map((b) => this.add.image(b.x, P.bottom, b.key).setOrigin(0.5, 1).setScale(scale).setDepth(21));
    this.cornerPortrait = [img, ...bars];
    this.candleBar = new CandleBar(this, bars[0]);
    this.candleBar.setVisible(run.candlesOn);
  }

  /** Музыка карты: Чаща — своя; город — своя только после первого прохода через ворота (до того — музыка Чащи). */
  private musicTrack(): MusicTrack {
    if (this.isWorld) return 'game';
    if (run.location === 'chasha') return 'chasha';
    return LOCATIONS[run.location].gate && !run.gatePassed ? 'chasha' : 'game';
  }

  /** Герой у ворот города (или проходит через них) первый раз — музыка Чащи плавно сменяется музыкой города. */
  private checkGate(x: number, y: number): void {
    const gate = this.isWorld || run.gatePassed ? undefined : LOCATIONS[run.location].gate;
    if (!gate || Math.hypot(x - POIS[gate].x, y - POIS[gate].y) > FEEL.map.candle.unlockRadius) return;
    run.gatePassed = true;
    playGameMusic(this, 'game');
  }

  /** Свечи ещё не открыты, а герой в точке открытия (CANDLES_UNLOCK_AT) или проходит через неё — открыть, с подсказкой. */
  private checkCandleUnlock(x: number, y: number): void {
    this.checkGate(x, y);
    if (run.candlesOn || this.isWorld) return;
    const at = POIS[CANDLES_UNLOCK_AT];
    if (at.loc !== run.location || Math.hypot(x - at.x, y - at.y) > FEEL.map.candle.unlockRadius) return;
    unlockCandles();
    this.candleBar.setVisible(true);
    this.showHint('Ночь в городе: действия теперь стоят свечей — свеча у портрета');
  }

  /** Переход на соседнюю карту той же локации пешком: уход в чёрное, герой — в точке at карты to. */
  private walkTo(to: LocationId, at: PoiId): void {
    if (this.transitioning) return;
    this.closeSidebar();
    this.transitioning = true;
    this.setHover(null);
    savedZoom.set(this.view.key, this.zoomTarget);
    const ms = FEEL.map.candle.linkFadeMs;
    this.cameras.main.fadeOut(ms);
    this.uiCam.fadeOut(ms);
    this.time.delayedCall(ms, () => {
      run.location = to;
      run.mapPoi = at;
      run.mapRoad = null;
      this.scene.start('Map', {});
    });
  }

  /** Портрет в углу и свеча у него — показать или спрятать (прячутся на время разговора). */
  private showCorner(on: boolean): void {
    for (const o of this.cornerPortrait) (o as Phaser.GameObjects.Image).setVisible(on);
    this.candleBar.setVisible(on && run.candlesOn);
  }

  /** Подсказка внизу экрана: появляется и тает через FEEL.map.candle.hintMs. */
  private showHint(text: string): void {
    this.hint?.destroy();
    this.buildingUi = true;
    const t = addText(this, L.hint.x, L.hint.y, text, 26, C.text, { stroke: '#000000', strokeThickness: 5 }).setOrigin(0.5).setDepth(40);
    this.buildingUi = false;
    this.hint = t;
    this.tweens.add({
      targets: t,
      alpha: 0,
      delay: FEEL.map.candle.hintMs + text.length * FEEL.map.candle.hintPerCharMs,
      duration: 400,
      onComplete: () => {
        t.destroy();
        if (this.hint === t) this.hint = null;
      },
    });
  }

  /** Ночлег текущей локации (нет — в локации ещё нет ночей: в путь, как раньше, из точки выхода и клавишей M). */
  private get lodging(): PoiId | undefined {
    return this.isWorld ? undefined : LOCATIONS[run.location].lodging;
  }

  /** Окно взаимодействия поверх всего (рисует ui-камера); портрет в углу на это время прячется. */
  private openDialog(start?: string): void {
    if (this.isWorld) return;
    const id = POI_DIALOGS[run.mapPoi];
    if (!id || this.dialog || this.target || this.onRoad) return;
    this.setHover(null);
    this.velocity = { x: 0, y: 0 };
    this.buildingUi = true;
    this.dialog = new DialogWindow(
      this,
      id,
      () => {
        this.dialog = null;
        this.dialogClosedFrame = this.game.loop.frame;
        this.showCorner(true);
        this.openSidebar();
      },
      () => this.startBattle(id),
      start,
    );
    this.buildingUi = false;
    this.showCorner(false);
  }

  /** Бой с собеседником: экран уходит в чёрное, дальше — сцена боя в обстановке разговора. */
  private startBattle(id: DialogId): void {
    const ms = FEEL.dialog.battleFadeMs;
    this.cameras.main.fadeOut(ms);
    this.uiCam.fadeOut(ms);
    this.time.delayedCall(ms, () => this.scene.start('Battle', { dialog: id }));
  }

  /** Точка экрана над интерфейсом (портрет, боковое меню точки) — карта её не получает. */
  private overUi(p: Phaser.Input.Pointer): boolean {
    const overCorner = this.cornerPortrait.some((o) => (o as Phaser.GameObjects.Image).getBounds().contains(p.x, p.y));
    return overCorner || !!this.sidebar?.covers(p.x);
  }

  // ─── Боковое меню точки ──────────────────────────────────────────────────

  /** Меню точки, где стоит герой: только на карте локации, когда он стоит в точке и ничто другое не открыто. */
  private openSidebar(): void {
    if (this.isWorld || this.target || this.onRoad || run.mapFree || this.keyWalking || this.dialog || this.qte || this.transitioning) return;
    const id = run.mapPoi;
    const actions: PlaceAction[] = [];
    const talk = POI_DIALOGS[id];
    if (talk) {
      // Разговор стоит свечей (бой из него — уже нет); не хватает — кнопка видна, но закрыта.
      const cost = run.candlesOn ? actionCost(id, 'talk') : 0;
      actions.push({
        label: cost ? `${DIALOGS[talk].talkLabel} · ${candlesWord(cost)}` : DIALOGS[talk].talkLabel,
        enabled: run.candles >= cost,
        run: () => {
          if (!spendCandles(cost)) return;
          this.candleBar.refresh();
          this.closeSidebar(false); // зум остаётся: после разговора меню вернётся
          this.openDialog();
        },
      });
    }
    const lodging = this.lodging;
    if (id === lodging) {
      actions.push({ label: 'Переночевать…', run: () => this.openRooms(false) });
      actions.push({ label: 'Отдохнуть и в дорогу…', run: () => this.openRooms(true) });
    }
    // Карета — тоже ночлег (бесплатный, но не выспишься); пока свечи не открыты (пролог), ночевать в ней нельзя.
    if (run.candlesOn && id === run.carriageAt && id !== lodging) {
      actions.push({ label: 'Переночевать в карете…', run: () => this.openRooms(false, true) });
      actions.push({ label: 'Отдохнуть в карете и в дорогу…', run: () => this.openRooms(true, true) });
    }
    // Проверки (QTE): пока не пройдены — кнопка с ценой в свечах.
    for (const c of POI_CHECKS) {
      if (c.poi !== id || run.checksDone.includes(c.id)) continue;
      const cost = run.candlesOn ? actionCost(id, c.kind) : 0;
      actions.push({ label: cost ? `${c.label} · ${candlesWord(cost)}` : c.label, enabled: run.candles >= cost, run: () => this.startCheck(c, cost) });
    }
    for (const label of PLACE_STUBS[id] ?? []) actions.push({ label, run: () => {} }); // заглушки — пока ничего не делают
    for (const l of LOCATIONS[run.location].links ?? []) if (l.from === id) actions.push({ label: l.label, run: () => this.walkTo(l.to, l.at) });
    if (!lodging && id === LOCATIONS[run.location].exit) actions.push({ label: 'Отправиться в путь', run: () => this.ascend() });
    actions.push({ label: 'Уйти', run: () => this.closeSidebar() });
    // Свечи догорели — делать нечего, кроме как идти на ночлег.
    const note = run.candlesOn && lodging && id !== lodging && run.candles <= 0 ? `Свечи догорели. Остаётся одно — идти на ночлег (${POIS[lodging].name}).` : undefined;
    this.showSidebar(id, actions, note);
    // Надпись слева внизу — под панелью; название и так в меню.
    this.location.setVisible(false);
    this.locationShade.setVisible(false);
    // Особая камера у точки (MapView.focus): камера плывёт к месту, туман над ним рассеивается.
    const focus = this.view.focus?.find((f) => f.poi === id);
    if (focus) return this.focusOn(focus);
    // Камера ведёт героя со сдвигом, чтобы он не прятался под панелью (сдвиг — в update).
    this.following = true;
    this.zoomAnchor = null;
    const cam = this.cameras.main;
    cam.startFollow(this.hero, false, FEEL.map.followLerp, FEEL.map.followLerp);
    // Наезд на героя: камера приближается, герой — в центре свободной от панели части экрана.
    const z = Math.min(Math.max(this.zoomTarget, FEEL.sidebar.camZoom), this.maxZoom);
    if (this.zoomBeforeSidebar === null) this.zoomBeforeSidebar = this.zoomTarget;
    if (z > this.zoomTarget + 1e-4) {
      this.zoomTarget = z;
      cam.zoomTo(z, FEEL.sidebar.camZoomMs, 'Sine.easeInOut', true);
    }
  }

  /**
   * Особая камера: перестаёт следить за героем и медленно, с плавным разгоном и торможением, едет к месту и приближается;
   * место встаёт в центр свободной от меню части экрана. Туман над местом рассеивается. Ушёл из точки — камера снова за героем.
   */
  private focusOn(f: NonNullable<MapView['focus']>[number]): void {
    const F = FEEL.map.focus;
    const cam = this.cameras.main;
    cam.stopFollow();
    this.following = false;
    this.zoomAnchor = null;
    this.velocity = { x: 0, y: 0 };
    const z = Phaser.Math.Clamp(f.zoom, this.minZoom, this.maxZoom);
    if (this.zoomBeforeSidebar === null) this.zoomBeforeSidebar = this.zoomTarget;
    this.zoomTarget = z;
    // Меню справа: центр камеры правее места на полширины меню (в px мира при конечном зуме).
    cam.pan(f.x * this.k + PLACE_SIDEBAR.w / 2 / z, f.y * this.k, F.panMs, F.ease, true);
    cam.zoomTo(z, F.panMs, F.ease, true);
    const shape = f.shape !== undefined ? this.occl.shapeOf(f.shape) : null;
    if (this.fog?.dissolve(this, f.x, f.y, f.reveal, F.dissolveMs, F.dissolveDelayMs, shape)) this.time.delayedCall(F.dissolveDelayMs + F.dissolveMs, () => this.refreshMarkers());
  }

  /** Проверка в точке: награды некуда положить — подсказка; иначе свечи списываются и идёт QTE; итог — подсказкой, меню возвращается. */
  private startCheck(c: PoiCheck, cost: number): void {
    if (this.qte || this.busy) return;
    if (!canAddItem(c.reward.item)) return this.showHint(`Некуда положить: ${ITEMS[c.reward.item].name} не помещается в сумку`);
    if (!spendCandles(cost)) return;
    this.candleBar.refresh();
    this.closeSidebar(false);
    this.setHover(null);
    this.velocity = { x: 0, y: 0 };
    this.buildingUi = true;
    this.qte = new QteWindow(this, c.label, c.difficulty, qtePool(), (ok) => {
      this.qte = null;
      if (ok) {
        addItem(c.reward.item);
        run.checksDone.push(c.id);
        this.showHint(`${c.success} Найдено: ${ITEMS[c.reward.item].name}.`);
      } else this.showHint(c.fail);
      this.openSidebar();
    }, run.showTutorials && !run.tutorialsSeen.includes('qte'));
    this.buildingUi = false;
  }

  /** Открыть (или перестроить) меню точки с этими действиями и пометкой. */
  private showSidebar(id: PoiId, actions: PlaceAction[], note?: string): void {
    this.buildingUi = true;
    this.sidebar.open(id, actions, { key: this.view.key, scale: this.k }, () => this.closeSidebar(), note);
    this.buildingUi = false;
  }

  /** Ночлег в том же меню: комнаты постоялого двора (на какие хватает золота) или ночь в карете, и «Назад».
   *  travel — после сна в путь, на карту мира. */
  private openRooms(travel: boolean, carriage = false): void {
    const id = run.mapPoi;
    const T = COACHMAN_TRIBUTE;
    const lines = carriage
      ? [`${CARRIAGE.name} — ${candlesWord(CANDLES_PER_NIGHT + CARRIAGE_CANDLES)} на ночь: ${CARRIAGE.note}.`]
      : ROOM_IDS.map((r) => `${ROOMS[r].name} — ${ROOM_STATS[r].price} золота, ${candlesWord(CANDLES_PER_NIGHT + ROOM_STATS[r].candles)} на ночь${ROOMS[r].note ? `: ${ROOMS[r].note}` : ''}.`);
    const head = [
      `${travel ? 'Отдохнуть перед дорогой.' : 'Сон до следующей ночи.'} Сон лечит, оставшиеся свечи сгорают.`,
      `Каждый день кучер берёт дань — ${T} золота (не хватит — простит). Золота: ${run.gold}.`,
    ];
    const actions: PlaceAction[] = carriage
      ? [{ label: CARRIAGE.name, run: () => this.rest('carriage', travel) }]
      : ROOM_IDS.map((r) => ({ label: `${ROOMS[r].name} · ${ROOM_STATS[r].price} золота`, enabled: canTakeRoom(r), run: () => this.rest(r, travel) }));
    actions.push({ label: 'Назад', run: () => this.openSidebar() });
    this.showSidebar(id, actions, [...head, ...lines].join('\n'));
  }

  /** Сон: экран уходит в чёрное, новая ночь (надпись), проявление, итог дани подсказкой; travel — дальше подъём на карту мира. */
  private rest(room: SleepPlace, travel: boolean): void {
    if (this.transitioning) return;
    const F = FEEL.map.candle;
    this.closeSidebar();
    this.transitioning = true;
    this.velocity = { x: 0, y: 0 };
    this.setHover(null);
    this.buildingUi = true;
    const shade = this.add.rectangle(0, 0, W, H, 0x000000).setOrigin(0).setAlpha(0).setDepth(60);
    const title = addText(this, W / 2, H / 2, '', 64, C.accent).setOrigin(0.5).setDepth(61).setAlpha(0);
    this.buildingUi = false;
    this.tweens.add({
      targets: shade,
      alpha: 1,
      duration: F.sleepMs,
      onComplete: () => {
        const carriageWas = run.carriageAt;
        const { tribute } = sleep(room);
        this.candleBar.refresh();
        const moved = run.carriageAt !== carriageWas ? ` Карета теперь ждёт у ворот: ${POIS[run.carriageAt].name}.` : '';
        const result = (tribute ? `Кучер взял дань: ${tribute} золота.` : TRIBUTE_FORGIVEN) + moved;
        title.setText(`Ночь ${run.night}`);
        this.tweens.chain({
          tweens: [
            { targets: title, alpha: 1, duration: F.sleepMs / 2 },
            { targets: title, alpha: 0, delay: F.sleepHoldMs, duration: F.sleepMs / 2 },
            { targets: shade, alpha: 0, duration: F.sleepMs },
          ],
          onComplete: () => {
            shade.destroy();
            title.destroy();
            this.transitioning = false;
            this.showHint(result);
            if (travel) this.ascend();
            else this.openSidebar();
          },
        });
      },
    });
  }

  /** restoreZoom — вернуть зум, что был до наезда (false — когда меню уходит на время разговора). */
  private closeSidebar(restoreZoom = true): void {
    if (!this.sidebar?.openFor) return;
    this.sidebar.close();
    const back = this.zoomBeforeSidebar;
    if (restoreZoom && back !== null) {
      this.zoomBeforeSidebar = null;
      if (Math.abs(back - this.zoomTarget) > 1e-4) {
        this.zoomTarget = back;
        this.cameras.main.zoomTo(back, FEEL.sidebar.camBackMs, 'Sine.easeInOut', true);
      }
    }
    this.location.setVisible(true);
    this.locationShade.setVisible(true);
  }

  /** Точка мира под точкой экрана — по основной камере (pointer.worldX считает верхняя, ui-камера). */
  private world(p: { x: number; y: number }): Phaser.Math.Vector2 {
    return this.cameras.main.getWorldPoint(p.x, p.y);
  }

  /** Скорость героя на карте локации, px мира в секунду: с зажатым Shift — бег. */
  private get walkSpeed(): number {
    return FEEL.map.speed * (this.shift?.isDown ? FEEL.map.sprint : 1);
  }

  /** Ввод закрыт: окно разговора или переход за облака. */
  private get busy(): boolean {
    return !!this.dialog || !!this.bag || !!this.qte || !!this.pause || this.transitioning;
  }

  // ─── Ходьба по клавишам WASD (только карта локации) ──────────────────────

  /** Направление с зажатых WASD (единичный вектор, y вниз) или null — ничего не зажато / ввод закрыт. */
  private keyDir(): Pt | null {
    if (this.isWorld || this.busy || !this.keys) return null;
    const K = this.keys;
    const x = (K.D.isDown ? 1 : 0) - (K.A.isDown ? 1 : 0);
    const y = (K.S.isDown ? 1 : 0) - (K.W.isDown ? 1 : 0);
    if (!x && !y) return null;
    const len = Math.hypot(x, y);
    return { x: x / len, y: y / len };
  }

  /** Позиция для run: развилка — не точка, поэтому стоящий в развилке хранится как конец одной из её дорог. */
  private storePos(pos: MapPos): void {
    if ('node' in pos && pos.node in POIS) {
      run.mapPoi = pos.node as PoiId;
      run.mapRoad = null;
    } else if ('node' in pos) {
      const e = this.graph.exits(pos.node)[0];
      run.mapRoad = { road: e.road, d: e.fromA ? 0 : this.graph.roadLength(e.road) };
    } else run.mapRoad = { road: pos.road, d: pos.d };
  }

  /** Кадр ходьбы по клавишам: идущий по клику путь бросается, герой шагает по дорогам в сторону v. Возвращает сдвиг по x. */
  private keyWalk(v: Pt, delta: number): number {
    const Kf = FEEL.map.keys;
    // Шёл по клику по лесу — встаёт и дальше идёт клавишами.
    this.pendingFree = null;
    if (this.freeGoal) {
      this.freeGoal = null;
      this.freeThen = null;
      this.ring.setVisible(false);
    }
    if (this.target) {
      // Шёл по клику — остаётся там, где был, и дальше идёт клавишами.
      this.storePos(this.graph.alongRoute(this.legs, this.walked).pos);
      this.target = null;
      this.targetRoad = null;
      this.legs = [];
      this.walked = 0;
      this.ring.setVisible(false);
    }
    if (!this.keyWalking) {
      this.closeSidebar();
      this.keyWalking = true;
      this.velocity = { x: 0, y: 0 };
      this.zoomAnchor = null;
      this.following = true;
      this.cameras.main.startFollow(this.hero, false, FEEL.map.followLerp, FEEL.map.followLerp);
      this.refreshLocation();
    }
    const len = (this.walkSpeed / this.k) * (delta / 1000);
    // В лесу — свободно в сторону клавиш.
    if (run.mapFree) {
      const x0 = this.hero.x;
      const r = this.freeMove(v, len, true);
      const moving = r.moved > 1e-6 || r.exited;
      this.figure.setWalking(moving);
      this.dust.emitting = moving;
      if (r.exited) this.refreshLocation();
      return this.hero.x - x0;
    }
    const p0 = this.graph.pointAt(this.herePos);
    const res = this.graph.steer(this.herePos, this.keySign, v, len, Kf.look, Kf.minDot, Kf.keepDot);
    // С тропы в лес: впереди по клавишам — лес, а тропа туда не ведёт (стоит или уходит в сторону) — сворачиваем.
    if (this.zones.length) {
      const F = FEEL.map.forest;
      const q = { x: p0.x + v.x * F.enterLook, y: p0.y + v.y * F.enterLook };
      const p1 = this.graph.pointAt(res.pos);
      const mv = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const along = mv > 1e-6 ? ((p1.x - p0.x) * v.x + (p1.y - p0.y) * v.y) / mv : 0;
      if (this.inZone(q) && (mv < len * 0.5 || along < 0.6)) {
        run.mapFree = { x: p0.x, y: p0.y };
        run.mapRoad = null;
        this.refreshMarkers();
        this.refreshLocation();
        return this.keyWalk(v, delta);
      }
    }
    this.keySign = res.sign;
    this.storePos(res.pos);
    const pt = this.graph.pointAt(res.pos);
    const dx = pt.x * this.k - this.hero.x;
    this.hero.setPosition(pt.x * this.k, pt.y * this.k);
    const moving = res.moved > 1e-6;
    this.figure.setWalking(moving);
    this.dust.emitting = moving;
    if (this.fog?.reveal(pt.x, pt.y)) this.refreshMarkers();
    this.checkCandleUnlock(pt.x, pt.y);
    return dx;
  }

  /** Клавиши отпущены: у точки — прибытие в неё (окно, если есть); посреди дороги — стоим там. */
  private keyStop(): void {
    this.keyWalking = false;
    this.figure.setWalking(false);
    this.dust.emitting = false;
    if (run.mapFree) {
      this.refreshMarkers();
      this.refreshLocation();
      return;
    }
    let pos = this.herePos;
    if (!('node' in pos)) {
      // Совсем рядом с точкой — встаём в неё.
      const ends = this.graph.roadEnds(pos.road);
      const L = this.graph.roadLength(pos.road);
      const snap = FEEL.map.keys.snap;
      if (pos.d <= snap && ends.a in POIS) pos = { node: ends.a };
      else if (L - pos.d <= snap && ends.b in POIS) pos = { node: ends.b };
    }
    if ('node' in pos) {
      this.target = pos.node;
      this.targetRoad = null;
      this.arriveAt();
      return;
    }
    this.refreshMarkers();
    this.refreshLocation();
  }

  /** Открыть сумку поверх карты (не во время разговора и перехода): герой останавливается, пока она открыта. */
  private openBag(): void {
    if (this.busy) return;
    this.setHover(null);
    this.input.setDefaultCursor('default');
    this.velocity = { x: 0, y: 0 };
    if (this.keyWalking) this.keyStop();
    this.figure.setWalking(false);
    this.dust.emitting = false;
    this.buildingUi = true;
    this.bag = new BagWindow(this);
    this.buildingUi = false;
  }

  private closeBag(): void {
    if (!this.bag) return;
    // Окно уезжает само (BagWindow.close) — игра продолжается сразу.
    this.bag.close();
    this.bag = null;
    // Шёл по клику — идёт дальше.
    if (this.target) {
      this.figure.setWalking(true);
      this.dust.emitting = true;
    }
  }

  update(_time: number, delta: number): void {
    this.clock += delta / 1000;
    this.ambience(delta);
    this.applyInertia(delta);
    this.applyZoom(delta);

    let dx = 0;
    const v = this.keyDir();
    if (v) dx = this.keyWalk(v, delta);
    else if (this.keyWalking) this.keyStop();
    if (this.freeGoal && run.mapFree && !this.bag && !this.pause) dx = this.freeWalk(delta);
    if (this.target && !this.bag && !this.pause) {
      const total = routeLength(this.legs);
      // Скорость — в px мира в секунду; путь считается в пикселях подложки.
      const speed = this.isWorld ? FEEL.world.speed : this.walkSpeed;
      this.walked = Math.min(total, this.walked + (speed / this.k) * (delta / 1000));
      const { pt } = this.graph.alongRoute(this.legs, this.walked);
      dx = pt.x * this.k - this.hero.x;
      this.hero.setPosition(pt.x * this.k, pt.y * this.k);
      if (this.fog?.reveal(pt.x, pt.y)) this.refreshMarkers();
      this.checkCandleUnlock(pt.x, pt.y);
      if (this.walked >= total) this.arriveAt();
    }
    if (this.figure instanceof MapHero) {
      this.figure.setRunning(!!this.shift?.isDown);
      this.figure.aimLight(this.hero.x / this.k, this.hero.y / this.k);
    }
    this.figure.update(delta, dx);
    this.occl.update(delta, this.hero, this.dust, FEEL.map.hero.height, this.figure.sprite);
    this.dialog?.update(delta);
    this.qte?.update(delta);
    this.updateMinimap(delta);
    // Меню точки открыто (справа) — герой левее центра на полширины панели (сдвиг в px мира зависит от зума).
    const cam = this.cameras.main;
    // Phaser вычитает сдвиг из точки цели: «−» сдвигает героя влево — в центр свободной от панели части экрана.
    cam.setFollowOffset(this.sidebar?.openFor ? -PLACE_SIDEBAR.w / 2 / cam.zoom : 0, 0);
    this.applyScreenSizes();
    this.drawRoute();
  }

  // ─── Зум и переход за облака ─────────────────────────────────────────────

  private onWheel(p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void {
    const cam = this.cameras.main;
    if (this.busy || dy === 0 || this.overUi(p) || cam.zoomEffect.isRunning) return;
    const Z = FEEL.map.zoom;
    const out = dy > 0;
    // Мир приближен до упора и крутят дальше — спуск в локацию героя (если он не в пути). Подъём из локации колёсиком
    // убран по решению дизайнера — карта мира открывается клавишей M.
    const atEdge = this.isWorld && !out && this.zoomTarget >= this.maxZoom - 1e-4;
    if (atEdge) {
      if (this.target) return;
      const Tr = FEEL.transition;
      const now = this.time.now;
      this.overscroll = { n: now - this.overscroll.t <= Tr.notchMs ? this.overscroll.n + 1 : 1, t: now };
      if (this.overscroll.n >= Tr.notches) this.descend(run.location);
      return;
    }
    this.overscroll = { n: 0, t: 0 };
    this.zoomBeforeSidebar = null; // зум выбрали сами — при закрытии меню не возвращаем
    this.zoomTarget = Phaser.Math.Clamp(this.zoomTarget * (out ? 1 / Z.step : Z.step), this.minZoom, this.maxZoom);
    if (this.target && this.following) {
      this.zoomAnchor = null; // ведём героя — зум вокруг него
    } else {
      // Свободная камера — к курсору: точка мира под ним остаётся под ним.
      cam.stopFollow();
      this.following = false;
      const w = this.world(p);
      this.zoomAnchor = { sx: p.x, sy: p.y, wx: w.x, wy: w.y };
    }
  }

  /** Подъём за облака: карта отъезжает и размывается, облака сходятся — дальше карта мира. */
  private ascend(): void {
    this.closeSidebar();
    if (this.transitioning) return;
    // Поднялись посреди пути — герой остаётся там, куда шёл.
    this.settleAtTarget();
    savedZoom.set(this.view.key, this.zoomTarget);
    this.leaveBy(this.minZoom * FEEL.transition.ascendZoom, null, { world: true, arrive: 'ascend' });
  }

  /** Спуск в локацию: камера наезжает на неё, облака сходятся — дальше карта локации. */
  private descend(loc: LocationId): void {
    if (this.transitioning) return;
    savedZoom.set(this.view.key, this.zoomTarget);
    const p = WORLD_NODES[worldOf(loc)];
    this.leaveBy(this.maxZoom * FEEL.transition.descendZoom, { x: p.x * this.k, y: p.y * this.k }, { arrive: 'descend' });
  }

  /** Общая часть перехода: ввод закрыт, камера едет к зуму (и к точке), размытие, облака, новая сцена. */
  private leaveBy(zoom: number, at: { x: number; y: number } | null, data: MapData): void {
    const Tr = FEEL.transition;
    const cam = this.cameras.main;
    this.transitioning = true;
    this.velocity = { x: 0, y: 0 };
    this.setHover(null);
    if (at) {
      cam.stopFollow();
      cam.pan(at.x, at.y, Tr.closeMs, 'Sine.easeInOut');
    }
    cam.zoomTo(zoom, Tr.closeMs, 'Sine.easeIn', true);
    // Лёгкое размытие только на время перехода (фильтр камеры снимается вместе со сценой).
    const blur = cam.filters.internal.addBlur(0, 2, 2, 0);
    this.tweens.add({ targets: blur, strength: Tr.blur, duration: Tr.closeMs, ease: 'Sine.easeIn' });
    this.curtain.close(Tr.closeMs, () => this.scene.start('Map', data));
  }

  /** Плавно подводит масштаб к zoomTarget; при опоре на курсор двигает прокрутку, чтобы точка под ним не уезжала. */
  private applyZoom(delta: number): void {
    const cam = this.cameras.main;
    if (this.transitioning || cam.zoomEffect.isRunning || Math.abs(cam.zoom - this.zoomTarget) < 1e-4) return;
    const t = 1 - Math.exp(-delta / FEEL.map.zoom.ms);
    const z = Math.abs(this.zoomTarget - cam.zoom) < 0.002 ? this.zoomTarget : cam.zoom + (this.zoomTarget - cam.zoom) * t;
    cam.setZoom(z);
    const a = this.zoomAnchor;
    if (a) {
      // Центр вида камеры — scroll + половина размера; точка экрана sx отстоит от центра на (sx − w/2)/zoom.
      cam.setScroll(a.wx - cam.width / 2 - (a.sx - cam.width / 2) / z, a.wy - cam.height / 2 - (a.sy - cam.height / 2) / z);
    }
  }

  /** Метки, подписи и кольца — одного размера на экране при любом зуме. */
  private applyScreenSizes(): void {
    const F = FEEL.map;
    const inv = 1 / this.cameras.main.zoom;
    for (const m of this.markers) {
      m.dot.setScale(m.hover.s * inv);
      m.glow.setDisplaySize(F.markerGlow.size * inv, F.markerGlow.size * inv);
    }
    this.hereRing.setScale(inv);
    this.ring.setScale(this.ringPulse.s * inv);
    const A = this.tooltipAnchor;
    this.tooltip.setScale(inv).setPosition(A.x, A.y - A.dy * inv);
  }

  // ─── Движение ────────────────────────────────────────────────────────────

  /** Пойти к узлу. */
  private travel(id: string): void {
    this.go({ node: id });
  }

  /** Пойти к узлу или месту на дороге: маршрут считается от того места, где герой сейчас (в узле или посреди дороги). */
  private go(dest: MapPos, free: Pt | null = null): void {
    this.pendingFree = free;
    // В лесу — сперва по прямой к ближайшей тропе, оттуда — по дорогам.
    if (run.mapFree) {
      const near = this.graph.nearestOnRoad(run.mapFree);
      return this.startFreeWalk(this.graph.pointOnRoad(near.road, near.d), dest);
    }
    const from: MapPos = this.target ? this.graph.alongRoute(this.legs, this.walked).pos : this.herePos;
    // Уже здесь — открыть окно точки, если оно есть.
    if (!this.target && !this.onRoad && 'node' in dest && dest.node === this.here) return this.openSidebar();
    this.closeSidebar();
    this.legs = this.graph.routeTo(from, dest);
    this.walked = 0;
    this.target = 'node' in dest ? dest.node : ROAD;
    this.targetRoad = 'node' in dest ? null : { ...dest };
    if (this.legs.length === 0) return this.arriveAt();
    this.velocity = { x: 0, y: 0 };
    this.zoomAnchor = null;
    this.following = true;
    this.cameras.main.startFollow(this.hero, false, FEEL.map.followLerp, FEEL.map.followLerp);
    const p = free ?? this.graph.pointAt(dest);
    this.ring.setPosition(p.x * this.k, p.y * this.k).setVisible(true);
    this.dust.emitting = true;
    this.figure.setWalking(true);
    this.refreshMarkers();
    this.refreshLocation();
  }

  private arriveAt(): void {
    const id = this.target!;
    const road = this.targetRoad;
    this.target = null;
    this.targetRoad = null;
    this.legs = [];
    this.walked = 0;
    const p: Pt = road ? this.graph.pointOnRoad(road.road, road.d) : this.graph.nodePoint(id);
    this.hero.setPosition(p.x * this.k, p.y * this.k);
    this.figure.setWalking(false);
    this.dust.emitting = false;
    this.ring.setVisible(false);
    this.arrivalWave(p.x * this.k, p.y * this.k);
    if (this.fog?.reveal(p.x, p.y)) this.refreshMarkers();
    if (road && this.pendingFree) {
      // Дошли по тропе до края леса — дальше по прямой в лес.
      const goal = this.pendingFree;
      this.pendingFree = null;
      run.mapRoad = null;
      run.mapFree = { x: p.x, y: p.y };
      this.startFreeWalk(goal, null);
      return;
    }
    if (road) {
      // Остановились посреди дороги: ни окна, ни точки — просто стоим.
      run.mapRoad = { ...road };
      this.refreshMarkers();
      this.refreshLocation();
      return;
    }
    if (this.isWorld) {
      // Пришли в другую локацию по дороге мира — спуск в неё, в её точку выхода.
      const loc = id as LocationId;
      if (loc !== run.location) {
        run.location = loc;
        run.mapPoi = LOCATIONS[loc].arrival ?? LOCATIONS[loc].exit;
        run.mapRoad = null;
      }
      this.refreshMarkers();
      this.refreshLocation();
      this.time.delayedCall(FEEL.dialog.openDelayMs, () => this.descend(loc));
      return;
    }
    run.mapPoi = id as PoiId;
    run.mapRoad = null;
    this.refreshMarkers();
    this.refreshLocation();
    // Пришли в точку — слева выезжает её меню (разговор — кнопкой в нём).
    this.time.delayedCall(FEEL.sidebar.openDelayMs, () => this.openSidebar());
  }

  /** Волна света от метки, куда пришёл герой (размер — в px экрана при текущем зуме). */
  private arrivalWave(x: number, y: number): void {
    const A = FEEL.map.arrivalWave;
    const inv = 1 / this.cameras.main.zoom;
    const wave = this.add.circle(x, y, A.from * inv).setStrokeStyle(A.width * inv, FEEL.map.routeColor, 1).setDepth(6.8);
    this.tweens.add({ targets: wave, radius: A.to * inv, alpha: 0, duration: A.ms, ease: 'Cubic.easeOut', onUpdate: () => wave.setStrokeStyle(A.width * inv, FEEL.map.routeColor, wave.alpha), onComplete: () => wave.destroy() });
  }

  /** Маршрут — бегущий пунктир от героя к цели по оставшейся части пути (шаг и точки — в px экрана). */
  private drawRoute(): void {
    const R = FEEL.map.route;
    const color = FEEL.map.routeColor;
    const g = this.routeLine.clear();
    if (!this.target && !this.freeGoal) return;
    const pts = this.freeGoal ? [{ x: this.hero.x, y: this.hero.y }, { x: this.freeGoal.x * this.k, y: this.freeGoal.y * this.k }] : this.graph.remainingPoints(this.legs, this.walked).map((p) => ({ x: p.x * this.k, y: p.y * this.k }));
    if (!this.freeGoal && this.pendingFree) pts.push({ x: this.pendingFree.x * this.k, y: this.pendingFree.y * this.k });
    if (pts.length < 2) return;
    const inv = 1 / this.cameras.main.zoom;
    const step = R.step * inv;
    // Первая точка пунктира сдвигается со временем — точки бегут к цели.
    let next = step - ((this.clock * R.speed * inv) % step);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      while (next <= acc + len) {
        const t = (next - acc) / (len || 1);
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        g.fillStyle(color, R.haloAlpha).fillCircle(x, y, R.halo * inv);
        g.fillStyle(color, R.alpha).fillCircle(x, y, R.dot * inv);
        next += step;
      }
      acc += len;
    }
  }

  // ─── Ввод: клик по точке или перетаскивание карты ────────────────────────

  private onDown(p: Phaser.Input.Pointer): void {
    if (this.busy || p.button !== 0 || this.overUi(p)) return; // окно, переход, полоса сверху и портрет — не карта
    const cam = this.cameras.main;
    this.press = { x: p.x, y: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY };
    this.dragging = false;
    this.velocity = { x: 0, y: 0 };
    this.lastMove = { x: p.x, y: p.y, t: this.time.now };
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const cam = this.cameras.main;
    if (this.busy) return;
    if (this.press && p.isDown) {
      if (!this.dragging && Math.hypot(p.x - this.press.x, p.y - this.press.y) >= FEEL.dragThreshold) {
        this.dragging = true;
        cam.stopFollow();
        this.following = false;
        this.zoomAnchor = null;
        this.setHover(null);
      }
      if (this.dragging) {
        // Сдвиг мыши в px экрана → в px мира делится на зум.
        cam.setScroll(this.press.scrollX - (p.x - this.press.x) / cam.zoom, this.press.scrollY - (p.y - this.press.y) / cam.zoom);
        const dt = Math.max(1, this.time.now - this.lastMove.t);
        this.velocity = { x: (p.x - this.lastMove.x) / dt, y: (p.y - this.lastMove.y) / dt };
        this.lastMove = { x: p.x, y: p.y, t: this.time.now };
        return;
      }
    }
    const w = this.world(p);
    const ui = this.overUi(p);
    this.setHover(ui ? null : this.nodeAt(w.x, w.y));
    // Подсветка здания под мышью (заслоны с hover, уже открытые из-под тумана).
    const overBuilding = this.occl.hoverAt(ui || this.isWorld ? null : { x: w.x / this.k, y: w.y / this.k }, (x, y) => !this.fog || this.fog.isOpen(x, y)) && !!this.occl.hoveredPoi;
    this.input.setDefaultCursor(!ui && (this.hovered || overBuilding || this.roadAt(w.x, w.y) || this.forestAt(w.x, w.y)) ? walkCursor() : 'default');
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (!this.press || p.button !== 0) return;
    const wasDrag = this.dragging;
    this.press = null;
    this.dragging = false;
    if (wasDrag) {
      if (this.time.now - this.lastMove.t > 80) this.velocity = { x: 0, y: 0 }; // остановил мышь перед отпусканием — без инерции
      return;
    }
    if (this.busy) return;
    const w = this.world(p);
    const id = this.nodeAt(w.x, w.y);
    if (id) return this.travel(id);
    // Клик по зданию (заслон с poi, открытый из-под тумана) — идти в его точку; здание закрывает дороги за ним.
    if (!this.isWorld && this.occl.hoverAt({ x: w.x / this.k, y: w.y / this.k }, (x, y) => !this.fog || this.fog.isOpen(x, y)) && this.occl.hoveredPoi) return this.travel(this.occl.hoveredPoi);
    const road = this.roadAt(w.x, w.y);
    if (road) return this.go(road);
    const free = this.forestAt(w.x, w.y);
    if (free) this.goFree(free);
  }

  /** Место в лесу под курсором (точка мира → пиксели подложки): внутри зоны свободного хода и на открытой части карты. */
  private forestAt(x: number, y: number): Pt | null {
    const p = { x: x / this.k, y: y / this.k };
    if (!this.inZone(p) || (this.fog && !this.fog.isOpen(p.x, p.y))) return null;
    return p;
  }

  /** Место на дороге под курсором (точка мира): только на карте локации и только на открытой части карты. */
  private roadAt(x: number, y: number): { road: number; d: number } | null {
    if (this.isWorld) return null;
    const n = this.graph.nearestOnRoad({ x: x / this.k, y: y / this.k });
    if (n.dist * this.k * this.cameras.main.zoom > FEEL.map.roadHitRadius) return null;
    const p = this.graph.pointOnRoad(n.road, n.d);
    if (this.fog && !this.fog.isOpen(p.x, p.y)) return null;
    return { road: n.road, d: n.d };
  }

  /** Инерция после перетаскивания: карта едет дальше и плавно тормозит. */
  private applyInertia(delta: number): void {
    const In = FEEL.map.inertia;
    if (this.dragging || (Math.abs(this.velocity.x) < In.minSpeed && Math.abs(this.velocity.y) < In.minSpeed)) return;
    const cam = this.cameras.main;
    cam.setScroll(cam.scrollX - (this.velocity.x * delta) / cam.zoom, cam.scrollY - (this.velocity.y * delta) / cam.zoom);
    const f = Math.pow(In.friction, delta / (1000 / 60));
    this.velocity = { x: this.velocity.x * f, y: this.velocity.y * f };
  }

  /** Узел под курсором: метка в радиусе hitRadius px экрана. */
  private nodeAt(x: number, y: number): string | null {
    return this.markerAt(x, y);
  }

  private markerAt(x: number, y: number): string | null {
    let best: string | null = null;
    let bd = FEEL.map.hitRadius / this.cameras.main.zoom;
    for (const m of this.markers) {
      if (!m.dot.visible) continue;
      const d = Math.hypot(m.wx - x, m.wy - y);
      if (d <= bd) {
        bd = d;
        best = m.id;
      }
    }
    return best;
  }

  // ─── Отрисовка состояния ─────────────────────────────────────────────────

  private setHover(id: string | null): void {
    if (id === this.hovered) return;
    const F = FEEL.map;
    const prev = this.markers.find((m) => m.id === this.hovered);
    if (prev) this.tweens.add({ targets: prev.hover, s: 1, duration: F.markerHoverMs });
    this.hovered = id;
    this.input.setDefaultCursor(id ? walkCursor() : 'default');
    this.tweens.killTweensOf(this.tooltip);
    if (id) {
      const m = this.markers.find((x) => x.id === id)!;
      this.tweens.add({ targets: m.hover, s: F.markerHoverScale, duration: F.markerHoverMs, ease: 'Back.easeOut' });
      const T = F.tooltip;
      this.tooltipText.setText(m.name);
      this.tooltipBox.setSize(this.tooltipText.width + T.padX * 2, this.tooltipText.height + T.padY * 2);
      // Подпись — над меткой; отступ — в px экрана.
      const half = this.tooltipBox.height / 2;
      this.tooltipAnchor = { x: m.wx, y: m.wy, dy: -L.tooltipDy + half };
      this.tweens.add({ targets: this.tooltip, alpha: 1, duration: T.fadeMs });
    } else this.tweens.add({ targets: this.tooltip, alpha: 0, duration: F.tooltip.fadeMs });
    this.refreshMarkers();
  }

  private refreshMarkers(): void {
    const F = FEEL.map;
    const atNode = !this.target && !this.onRoad && !run.mapFree && !this.freeGoal;
    for (const m of this.markers) {
      const fill = m.id === this.hovered ? F.markerHoverFill : atNode && m.id === this.here ? F.markerHereFill : F.markerFill;
      m.dot.setFillStyle(fill);
      // Туман войны: метка появляется, когда место открыто.
      const open = !this.fog || this.fog.isOpen(m.x, m.y);
      if (open !== m.dot.visible) {
        m.dot.setVisible(open).setAlpha(open ? 0 : 1);
        m.glow.setVisible(open);
        if (open) this.tweens.add({ targets: m.dot, alpha: 1, duration: F.fogOfWar.revealMs });
      }
    }
    const here = this.graph.nodePoint(this.here);
    this.hereRing.setPosition(here.x * this.k, here.y * this.k).setVisible(atNode);
  }

  /** Надпись справа внизу: где герой. Локация — «Северляндия · Вы здесь: Зимняя гавань», мир — «Карта мира · …». */
  private refreshLocation(): void {
    const def = LOCATIONS[run.location];
    const head = this.isWorld ? 'Карта мира' : def.parent ? `${LOCATIONS[def.parent].name} · ${def.name}` : def.name;
    const tail = this.freeGoal || (run.mapFree && this.keyWalking) ? 'В пути' : run.mapFree ? 'Вы здесь: в лесу' : this.target === ROAD || this.keyWalking ? 'В пути' : this.target ? `В пути: → ${this.nodeName(this.target)}` : this.onRoad ? 'Вы здесь: на дороге' : this.isWorld ? `Вы в локации: ${this.nodeName(this.here)}` : `Вы здесь: ${this.nodeName(this.here)}`;
    this.location.setText(`${head} · ${tail}`);
    // Затемнение — мягкое пятно по центру текста, с запасом вокруг.
    const S = FEEL.map.locationShade;
    const t = this.location;
    this.locationShade.setPosition(t.x + t.width * (0.5 - t.originX), t.y + t.height * (0.5 - t.originY)).setDisplaySize(t.width + S.padX * 2, t.height + S.padY * 2);
  }
}

/** «3 свечи», «1 свеча», «5 свечей». */
function candlesWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? 'свеча' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'свечи' : 'свечей';
  return `${n} ${w}`;
}
