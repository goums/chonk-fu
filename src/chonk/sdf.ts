// Sculpting characters in code: a character is a set of soft primitives (ellipsoids, tapered capsules,
// tori) smoothly blended into ONE signed distance field, meshed with Surface Nets into a seamless skin,
// then skinned to the skeleton with soft weights derived from the same field. This gives the round,
// continuous, animated-film look that glued primitives can't.
import * as THREE from 'three';

export type V3 = [number, number, number];

export interface Prim {
  kind: 'ellipsoid' | 'capsule' | 'torus';
  bone: string;
  /** ellipsoid: center; capsule: start point; torus: center */
  a: V3;
  /** capsule: end point */
  b?: V3;
  /** ellipsoid radii */
  r?: V3;
  /** capsule radius at a / at b; torus: major / minor radius */
  ra?: number;
  rb?: number;
  /** smooth-union blend radius with what came before */
  k?: number;
  /** color of this primitive's skin (a function receives the surface point, in rest pose) */
  color: number | ((p: THREE.Vector3) => number);
  /** subtract instead of add (carves) */
  carve?: boolean;
  /** 0 = cloth (no fur), 1 = fur */
  fur?: number;
}

const tmp = new THREE.Vector3();

function sdEllipsoid(px: number, py: number, pz: number, c: V3, r: V3) {
  const x = (px - c[0]) / r[0], y = (py - c[1]) / r[1], z = (pz - c[2]) / r[2];
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const x1 = x / r[0], y1 = y / r[1], z1 = z / r[2];
  const k1 = Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1);
  return k1 < 1e-9 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
}
function sdRoundCone(px: number, py: number, pz: number, a: V3, b: V3, ra: number, rb: number) {
  // capsule with linearly interpolated radius (good enough for limbs)
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h);
}
function sdTorusY(px: number, py: number, pz: number, c: V3, R: number, r: number) {
  const x = px - c[0], y = py - c[1], z = pz - c[2];
  const q = Math.sqrt(x * x + z * z) - R;
  return Math.sqrt(q * q + y * y) - r;
}
function primDist(p: Prim, x: number, y: number, z: number) {
  switch (p.kind) {
    case 'ellipsoid': return sdEllipsoid(x, y, z, p.a, p.r!);
    case 'capsule': return sdRoundCone(x, y, z, p.a, p.b!, p.ra!, p.rb ?? p.ra!);
    case 'torus': return sdTorusY(x, y, z, p.a, p.ra!, p.rb!);
  }
}
const smin = (a: number, b: number, k: number) => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

export function fieldAt(prims: Prim[], x: number, y: number, z: number) {
  let d = Infinity;
  for (const p of prims) {
    const di = primDist(p, x, y, z);
    if (p.carve) d = smax(d, -di, p.k ?? 0);
    else d = d === Infinity ? di : smin(d, di, p.k ?? 0.05);
  }
  return d;
}

/** Surface Nets: one vertex per surface-crossing cell, quads between them. Smooth, watertight-ish. */
export function meshSDF(prims: Prim[], cell = 0.02) {
  // bounds from the primitives
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of prims) {
    if (p.carve) continue;
    const pad = (p.r ? Math.max(...p.r) : (p.ra ?? 0) + (p.kind === 'torus' ? p.rb! : Math.max(p.ra ?? 0, p.rb ?? 0))) + 0.08;
    for (const pt of [p.a, p.b ?? p.a]) {
      min.min(tmp.set(pt[0] - pad, pt[1] - pad, pt[2] - pad));
      max.max(tmp.set(pt[0] + pad, pt[1] + pad, pt[2] + pad));
    }
  }
  const nx = Math.ceil((max.x - min.x) / cell) + 1, ny = Math.ceil((max.y - min.y) / cell) + 1, nz = Math.ceil((max.z - min.z) / cell) + 1;
  const F = new Float32Array(nx * ny * nz);
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) F[idx(i, j, k)] = fieldAt(prims, min.x + i * cell, min.y + j * cell, min.z + k * cell);

  const vid = new Int32Array(nx * ny * nz).fill(-1);
  const pos: number[] = [];
  const cornerOff = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const o = cornerOff[c];
          cv[c] = F[idx(i + o[0], j + o[1], k + o[2])];
          if (cv[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        // average of the edge crossings
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [e0, e1] of edges) {
          const a = cv[e0], b = cv[e1];
          if (a < 0 === b < 0) continue;
          const t = a / (a - b);
          const o0 = cornerOff[e0], o1 = cornerOff[e1];
          sx += o0[0] + (o1[0] - o0[0]) * t;
          sy += o0[1] + (o1[1] - o0[1]) * t;
          sz += o0[2] + (o1[2] - o0[2]) * t;
          n++;
        }
        vid[idx(i, j, k)] = pos.length / 3;
        pos.push(min.x + (i + sx / n) * cell, min.y + (j + sy / n) * cell, min.z + (k + sz / n) * cell);
      }
  const index: number[] = [];
  // a quad for every grid edge that crosses the surface
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const inside = F[idx(i, j, k)] < 0;
        // edge along x: (i,j,k)-(i+1,j,k), shared by cells (i, j-1..j, k-1..k)
        if (i < nx - 1 && inside !== F[idx(i + 1, j, k)] < 0) {
          const a = vid[idx(i, j - 1, k - 1)], b = vid[idx(i, j, k - 1)], c = vid[idx(i, j, k)], d = vid[idx(i, j - 1, k)];
          if (a >= 0 && b >= 0 && c >= 0 && d >= 0) inside ? index.push(a, b, c, a, c, d) : index.push(a, c, b, a, d, c);
        }
        if (j < ny - 1 && inside !== F[idx(i, j + 1, k)] < 0) {
          const a = vid[idx(i - 1, j, k - 1)], b = vid[idx(i - 1, j, k)], c = vid[idx(i, j, k)], d = vid[idx(i, j, k - 1)];
          if (a >= 0 && b >= 0 && c >= 0 && d >= 0) inside ? index.push(a, b, c, a, c, d) : index.push(a, c, b, a, d, c);
        }
        if (k < nz - 1 && inside !== F[idx(i, j, k + 1)] < 0) {
          const a = vid[idx(i - 1, j - 1, k)], b = vid[idx(i, j - 1, k)], c = vid[idx(i, j, k)], d = vid[idx(i - 1, j, k)];
          if (a >= 0 && b >= 0 && c >= 0 && d >= 0) inside ? index.push(a, b, c, a, c, d) : index.push(a, c, b, a, d, c);
        }
      }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  // smooth normals straight from the field gradient
  const nrm = new Float32Array(pos.length);
  const e = cell * 0.5;
  for (let v = 0; v < pos.length; v += 3) {
    const x = pos[v], y = pos[v + 1], z = pos[v + 2];
    tmp.set(
      fieldAt(prims, x + e, y, z) - fieldAt(prims, x - e, y, z),
      fieldAt(prims, x, y + e, z) - fieldAt(prims, x, y - e, z),
      fieldAt(prims, x, y, z + e) - fieldAt(prims, x, y, z - e),
    ).normalize();
    nrm[v] = tmp.x; nrm[v + 1] = tmp.y; nrm[v + 2] = tmp.z;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

/**
 * Colors, fur mask and skin weights for a meshed SDF. Each vertex is influenced by the primitives
 * closest to it (soft weights), grouped by bone, top 4 bones kept.
 */
export function paintAndSkin(g: THREE.BufferGeometry, prims: Prim[], boneIndex: Record<string, number>, softness = 0.035) {
  const P = g.attributes.position;
  const n = P.count;
  const col = new Float32Array(n * 3), fur = new Float32Array(n);
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const c = new THREE.Color(), acc = new THREE.Color();
  const p = new THREE.Vector3();
  const byBone = new Map<number, number>();
  for (let v = 0; v < n; v++) {
    p.fromBufferAttribute(P, v);
    let dmin = Infinity;
    const ds = prims.map((pr) => {
      const d = pr.carve ? Infinity : primDist(pr, p.x, p.y, p.z);
      if (d < dmin) dmin = d;
      return d;
    });
    acc.setRGB(0, 0, 0);
    let wsum = 0, fsum = 0;
    byBone.clear();
    prims.forEach((pr, i) => {
      if (pr.carve) return;
      const w = Math.exp(-(ds[i] - dmin) / softness);
      if (w < 1e-3) return;
      // colour blends a little tighter than the skinning
      const wc = Math.exp(-(ds[i] - dmin) / (softness * 0.35));
      c.set(typeof pr.color === 'function' ? pr.color(p) : pr.color);
      acc.r += c.r * wc; acc.g += c.g * wc; acc.b += c.b * wc;
      fsum += (pr.fur ?? 1) * wc;
      wsum += wc;
      const b = boneIndex[pr.bone];
      byBone.set(b, (byBone.get(b) ?? 0) + w);
    });
    col[v * 3] = acc.r / wsum; col[v * 3 + 1] = acc.g / wsum; col[v * 3 + 2] = acc.b / wsum;
    fur[v] = fsum / wsum;
    const top = [...byBone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = top.reduce((s, t) => s + t[1], 0);
    top.forEach(([b, w], k) => {
      si[v * 4 + k] = b;
      sw[v * 4 + k] = w / tot;
    });
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('fur', new THREE.BufferAttribute(fur, 1));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
}
