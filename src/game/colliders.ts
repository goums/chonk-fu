// Static obstacles as 2D shapes (circles and oriented boxes) with a height range, in a coarse grid.
// Characters are vertical cylinders pushed out of these. Simple, fast and deterministic.
// Each obstacle is tagged by what it is, so queries can pick: the follow camera only steers around solid
// architecture and rocks, and lets foliage and small props be (they turn see-through instead).
export type ColliderTag = 'building' | 'rock' | 'veg' | 'prop';
export interface Circle { kind: 'circle'; tag: ColliderTag; x: number; z: number; r: number; y0: number; y1: number }
export interface Box { kind: 'box'; tag: ColliderTag; x: number; z: number; hx: number; hz: number; rot: number; y0: number; y1: number }
export type Collider = Circle | Box;

const CELL = 16;
const grid = new Map<number, Collider[]>();
const key = (i: number, j: number) => (i + 1000) * 4000 + (j + 1000);
export const allColliders: Collider[] = [];

function insert(c: Collider, r: number) {
  allColliders.push(c);
  cellsOf.set(c, []);
  for (let i = Math.floor((c.x - r) / CELL); i <= Math.floor((c.x + r) / CELL); i++)
    for (let j = Math.floor((c.z - r) / CELL); j <= Math.floor((c.z + r) / CELL); j++) {
      const k = key(i, j);
      let l = grid.get(k);
      if (!l) grid.set(k, (l = []));
      l.push(c);
      cellsOf.get(c)!.push(k);
    }
  return c;
}
const cellsOf = new Map<Collider, number[]>();
export function removeCollider(c: Collider) {
  for (const k of cellsOf.get(c) ?? []) {
    const l = grid.get(k);
    if (l) l.splice(l.indexOf(c), 1);
  }
  cellsOf.delete(c);
  allColliders.splice(allColliders.indexOf(c), 1);
}
export function addCircle(x: number, z: number, r: number, y0 = -100, y1 = 1000, tag: ColliderTag = 'prop') {
  return insert({ kind: 'circle', tag, x, z, r, y0, y1 }, r);
}
export function addBox(x: number, z: number, hx: number, hz: number, rot = 0, y0 = -100, y1 = 1000, tag: ColliderTag = 'building') {
  return insert({ kind: 'box', tag, x, z, hx, hz, rot, y0, y1 }, Math.hypot(hx, hz));
}

/** push a cylinder (x, z, radius r, feet at y, height h) out of the obstacles; returns the corrected position */
export function resolve(x: number, z: number, r: number, y: number, h: number): { x: number; z: number; hit: boolean } {
  let hit = false;
  const near = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!near) return { x, z, hit };
  for (let pass = 0; pass < 2; pass++)
    for (const c of near) {
      if (y + h < c.y0 || y > c.y1) continue;
      if (c.kind === 'circle') {
        const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
        if (d < min && d > 1e-6) {
          x = c.x + (dx / d) * min;
          z = c.z + (dz / d) * min;
          hit = true;
        }
      } else {
        // into box space
        const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
        const dx = x - c.x, dz = z - c.z;
        let lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
        const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
        let ox = lx - qx, oz = lz - qz;
        let d = Math.hypot(ox, oz);
        if (d >= r) continue;
        if (d < 1e-6) {
          // center inside the box: push out along the shallowest axis
          const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
          if (px < pz) { ox = Math.sign(lx) || 1; oz = 0; lx = Math.sign(lx) * c.hx; }
          else { oz = Math.sign(lz) || 1; ox = 0; lz = Math.sign(lz) * c.hz; }
          d = 0;
          const nlx = (ox ? lx : qx) + ox * r, nlz = (oz ? lz : qz) + oz * r;
          x = c.x + nlx * cs + nlz * sn;
          z = c.z - nlx * sn + nlz * cs;
        } else {
          const nlx = qx + (ox / d) * r, nlz = qz + (oz / d) * r;
          x = c.x + nlx * cs + nlz * sn;
          z = c.z - nlx * sn + nlz * cs;
        }
        hit = true;
      }
    }
  return { x, z, hit };
}

/** obstacles the follow camera treats as solid */
export const CAMERA_SOLID: ReadonlySet<ColliderTag> = new Set<ColliderTag>(['building', 'rock']);

/** true if the point is inside an obstacle (optionally only obstacles with one of `tags`) */
export function pointBlocked(x: number, y: number, z: number, pad = 0.3, tags?: ReadonlySet<ColliderTag>) {
  const near = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!near) return false;
  for (const c of near) {
    if (y < c.y0 || y > c.y1) continue;
    if (tags && !tags.has(c.tag)) continue;
    if (c.kind === 'circle') {
      if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
    } else {
      const cs = Math.cos(c.rot), sn = Math.sin(c.rot), dx = x - c.x, dz = z - c.z;
      if (Math.abs(dx * cs - dz * sn) < c.hx + pad && Math.abs(dx * sn + dz * cs) < c.hz + pad) return true;
    }
  }
  return false;
}
