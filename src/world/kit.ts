// Geometry kit for the Valley's architecture: a builder that bakes colored parts into one vertex-colored
// geometry (one draw call per batch), and the signature curved Chinese roof.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonGradient } from '../chonk/toon';

export class Batch {
  private parts: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();

  /** add a geometry with a flat color, transformed by position / rotation (Y, then X, Z) / scale */
  add(
    geo: THREE.BufferGeometry,
    color: THREE.ColorRepresentation | null,
    x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0,
  ) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    if (color !== null) {
      const c = new THREE.Color(color);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    this.e.set(rx, ry, rz, 'YXZ');
    this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e), this.s.set(sx, sy, sz));
    g.applyMatrix4(this.m);
    this.parts.push(g);
    return this;
  }

  /** add another batch's merged geometry, transformed */
  addGeometry(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, ry = 0, s = 1) {
    return this.add(g, null, x, y, z, ry, s, s, s);
  }

  geometry() {
    const g = mergeGeometries(this.parts, false)!;
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    return g;
  }

  mesh(material: THREE.Material = kitMaterial()) {
    const m = new THREE.Mesh(this.geometry(), material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

let shared: THREE.MeshToonMaterial | null = null;
export const kitMaterial = () => (shared ??= new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() }));

/**
 * Curved hip roof with upturned corners. Footprint w x d (ridge along x), rise h, eaves curl `curl`.
 * Tiles are drawn as alternating color strips running down the slopes.
 */
export function roofGeometry(w: number, d: number, h: number, curl: number, tileA: number, tileB: number, under: number, thick = 0.25) {
  const W = w / 2, D = d / 2;
  const nu = Math.max(8, Math.round(w * 2.4)), nv = Math.max(6, Math.round(d * 2.4));
  const height = (X: number, Z: number) => {
    const s = Math.min(D - Math.abs(Z), W - Math.abs(X)) / D; // 0 at the eaves, 1 at the ridge
    const lift = curl * Math.min(Math.abs(X) / W, Math.abs(Z) / D) ** 3 * (1 - s) ** 2;
    return h * Math.max(0, s) ** 1.55 + lift;
  };
  const pos: number[] = [], col: number[] = [];
  const cA = new THREE.Color(tileA), cB = new THREE.Color(tileB), cU = new THREE.Color(under);
  const push = (c: THREE.Color, ...pts: number[][]) => {
    for (const p of pts) { pos.push(p[0], p[1], p[2]); col.push(c.r, c.g, c.b); }
  };
  const P = (i: number, j: number, dy = 0) => {
    const X = -W + (2 * W * i) / nu, Z = -D + (2 * D * j) / nv;
    return [X, height(X, Z) + dy, Z];
  };
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const a = P(i, j), b = P(i, j + 1), c = P(i + 1, j + 1), e = P(i + 1, j);
      // which slope is this quad on? front/back slopes stripe along x, hip ends along z
      const cx = (a[0] + c[0]) / 2, cz = (a[2] + c[2]) / 2;
      const frontBack = D - Math.abs(cz) < W - Math.abs(cx);
      const odd = frontBack ? i % 2 : j % 2;
      const tile = odd ? cB : cA;
      push(tile, a, b, c, a, c, e);
      // underside
      const a2 = P(i, j, -thick), b2 = P(i, j + 1, -thick), c2 = P(i + 1, j + 1, -thick), e2 = P(i + 1, j, -thick);
      push(cU, a2, c2, b2, a2, e2, c2);
    }
  // fascia around the eaves
  const edge = (i0: number, j0: number, i1: number, j1: number) => {
    const t0 = P(i0, j0), t1 = P(i1, j1), b0 = P(i0, j0, -thick), b1 = P(i1, j1, -thick);
    push(cB, t0, b0, b1, t0, b1, t1);
    push(cB, t0, b1, b0, t0, t1, b1);
  };
  for (let i = 0; i < nu; i++) { edge(i, 0, i + 1, 0); edge(i, nv, i + 1, nv); }
  for (let j = 0; j < nv; j++) { edge(0, j, 0, j + 1); edge(nu, j, nu, j + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** a ridge beam with curled finials, to sit on a roof of footprint w x d and rise h */
export function addRidge(b: Batch, w: number, d: number, h: number, y: number, color: number, finial: number, x = 0, z = 0, ry = 0) {
  const len = Math.max(0.4, w - d);
  const cs = Math.cos(ry), sn = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
  const [rx, rz] = at(0, 0);
  b.add(new THREE.BoxGeometry(len + 0.4, 0.35, 0.35), color, rx, y + h + 0.1, rz, ry);
  for (const s of [-1, 1]) {
    const [fx, fz] = at(s * (len / 2 + 0.2), 0);
    b.add(new THREE.ConeGeometry(0.22, 0.9, 6), finial, fx, y + h + 0.55, fz, ry, 1, 1, 1, 0, -s * 0.5);
    b.add(new THREE.SphereGeometry(0.2, 8, 6), finial, fx + s * 0.25 * cs, y + h + 0.95, fz - s * 0.25 * sn, ry);
  }
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (r0: number, r1: number, h: number, seg = 10) => new THREE.CylinderGeometry(r0, r1, h, seg);
