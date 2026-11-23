// Поиск пути в зоне свободного хода без Phaser: сетка проходимых клеток (зона минус преграды минус стволы — по предикату
// walkable), A* по 8 соседям без срезания углов и «натягивание нити» — из ломаной по клеткам остаются только точки,
// между которыми прямая свободна (герой идёт плавно, а не зигзагом). Координаты — пиксели подложки.
import type { Pt } from './map';

export class NavGrid {
  private cols: number;
  private rows: number;
  private open: Uint8Array;

  /** walkable — можно ли стоять в точке; bounds — рамка зоны; cell — шаг сетки (px подложки). */
  constructor(private walkable: (p: Pt) => boolean, private bounds: { x0: number; y0: number; x1: number; y1: number }, private cell: number) {
    this.cols = Math.ceil((bounds.x1 - bounds.x0) / cell);
    this.rows = Math.ceil((bounds.y1 - bounds.y0) / cell);
    this.open = new Uint8Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) if (walkable(this.center(c, r))) this.open[r * this.cols + c] = 1;
  }

  private center(c: number, r: number): Pt {
    return { x: this.bounds.x0 + (c + 0.5) * this.cell, y: this.bounds.y0 + (r + 0.5) * this.cell };
  }

  private cellOf(p: Pt): { c: number; r: number } {
    return { c: Math.floor((p.x - this.bounds.x0) / this.cell), r: Math.floor((p.y - this.bounds.y0) / this.cell) };
  }

  private isOpen(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.open[r * this.cols + c] === 1;
  }

  /** Прямая от a до b идёт только по проходимым клеткам (проверка с шагом в треть клетки). */
  lineFree(a: Pt, b: Pt): boolean {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / (this.cell / 3)));
    for (let i = 0; i <= n; i++) {
      const { c, r } = this.cellOf({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
      if (!this.isOpen(c, r)) return false;
    }
    return true;
  }

  /** Ближайшая проходимая точка к p (сама p, если проходима); null — в зоне нет проходимых мест. */
  nearest(p: Pt): Pt | null {
    if (this.walkable(p)) return { ...p };
    const { c, r } = this.cellOf(p);
    let best: Pt | null = null;
    let bd = Infinity;
    for (let rad = 0; rad < Math.max(this.cols, this.rows); rad++) {
      for (let rr = r - rad; rr <= r + rad; rr++)
        for (let cc = c - rad; cc <= c + rad; cc++) {
          if (Math.max(Math.abs(rr - r), Math.abs(cc - c)) !== rad || !this.isOpen(cc, rr)) continue;
          const q = this.center(cc, rr);
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < bd) {
            bd = d;
            best = q;
          }
        }
      // Нашли на этом кольце — дальше кольца не ближе, чем на клетку.
      if (best && bd <= (rad + 1) * this.cell) return best;
    }
    return best;
  }

  /**
   * Путь от a до b: точки поворота после a (последняя — b или ближайшая к ней проходимая). null — не дойти.
   * a должна быть проходимой (иначе путь начнётся с ближайшей к ней проходимой точки).
   */
  findPath(a: Pt, b: Pt): Pt[] | null {
    const start = this.nearest(a);
    const goal = this.nearest(b);
    if (!start || !goal) return null;
    if (this.lineFree(start, goal)) return start.x === a.x && start.y === a.y ? [goal] : [start, goal];
    const s = this.cellOf(start);
    const g = this.cellOf(goal);
    const C = this.cols;
    const N = C * this.rows;
    const gScore = new Float32Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const si = s.r * C + s.c;
    const gi = g.r * C + g.c;
    gScore[si] = 0;
    // Открытый список — двоичная куча по f = g + h.
    const heap: number[] = [si];
    const f = new Float32Array(N).fill(Infinity);
    const h = (i: number) => {
      const dx = Math.abs((i % C) - g.c);
      const dy = Math.abs(((i / C) | 0) - g.r);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    f[si] = h(si);
    const push = (i: number) => {
      heap.push(i);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (f[heap[p]] <= f[heap[k]]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
          if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    let found = false;
    while (heap.length) {
      const i = pop();
      if (closed[i]) continue;
      if (i === gi) {
        found = true;
        break;
      }
      closed[i] = 1;
      const c = i % C;
      const r = (i / C) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nc = c + dx;
          const nr = r + dy;
          if (!this.isOpen(nc, nr)) continue;
          // По диагонали — только если обе соседние клетки открыты (не срезаем угол преграды).
          if (dx && dy && (!this.isOpen(c + dx, r) || !this.isOpen(c, r + dy))) continue;
          const ni = nr * C + nc;
          const ng = gScore[i] + (dx && dy ? Math.SQRT2 : 1);
          if (ng >= gScore[ni]) continue;
          gScore[ni] = ng;
          from[ni] = i;
          f[ni] = ng + h(ni);
          push(ni);
        }
    }
    if (!found) return null;
    // Клетки от цели к старту → точки, затем натягивание нити.
    const cells: Pt[] = [];
    for (let i = from[gi]; i !== -1 && i !== si; i = from[i]) cells.push(this.center(i % C, (i / C) | 0));
    const raw = [start, ...cells.reverse(), goal];
    const out: Pt[] = [];
    let anchor = raw[0];
    let k = 0;
    while (k < raw.length - 1) {
      // Вперёд, пока прямая от опоры свободна; первая точка, до которой не видно, — стоп.
      let far = k + 1;
      while (far + 1 < raw.length && this.lineFree(anchor, raw[far + 1])) far++;
      out.push(raw[far]);
      anchor = raw[far];
      k = far;
    }
    if (start.x !== a.x || start.y !== a.y) out.unshift(start);
    return out;
  }

  /** Длина пути от a: сумма отрезков a → p0 → p1 … */
  static pathLength(a: Pt, path: Pt[]): number {
    let s = 0;
    let p = a;
    for (const q of path) {
      s += Math.hypot(q.x - p.x, q.y - p.y);
      p = q;
    }
    return s;
  }
}
