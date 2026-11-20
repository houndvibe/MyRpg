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
