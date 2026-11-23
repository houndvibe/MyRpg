// Маршруты по картам без Phaser: граф дорог (локации — data/map.ts, мир — data/world.ts), кратчайший путь
// от любой позиции героя (в узле или посреди дороги) до узла и положение на маршруте. Координаты — пиксели подложки.
import { LOCATIONS, POIS, type LocationId, type Road } from '../data/map';
import { WORLD_JUNCTIONS, WORLD_NODES, WORLD_ROADS } from '../data/world';

export interface Pt {
  x: number;
  y: number;
}

/** Где герой: в узле (точке или развилке) или на дороге road на расстоянии d от её начала (узла a). */
export type MapPos = { node: string } | { road: number; d: number };

/** Точка внутри многоугольника (пиксели подложки). */
export function insidePoly(p: Pt, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Отрезок маршрута: проход по дороге road от расстояния d0 до d1 (d1 < d0 — против направления дороги). */
export interface Leg {
  road: number;
  d0: number;
  d1: number;
}

export const legLength = (leg: Leg): number => Math.abs(leg.d1 - leg.d0);
export const routeLength = (legs: Leg[]): number => legs.reduce((s, l) => s + legLength(l), 0);

/** Граф одной карты: узлы (точки и развилки) и дороги-ломаные между ними. */
export class MapGraph {
  private nodes: Map<string, Pt>;
  /** Накопленные длины вдоль каждой дороги: cum[road][i] — расстояние от начала до i-й вершины. */
  private cum: number[][];
  /** Соседи узла: по какой дороге, куда и с какого конца дороги выходим. */
  private adj = new Map<string, { road: number; to: string; fromA: boolean }[]>();

  constructor(nodes: Record<string, Pt>, private roads: Road[]) {
    this.nodes = new Map(Object.entries(nodes));
    this.cum = roads.map((r) => {
      const out = [0];
      for (let i = 1; i < r.points.length; i++) {
        const [ax, ay] = r.points[i - 1];
        const [bx, by] = r.points[i];
        out.push(out[i - 1] + Math.hypot(bx - ax, by - ay));
      }
      return out;
    });
    roads.forEach((r, i) => {
      for (const [n, to, fromA] of [[r.a, r.b, true], [r.b, r.a, false]] as const) {
        if (!this.adj.has(n)) this.adj.set(n, []);
        this.adj.get(n)!.push({ road: i, to, fromA });
      }
    });
  }

  /** Сколько дорог в графе. */
  get roadCount(): number {
    return this.roads.length;
  }

  roadLength(road: number): number {
    return this.cum[road][this.cum[road].length - 1];
  }

  nodePoint(id: string): Pt {
    return this.nodes.get(id)!;
  }

  /** Точка на дороге на расстоянии d от её начала. */
  pointOnRoad(road: number, d: number): Pt {
    const pts = this.roads[road].points;
    const cum = this.cum[road];
    const dd = Math.min(Math.max(d, 0), this.roadLength(road));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < dd) i++;
    const k = (dd - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k };
  }

  /** Вершины дороги между d0 и d1 в порядке движения (с концами). */
  private legPoints(leg: Leg): Pt[] {
    const cum = this.cum[leg.road];
    const pts = this.roads[leg.road].points;
    const lo = Math.min(leg.d0, leg.d1);
    const hi = Math.max(leg.d0, leg.d1);
    const inner: Pt[] = [];
    for (let i = 0; i < pts.length; i++) if (cum[i] > lo && cum[i] < hi) inner.push({ x: pts[i][0], y: pts[i][1] });
    if (leg.d1 < leg.d0) inner.reverse();
    return [this.pointOnRoad(leg.road, leg.d0), ...inner, this.pointOnRoad(leg.road, leg.d1)];
  }

  /**
   * Кратчайший маршрут от позиции героя до узла (Дейкстра). Пустой список — уже на месте.
   * С середины дороги можно пойти к любому её концу — так работает разворот на ходу.
   */
  route(pos: MapPos, target: string): Leg[] {
    const dist = new Map<string, number>();
    const prev = new Map<string, Leg[]>(); // какими отрезками пришли в узел
    const open: string[] = [];
    const relax = (node: string, cost: number, legs: Leg[]) => {
      if (cost >= (dist.get(node) ?? Infinity)) return;
      dist.set(node, cost);
      prev.set(node, legs);
      open.push(node);
    };
    if ('node' in pos) relax(pos.node, 0, []);
    else {
      const L = this.roadLength(pos.road);
      relax(this.roads[pos.road].a, pos.d, [{ road: pos.road, d0: pos.d, d1: 0 }]);
      relax(this.roads[pos.road].b, L - pos.d, [{ road: pos.road, d0: pos.d, d1: L }]);
    }
    while (open.length) {
      open.sort((p, q) => dist.get(p)! - dist.get(q)!);
      const n = open.shift()!;
      const base = dist.get(n)!;
      for (const e of this.adj.get(n) ?? []) {
        const L = this.roadLength(e.road);
        relax(e.to, base + L, [...prev.get(n)!, e.fromA ? { road: e.road, d0: 0, d1: L } : { road: e.road, d0: L, d1: 0 }]);
      }
    }
    return prev.get(target) ?? [];
  }

  /** Точка позиции: узел или место на дороге. */
  pointAt(pos: MapPos): Pt {
    return 'node' in pos ? this.nodePoint(pos.node) : this.pointOnRoad(pos.road, pos.d);
  }

  /** Ближайшее к точке место на дорогах: дорога, расстояние от её начала и расстояние до точки. */
  nearestOnRoad(p: Pt): { road: number; d: number; dist: number } {
    let best = { road: 0, d: 0, dist: Infinity };
    this.roads.forEach((r, road) => {
      const cum = this.cum[road];
      for (let i = 1; i < r.points.length; i++) {
        const [ax, ay] = r.points[i - 1];
        const [bx, by] = r.points[i];
        const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
        const t = Math.min(1, Math.max(0, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / len2));
        const dist = Math.hypot(ax + (bx - ax) * t - p.x, ay + (by - ay) * t - p.y);
        if (dist < best.dist) best = { road, d: cum[i - 1] + (cum[i] - cum[i - 1]) * t, dist };
      }
    });
    return best;
  }

  /**
   * Кратчайший маршрут от позиции героя до любой позиции: узла или места на дороге. К месту на дороге — через ближний
   * из её концов или прямо по ней, если герой уже на этой дороге (или в одном из её концов).
   */
  routeTo(pos: MapPos, dest: MapPos): Leg[] {
    if ('node' in dest) return this.route(pos, dest.node);
    const r = this.roads[dest.road];
    const L = this.roadLength(dest.road);
    const options: Leg[][] = [
      [...this.route(pos, r.a), { road: dest.road, d0: 0, d1: dest.d }],
      [...this.route(pos, r.b), { road: dest.road, d0: L, d1: dest.d }],
    ];
    if (!('node' in pos) && pos.road === dest.road) options.push([{ road: dest.road, d0: pos.d, d1: dest.d }]);
    const best = options.reduce((p, q) => (routeLength(q) < routeLength(p) ? q : p));
    return best.filter((l) => legLength(l) > 1e-6);
  }

  /** Дороги из узла: по какой дороге и с какого конца (fromA — от её начала). */
  exits(node: string): { road: number; fromA: boolean }[] {
    return (this.adj.get(node) ?? []).map((e) => ({ road: e.road, fromA: e.fromA }));
  }

  /** Концы дороги — узлы a и b. */
  roadEnds(road: number): { a: string; b: string } {
    return { a: this.roads[road].a, b: this.roads[road].b };
  }

  /** Куда ведёт дорога от места d на look вперёд (sign +1 — к концу b, −1 — к началу a): единичный вектор (0, 0 — тупик). */
  heading(road: number, d: number, sign: 1 | -1, look: number): Pt {
    const p = this.pointOnRoad(road, d);
    const q = this.pointOnRoad(road, d + sign * look);
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    return len < 1e-6 ? { x: 0, y: 0 } : { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
  }

  /**
   * Шаг ходьбы по клавишам: из позиции pos пройти dist по дорогам в сторону v (единичный вектор, ось y вниз).
   * На дороге герой идёт туда, куда она ведёт ближе к v (смотрит на look вперёд и назад), и продолжает, пока дорога
   * не уходит от v сильнее keepDot (так проходятся серпантины). В узле выбирает дорогу, чьё начало ближе всего к v;
   * если ни одна не ближе minDot — стоит. sign — в какую сторону по дороге шёл (для продолжения на следующем шаге).
   */
  steer(pos: MapPos, sign: 1 | -1, v: Pt, dist: number, look: number, minDot: number, keepDot: number): { pos: MapPos; sign: 1 | -1; moved: number } {
    const dot = (a: Pt) => a.x * v.x + a.y * v.y;
    let cur: MapPos = 'node' in pos ? { ...pos } : { ...pos };
    let s = sign;
    let left = dist;
    for (let guard = 0; left > 1e-6 && guard < 24; guard++) {
      if ('node' in cur) {
        let best: { road: number; fromA: boolean; dot: number } | null = null;
        for (const e of this.exits(cur.node)) {
          const h = this.heading(e.road, e.fromA ? 0 : this.roadLength(e.road), e.fromA ? 1 : -1, look);
          const dt = dot(h);
          if (!best || dt > best.dot) best = { ...e, dot: dt };
        }
        if (!best || best.dot < minDot) break;
        cur = { road: best.road, d: best.fromA ? 0 : this.roadLength(best.road) };
        s = best.fromA ? 1 : -1;
        continue;
      }
      const L = this.roadLength(cur.road);
      const ahead = dot(this.heading(cur.road, cur.d, s, look));
      const back = dot(this.heading(cur.road, cur.d, -s as 1 | -1, look));
      if (back > ahead && back >= minDot) s = -s as 1 | -1;
      else if (ahead < keepDot || (ahead === 0 && back === 0)) break;
      const nd = cur.d + s * left;
      if (nd >= 0 && nd <= L) {
        cur = { road: cur.road, d: nd };
        left = 0;
      } else {
        left -= s > 0 ? L - cur.d : cur.d;
        const ends = this.roadEnds(cur.road);
        cur = { node: s > 0 ? ends.b : ends.a };
      }
    }
    return { pos: cur, sign: s, moved: dist - left };
  }

  /** Где герой на маршруте, пройдя s: точка и позиция на дороге (для разворота). */
  alongRoute(legs: Leg[], s: number): { pt: Pt; pos: MapPos } {
    let left = s;
    for (const leg of legs) {
      const len = legLength(leg);
      if (left <= len) {
        const d = leg.d0 + Math.sign(leg.d1 - leg.d0) * left;
        return { pt: this.pointOnRoad(leg.road, d), pos: { road: leg.road, d } };
      }
      left -= len;
    }
    const last = legs[legs.length - 1];
    return { pt: this.pointOnRoad(last.road, last.d1), pos: { road: last.road, d: last.d1 } };
  }

  /** Остаток маршрута после пройденного s — ломаная для линии к цели. */
  remainingPoints(legs: Leg[], s: number): Pt[] {
    const out: Pt[] = [];
    let left = s;
    for (const leg of legs) {
      const len = legLength(leg);
      if (left >= len) {
        left -= len;
        continue;
      }
      const d = leg.d0 + Math.sign(leg.d1 - leg.d0) * left;
      left = 0;
      const pts = this.legPoints({ road: leg.road, d0: d, d1: leg.d1 });
      out.push(...(out.length ? pts.slice(1) : pts));
    }
    return out;
  }
}

const graphs = new Map<string, MapGraph>();

/** Граф дорог локации (строится один раз). */
export function locationGraph(loc: LocationId): MapGraph {
  if (!graphs.has(loc)) {
    const def = LOCATIONS[loc];
    const nodes: Record<string, Pt> = { ...def.junctions };
    for (const p of Object.values(POIS)) if (p.loc === loc) nodes[p.id] = { x: p.x, y: p.y };
    graphs.set(loc, new MapGraph(nodes, def.roads));
  }
  return graphs.get(loc)!;
}

/** Граф дорог карты мира: узлы — локации и развилки. */
export function worldGraph(): MapGraph {
  if (!graphs.has('world')) graphs.set('world', new MapGraph({ ...WORLD_NODES, ...WORLD_JUNCTIONS }, WORLD_ROADS));
  return graphs.get('world')!;
}
