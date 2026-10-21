// Navigation for the AI harness: a 1 m walkability grid over the valley and A* on it.
// Walkable = not inside an obstacle and not a cliff (same rule as the physics, a bit stricter).
// Deep water is walkable but slow (Le Chonk swims), so paths prefer bridges.
import { pointBlocked } from '../game/colliders';
import { WATER_LEVEL } from '../world/layout';
import { groundAt } from '../world/world';

const HALF = 266;
const N = HALF * 2 + 1;
const idx = (i: number, j: number) => j * N + i;
const toCell = (v: number) => Math.round(v + HALF);
const toWorld = (c: number) => c - HALF;

export class NavGrid {
  h = new Float32Array(N * N);
  /** 1 = obstacle */
  block = new Uint8Array(N * N);
  /** 1 = deep water (swimming) */
  water = new Uint8Array(N * N);
  /** extra blocks learned when Le Chonk got stuck */
  private learned = new Set<number>();

  constructor() {
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = toWorld(i), z = toWorld(j), k = idx(i, j);
        const h = groundAt(x, z);
        this.h[k] = h;
        this.water[k] = WATER_LEVEL - h > 0.7 ? 1 : 0;
      }
    this.refresh(-HALF, -HALF, HALF, HALF);
  }

  /** recompute obstacles in a box (after a crate or a rock breaks) */
  refresh(x0: number, z0: number, x1: number, z1: number) {
    const i0 = Math.max(0, toCell(x0)), i1 = Math.min(N - 1, toCell(x1));
    const j0 = Math.max(0, toCell(z0)), j1 = Math.min(N - 1, toCell(z1));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = idx(i, j), x = toWorld(i), z = toWorld(j);
        this.block[k] = this.learned.has(k) || pointBlocked(x, this.h[k] + 0.8, z, 0.62) || this.ledge(i, j) ? 1 : 0;
      }
  }

  /** the edge of a sudden drop (a bridge side, a terrace): keep a cell away so we don't fall or bump into it */
  private ledge(i: number, j: number) {
    const h = this.h[idx(i, j)];
    for (let d = 0; d < 4; d++) {
      const ni = i + DI[d], nj = j + DJ[d];
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      if (Math.abs(this.h[idx(ni, nj)] - h) > 1.5) return true;
    }
    return false;
  }

  /** can Le Chonk walk straight from a to b? (samples the grid every half meter) */
  clear(ax: number, az: number, bx: number, bz: number) {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
    for (let k = 1; k <= n; k++) if (!this.walkable(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n)) return false;
    return true;
  }

  /** remember a spot where Le Chonk could not pass */
  learnBlock(x: number, z: number) {
    const i = toCell(x), j = toCell(z);
    if (i < 0 || j < 0 || i >= N || j >= N) return;
    this.learned.add(idx(i, j));
    this.block[idx(i, j)] = 1;
  }

  walkable(x: number, z: number) {
    const i = toCell(x), j = toCell(z);
    return i >= 0 && j >= 0 && i < N && j < N && !this.block[idx(i, j)];
  }

  /** the closest walkable cell to (x, z), within r meters */
  nearestWalkable(x: number, z: number, r = 6): [number, number] | null {
    const ci = toCell(x), cj = toCell(z);
    let best: [number, number] | null = null, bd = Infinity;
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= N || j >= N || this.block[idx(i, j)]) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; best = [i, j]; }
      }
    return best;
  }

  /**
   * A* from (sx, sz) to (tx, tz). Returns world waypoints (every cell, start excluded), or null.
   * `near`: stop when within this distance of the target (talking, hitting, picking up).
   */
  path(sx: number, sz: number, tx: number, tz: number, near = 0): { x: number; z: number }[] | null {
    const s = this.nearestWalkable(sx, sz, 3);
    if (!s) return null;
    const S = idx(s[0], s[1]);
    const ti = toCell(tx), tj = toCell(tz);
    const goalR = Math.max(near, 0.8);
    const g = new Float32Array(N * N).fill(Infinity);
    const from = new Int32Array(N * N).fill(-1);
    const closed = new Uint8Array(N * N);
    const heap = new Heap();
    const hEst = (i: number, j: number) => Math.hypot(i - ti, j - tj);
    g[S] = 0;
    heap.push(S, hEst(s[0], s[1]));
    let goal = -1, bestK = S, bestH = Infinity;
    let expanded = 0;
    while (heap.size) {
      const k = heap.pop();
      if (closed[k]) continue;
      closed[k] = 1;
      const i = k % N, j = (k / N) | 0;
      const dh = hEst(i, j);
      if (dh < bestH) { bestH = dh; bestK = k; }
      if (dh <= goalR) { goal = k; break; }
      if (++expanded > 260000) break;
      const hk = this.h[k];
      for (let d = 0; d < 8; d++) {
        const ni = i + DI[d], nj = j + DJ[d];
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = idx(ni, nj);
        if (closed[nk] || this.block[nk]) continue;
        // diagonal moves must not cut a blocked corner
        if (d >= 4 && (this.block[idx(i + DI[d], j)] || this.block[idx(i, j + DJ[d])])) continue;
        const len = d >= 4 ? Math.SQRT2 : 1;
        const rise = this.h[nk] - hk;
        if (rise > 0.5 + 1.2 * len) continue; // a cliff
        let cost = len * (this.water[nk] ? 3.2 : 1) + Math.max(0, rise) * 0.4;
        cost += Math.abs(rise) > 1.2 * len ? 1 : 0; // steep: prefer gentler ways
        const ng = g[k] + cost;
        if (ng < g[nk]) {
          g[nk] = ng;
          from[nk] = k;
          heap.push(nk, ng + hEst(ni, nj));
        }
      }
    }
    if (goal < 0) {
      // unreachable: go as close as possible (the action reports it)
      if (bestH > goalR + 4) return null;
      goal = bestK;
    }
    const out: { x: number; z: number }[] = [];
    for (let k = goal; k !== S && k >= 0; k = from[k]) out.push({ x: toWorld(k % N), z: toWorld((k / N) | 0) });
    out.reverse();
    return out;
  }
}

const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ = [0, 0, 1, -1, 1, -1, 1, -1];

/** binary min-heap of (key, priority) */
class Heap {
  private k: number[] = [];
  private p: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, pri: number) {
    const k = this.k, p = this.p;
    let i = k.length;
    k.push(key);
    p.push(pri);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (p[up] <= pri) break;
      k[i] = k[up]; p[i] = p[up];
      i = up;
    }
    k[i] = key; p[i] = pri;
  }
  pop(): number {
    const k = this.k, p = this.p;
    const top = k[0];
    const lk = k.pop()!, lp = p.pop()!;
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && p[c + 1] < p[c]) c++;
        if (p[c] >= lp) break;
        k[i] = k[c]; p[i] = p[c];
        i = c;
      }
      k[i] = lk; p[i] = lp;
    }
    return top;
  }
}
