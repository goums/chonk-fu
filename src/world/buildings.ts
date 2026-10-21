// The Valley's architecture, all procedural: village houses with curved roofs, the noodle shop, the
// Palace on the mountain with the Thousand Steps, a pagoda, gates, arched bridges and red lanterns.
import * as THREE from 'three';
import { rng } from '../core/math';
import { addBox, addCircle } from '../game/colliders';
import { Batch, addRidge, box, cyl, kitMaterial, roofGeometry } from './kit';
import { ARENA, BRIDGES, FRUIT_TREES, GROUND, MUSHROOM_ROCKS, PALACE_MOUNT, PEACH_HILL, POND, RIVER_HALF_WIDTH, SHOOTS, SPOTS, STAIRS, VILLAGE, riverX } from './layout';
import { heightAt, stairHeight } from './terrain';

const C = {
  stone: 0xbcae98, stoneDark: 0x8f8472, pillar: 0xb8322a, wall: 0xf1e3c6, beam: 0x5a3324, under: 0x8a2d22,
  door: 0x7a2a1f, paper: 0xf7ecd2, lattice: 0x3b2418, gold: 0xe8b83a, jadeA: 0x2f8f6e, jadeB: 0x267559,
  tealA: 0x3f7f78, tealB: 0x356b66, slateA: 0x5d6b80, slateB: 0x4e5b6e, rustA: 0x9a4a32, rustB: 0x84402c,
  wood: 0x8a5a3a, woodLight: 0xb07a4e, lantern: 0xe2352b,
};
const ROOFS: [number, number][] = [[C.tealA, C.tealB], [C.slateA, C.slateB], [C.rustA, C.rustB]];

/** one building footprint, used to keep trees off buildings and for quest/agent landmarks */
export interface Footprint { x: number; z: number; hx: number; hz: number; ry: number; name: string }
export const FOOTPRINTS: Footprint[] = [];

/** a house in local space: front faces +z, ground at y = 0 */
function house(w: number, d: number, floors: number, roof: [number, number], seed: number) {
  const R = rng(seed), b = new Batch();
  const plat = 0.6;
  b.add(box(w + 1.4, plat + 1.5, d + 1.4), C.stone, 0, plat / 2 - 0.75, 0);
  // front steps
  b.add(box(2.2, 0.3, 0.6), C.stoneDark, 0, 0.15, d / 2 + 0.95);
  let y = plat;
  let fw = w, fd = d;
  for (let f = 0; f < floors; f++) {
    const wh = f === 0 ? 2.7 : 2.2;
    b.add(box(fw, wh, fd), C.wall, 0, y + wh / 2, 0);
    // pillars at the corners and along the front
    const cols = Math.max(2, Math.round(fw / 2.2) + 1);
    for (let i = 0; i < cols; i++) {
      const px = -fw / 2 + (fw * i) / (cols - 1);
      for (const pz of [fd / 2 + 0.05, -fd / 2 - 0.05]) b.add(cyl(0.17, 0.19, wh, 8), C.pillar, px, y + wh / 2, pz);
    }
    for (const px of [-fw / 2 - 0.05, fw / 2 + 0.05]) b.add(cyl(0.17, 0.19, wh, 8), C.pillar, px, y + wh / 2, 0);
    // beams
    b.add(box(fw + 0.3, 0.28, fd + 0.3), C.beam, 0, y + wh - 0.14, 0);
    b.add(box(fw + 0.2, 0.18, fd + 0.2), C.beam, 0, y + 0.09, 0);
    // door (ground floor) and lattice windows
    if (f === 0) {
      b.add(box(1.3, 2.0, 0.12), C.door, 0, y + 1.0, fd / 2 + 0.04);
      b.add(box(0.08, 2.0, 0.14), C.gold, 0, y + 1.0, fd / 2 + 0.06);
    }
    const winY = y + (f === 0 ? 1.45 : 1.15);
    const wins = f === 0 ? [-fw / 4 - 0.3, fw / 4 + 0.3] : [-fw / 4, 0, fw / 4];
    for (const wx of wins) {
      if (f === 0 && Math.abs(wx) < 1) continue;
      b.add(box(1.0, 0.9, 0.1), C.paper, wx, winY, fd / 2 + 0.04);
      for (const k of [-1, 0, 1]) {
        b.add(box(0.05, 0.9, 0.13), C.lattice, wx + k * 0.3, winY, fd / 2 + 0.05);
        b.add(box(1.0, 0.05, 0.13), C.lattice, wx, winY + k * 0.28, fd / 2 + 0.05);
      }
    }
    y += wh;
    const last = f === floors - 1;
    const rw = fw + 2.4, rd = fd + 2.4, rh = last ? 1.5 + fd * 0.16 : 0.9;
    b.add(roofGeometry(rw, rd, rh, last ? 0.9 : 0.6, roof[0], roof[1], C.under), null, 0, y + 0.05, 0);
    if (last) addRidge(b, rw, rd, rh, y, roof[1], C.gold);
    fw *= 0.78;
    fd *= 0.8;
    y += f === floors - 1 ? 0 : 0.35;
  }
  // a hanging lantern pair by the door and a barrel or two
  for (const s of [-1, 1]) {
    b.add(new THREE.SphereGeometry(0.28, 10, 8), C.lantern, s * 1.1, plat + 2.3, d / 2 + 0.7, 0, 1, 1.25, 1);
    b.add(cyl(0.16, 0.16, 0.08, 8), C.gold, s * 1.1, plat + 2.66, d / 2 + 0.7);
    b.add(cyl(0.16, 0.16, 0.08, 8), C.gold, s * 1.1, plat + 1.94, d / 2 + 0.7);
  }
  if (R() < 0.6) b.add(cyl(0.4, 0.35, 0.9, 10), C.wood, w / 2 + 0.2, 0.45, d / 2 + 1.2);
  return b.geometry();
}

/** a multi-tier pagoda */
function pagoda(tiers: number, base: number) {
  const b = new Batch();
  b.add(box(base + 2.5, 2.2, base + 2.5), C.stone, 0, -0.4, 0);
  let y = 0.7, w = base;
  for (let t = 0; t < tiers; t++) {
    const h = t === 0 ? 3 : 2.1;
    b.add(box(w, h, w), C.wall, 0, y + h / 2, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cyl(0.2, 0.22, h, 8), C.pillar, (sx * w) / 2, y + h / 2, (sz * w) / 2);
    b.add(box(w + 0.3, 0.3, w + 0.3), C.beam, 0, y + h - 0.15, 0);
    if (t === 0) b.add(box(1.4, 2.2, 0.12), C.door, 0, y + 1.1, w / 2 + 0.04);
    else b.add(box(0.9, 0.9, 0.1), C.paper, 0, y + 1.0, w / 2 + 0.04);
    y += h;
    b.add(roofGeometry(w + 2.6, w + 2.6, 1.1, 1.0, C.jadeA, C.jadeB, C.under), null, 0, y, 0);
    y += 0.9;
    w *= 0.84;
  }
  // spire
  b.add(cyl(0.12, 0.3, 3.2, 8), C.gold, 0, y + 1.4, 0);
  for (let k = 0; k < 4; k++) b.add(new THREE.TorusGeometry(0.35 - k * 0.05, 0.07, 6, 12), C.gold, 0, y + 0.6 + k * 0.55, 0, 0, 1, 1, 1, Math.PI / 2);
  b.add(new THREE.SphereGeometry(0.3, 10, 8), C.gold, 0, y + 3.2, 0);
  return b.geometry();
}

/** the Palace's great hall: big stone platform with front stairs, colonnade, double-eave golden roof */
function palaceHall(w: number, d: number) {
  const b = new Batch();
  const plat = 1.6;
  b.add(box(w + 4, plat + 2, d + 4), C.stone, 0, plat / 2 - 1, 0);
  b.add(box(w + 4.4, 0.25, d + 4.4), C.stoneDark, 0, plat, 0);
  // front stairs
  for (let k = 0; k < 6; k++) b.add(box(7, plat - k * 0.27, 0.6), C.stoneDark, 0, (plat - k * 0.27) / 2, d / 2 + 2 + k * 0.6 + 0.3);
  const wh = 5.5;
  b.add(box(w - 1.5, wh, d - 1.5), C.pillar, 0, plat + wh / 2, 0);
  // colonnade
  const cols = 8;
  for (let i = 0; i < cols; i++) {
    const px = -w / 2 + (w * i) / (cols - 1);
    b.add(cyl(0.38, 0.42, wh, 10), C.pillar, px, plat + wh / 2, d / 2);
    b.add(cyl(0.38, 0.42, wh, 10), C.pillar, px, plat + wh / 2, -d / 2);
    b.add(cyl(0.55, 0.55, 0.4, 10), C.stoneDark, px, plat + 0.2, d / 2);
  }
  // big doors with golden studs
  for (const dx of [-3.6, 0, 3.6]) {
    b.add(box(2.6, 4.0, 0.15), C.door, dx, plat + 2.0, (d - 1.5) / 2 + 0.05);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) b.add(new THREE.SphereGeometry(0.07, 6, 4), C.gold, dx - 0.6 + c * 0.6, plat + 0.9 + r * 0.8, (d - 1.5) / 2 + 0.15);
  }
  b.add(box(w + 0.6, 0.6, d + 0.6), C.beam, 0, plat + wh - 0.3, 0);
  b.add(box(w + 0.4, 0.3, d + 0.4), C.jadeB, 0, plat + wh - 0.75, 0);
  // golden plaque
  b.add(box(3.4, 1.3, 0.2), C.gold, 0, plat + wh + 0.9, d / 2 + 0.6);
  b.add(box(3.0, 1.0, 0.22), C.under, 0, plat + wh + 0.9, d / 2 + 0.62);
  // lower roof
  let y = plat + wh;
  b.add(roofGeometry(w + 5, d + 5, 1.6, 1.3, C.gold, 0xd4a22e, C.under, 0.35), null, 0, y, 0);
  // upper storey and roof
  y += 1.3;
  b.add(box(w * 0.7, 3.2, d * 0.62), C.pillar, 0, y + 1.6, 0);
  b.add(box(w * 0.72, 0.4, d * 0.64), C.beam, 0, y + 3.0, 0);
  y += 3.2;
  const rw = w * 0.7 + 5.5, rd = d * 0.62 + 5.5;
  b.add(roofGeometry(rw, rd, 4.2, 1.6, C.gold, 0xd4a22e, C.under, 0.35), null, 0, y, 0);
  addRidge(b, rw, rd, 4.2, y, C.jadeA, C.jadeA);
  return b.geometry();
}

/** paifang gate: 4 pillars, beams and three little roofs */
function gate(w: number, h: number) {
  const b = new Batch();
  const xs = [-w / 2, -w / 6, w / 6, w / 2];
  for (const x of xs) {
    b.add(cyl(0.3, 0.32, h, 10), C.pillar, x, h / 2, 0);
    b.add(box(0.9, 0.6, 0.9), C.stoneDark, x, 0.3, 0);
  }
  b.add(box(w + 1, 0.5, 0.5), C.beam, 0, h - 0.6, 0);
  b.add(box(w * 0.4, 0.4, 0.45), C.beam, 0, h + 0.6, 0);
  b.add(box(w * 0.32 + 0.4, 0.4, 0.45), C.jadeB, 0, h - 1.4, 0);
  b.add(box(2.4, 1.1, 0.2), C.gold, 0, h + 0.05, 0.05);
  b.add(box(2.1, 0.85, 0.22), C.under, 0, h + 0.05, 0.06);
  b.add(roofGeometry(w * 0.42, 1.8, 0.9, 0.9, C.jadeA, C.jadeB, C.under), null, 0, h + 0.85, 0);
  for (const s of [-1, 1]) b.add(roofGeometry(w * 0.4, 1.6, 0.7, 0.8, C.jadeA, C.jadeB, C.under), null, (s * w) / 3, h - 0.3, 0);
  return b.geometry();
}

/** arched wooden bridge spanning `len` along x, deck `w` wide */
export const BRIDGE = { len: 2 * RIVER_HALF_WIDTH + 14, w: 3.6, arch: 2.2 };
function bridge() {
  const b = new Batch();
  const { len, w } = BRIDGE;
  const n = 24;
  for (let i = 0; i < n; i++) {
    const x0 = -len / 2 + (len * i) / n, x1 = -len / 2 + (len * (i + 1)) / n;
    const y0 = bridgeArch(x0), y1 = bridgeArch(x1);
    const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
    const ang = Math.atan2(y1 - y0, x1 - x0);
    b.add(box(Math.hypot(x1 - x0, y1 - y0) + 0.02, 0.25, w), i % 2 ? C.wood : C.woodLight, xm, ym - 0.12, 0, 0, 1, 1, 1, 0, ang);
    if (i % 3 === 0)
      for (const s of [-1, 1]) {
        b.add(cyl(0.09, 0.09, 1.2, 6), C.pillar, x0, y0 + 0.5, (s * w) / 2);
      }
    for (const s of [-1, 1]) b.add(box(Math.hypot(x1 - x0, y1 - y0) + 0.05, 0.12, 0.14), C.pillar, xm, ym + 1.0, (s * w) / 2, 0, 1, 1, 1, 0, ang);
  }
  for (const s of [-1, 1]) b.add(cyl(0.18, 0.18, 1.6, 8), C.pillar, (s * len) / 2, 0.8, w / 2), b.add(cyl(0.18, 0.18, 1.6, 8), C.pillar, (s * len) / 2, 0.8, -w / 2);
  // supports in the water
  for (const x of [-len / 4, 0, len / 4]) for (const s of [-1, 1]) b.add(cyl(0.2, 0.2, 5, 8), C.beam, x, bridgeArch(x) - 2.6, (s * w) / 2 - s * 0.3);
  return b.geometry();
}
export const bridgeArch = (x: number) => {
  const u = (2 * x) / BRIDGE.len;
  return BRIDGE.arch * (1 - u * u) + 0.0;
};

/** the Thousand Steps: one box per step, plus stone balustrades and lantern posts */
function stairs() {
  const b = new Batch();
  const rise = 0.25;
  const total = PALACE_MOUNT.h - GROUND;
  const n = Math.round(total / rise);
  const len = STAIRS.z0 - STAIRS.z1;
  const run = len / n;
  const W = STAIRS.halfWidth * 2;
  for (let k = 0; k < n; k++) {
    const z = STAIRS.z0 - (k + 0.5) * run;
    const top = GROUND + (k + 1) * rise;
    b.add(box(W, 1.6, run + 0.02), k % 2 ? C.stone : 0xc6b9a3, STAIRS.x, top - 0.8, z);
  }
  // balustrades
  for (const s of [-1, 1]) {
    const x = STAIRS.x + s * (STAIRS.halfWidth + 0.3);
    const segs = 40;
    for (let i = 0; i < segs; i++) {
      const z0 = STAIRS.z0 - (len * i) / segs, z1 = STAIRS.z0 - (len * (i + 1)) / segs;
      const y0 = stairHeight(z0), y1 = stairHeight(z1);
      const ang = Math.atan2(y1 - y0, -(z1 - z0));
      b.add(box(0.5, 1.0, Math.hypot(z1 - z0, y1 - y0) + 0.05), C.stoneDark, x, (y0 + y1) / 2 + 0.4, (z0 + z1) / 2, 0, 1, 1, 1, ang, 0);
      if (i % 5 === 0) {
        b.add(box(0.7, 1.8, 0.7), C.stoneDark, x, y0 + 0.9, z0);
        b.add(new THREE.SphereGeometry(0.3, 8, 6), C.lantern, x, y0 + 2.1, z0, 0, 1, 1.2, 1);
        b.add(roofGeometry(1.0, 1.0, 0.3, 0.2, C.stoneDark, C.stoneDark, C.stoneDark, 0.1), null, x, y0 + 2.45, z0);
      }
    }
  }
  return b.geometry();
}

/** stone lantern post / red hanging lantern string */
function lanternString(len: number, n: number) {
  const b = new Batch();
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (len * (i + 0.5)) / n;
    const sag = 0.6 * (1 - ((2 * x) / len) ** 2);
    b.add(new THREE.SphereGeometry(0.3, 10, 8), C.lantern, x, -sag - 0.4, 0, 0, 1, 1.25, 1);
    b.add(cyl(0.17, 0.17, 0.08, 8), C.gold, x, -sag - 0.02, 0);
    b.add(cyl(0.04, 0.04, 0.35, 4), C.gold, x, -sag - 0.85, 0);
  }
  b.add(cyl(0.02, 0.02, len, 4), C.beam, 0, 0, 0, 0, 1, 1, 1, 0, Math.PI / 2);
  return b.geometry();
}

function pole(h: number) {
  const b = new Batch();
  b.add(cyl(0.12, 0.15, h, 8), C.pillar, 0, h / 2, 0);
  b.add(box(0.5, 0.3, 0.5), C.stoneDark, 0, 0.15, 0);
  return b.geometry();
}

/** the training arena: a round wooden deck ring, posts, and wooden training dummies */
function arena() {
  const b = new Batch();
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * ARENA.r, z = Math.sin(a) * ARENA.r;
    if (Math.abs(a - Math.PI * 1.5) < 0.25) continue; // entrance to the north
    b.add(cyl(0.22, 0.25, 2.2, 8), C.beam, x, 1.1, z);
    if (i % 2 === 0) b.add(new THREE.SphereGeometry(0.25, 8, 6), C.lantern, x, 2.4, z);
  }
  return b.geometry();
}

export function trainingDummy() {
  const b = new Batch();
  b.add(cyl(0.12, 0.15, 1.2, 8), C.beam, 0, 0.6, 0);
  b.add(new THREE.SphereGeometry(0.55, 14, 10), C.woodLight, 0, 1.6, 0, 0, 1, 1.15, 1);
  b.add(new THREE.SphereGeometry(0.32, 12, 8), C.wood, 0, 2.45, 0);
  for (const s of [-1, 1]) b.add(cyl(0.07, 0.07, 0.8, 6), C.beam, s * 0.6, 1.8, 0, 0, 1, 1, 1, 0, s * 1.2);
  b.add(box(0.5, 0.1, 0.05), C.lantern, 0, 2.5, 0.3);
  return b.geometry();
}

interface Placed { geo: THREE.BufferGeometry; x: number; z: number; ry: number; y?: number; name?: string; collide?: [number, number] }

export function buildArchitecture() {
  const group = new THREE.Group();
  group.name = 'architecture';
  const R = rng(777);
  const world = new Batch();
  const placed: Placed[] = [];
  const geoCache = new Map<string, THREE.BufferGeometry>();
  const cached = (k: string, f: () => THREE.BufferGeometry) => {
    let g = geoCache.get(k);
    if (!g) geoCache.set(k, (g = f()));
    return g;
  };

  // --- village houses along the main street (z ~ 30) and the north lane (x ~ 0) ---
  const street = VILLAGE.z;
  const houseAt = (x: number, z: number, ry: number, name = 'house') => {
    const w = 6 + Math.floor(R() * 3) * 1.5, d = 5 + Math.floor(R() * 2) * 1.5;
    const floors = R() < 0.3 ? 2 : 1;
    const roof = ROOFS[Math.floor(R() * ROOFS.length)];
    const key = `h${w}${d}${floors}${roof[0]}`;
    placed.push({ geo: cached(key, () => house(w, d, floors, roof, Math.floor(R() * 1e6))), x, z, ry, name, collide: [w / 2 + 0.7, d / 2 + 0.7] });
  };
  for (let x = -58; x <= 46; x += 11.5) {
    if (Math.abs(x) < 10) continue;
    houseAt(x + (R() - 0.5) * 2, street - 12.5, 0);
    houseAt(x + (R() - 0.5) * 2, street + 12.5, Math.PI);
  }
  for (let z = -2; z >= -30; z -= 11) {
    houseAt(-12.5, z, Math.PI / 2);
    houseAt(12.5, z, -Math.PI / 2);
  }
  // second row
  for (let x = -50; x <= 40; x += 15) {
    if (Math.abs(x) < 8) continue;
    houseAt(x + (R() - 0.5) * 3, street + 28, Math.PI);
  }
  // the noodle shop: the big two-storey house facing the square
  placed.push({ geo: house(10, 7, 2, [C.rustA, C.rustB], 9), x: -2, z: street - 22, ry: 0, name: 'noodle shop', collide: [5.7, 4.2] });

  // --- the Palace on the mountain ---
  const pz = PALACE_MOUNT.z, ph = PALACE_MOUNT.h;
  placed.push({ geo: palaceHall(22, 13), x: 0, z: pz - 6, ry: 0, y: ph, name: 'palace hall', collide: [13, 8.5] });
  placed.push({ geo: cached('side', () => house(9, 6, 1, [C.jadeA, C.jadeB], 5)), x: -15, z: pz + 6, ry: Math.PI / 2, y: ph, name: 'palace dojo', collide: [4.2, 5.2] });
  placed.push({ geo: cached('side2', () => house(9, 6, 1, [C.jadeA, C.jadeB], 6)), x: 15, z: pz + 6, ry: -Math.PI / 2, y: ph, name: 'palace library', collide: [4.2, 5.2] });
  placed.push({ geo: pagoda(5, 6), x: 14, z: pz - 17, ry: 0.3, y: ph, name: 'pagoda', collide: [4.4, 4.4] });
  // gates: top of the stairs, foot of the stairs, village entrance on the main street
  const g1 = gate(10, 5.2);
  placed.push({ geo: g1, x: STAIRS.x, z: STAIRS.z1 - 1.5, ry: 0, y: ph, name: 'palace gate' });
  placed.push({ geo: g1, x: STAIRS.x, z: STAIRS.z0 + 3, ry: 0, name: 'stairs gate' });
  placed.push({ geo: gate(9, 4.8), x: 52, z: street, ry: Math.PI / 2, name: 'east gate' });
  for (const gx of [-5, -5 / 3, 5 / 3, 5]) {
    addCircle(STAIRS.x + gx, STAIRS.z1 - 1.5, 0.4);
    if (Math.abs(gx) > 2) addCircle(STAIRS.x + gx, STAIRS.z0 + 3, 0.4);
  }
  for (const gz of [-4.5, 4.5]) addCircle(52, street + gz, 0.4);

  // a second pagoda on the peach hill side and a little shrine by the pond
  placed.push({ geo: pagoda(3, 4), x: PEACH_HILL.x + 22, z: PEACH_HILL.z - 26, ry: 0.6, name: 'hill pagoda', collide: [3.4, 3.4] });
  placed.push({ geo: cached('shrine', () => house(4, 3.5, 1, [C.jadeA, C.jadeB], 3)), x: POND.x - 26, z: POND.z, ry: Math.PI / 2, name: 'pond shrine', collide: [2.7, 2.5] });

  // arena
  placed.push({ geo: arena(), x: ARENA.x, z: ARENA.z, ry: 0, name: 'training arena' });
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    if (Math.abs(a - Math.PI * 1.5) < 0.25) continue;
    addCircle(ARENA.x + Math.cos(a) * ARENA.r, ARENA.z + Math.sin(a) * ARENA.r, 0.35);
  }

  // stairs (already in world coordinates)
  world.addGeometry(stairs());

  for (const p of placed) {
    // sit the building on the lowest corner so it never floats
    let y = p.y;
    if (y === undefined) {
      y = Infinity;
      for (const [dx, dz] of [[0, 0], [-3, -3], [3, -3], [3, 3], [-3, 3]]) y = Math.min(y, heightAt(p.x + dx, p.z + dz));
    }
    world.addGeometry(p.geo, p.x, y, p.z, p.ry);
    if (p.collide) {
      addBox(p.x, p.z, p.collide[0], p.collide[1], p.ry, y - 2, y + (p.name === 'palace hall' ? 20 : p.name?.includes('pagoda') ? 22 : 9));
      FOOTPRINTS.push({ x: p.x, z: p.z, hx: p.collide[0], hz: p.collide[1], ry: p.ry, name: p.name ?? 'building' });
    } else if (p.name) FOOTPRINTS.push({ x: p.x, z: p.z, hx: 5, hz: 1, ry: p.ry, name: p.name });
  }

  // bridges (oriented along x, across the river)
  const bg = bridge();
  for (const br of BRIDGES) world.addGeometry(bg, br.x, GROUND - 0.1, br.z, 0);

  // lantern strings across the main street and the north lane
  const ls = lanternString(18, 6), pg = pole(5.2);
  for (let x = -45; x <= 40; x += 17) {
    if (Math.abs(x) < 6) continue;
    world.addGeometry(ls, x, 5.0 + heightAt(x, street), street, Math.PI / 2);
    for (const s of [-1, 1]) {
      world.addGeometry(pg, x, heightAt(x, street + s * 9), street + s * 9);
      addCircle(x, street + s * 9, 0.3);
    }
  }
  const mesh = world.mesh(kitMaterial());
  mesh.name = 'buildings';
  group.add(mesh);
  return group;
}

/** walkable height including bridge decks */
export function bridgeDeckAt(x: number, z: number): number {
  for (const br of BRIDGES) {
    const lx = x - br.x, lz = z - br.z;
    if (Math.abs(lx) < BRIDGE.len / 2 && Math.abs(lz) < BRIDGE.w / 2) return GROUND - 0.1 + bridgeArch(lx);
  }
  return -Infinity;
}

/** true if (x, z) is on or right next to a building, a bridge, the stairs or a street: no trees there */
export function reserved(x: number, z: number) {
  for (const f of FOOTPRINTS) if (Math.abs(x - f.x) < Math.max(f.hx, f.hz) + 2.5 && Math.abs(z - f.z) < Math.max(f.hx, f.hz) + 2.5) return true;
  for (const br of BRIDGES) if (Math.abs(x - br.x) < BRIDGE.len / 2 + 3 && Math.abs(z - br.z) < 5) return true;
  if (Math.abs(x - VILLAGE.x) < 60 && Math.abs(z - VILLAGE.z) < 6) return true;
  if (Math.abs(x - riverX(z)) < 2) return true;
  for (const p of Object.values(SPOTS)) if (Math.hypot(x - p.x, z - p.z) < 6) return true;
  for (const [px, pz] of [...FRUIT_TREES, ...SHOOTS, ...MUSHROOM_ROCKS]) if (Math.hypot(x - px, z - pz) < 3.5) return true;
  return false;
}
