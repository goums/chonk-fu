// Animated faces for the pipeline characters. Their eyes and mouths are painted into the generated
// colour texture, so the faces never moved. Here every eye and the mouth get a live "decal": a small
// skinned overlay made of the head's own triangles (same vertices, same skin weights, so it can never
// float or slide), textured by a canvas we redraw when the expression changes.
//
// Eyes: the painted eye (and painted brows) are erased in the overlay: the texture under the overlay is
// baked into the canvas by front projection (the generators project their texture from a front view,
// so features are undistorted that way), the painted feature is inpainted from the fur around it, and
// the edge of the patch is feathered (outside the inpainted area the canvas IS the original texture, so
// the seam is invisible). Our eye is then drawn over it: sclera, iris, pupil, highlights, lash line, and
// lids made of the inpainted fur, so blinks and squints close real-looking skin over the eye.
// Mouth: the painted upper lip stays; when the character speaks, shouts or roars an opening is drawn
// below it (jaw drop) with tongue, teeth or fangs. Closed = the original painting, untouched.
//
// Behaviour (update(dt, AnimInput)): saccadic gaze toward AnimInput.lookAt (what the head turn leaves
// over), else toward the turn, a nearby character, or small idle glances; blinks every 2-6 s (some
// double); expressions blended from the input: happy (talk / gestures / cheer: ^^ eyes), angry (fight,
// attacks), hurt (squeezed shut), surprised (just after a hit, jumps), sleepy (Master Tortue), KO.
// Cost: one 2D canvas per eye / mouth per character, redrawn only when the drawn state changes (at most
// 30 Hz), skipped beyond 25 m from the camera.
import * as THREE from 'three';
import type { AnimInput } from './animator';
import { excludeFromAO } from '../game/highlight';
import { clamp, damp, lerp, rng } from '../core/math';

type P2 = [number, number];

// ---------------------------------------------------------------------------------------------- calibration
// Measured on an orthographic front render of each GLB in its bind pose (Blender, 1024 x 1024 px, flat
// texture colour): `frame` = [view width (m), view centre height (m)], features in that render's pixels
// (x right = the character's left, +x; y down). The texture colours were sampled there too.
interface EyeSpec { c: P2; r: P2; tilt?: number }
/** a painted brow to repaint: centreline from the outer to the inner end, arch (px, + = up), thickness */
interface BrowSpec { outer: P2; inner: P2; arch: number; w: P2 }
/** the painted upper lip: corners and middle (a cusp for a cat's "w", else the bottom of a smile curve) */
interface MouthSpec { l: P2; m: P2; r: P2; cusp?: boolean; depth: number; inside: string; tongue: string; lip: string; fangs?: boolean }
interface EyeStyle {
  dot?: boolean; // a glossy black bead (no sclera / iris)
  sclera: string; iris: string; rim: string; pupil: string; line: string;
  irisR: number; // iris radius / eye half-height
  pupilR: number; // pupil radius / iris radius
  lineW: number; // lash line width / eye half-height
}
interface FaceSpec {
  frame: P2;
  eyes: [EyeSpec, EyeSpec]; // [right eye (-x), left eye (+x)]
  style: EyeStyle;
  brows?: [BrowSpec, BrowSpec];
  brow?: string;
  mouth?: MouthSpec;
  /** resting lid opening (Master Tortue dozes) */
  sleepy?: number;
}

export const FACES: Record<string, FaceSpec> = {
  chonk: {
    frame: [0.726, 1.487],
    eyes: [{ c: [318, 477], r: [81, 62] }, { c: [692, 478], r: [79, 62] }],
    style: { sclera: '#f3eadc', iris: '#2a160b', rim: '#7a4519', pupil: '#070404', line: '#4a200c', irisR: 0.86, pupilR: 0.6, lineW: 0.075 },
    mouth: { l: [366, 731], m: [512, 688], r: [656, 731], cusp: true, depth: 62, inside: '#4a1716', tongue: '#d9727c', lip: '#9a6a5c' },
  },
  tiger: {
    frame: [0.633, 2.0335],
    eyes: [{ c: [398, 398], r: [52, 42], tilt: 0.18 }, { c: [728, 400], r: [50, 41], tilt: -0.18 }],
    style: { sclera: '#f4ead0', iris: '#e3a62a', rim: '#94580c', pupil: '#0a0605', line: '#140b07', irisR: 0.92, pupilR: 0.42, lineW: 0.13 },
    mouth: { l: [476, 682], m: [562, 648], r: [650, 682], cusp: true, depth: 130, inside: '#47100f', tongue: '#c9586a', lip: '#5a4a44', fangs: true },
  },
  wolf: {
    frame: [0.657, 1.6715],
    eyes: [{ c: [406, 453], r: [45, 27] }, { c: [610, 453], r: [47, 27] }],
    style: { sclera: '#eeeadf', iris: '#a27a2e', rim: '#4a3410', pupil: '#070404', line: '#1f1a16', irisR: 0.8, pupilR: 0.55, lineW: 0.12 },
    mouth: { l: [450, 681], m: [514, 699], r: [578, 681], depth: 42, inside: '#3a1214', tongue: '#c25a66', lip: '#4a3c38', fangs: true },
  },
  tortoise: {
    frame: [0.9375, 1.33125],
    eyes: [{ c: [478, 266], r: [52, 28], tilt: -0.12 }, { c: [695, 266], r: [55, 28], tilt: 0.12 }],
    style: { sclera: '#e9e1c6', iris: '#4a3a1c', rim: '#2a2010', pupil: '#0a0806', line: '#3a3a18', irisR: 0.82, pupilR: 0.5, lineW: 0.12 },
    mouth: { l: [536, 403], m: [597, 407], r: [660, 403], depth: 30, inside: '#4a1a12', tongue: '#c86a5a', lip: '#9a5a3a' },
    sleepy: 0.32,
  },
  duck: {
    frame: [0.87, 1.215],
    eyes: [{ c: [441, 557], r: [20, 24] }, { c: [581, 559], r: [21, 24] }],
    style: { dot: true, sclera: '#ffffff', iris: '#070405', rim: '#070405', pupil: '#070405', line: '#221a18', irisR: 1, pupilR: 1, lineW: 0.16 },
    mouth: { l: [420, 643], m: [512, 693], r: [605, 641], depth: 30, inside: '#5a1a08', tongue: '#e0805a', lip: '#a84a08' },
  },
  pig: {
    frame: [0.701, 1.1495],
    eyes: [{ c: [338, 399], r: [45, 40] }, { c: [683, 399], r: [45, 40] }],
    style: { sclera: '#f1e9e7', iris: '#1d0d0b', rim: '#3e1c17', pupil: '#050202', line: '#55262a', irisR: 0.78, pupilR: 0.62, lineW: 0.09 },
    brows: [
      { outer: [292, 292], inner: [412, 238], arch: 12, w: [11, 26] },
      { outer: [736, 292], inner: [616, 238], arch: 12, w: [11, 26] },
    ],
    brow: '#43210d',
    mouth: { l: [332, 643], m: [515, 697], r: [700, 641], depth: 70, inside: '#5c100d', tongue: '#e0707a', lip: '#b05a60' },
  },
  bunny: {
    frame: [0.825, 1.1375],
    eyes: [{ c: [360, 771], r: [65, 59] }, { c: [663, 771], r: [63, 59] }],
    style: { sclera: '#f1ebe4', iris: '#7b3d18', rim: '#38190a', pupil: '#0b0505', line: '#3a2010', irisR: 0.7, pupilR: 0.6, lineW: 0.075 },
    brows: [
      { outer: [306, 679], inner: [447, 626], arch: 20, w: [9, 19] },
      { outer: [718, 679], inner: [578, 626], arch: 20, w: [9, 19] },
    ],
    brow: '#563114',
    mouth: { l: [452, 940], m: [512, 925], r: [574, 940], cusp: true, depth: 46, inside: '#5a190d', tongue: '#d8707a', lip: '#a87a6a' },
  },
};

// ---------------------------------------------------------------------------------------------- per model
interface Region {
  geo: THREE.BufferGeometry;
  W: number; H: number;
  /** canvas px per metre, and the model-space box (left / top edges) */
  ppm: number; x0: number; y1: number;
  /** eyes: the fur under the overlay with the painted feature inpainted, feathered alpha */
  bg?: HTMLCanvasElement;
}
interface ModelFace {
  spec: FaceSpec;
  eyes: [Region, Region];
  mouth: Region | null;
  /** bind-pose midpoint between the eyes (model space) */
  eyeMid: THREE.Vector3;
}
const models = new Map<string, ModelFace | null>();

const toModel = (s: FaceSpec, p: P2) => new THREE.Vector2((p[0] / 1024 - 0.5) * s.frame[0], s.frame[1] + (0.5 - p[1] / 1024) * s.frame[0]);
const pxToM = (s: FaceSpec, px: number) => (px / 1024) * s.frame[0];

/** bind-pose world positions and the triangle list of a skinned mesh */
function meshData(mesh: THREE.SkinnedMesh) {
  const g = mesh.geometry, pos = g.attributes.position;
  const P = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
  }
  const index = g.index ? (g.index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i);
  return { P, index, triCount: Math.floor(index.length / 3) };
}
type MeshData = ReturnType<typeof meshData>;

/** front-most surface depth (z) at (x, y), looking down -z (over the listed triangles) */
function frontZ(D: MeshData, x: number, y: number, list: number[]) {
  const { P, index } = D;
  let best = -Infinity;
  for (const t of list) {
    const a = index[t * 3] * 3, b = index[t * 3 + 1] * 3, c = index[t * 3 + 2] * 3;
    const ax = P[a], ay = P[a + 1], bx = P[b], by = P[b + 1], cx = P[c], cy = P[c + 1];
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue;
    const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
    const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const z = l1 * P[a + 2] + l2 * P[b + 2] + l3 * P[c + 2];
    if (z > best) best = z;
  }
  return best;
}

/**
 * The overlay for one feature: the mesh triangles whose centroid lies in the box (model x / y) near the
 * surface depth there and facing forward, as a compact geometry (all source attributes, skin included)
 * plus `uv1` = the front projection into the canvas.
 */
function buildRegion(mesh: THREE.SkinnedMesh, D: MeshData, box: { x0: number; x1: number; y0: number; y1: number }, centre: THREE.Vector2, maxPx: P2, pxPerHalf: number, half: number) {
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const ppm = Math.min(pxPerHalf / half, maxPx[0] / bw, maxPx[1] / bh);
  const W = Math.max(8, Math.round(bw * ppm)), H = Math.max(8, Math.round(bh * ppm));
  const span = Math.max(bw, bh);
  const mx = bw * 0.06, my = bh * 0.06;
  const { P, index } = D;
  // forward-facing triangles over the box...
  const cand: number[] = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < D.triCount; t++) {
    const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
    const gx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, gy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3;
    if (gx < box.x0 - mx || gx > box.x1 + mx || gy < box.y0 - my || gy > box.y1 + my) continue;
    e1.set(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
    e2.set(P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]);
    n.crossVectors(e1, e2);
    if (n.z > 0) cand.push(t);
  }
  const zc = frontZ(D, centre.x, centre.y, cand);
  if (!Number.isFinite(zc)) return null;
  // ...that are visible from the front (what the front-projected texture paints), with some slack for
  // surfaces just behind a fold
  const tol = 0.2 * span + 0.008;
  const tris: number[] = [];
  for (const t of cand) {
    const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
    const gx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, gy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, gz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
    if (gz < frontZ(D, gx, gy, cand) - tol) continue;
    tris.push(a, b, c);
  }
  if (!tris.length) return null;
  // compact copy
  const src = mesh.geometry;
  const remap = new Map<number, number>();
  for (const i of tris) if (!remap.has(i)) remap.set(i, remap.size);
  const nv = remap.size;
  const geo = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    // (glTF attributes may be interleaved: copy component by component)
    const A = src.attributes[name] as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    const Ctor = (A.array as Float32Array).constructor as new (n: number) => Float32Array;
    const out = new THREE.BufferAttribute(new Ctor(nv * A.itemSize), A.itemSize, A.normalized);
    for (const [from, to] of remap) for (let k = 0; k < A.itemSize; k++) out.setComponent(to, k, A.getComponent(from, k));
    geo.setAttribute(name, out);
  }
  const uv1 = new Float32Array(nv * 2);
  for (const [from, to] of remap) {
    uv1[to * 2] = (P[from * 3] - box.x0) / bw;
    uv1[to * 2 + 1] = (P[from * 3 + 1] - box.y0) / bh; // CanvasTexture.flipY: v = 1 is the canvas top
  }
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  geo.setIndex(tris.map((i) => remap.get(i)!));
  const region: Region = { geo, W, H, ppm, x0: box.x0, y1: box.y1 };
  return { region, tris, zc };
}

/** affine transform taking three source points onto three destination points */
function affine(s: number[], d: number[]): [number, number, number, number, number, number] | null {
  const sx1 = s[2] - s[0], sy1 = s[3] - s[1], sx2 = s[4] - s[0], sy2 = s[5] - s[1];
  const det = sx1 * sy2 - sx2 * sy1;
  if (Math.abs(det) < 1e-9) return null;
  const dx1 = d[2] - d[0], dy1 = d[3] - d[1], dx2 = d[4] - d[0], dy2 = d[5] - d[1];
  const a = (dx1 * sy2 - dx2 * sy1) / det, c = (dx2 * sx1 - dx1 * sx2) / det;
  const b = (dy1 * sy2 - dy2 * sy1) / det, dd = (dy2 * sx1 - dy1 * sx2) / det;
  return [a, b, c, dd, d[0] - a * s[0] - c * s[1], d[1] - b * s[0] - dd * s[1]];
}

const canvas = (W: number, H: number) => {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  return c;
};

/** the texture under the overlay, front-projected into canvas space (front-most triangles win) */
function bakeTexture(R: Region, D: MeshData, tris: number[], uv: THREE.BufferAttribute, map: THREE.Texture) {
  const img = map.image as CanvasImageSource & { width: number; height: number };
  const cv = canvas(R.W, R.H);
  const g = cv.getContext('2d')!;
  const { P } = D;
  const order: number[] = [];
  for (let t = 0; t < tris.length; t += 3) order.push(t);
  const zOf = (t: number) => P[tris[t] * 3 + 2] + P[tris[t + 1] * 3 + 2] + P[tris[t + 2] * 3 + 2];
  order.sort((a, b) => zOf(a) - zOf(b));
  for (const t of order) {
    const d: number[] = [], s: number[] = [];
    for (let k = 0; k < 3; k++) {
      const i = tris[t + k];
      d.push((P[i * 3] - R.x0) * R.ppm, (R.y1 - P[i * 3 + 1]) * R.ppm);
      const v = uv.getY(i);
      s.push(uv.getX(i) * img.width, (map.flipY ? 1 - v : v) * img.height);
    }
    const M = affine(s, d);
    if (!M) continue;
    // grow the clip triangle a little so neighbours overlap (no hairline cracks)
    const gx = (d[0] + d[2] + d[4]) / 3, gy = (d[1] + d[3] + d[5]) / 3;
    g.save();
    g.beginPath();
    for (let k = 0; k < 3; k++) {
      const dx = d[k * 2] - gx, dy = d[k * 2 + 1] - gy, l = Math.hypot(dx, dy) || 1;
      const x = d[k * 2] + (dx / l) * 0.8, y = d[k * 2 + 1] + (dy / l) * 0.8;
      if (k) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
    g.clip();
    g.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
    // only the triangle's texel rectangle (+1 px for filtering)
    const sx = Math.max(0, Math.floor(Math.min(s[0], s[2], s[4])) - 1), sy = Math.max(0, Math.floor(Math.min(s[1], s[3], s[5])) - 1);
    const sw = Math.min(img.width, Math.ceil(Math.max(s[0], s[2], s[4])) + 2) - sx, sh = Math.min(img.height, Math.ceil(Math.max(s[1], s[3], s[5])) + 2) - sy;
    if (sw > 0 && sh > 0) g.drawImage(img, sx, sy, sw, sh, sx, sy, sw, sh);
    g.restore();
  }
  return g.getImageData(0, 0, R.W, R.H);
}

/**
 * Fill the hole pixels from the known ones around them (push-pull pyramid, then a few relaxation
 * passes for a smooth fur gradient), and feather the overlay's alpha outward from the hole.
 */
function inpaint(img: ImageData, hole: Uint8Array) {
  const W = img.width, H = img.height, src = img.data;
  type Level = { w: number; h: number; c: Float32Array; a: Float32Array };
  const L0: Level = { w: W, h: H, c: new Float32Array(W * H * 3), a: new Float32Array(W * H) };
  for (let i = 0; i < W * H; i++) {
    if (hole[i] || src[i * 4 + 3] < 250) continue;
    L0.a[i] = 1;
    for (let k = 0; k < 3; k++) L0.c[i * 3 + k] = src[i * 4 + k];
  }
  const levels = [L0];
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const f = levels[levels.length - 1];
    const w = Math.ceil(f.w / 2), h = Math.ceil(f.h / 2);
    const L: Level = { w, h, c: new Float32Array(w * h * 3), a: new Float32Array(w * h) };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sa = 0, r = 0, gg = 0, b = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const X = Math.min(f.w - 1, x * 2 + dx), Y = Math.min(f.h - 1, y * 2 + dy), j = Y * f.w + X;
        const wa = f.a[j];
        sa += wa; r += f.c[j * 3] * wa; gg += f.c[j * 3 + 1] * wa; b += f.c[j * 3 + 2] * wa;
      }
      const i = y * w + x;
      if (sa > 0) {
        L.c[i * 3] = r / sa; L.c[i * 3 + 1] = gg / sa; L.c[i * 3 + 2] = b / sa;
        L.a[i] = Math.min(1, sa);
      }
    }
    levels.push(L);
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const f = levels[l], c = levels[l + 1];
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const i = y * f.w + x;
      if (f.a[i] >= 1) continue;
      // bilinear sample of the coarser level
      const fx = clamp((x + 0.5) / 2 - 0.5, 0, c.w - 1), fy = clamp((y + 0.5) / 2 - 0.5, 0, c.h - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(c.w - 1, x0 + 1), y1 = Math.min(c.h - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      for (let k = 0; k < 3; k++) {
        const v = lerp(lerp(c.c[(y0 * c.w + x0) * 3 + k], c.c[(y0 * c.w + x1) * 3 + k], tx), lerp(c.c[(y1 * c.w + x0) * 3 + k], c.c[(y1 * c.w + x1) * 3 + k], tx), ty);
        f.c[i * 3 + k] = f.c[i * 3 + k] * f.a[i] + v * (1 - f.a[i]);
      }
      f.a[i] = 1;
    }
  }
  const C = L0.c;
  const holes: number[] = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (hole[y * W + x]) holes.push(y * W + x);
  for (let it = 0; it < 40; it++) {
    for (const i of holes) {
      for (let k = 0; k < 3; k++) C[i * 3 + k] = (C[(i - 1) * 3 + k] + C[(i + 1) * 3 + k] + C[(i - W) * 3 + k] + C[(i + W) * 3 + k]) * 0.25;
    }
  }
  // chamfer distance (px) to the hole -> feathered alpha
  const dist = new Float32Array(W * H).fill(1e9);
  for (let i = 0; i < W * H; i++) if (hole[i]) dist[i] = 0;
  const relax = (i: number, j: number, d: number) => { if (dist[j] + d < dist[i]) dist[i] = dist[j] + d; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (x > 0) relax(i, i - 1, 1);
    if (y > 0) { relax(i, i - W, 1); if (x > 0) relax(i, i - W - 1, 1.414); if (x < W - 1) relax(i, i - W + 1, 1.414); }
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    if (x < W - 1) relax(i, i + 1, 1);
    if (y < H - 1) { relax(i, i + W, 1); if (x < W - 1) relax(i, i + W + 1, 1.414); if (x > 0) relax(i, i + W - 1, 1.414); }
  }
  const out = new ImageData(W, H);
  const grow = Math.max(2, W * 0.025), feather = Math.max(4, W * 0.06);
  for (let i = 0; i < W * H; i++) {
    const a = clamp(1 - (dist[i] - grow) / feather, 0, 1) * (src[i * 4 + 3] / 255);
    for (let k = 0; k < 3; k++) out.data[i * 4 + k] = hole[i] ? C[i * 3 + k] : src[i * 4 + k];
    out.data[i * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

/** model-space eye geometry inside an eye region, in canvas px */
interface EyeGeom { cx: number; cy: number; rx: number; ry: number; tilt: number; inner: number; brow?: BrowSpec & { px: (p: P2) => P2 } }

function setupModel(name: string, mesh: THREE.SkinnedMesh): ModelFace | null {
  const spec = FACES[name];
  const map = (mesh.material as THREE.MeshStandardMaterial).map;
  const uv = mesh.geometry.attributes.uv as THREE.BufferAttribute | undefined;
  if (!spec || !map?.image || !uv) return null;
  const D = meshData(mesh);
  const eyes: Region[] = [];
  const mid = new THREE.Vector3();
  for (let s = 0; s < 2; s++) {
    const e = spec.eyes[s];
    const c = toModel(spec, e.c), rx = pxToM(spec, e.r[0]), ry = pxToM(spec, e.r[1]);
    const box = { x0: c.x - rx * 1.75, x1: c.x + rx * 1.75, y0: c.y - ry * 1.9, y1: c.y + ry * 1.9 };
    const b = spec.brows?.[s];
    if (b) {
      for (const p of [b.outer, b.inner]) {
        const q = toModel(spec, p), m = pxToM(spec, Math.max(...b.w) + b.arch) + ry * 0.45;
        box.x0 = Math.min(box.x0, q.x - m); box.x1 = Math.max(box.x1, q.x + m); box.y1 = Math.max(box.y1, q.y + m);
      }
    }
    const built = buildRegion(mesh, D, box, c, [256, 256], 50, ry);
    if (!built) return null;
    const R = built.region;
    mid.add(new THREE.Vector3(c.x, c.y, built.zc).multiplyScalar(0.5));
    // hole: the painted eye (+ its outline) and the painted brow
    const mask = canvas(R.W, R.H), g = mask.getContext('2d', { willReadFrequently: true })!;
    const geom = eyeGeom(spec, s, R);
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(geom.cx, geom.cy, geom.rx * 1.14 + 1.5, geom.ry * 1.16 + 1.5, geom.tilt, 0, Math.PI * 2);
    g.fill();
    if (geom.brow) {
      g.strokeStyle = '#fff';
      g.lineCap = 'round';
      g.lineWidth = Math.max(...geom.brow.w) * 1.5 + (12 * R.ppm * spec.frame[0]) / 1024;
      g.beginPath();
      browPath(g, geom.brow.px(geom.brow.outer), geom.brow.px(geom.brow.inner), geom.brow.arch);
      g.stroke();
    }
    const md = g.getImageData(0, 0, R.W, R.H).data;
    const hole = new Uint8Array(R.W * R.H);
    for (let i = 0; i < hole.length; i++) hole[i] = md[i * 4 + 3] > 40 ? 1 : 0;
    const baked = bakeTexture(R, D, built.tris, uv, map);
    const bg = canvas(R.W, R.H);
    bg.getContext('2d')!.putImageData(inpaint(baked, hole), 0, 0);
    R.bg = bg;
    eyes.push(R);
  }
  let mouth: Region | null = null;
  if (spec.mouth) {
    const M = spec.mouth;
    const l = toModel(spec, M.l), r = toModel(spec, M.r), m = toModel(spec, M.m), depth = pxToM(spec, M.depth);
    const span = r.x - l.x;
    const box = { x0: l.x - span * 0.12, x1: r.x + span * 0.12, y0: Math.min(l.y, r.y, m.y) - depth * 1.25, y1: Math.max(l.y, r.y, m.y) + depth * 0.15 };
    const built = buildRegion(mesh, D, box, new THREE.Vector2(m.x, m.y - depth * 0.3), [256, 192], 120, span / 2);
    mouth = built?.region ?? null;
  }
  return { spec, eyes: eyes as [Region, Region], mouth, eyeMid: mid };
}

function eyeGeom(spec: FaceSpec, s: number, R: Region): EyeGeom {
  const e = spec.eyes[s];
  const k = (R.ppm * spec.frame[0]) / 1024; // calibration px -> canvas px
  const px = (p: P2): P2 => {
    const q = toModel(spec, p);
    return [(q.x - R.x0) * R.ppm, (R.y1 - q.y) * R.ppm];
  };
  const [cx, cy] = px(e.c);
  const b = spec.brows?.[s];
  return {
    cx, cy, rx: e.r[0] * k, ry: e.r[1] * k, tilt: e.tilt ?? 0,
    // the inner corner (toward the nose) in canvas x: the right eye (-x) has it on its +x side
    inner: s === 0 ? 1 : -1,
    brow: b ? { ...b, w: [b.w[0] * k, b.w[1] * k], arch: b.arch * k, px } : undefined,
  };
}

/** a brow centreline from the outer to the inner end, bulging up by `arch` px */
function browPath(g: CanvasRenderingContext2D, o: P2, i: P2, arch: number) {
  const mx = (o[0] + i[0]) / 2, my = (o[1] + i[1]) / 2;
  const dx = i[0] - o[0], dy = i[1] - o[1], l = Math.hypot(dx, dy) || 1;
  // normal pointing up (canvas -y)
  let nx = -dy / l, ny = dx / l;
  if (ny > 0) { nx = -nx; ny = -ny; }
  g.moveTo(o[0], o[1]);
  g.quadraticCurveTo(mx + nx * arch * 2, my + ny * arch * 2, i[0], i[1]);
}

// ---------------------------------------------------------------------------------------------- drawing
interface EyeState {
  open: number; // upper lid opening (1 = round open)
  lower: number; // lower lid raise toward the closing line (blink)
  happy: number; // lower lid arcs up (smiling eyes; with the upper lid down: ^^)
  angry: number; // upper lid slants down toward the nose
  sad: number; // ...or toward the outer corner
  wide: number; // surprised: bigger eye, smaller pupil
  squeeze: number; // hurt: tense closed line
  gx: number; gy: number; // gaze, -1..1 (x = toward +x / the character's left, y = down)
  pupil: number; // dilation
  browUp: number; browIn: number; // brow raise, inner-end raise (+) / frown (-) in eye half-heights
}

const N = 24;
const _top = new Float32Array(N + 1), _bot = new Float32Array(N + 1);

function drawEye(g: CanvasRenderingContext2D, R: Region, E: EyeGeom, st: EyeState, style: EyeStyle, browColor?: string) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, R.W, R.H);
  g.drawImage(R.bg!, 0, 0);
  const rx = E.rx * (1 + 0.07 * st.wide), ry = E.ry * (1 + 0.12 * st.wide);
  // lid curves over u in [-1, 1] across the eye
  let anyOpen = false;
  for (let i = 0; i <= N; i++) {
    const u = (i / N) * 2 - 1, e = Math.sqrt(Math.max(0, 1 - u * u));
    const top = -ry * e, bot = ry * e;
    const meet = lerp(ry * (0.22 * e - 0.05), -ry * 0.7 * e, st.happy) - ry * 0.12 * st.squeeze * e;
    const inner = clamp((u * E.inner + 0.35) / 1.35, 0, 1), outer = clamp((-u * E.inner + 0.35) / 1.35, 0, 1);
    let yU = lerp(top, meet, 1 - st.open) + ry * (0.8 * st.angry * inner * inner + 0.4 * st.sad * outer * outer);
    const yL = lerp(bot, meet, Math.max(st.lower, st.happy));
    yU = Math.max(yU, top);
    const b = Math.min(bot, yL);
    _top[i] = Math.min(yU, b);
    _bot[i] = b;
    if (b - yU > 0.6) anyOpen = true;
  }
  g.save();
  g.translate(E.cx, E.cy);
  g.rotate(E.tilt);
  const X = (i: number) => ((i / N) * 2 - 1) * rx;
  const lw = Math.max(1, style.lineW * ry);
  if (anyOpen) {
    g.save();
    g.beginPath();
    g.moveTo(X(0), _top[0]);
    for (let i = 1; i <= N; i++) g.lineTo(X(i), _top[i]);
    for (let i = N; i >= 0; i--) g.lineTo(X(i), _bot[i]);
    g.closePath();
    g.clip();
    const gl = Math.hypot(st.gx, st.gy) > 1 ? 1 / Math.hypot(st.gx, st.gy) : 1;
    const gx = st.gx * gl, gy = st.gy * gl;
    if (style.dot) {
      // a glossy bead that rolls a little with the gaze
      const ox = gx * rx * 0.14, oy = gy * ry * 0.12;
      g.fillStyle = style.pupil;
      g.beginPath();
      g.ellipse(ox, oy, rx * 1.02, ry * 1.02, 0, 0, Math.PI * 2);
      g.fill();
      highlights(g, ox - rx * 0.05, oy - ry * 0.05, Math.min(rx, ry));
    } else {
      // sclera, shaded toward the rim
      const sg = g.createRadialGradient(0, ry * 0.15, 0, 0, 0, Math.max(rx, ry) * 1.05);
      sg.addColorStop(0, style.sclera);
      sg.addColorStop(0.75, style.sclera);
      sg.addColorStop(1, shade(style.sclera, 0.78));
      g.fillStyle = sg;
      g.fillRect(-rx - 2, -ry - 2, rx * 2 + 4, ry * 2 + 4);
      const ir = style.irisR * ry * (1 - 0.1 * st.wide);
      const ix = gx * Math.max(ry * 0.15, rx - ir * 0.92), iy = gy * Math.max(ry * 0.2, ry - ir * 0.9);
      const ig = g.createRadialGradient(ix, iy, 0, ix, iy, ir);
      ig.addColorStop(0, shade(style.iris, 0.75));
      ig.addColorStop(0.45, style.iris);
      ig.addColorStop(0.85, mix(style.iris, style.rim, 0.5));
      ig.addColorStop(1, style.rim);
      g.fillStyle = ig;
      g.beginPath();
      g.arc(ix, iy, ir, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = style.pupil;
      g.beginPath();
      g.arc(ix, iy, ir * style.pupilR * st.pupil * (1 - 0.3 * st.wide), 0, Math.PI * 2);
      g.fill();
      highlights(g, lerp(0, ix, 0.75), lerp(0, iy, 0.75), ir);
    }
    // the upper lid's soft shadow on the eyeball
    g.strokeStyle = 'rgba(40,20,10,0.28)';
    g.lineWidth = ry * 0.32;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(X(0), _top[0]);
    for (let i = 1; i <= N; i++) g.lineTo(X(i), _top[i]);
    g.stroke();
    g.restore();
  }
  // the lowered upper lid: fur shading toward its edge, and a soft crease when it is shut
  let lid = 0;
  for (let i = 0; i <= N; i++) lid = Math.max(lid, _top[i] + ry * Math.sqrt(Math.max(0, 1 - (X(i) / rx) ** 2)));
  if (lid > ry * 0.08) {
    const k = clamp(lid / (ry * 1.2), 0, 1);
    const lg = g.createLinearGradient(0, -ry, 0, -ry + lid);
    lg.addColorStop(0, 'rgba(80,40,15,0)');
    lg.addColorStop(1, `rgba(80,40,15,${0.2 * k})`);
    g.fillStyle = lg;
    g.beginPath();
    for (let i = 0; i <= N; i++) g.lineTo(X(i), -ry * Math.sqrt(Math.max(0, 1 - (X(i) / rx) ** 2)));
    for (let i = N; i >= 0; i--) g.lineTo(X(i), _top[i]);
    g.closePath();
    g.fill();
    if (!anyOpen) {
      g.strokeStyle = style.line;
      g.globalAlpha = 0.16 * k;
      g.lineWidth = lw * 0.8;
      g.beginPath();
      for (let i = 4; i <= N - 4; i++) g.lineTo(X(i) * 0.85, _top[i] - ry * 0.42);
      g.stroke();
      g.globalAlpha = 1;
    }
  }
  // lash line along the upper lid (also the closed-eye line), finer along the lower lid
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = style.line;
  g.lineWidth = lw * (1 + 0.4 * st.squeeze);
  g.globalAlpha = 1 - 0.85 * clamp((st.squeeze - 0.3) / 0.5, 0, 1);
  g.beginPath();
  g.moveTo(X(0), _top[0]);
  for (let i = 1; i <= N; i++) g.lineTo(X(i), _top[i]);
  g.stroke();
  g.globalAlpha = 1;
  if (st.squeeze > 0.3) {
    // squeezed shut: the lids pinch into a chevron pointing at the nose
    g.globalAlpha = clamp((st.squeeze - 0.3) / 0.5, 0, 1);
    g.lineWidth = lw * 1.3;
    const tip = E.inner * rx * 0.6, out = -E.inner * rx * 0.95;
    g.beginPath();
    g.moveTo(out, -ry * 0.5);
    g.quadraticCurveTo(tip * 0.2, -ry * 0.28, tip, ry * 0.02);
    g.quadraticCurveTo(tip * 0.2, ry * 0.2, out, ry * 0.38);
    g.stroke();
    g.globalAlpha = 1;
  }
  if (anyOpen && !style.dot) {
    g.globalAlpha = 0.65;
    g.lineWidth = lw * 0.5;
    g.beginPath();
    let pen = false;
    for (let i = 0; i <= N; i++) {
      if (_bot[i] - _top[i] < 0.3) { pen = false; continue; }
      if (pen) g.lineTo(X(i), _bot[i]);
      else g.moveTo(X(i), _bot[i]);
      pen = true;
    }
    g.stroke();
    g.globalAlpha = 1;
  }
  if (!E.brow && (st.angry > 0.05 || st.browIn > 0.05)) {
    // no brows: a soft fur furrow above the inner corner (down = cross, up = pained)
    const a = st.angry, p = Math.max(0, st.browIn);
    const ix = E.inner * rx;
    g.strokeStyle = style.line;
    g.lineWidth = lw * 2.6;
    g.filter = `blur(${Math.max(1.5, ry * 0.12).toFixed(1)}px)`;
    if (a > 0.05) {
      g.globalAlpha = 0.3 * a;
      g.beginPath();
      g.moveTo(-ix * 0.1, -ry * 1.42);
      g.quadraticCurveTo(ix * 0.5, -ry * 1.36, ix * 0.95, -ry * 1.08);
      g.stroke();
    }
    if (p > 0.05) {
      g.globalAlpha = 0.3 * p;
      g.beginPath();
      g.moveTo(-ix * 0.1, -ry * 1.18);
      g.quadraticCurveTo(ix * 0.5, -ry * 1.25, ix * 0.9, -ry * 1.55);
      g.stroke();
    }
    g.filter = 'none';
    g.globalAlpha = 1;
  }
  g.restore();
  if (E.brow && browColor) drawBrow(g, E, st, browColor);
}

function highlights(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.ellipse(x - r * 0.36, y - r * 0.4, r * 0.24, r * 0.2, -0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath();
  g.arc(x + r * 0.34, y + r * 0.3, r * 0.1, 0, Math.PI * 2);
  g.fill();
}

function drawBrow(g: CanvasRenderingContext2D, E: EyeGeom, st: EyeState, color: string) {
  const B = E.brow!;
  const o = B.px(B.outer), i = B.px(B.inner);
  const up = st.browUp * E.ry, inUp = st.browIn * E.ry;
  const O: P2 = [o[0], o[1] - up], I: P2 = [i[0] + E.inner * Math.min(0, st.browIn) * E.ry * 0.15, i[1] - up - inUp];
  const arch = B.arch * (1 + 0.3 * st.browUp - 0.5 * Math.max(0, -st.browIn));
  // tapered stroke: thin outer end -> thick inner end, rounded
  const M = 20, mx = (O[0] + I[0]) / 2, my = (O[1] + I[1]) / 2;
  const dx = I[0] - O[0], dy = I[1] - O[1], l = Math.hypot(dx, dy) || 1;
  let nx = -dy / l, ny = dx / l;
  if (ny > 0) { nx = -nx; ny = -ny; }
  const cx = mx + nx * arch * 2, cy = my + ny * arch * 2;
  const pt = (t: number): P2 => [(1 - t) * (1 - t) * O[0] + 2 * (1 - t) * t * cx + t * t * I[0], (1 - t) * (1 - t) * O[1] + 2 * (1 - t) * t * cy + t * t * I[1]];
  const left: P2[] = [], right: P2[] = [];
  for (let j = 0; j <= M; j++) {
    const t = j / M, p = pt(t), q = pt(Math.min(1, t + 0.01)), r0 = pt(Math.max(0, t - 0.01));
    const tx = q[0] - r0[0], ty = q[1] - r0[1], tl = Math.hypot(tx, ty) || 1;
    const w = lerp(B.w[0], B.w[1], t) * 0.5 * Math.sqrt(Math.sin(Math.PI * clamp(0.08 + t * 0.92, 0, 1)) * 0.85 + 0.15);
    left.push([p[0] - (ty / tl) * w, p[1] + (tx / tl) * w]);
    right.push([p[0] + (ty / tl) * w, p[1] - (tx / tl) * w]);
  }
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(left[0][0], left[0][1]);
  for (const p of left) g.lineTo(p[0], p[1]);
  for (let j = right.length - 1; j >= 0; j--) g.lineTo(right[j][0], right[j][1]);
  g.closePath();
  g.fill();
}

interface MouthState { open: number; width: number; teeth: number; fangs: number }

function drawMouth(g: CanvasRenderingContext2D, R: Region, spec: FaceSpec, st: MouthState) {
  const M = spec.mouth!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, R.W, R.H);
  if (st.open < 0.02) return;
  const px = (p: P2): P2 => {
    const q = toModel(spec, p);
    return [(q.x - R.x0) * R.ppm, (R.y1 - q.y) * R.ppm];
  };
  const L = px(M.l), Mi = px(M.m), Rr = px(M.r);
  const depth = ((M.depth * spec.frame[0]) / 1024) * R.ppm;
  // the painted upper lip as y(x)
  const lipY = (x: number) => {
    const left = x < Mi[0], C = left ? L : Rr, t = clamp((x - Mi[0]) / (C[0] - Mi[0]), 0, 1);
    return M.cusp ? C[1] + (Mi[1] - C[1]) * (1 - t) * (1 - t) : Mi[1] + (C[1] - Mi[1]) * t * t;
  };
  const xa = Mi[0] + (L[0] - Mi[0]) * st.width * 0.86, xb = Mi[0] + (Rr[0] - Mi[0]) * st.width * 0.86;
  const h = st.open * depth;
  const K = 28;
  const topP: P2[] = [], botP: P2[] = [];
  for (let i = 0; i <= K; i++) {
    const t = i / K, x = lerp(xa, xb, t), s = Math.sin(Math.PI * t);
    const y = lipY(x) + 0.6;
    topP.push([x, y]);
    botP.push([x, y + h * Math.pow(s, 0.75)]);
  }
  const lineW = Math.max(1, depth * 0.05);
  g.save();
  g.beginPath();
  g.moveTo(topP[0][0], topP[0][1]);
  for (const p of topP) g.lineTo(p[0], p[1]);
  for (let i = K; i >= 0; i--) g.lineTo(botP[i][0], botP[i][1]);
  g.closePath();
  g.save();
  g.clip();
  const midY = topP[K >> 1][1];
  const ig = g.createLinearGradient(0, midY, 0, midY + h);
  ig.addColorStop(0, shade(M.inside, 0.45));
  ig.addColorStop(1, M.inside);
  g.fillStyle = ig;
  g.fillRect(0, 0, R.W, R.H);
  // tongue
  const hw = (xb - xa) / 2, xc = (xa + xb) / 2;
  g.fillStyle = M.tongue;
  g.beginPath();
  g.ellipse(xc, midY + h * 1.08, hw * 0.55, h * 0.42, 0, 0, Math.PI * 2);
  g.fill();
  // teeth along the upper lip (grimace / shout)
  if (st.teeth > 0.05) {
    g.fillStyle = '#f6f0e4';
    g.beginPath();
    g.moveTo(topP[0][0], topP[0][1]);
    for (const p of topP) g.lineTo(p[0], p[1]);
    for (let i = K; i >= 0; i--) g.lineTo(topP[i][0], topP[i][1] + h * 0.22 * st.teeth);
    g.fill();
  }
  if (st.fangs > 0.05) {
    g.fillStyle = '#f8f3ea';
    for (const sgn of [-1, 1]) {
      const fx = xc + sgn * hw * 0.55, fy = lipY(fx), fw = hw * 0.16, fl = Math.min(h * 0.55, depth * 0.4) * st.fangs;
      g.beginPath();
      g.moveTo(fx - fw, fy);
      g.quadraticCurveTo(fx - fw * 0.3, fy + fl * 0.6, fx + sgn * fw * 0.15, fy + fl);
      g.quadraticCurveTo(fx + fw * 0.4, fy + fl * 0.5, fx + fw, fy);
      g.closePath();
      g.fill();
    }
  }
  g.restore();
  // lower lip rim and a fine upper edge
  g.lineCap = 'round';
  g.strokeStyle = M.lip;
  g.globalAlpha = 0.8;
  g.lineWidth = lineW * 1.6;
  g.beginPath();
  g.moveTo(botP[0][0], botP[0][1]);
  for (const p of botP) g.lineTo(p[0], p[1]);
  g.stroke();
  g.globalAlpha = 1;
  g.strokeStyle = shade(M.inside, 0.5);
  g.lineWidth = lineW;
  g.beginPath();
  g.moveTo(topP[0][0], topP[0][1]);
  for (const p of topP) g.lineTo(p[0], p[1]);
  g.stroke();
  g.restore();
}

const _c = new THREE.Color(), _c2 = new THREE.Color();
const shade = (hex: string, k: number) => '#' + _c.set(hex).multiplyScalar(k).getHexString();
const mix = (a: string, b: string, t: number) => '#' + _c.set(a).lerp(_c2.set(b), t).getHexString();

// ---------------------------------------------------------------------------------------------- behaviour
const faces = new Set<Face>();
let seed = 1;
const LOD = 25;
const _v = new THREE.Vector3(), _cam = new THREE.Vector3(), _tp = new THREE.Vector3(), _m = new THREE.Matrix4();

/** debug overrides (window.chonk.player.rig.face.debug = { angry: 1, talk: true, ... }) */
export interface FaceDebug { happy?: number; angry?: number; hurt?: number; wide?: number; sad?: number; ko?: boolean; talk?: boolean; blink?: number; gaze?: P2; mouth?: number }

export class Face {
  debug: FaceDebug | null = null;
  /** world position of the head (for other faces to glance at) */
  readonly pos = new THREE.Vector3();
  private lastUpdate = 0;
  private camDist = 0;
  private rand: () => number;
  private t = 0;
  private sleepy: number;
  // eyes
  private eyeCtx: CanvasRenderingContext2D[] = [];
  private eyeTex: THREE.CanvasTexture[] = [];
  private eyeGeom: EyeGeom[] = [];
  private drawn: number[][] = [[], []];
  private drawnMouth: number[] = [];
  private lastDraw = -1;
  private st: EyeState = { open: 1, lower: 0, happy: 0, angry: 0, sad: 0, wide: 0, squeeze: 0, gx: 0, gy: 0, pupil: 1, browUp: 0, browIn: 0 };
  private ex = { happy: 0, angry: 0, hurt: 0, wide: 0, ko: 0, sad: 0 };
  private blinkT = -1;
  private nextBlink: number;
  private doubleBlink = false;
  private gaze = new THREE.Vector2();
  private gazeTarget = new THREE.Vector2();
  private glanceLeft = 0;
  private glanceAt: Face | null = null;
  private micro = new THREE.Vector2();
  private microLeft = 0;
  // mouth
  private mouthCtx: CanvasRenderingContext2D | null = null;
  private mouthTex: THREE.CanvasTexture | null = null;
  private mouthMesh: THREE.SkinnedMesh | null = null;
  private ms: MouthState = { open: 0, width: 1, teeth: 0, fangs: 0 };
  private syll = { open: 0, width: 1 };
  private syllLeft = 0;
  private talkHold = 0;
  private meshes: THREE.SkinnedMesh[] = [];

  constructor(private mf: ModelFace, mesh: THREE.SkinnedMesh, private head: THREE.Object3D, baseMat: THREE.MeshPhysicalMaterial) {
    this.rand = rng(seed++ * 7919);
    this.nextBlink = 0.5 + this.rand() * 3;
    this.sleepy = mf.spec.sleepy ?? 1;
    const add = (R: Region, mouth: boolean) => {
      const cv = canvas(R.W, R.H);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.channel = 1;
      tex.anisotropy = 4;
      const mat = baseMat.clone();
      mat.map = tex;
      mat.transparent = true;
      mat.depthWrite = false;
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -1;
      mat.polygonOffsetUnits = -4;
      // fur sheen would wash out a dark mouth (it faces down: grazing) and grey the eyes; the eye patch keeps
      // some so its fur still matches the skin around it
      mat.sheen = mouth ? 0 : baseMat.sheen * 0.5;
      const o = new THREE.SkinnedMesh(R.geo, mat);
      o.name = 'face';
      o.bind(mesh.skeleton, mesh.bindMatrix);
      o.frustumCulled = false;
      o.castShadow = false;
      o.receiveShadow = true;
      o.renderOrder = 1;
      mesh.add(o);
      excludeFromAO(o);
      const ao = o.onBeforeRender;
      o.onBeforeRender = (r, scene, cam, geo, m, group) => {
        this.camDist = _cam.setFromMatrixPosition(cam.matrixWorld).distanceTo(this.pos);
        ao.call(o, r, scene, cam, geo, m, group);
      };
      this.meshes.push(o);
      return { ctx: cv.getContext('2d')!, tex, mesh: o };
    };
    for (let s = 0; s < 2; s++) {
      const R = mf.eyes[s];
      const { ctx, tex } = add(R, false);
      this.eyeCtx.push(ctx);
      this.eyeTex.push(tex);
      this.eyeGeom.push(eyeGeom(mf.spec, s, R));
    }
    if (mf.mouth) {
      const { ctx, tex, mesh: o } = add(mf.mouth, true);
      this.mouthCtx = ctx;
      this.mouthTex = tex;
      this.mouthMesh = o;
      o.visible = false;
    }
    faces.add(this);
    this.head.updateWorldMatrix(true, false);
    this.pos.setFromMatrixPosition(this.head.matrixWorld);
    this.redraw(true);
  }

  dispose() {
    faces.delete(this);
    for (const m of this.meshes) {
      m.removeFromParent();
      (m.material as THREE.MeshPhysicalMaterial).map?.dispose();
      (m.material as THREE.Material).dispose();
    }
  }

  update(dt: number, inp: AnimInput) {
    this.t += dt;
    this.lastUpdate = performance.now();
    this.pos.setFromMatrixPosition(this.head.matrixWorld);
    if (this.camDist > LOD) return;
    const D = this.debug;
    const rnd = this.rand;
    const tiger = !!this.mf.spec.mouth?.fangs && this.mf.spec.mouth.depth > 80;

    // ---- expression targets from the animation input
    const g = inp.ko ? null : inp.gesture ?? null;
    const fight = !inp.ko && (inp.fighting || inp.angry || !!inp.move || g === 'angry');
    const hurt = !inp.ko && inp.hurtT < 0.3;
    const T = {
      ko: inp.ko ? 1 : 0,
      hurt: hurt ? 1 : 0,
      angry: hurt || inp.ko ? 0 : fight ? (inp.move ? 1 : 0.75) : inp.swimming ? 0.4 : 0,
      happy: fight || hurt || inp.ko ? 0 : g === 'cheer' ? 1 : g === 'wave' || g === 'yes' || g === 'nod' ? 0.55 : g === 'talk' ? 0.3 : inp.talking ? 0.25 : 0,
      wide: inp.ko || hurt ? 0 : inp.hurtT < 0.9 ? 0.8 : !inp.grounded && !inp.swimming && inp.vy > 3 ? 0.6 : 0,
      sad: 0,
    };
    if (D) {
      for (const k of ['happy', 'angry', 'hurt', 'wide', 'sad'] as const) if (D[k] !== undefined) T[k] = D[k]!;
      if (D.ko !== undefined) T.ko = D.ko ? 1 : 0;
    }
    const ex = this.ex;
    for (const k of Object.keys(T) as (keyof typeof T)[]) ex[k] = damp(ex[k], T[k], k === 'hurt' || k === 'wide' ? 22 : 10, dt);

    // ---- blinks: every 2-6 s, sometimes a double; slower for the sleepy
    const slow = this.sleepy < 1 ? 1.6 : 1;
    if (this.blinkT < 0 && (this.nextBlink -= dt) <= 0) this.startBlink();
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt / slow;
      const b = this.blinkT;
      blink = b < 0.06 ? b / 0.06 : b < 0.09 ? 1 : 1 - (b - 0.09) / 0.11;
      if (b > 0.2) {
        this.blinkT = -1;
        blink = 0;
        if (this.doubleBlink) {
          this.doubleBlink = false;
          this.nextBlink = 0.12;
        } else this.nextBlink = (2 + rnd() * 4) * slow;
      }
    }
    if (D?.blink !== undefined) blink = D.blink;
    blink = clamp(blink, 0, 1);

    // ---- gaze
    this.updateGaze(dt, inp);
    if (D?.gaze) this.gaze.set(D.gaze[0], D.gaze[1]);

    // ---- eye state
    const st = this.st;
    const alert = Math.max(ex.angry, ex.wide, ex.hurt);
    const baseOpen = lerp(this.sleepy, 1, alert) * (1 - 0.18 * ex.angry) * (1 + 0.12 * ex.wide);
    const closed = Math.max(blink, ex.hurt, ex.ko, ex.happy > 0.8 ? (ex.happy - 0.8) * 5 : 0);
    st.open = baseOpen * (1 - closed) * (1 - 0.15 * ex.happy);
    st.lower = Math.max(blink, ex.hurt, ex.ko, ex.happy > 0.8 ? (ex.happy - 0.8) * 5 : 0) * 0.999;
    st.happy = ex.happy * 0.85;
    st.angry = ex.angry * (1 - ex.ko);
    st.sad = Math.max(ex.sad, ex.hurt * 0.5);
    st.wide = ex.wide;
    st.squeeze = ex.hurt;
    st.gx = this.gaze.x;
    st.gy = this.gaze.y;
    st.pupil = 1 - 0.15 * ex.angry + 0.08 * ex.happy;
    st.browUp = 0.35 * ex.wide + 0.15 * ex.happy - 0.2 * ex.angry - 0.1 * ex.ko;
    st.browIn = -0.55 * ex.angry + 0.35 * ex.hurt + 0.3 * ex.sad;

    // ---- mouth
    const ms = this.ms;
    let talking = g === 'talk' || !!D?.talk;
    if (talking) this.talkHold = 0.2;
    else if ((this.talkHold -= dt) > 0) talking = true;
    let tOpen = 0, tWidth = 1, tTeeth = 0, tFangs = 0;
    if (talking) {
      if ((this.syllLeft -= dt) <= 0) {
        // syllables: ah, o, ee, eh, m (closed)
        const shapes: P2[] = [[1, 0.9], [0.7, 0.6], [0.4, 1.05], [0.6, 0.85], [0.05, 0.85], [0.85, 0.8]];
        const s = shapes[Math.floor(rnd() * shapes.length)];
        this.syll.open = s[0] * (0.55 + rnd() * 0.45);
        this.syll.width = s[1];
        this.syllLeft = 0.075 + rnd() * 0.09;
      }
      tOpen = this.syll.open * 0.75;
      tWidth = this.syll.width;
    }
    if (inp.move && !inp.ko) {
      // kiai! / ROAR on attacks, peaking at the strike
      const k = Math.sin(clamp(inp.moveT / 0.75, 0, 1) * Math.PI);
      tOpen = Math.max(tOpen, (tiger ? 1 : 0.55) * k);
      tWidth = tiger ? 1.05 : 0.8;
      tTeeth = tiger ? 0 : 1;
      tFangs = tiger || this.mf.spec.mouth?.fangs ? 1 : 0;
    } else if (ex.hurt > 0.1) {
      tOpen = Math.max(tOpen, 0.32 * ex.hurt);
      tWidth = 0.95;
      tTeeth = 1;
    } else if (ex.ko > 0.5) {
      tOpen = 0.22;
      tWidth = 0.45;
    } else if (!talking && ex.happy > 0.6) {
      tOpen = 0.45 * ex.happy;
      tWidth = 0.95;
    } else if (!talking && ex.wide > 0.3) {
      tOpen = 0.35 * ex.wide;
      tWidth = 0.5;
    }
    if (D?.mouth !== undefined) tOpen = D.mouth;
    ms.open = damp(ms.open, tOpen, 28, dt);
    ms.width = damp(ms.width, tWidth, 20, dt);
    ms.teeth = damp(ms.teeth, tTeeth, 20, dt);
    ms.fangs = damp(ms.fangs, tFangs, 20, dt);

    this.redraw(false);
  }

  private startBlink() {
    this.blinkT = 0;
    this.doubleBlink = this.rand() < 0.2;
  }

  private updateGaze(dt: number, inp: AnimInput) {
    const rnd = this.rand;
    this.glanceLeft -= dt;
    this.microLeft -= dt;
    if (this.microLeft <= 0) {
      this.micro.set((rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.08);
      this.microLeft = 0.35 + rnd() * 0.9;
    }
    const tgt = this.gazeTarget;
    const px = tgt.x, py = tgt.y;
    if (inp.ko) tgt.set(0, 0);
    else if (inp.lookAt) {
      this.lookToward(inp.lookAt, tgt);
      tgt.add(this.micro);
      this.glanceAt = null;
    } else if (Math.abs(inp.turn ?? 0) > 0.6 && inp.speed > 0.3) {
      // eyes lead the turn
      tgt.set(clamp((inp.turn ?? 0) * 0.3, -0.85, 0.85), 0.05);
    } else {
      if (this.glanceLeft <= 0) {
        this.glanceAt = null;
        const r = rnd();
        if (r < 0.45) this.glanceAt = this.nearest();
        if (!this.glanceAt) {
          if (r < 0.7) tgt.set((rnd() - 0.5) * 0.25, (rnd() - 0.5) * 0.15);
          else {
            const a = rnd() * Math.PI * 2, m = 0.35 + rnd() * 0.4;
            tgt.set(Math.cos(a) * m, Math.sin(a) * m * 0.6);
          }
        }
        this.glanceLeft = 0.6 + rnd() * 2;
      }
      if (this.glanceAt) {
        this.lookToward(_tp.copy(this.glanceAt.pos).setY(this.glanceAt.pos.y + 0.1), tgt);
        tgt.add(this.micro);
      }
      if (inp.fighting && this.glanceAt === null) tgt.multiplyScalar(0.3);
    }
    // a big saccade sometimes comes with a blink
    if (Math.hypot(tgt.x - px, tgt.y - py) > 0.5 && this.blinkT < 0 && rnd() < 0.3) this.startBlink();
    // saccade: fast, then hold
    this.gaze.x = damp(this.gaze.x, tgt.x, 30, dt);
    this.gaze.y = damp(this.gaze.y, tgt.y, 30, dt);
  }

  /** gaze (-1..1) that points the eyes at a world point, given the head's current orientation */
  private lookToward(p: THREE.Vector3, out: THREE.Vector2) {
    // head bone space at rest = rig space: +z forward, +x the character's left
    _v.copy(p).applyMatrix4(_m.copy(this.head.matrixWorld).invert()).sub(this.eyeLocal);
    const yaw = Math.atan2(_v.x, Math.max(0.05, _v.z));
    const pitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
    out.set(clamp(yaw / 0.6, -1, 1), clamp(-pitch / 0.45, -0.8, 0.8));
  }

  /** midpoint between the eyes in head bone space (set at creation, bind pose) */
  readonly eyeLocal = new THREE.Vector3();

  /** the nearest other character within 7 m in front of this one */
  private nearest(): Face | null {
    let best: Face | null = null, bd = 7;
    const now = performance.now();
    _m.copy(this.head.matrixWorld);
    const fwd = _v.set(_m.elements[8], 0, _m.elements[10]).normalize();
    for (const f of faces) {
      if (f === this) continue;
      if (now - f.lastUpdate > 2000) {
        if (now - f.lastUpdate > 10000) faces.delete(f);
        continue;
      }
      const dx = f.pos.x - this.pos.x, dz = f.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * fwd.x + dz * fwd.z) / Math.max(d, 1e-3) > 0.2) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  private redraw(force: boolean) {
    const now = this.t;
    if (!force && now - this.lastDraw < 1 / 30) return;
    const st = this.st, mf = this.mf;
    const key = [st.open, st.lower, st.happy, st.angry, st.sad, st.wide, st.squeeze, st.gx, st.gy, st.pupil, st.browUp, st.browIn];
    for (let s = 0; s < 2; s++) {
      const d = this.drawn[s];
      let changed = force || d.length !== key.length;
      for (let i = 0; !changed && i < key.length; i++) if (Math.abs(d[i] - key[i]) > 0.012) changed = true;
      if (!changed) continue;
      this.drawn[s] = key.slice();
      // the gaze is shared; each eye keeps its own lid side (inner corner) in its geometry
      drawEye(this.eyeCtx[s], mf.eyes[s], this.eyeGeom[s], st, mf.spec.style, mf.spec.brow);
      this.eyeTex[s].needsUpdate = true;
      this.lastDraw = now;
    }
    if (this.mouthCtx && mf.mouth) {
      const ms = this.ms;
      const mk = [ms.open < 0.02 ? 0 : ms.open, ms.width, ms.teeth, ms.fangs];
      const d = this.drawnMouth;
      let changed = force || d.length !== mk.length;
      for (let i = 0; !changed && i < mk.length; i++) if (Math.abs(d[i] - mk[i]) > 0.015) changed = true;
      if (changed) {
        this.drawnMouth = mk;
        drawMouth(this.mouthCtx, mf.mouth, mf.spec, ms);
        this.mouthTex!.needsUpdate = true;
        this.mouthMesh!.visible = ms.open >= 0.02;
        this.lastDraw = now;
      }
    }
  }
}

/**
 * The animated face of a pipeline character (null when the model has no calibration). Call in the
 * bind pose, after the mesh is bound to its skeleton; `mat` is the character's material (the overlays
 * reuse its shading so they light exactly like the skin around them).
 */
export function createFace(name: string, mesh: THREE.SkinnedMesh, head: THREE.Object3D, mat: THREE.MeshPhysicalMaterial): Face | null {
  if (!models.has(name)) {
    let mf: ModelFace | null = null;
    try {
      mf = setupModel(name, mesh);
    } catch (e) {
      console.warn(`face: ${name} calibration failed`, e);
    }
    models.set(name, mf);
  }
  const mf = models.get(name);
  if (!mf) return null;
  head.updateWorldMatrix(true, false);
  const f = new Face(mf, mesh, head, mat);
  // bind pose: model space = the rig root's space, the head bone has no rest rotation
  const root = mesh.parent ?? head;
  root.updateWorldMatrix(true, false);
  f.eyeLocal.copy(mf.eyeMid).sub(_v.setFromMatrixPosition(_m.copy(root.matrixWorld).invert().multiply(head.matrixWorld)));
  return f;
}
