// Игровой режим: карта локации или карта мира — одна сцена, вид выбирается данными сцены ({ world: true } — мир).
// Карта локации: точки интереса (data/map.ts), клик по точке или зданию — герой идёт по дорогам, цель можно сменить на ходу;
// в точке с диалогом (POI_DIALOGS) открывается окно взаимодействия. Карта мира: медальоны локаций (data/world.ts),
// клик — герой идёт по дорогам мира, по приходу — спуск в локацию (в её точку выхода).
// Камера следит за героем; карту можно тянуть мышью (с инерцией) и приближать колёсиком. Отдалили локацию до упора и
// крутят дальше — подъём «за облака» на карту мира; приблизили мир до упора — спуск в локацию героя (CloudCurtain).
// Две камеры: main — карта (прокрутка и зум), ui — интерфейс поверх (полоса сверху, портрет, облака перехода, снег).
// Метки, подписи, пунктир и кольца — одного размера на экране при любом зуме (делятся на зум каждый кадр).
import * as Phaser from 'phaser';
import { CloudCurtain } from '../components/CloudCurtain';
import { DialogWindow } from '../components/DialogWindow';
import { addMapAmbience, addSnow, FX_SOFT } from '../components/MapAmbience';
import { MapBuildings } from '../components/MapBuildings';
import { MapCarriage } from '../components/MapCarriage';
import { ensureHeroFrames, MapHero } from '../components/MapHero';
import { HERO_SHEET, MAP_LAYOUT as L, type MapView } from '../config/assets';
import { FEEL } from '../config/feel';
import { POI_DIALOGS, type DialogId } from '../data/dialogs';
import { LOCATION_IDS, LOCATIONS, poisOf, POIS, type LocationId, type PoiId } from '../data/map';
import { WORLD_NODES } from '../data/world';
import { run } from '../state';
import { locationGraph, routeLength, worldGraph, type Leg, type MapGraph, type MapPos } from '../systems/map';
import { addText, Button, C, H, W } from '../ui';

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
  private hovered: string | null = null;
  private ambience: (deltaMs: number) => void = () => {};
  private buildings: MapBuildings | null = null;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  /** Пока true, всё созданное — интерфейс (видит только ui-камера). */
  private buildingUi = false;
  /** Открытое окно взаимодействия — пока оно есть, карта не получает ввод. */
  private dialog: DialogWindow | null = null;
  /** Портрет в углу карты — прячется, пока открыто окно взаимодействия. */
  private cornerPortrait: Phaser.GameObjects.GameObject[] = [];
  private curtain!: CloudCurtain;
  /** Идёт переход за облака — ввод закрыт. */
  private transitioning = false;
  /** Щелчки колёсика за краем зума подряд: сколько и когда был последний. */
  private overscroll = { n: 0, t: 0 };

  /** Текущий путь: отрезки дорог, пройдено (в пикселях подложки), цель. Пусто — герой стоит в своём узле. */
  private legs: Leg[] = [];
  private walked = 0;
  private target: string | null = null;
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
    return this.isWorld ? run.location : run.mapPoi;
  }

  private nodes(): MapNode[] {
    if (this.isWorld) return LOCATION_IDS.map((id) => ({ id, name: LOCATIONS[id].name, ...WORLD_NODES[id] }));
    return poisOf(run.location).map((id) => ({ id, name: POIS[id].name, x: POIS[id].x, y: POIS[id].y }));
  }

  private nodeName(id: string): string {
    return this.isWorld ? LOCATIONS[id as LocationId].name : POIS[id as PoiId].name;
  }

  create(): void {
    const F = FEEL.map;
    this.view = this.isWorld ? L.world : L.locations[run.location];
    this.graph = this.isWorld ? worldGraph() : locationGraph(run.location);
    const k = (this.k = this.view.scale);
    this.markers = [];
    this.legs = [];
    this.walked = 0;
    this.target = null;
    this.hovered = null;
    this.press = null;
    this.dragging = false;
    this.velocity = { x: 0, y: 0 };
    this.clock = 0;
    this.following = true;
    this.zoomAnchor = null;
    this.ringPulse = { s: 1 };
    this.dialog = null;
    this.buildings = null;
    this.transitioning = false;
    this.overscroll = { n: 0, t: 0 };

    // Камера интерфейса: всё, что не интерфейс, она не рисует; интерфейс не рисует основная.
    const cam = this.cameras.main;
    this.uiCam = this.cameras.add(0, 0, W, H);
    this.buildingUi = false;
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, (go: Phaser.GameObjects.GameObject) => {
      if (this.buildingUi) cam.ignore(go);
      else this.uiCam.ignore(go);
    });

    const bg = this.add.image(0, 0, this.view.key, '__BASE').setOrigin(0).setScale(k);
    const worldW = bg.width * k;
    const worldH = bg.height * k;
    cam.setBounds(0, 0, worldW, worldH);
    // Зум: минимум — карта целиком по ширине или высоте; максимум — у локации общий, у мира — от минимума.
    this.minZoom = Math.max(W / worldW, H / worldH);
    this.maxZoom = this.isWorld ? this.minZoom * FEEL.world.maxZoomMult : F.zoom.max;
    this.ambience = addMapAmbience(this, this.view);
    if (!this.isWorld) this.buildings = new MapBuildings(this, run.location, k);

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
    const start = this.graph.nodePoint(this.here);
    this.figure = this.isWorld ? new MapCarriage(this, FEEL.world.carriage.width) : new MapHero(this, F.hero.height);
    this.hero = this.add.container(start.x * k, start.y * k, [this.figure.sprite]).setDepth(8);
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
    this.add.rectangle(0, 0, W, L.topBar.h, 0x000000, 0.55).setOrigin(0).setDepth(20);
    this.location = addText(this, L.locationText.x, L.locationText.y, '', 28, C.accent).setOrigin(0.5).setDepth(21);
    const mb = L.menuButton;
    new Button(this, mb.x, mb.y, mb.w, mb.h, '← Меню', () => this.scene.start('Menu'), 22).setDepth(21);
    this.addPortrait();
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
      this.zoomTarget = Phaser.Math.Clamp(savedZoom.get(this.view.key) ?? 1, this.minZoom, this.maxZoom);
      cam.setZoom(this.minZoom).zoomTo(this.zoomTarget, Tr.openMs * 1.3, 'Cubic.easeOut');
      this.curtain.open(Tr.openMs);
    } else {
      const I = F.intro;
      this.zoomTarget = Phaser.Math.Clamp(savedZoom.get(this.view.key) ?? (this.isWorld ? this.minZoom : 1), this.minZoom, this.maxZoom);
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
    // Ушли посреди пути — в следующий раз герой стоит там, куда шёл. Масштаб запоминается.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.target && !this.isWorld) run.mapPoi = this.target as PoiId;
      if (!this.transitioning) savedZoom.set(this.view.key, this.zoomTarget);
      this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE);
      this.input.setDefaultCursor('default');
    });
    this.refreshMarkers();
    this.refreshLocation();
    this.applyScreenSizes();
    if (this.resume) this.openDialog(this.resume.node);
  }

  /** Портрет героя в правом нижнем углу: рамка с каймой, картинка вписана внутрь. */
  private addPortrait(): void {
    const P = L.portrait;
    const S = FEEL.map.portrait;
    const [, , w, h] = HERO_SHEET.portrait;
    const inner = P.size - P.pad * 2;
    ensureHeroFrames(this); // на карте мира фигурки нет — кадр портрета нарезаем здесь
    this.cornerPortrait = [
      this.add.rectangle(P.x, P.y, P.size, P.size, S.fill, S.fillAlpha).setStrokeStyle(S.strokeWidth, S.stroke).setDepth(20),
      this.add.image(P.x, P.y, HERO_SHEET.key, 'portrait').setScale(Math.min(inner / w, inner / h)).setDepth(21),
    ];
  }

  /** Окно взаимодействия поверх всего (рисует ui-камера); портрет в углу на это время прячется. */
  private openDialog(start?: string): void {
    if (this.isWorld) return;
    const id = POI_DIALOGS[run.mapPoi];
    if (!id || this.dialog || this.target) return;
    this.setHover(null);
    this.velocity = { x: 0, y: 0 };
    this.buildingUi = true;
    this.dialog = new DialogWindow(
      this,
      id,
      () => {
        this.dialog = null;
        for (const o of this.cornerPortrait) (o as Phaser.GameObjects.Image).setVisible(true);
      },
      () => this.startBattle(id),
      start,
    );
    this.buildingUi = false;
    for (const o of this.cornerPortrait) (o as Phaser.GameObjects.Image).setVisible(false);
  }

  /** Бой с собеседником: экран уходит в чёрное, дальше — сцена боя в обстановке разговора. */
  private startBattle(id: DialogId): void {
    const ms = FEEL.dialog.battleFadeMs;
    this.cameras.main.fadeOut(ms);
    this.uiCam.fadeOut(ms);
    this.time.delayedCall(ms, () => this.scene.start('Battle', { dialog: id }));
  }

  /** Точка экрана над интерфейсом (полоса сверху, портрет) — карта её не получает. */
  private overUi(p: Phaser.Input.Pointer): boolean {
    const P = L.portrait;
    return p.y < L.topBar.h || (Math.abs(p.x - P.x) <= P.size / 2 && Math.abs(p.y - P.y) <= P.size / 2);
  }

  /** Точка мира под точкой экрана — по основной камере (pointer.worldX считает верхняя, ui-камера). */
  private world(p: { x: number; y: number }): Phaser.Math.Vector2 {
    return this.cameras.main.getWorldPoint(p.x, p.y);
  }

  /** Ввод закрыт: окно разговора или переход за облака. */
  private get busy(): boolean {
    return !!this.dialog || this.transitioning;
  }

  update(_time: number, delta: number): void {
    this.clock += delta / 1000;
    this.ambience(delta);
    this.applyInertia(delta);
    this.applyZoom(delta);

    let dx = 0;
    if (this.target) {
      const total = routeLength(this.legs);
      // Скорость — в px мира в секунду; путь считается в пикселях подложки.
      const speed = this.isWorld ? FEEL.world.speed : FEEL.map.speed;
      this.walked = Math.min(total, this.walked + (speed / this.k) * (delta / 1000));
      const { pt } = this.graph.alongRoute(this.legs, this.walked);
      dx = pt.x * this.k - this.hero.x;
      this.hero.setPosition(pt.x * this.k, pt.y * this.k);
      if (this.walked >= total) this.arriveAt();
    }
    this.figure.update(delta, dx);
    this.dialog?.update(delta);
    this.applyScreenSizes();
    this.drawRoute();
  }

  // ─── Зум и переход за облака ─────────────────────────────────────────────

  private onWheel(p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void {
    const cam = this.cameras.main;
    if (this.busy || dy === 0 || this.overUi(p) || cam.zoomEffect.isRunning) return;
    const Z = FEEL.map.zoom;
    const out = dy > 0;
    // Уже на краю зума и крутят дальше: локация — наружу (подъём), мир — внутрь (спуск, если герой не в пути).
    const atEdge = this.isWorld ? !out && this.zoomTarget >= this.maxZoom - 1e-4 : out && this.zoomTarget <= this.minZoom + 1e-4;
    if (atEdge) {
      if (this.isWorld && this.target) return;
      const Tr = FEEL.transition;
      const now = this.time.now;
      this.overscroll = { n: now - this.overscroll.t <= Tr.notchMs ? this.overscroll.n + 1 : 1, t: now };
      if (this.overscroll.n >= Tr.notches) this.isWorld ? this.descend(run.location) : this.ascend();
      return;
    }
    this.overscroll = { n: 0, t: 0 };
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
    if (this.transitioning) return;
    // Поднялись посреди пути — герой остаётся там, куда шёл.
    if (this.target) run.mapPoi = this.target as PoiId;
    savedZoom.set(this.view.key, this.zoomTarget);
    this.leaveBy(this.minZoom * FEEL.transition.ascendZoom, null, { world: true, arrive: 'ascend' });
  }

  /** Спуск в локацию: камера наезжает на неё, облака сходятся — дальше карта локации. */
  private descend(loc: LocationId): void {
    if (this.transitioning) return;
    savedZoom.set(this.view.key, this.zoomTarget);
    const p = WORLD_NODES[loc];
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
    cam.zoomTo(zoom, Tr.closeMs, 'Sine.easeIn');
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

  /** Пойти к узлу: маршрут считается от того места, где герой сейчас (в узле или посреди дороги). */
  private travel(id: string): void {
    const from: MapPos = this.target ? this.graph.alongRoute(this.legs, this.walked).pos : { node: this.here };
    if (!this.target && id === this.here) return this.openDialog(); // уже здесь — открыть окно точки, если оно есть
    this.legs = this.graph.route(from, id);
    this.walked = 0;
    this.target = id;
    if (this.legs.length === 0) return this.arriveAt();
    this.velocity = { x: 0, y: 0 };
    this.zoomAnchor = null;
    this.following = true;
    this.cameras.main.startFollow(this.hero, false, FEEL.map.followLerp, FEEL.map.followLerp);
    const p = this.graph.nodePoint(id);
    this.ring.setPosition(p.x * this.k, p.y * this.k).setVisible(true);
    this.dust.emitting = true;
    this.figure.setWalking(true);
    this.refreshMarkers();
    this.refreshLocation();
  }

  private arriveAt(): void {
    const id = this.target!;
    this.target = null;
    this.legs = [];
    this.walked = 0;
    const p = this.graph.nodePoint(id);
    this.hero.setPosition(p.x * this.k, p.y * this.k);
    this.figure.setWalking(false);
    this.dust.emitting = false;
    this.ring.setVisible(false);
    this.arrivalWave(p.x * this.k, p.y * this.k);
    if (this.isWorld) {
      // Пришли в другую локацию по дороге мира — спуск в неё, в её точку выхода.
      const loc = id as LocationId;
      if (loc !== run.location) {
        run.location = loc;
        run.mapPoi = LOCATIONS[loc].exit;
      }
      this.refreshMarkers();
      this.refreshLocation();
      this.time.delayedCall(FEEL.dialog.openDelayMs, () => this.descend(loc));
      return;
    }
    run.mapPoi = id as PoiId;
    this.refreshMarkers();
    this.refreshLocation();
    if (POI_DIALOGS[run.mapPoi]) this.time.delayedCall(FEEL.dialog.openDelayMs, () => this.openDialog());
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
    if (!this.target) return;
    const pts = this.graph.remainingPoints(this.legs, this.walked).map((p) => ({ x: p.x * this.k, y: p.y * this.k }));
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
    this.setHover(this.overUi(p) ? null : this.nodeAt(w.x, w.y));
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
    if (id) this.travel(id);
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

  /** Узел под курсором: метка (в радиусе hitRadius px экрана) или здание (по непрозрачному пикселю). */
  private nodeAt(x: number, y: number): string | null {
    return this.markerAt(x, y) ?? this.buildings?.at(x, y) ?? null;
  }

  private markerAt(x: number, y: number): string | null {
    let best: string | null = null;
    let bd = FEEL.map.hitRadius / this.cameras.main.zoom;
    for (const m of this.markers) {
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
    this.buildings?.setHover(id as PoiId | null);
    this.input.setDefaultCursor(id ? 'pointer' : 'default');
    this.tweens.killTweensOf(this.tooltip);
    if (id) {
      const m = this.markers.find((x) => x.id === id)!;
      this.tweens.add({ targets: m.hover, s: F.markerHoverScale, duration: F.markerHoverMs, ease: 'Back.easeOut' });
      const T = F.tooltip;
      this.tooltipText.setText(m.name);
      this.tooltipBox.setSize(this.tooltipText.width + T.padX * 2, this.tooltipText.height + T.padY * 2);
      // Подпись — над зданием точки, если оно есть, иначе над меткой; отступ — в px экрана.
      const top = this.buildings?.top(id as PoiId) ?? null;
      const half = this.tooltipBox.height / 2;
      this.tooltipAnchor = top !== null ? { x: m.wx, y: top, dy: F.buildingTooltipGap + half } : { x: m.wx, y: m.wy, dy: -L.tooltipDy + half };
      this.tweens.add({ targets: this.tooltip, alpha: 1, duration: T.fadeMs });
    } else this.tweens.add({ targets: this.tooltip, alpha: 0, duration: F.tooltip.fadeMs });
    this.refreshMarkers();
  }

  private refreshMarkers(): void {
    const F = FEEL.map;
    for (const m of this.markers) {
      const fill = m.id === this.hovered ? F.markerHoverFill : !this.target && m.id === this.here ? F.markerHereFill : F.markerFill;
      m.dot.setFillStyle(fill);
    }
    const here = this.graph.nodePoint(this.here);
    this.hereRing.setPosition(here.x * this.k, here.y * this.k).setVisible(!this.target);
  }

  /** Надпись сверху: где герой. Локация — «Северляндия · Вы здесь: Зимняя гавань», мир — «Карта мира · …». */
  private refreshLocation(): void {
    const head = this.isWorld ? 'Карта мира' : LOCATIONS[run.location].name;
    const tail = this.target ? `В пути: → ${this.nodeName(this.target)}` : this.isWorld ? `Вы в локации: ${this.nodeName(this.here)}` : `Вы здесь: ${this.nodeName(this.here)}`;
    this.location.setText(`${head} · ${tail}`);
  }
}
