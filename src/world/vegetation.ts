// Trees, bamboo and rocks: a few procedural variants per species, instanced across the valley.
import * as THREE from 'three';
import { fbm, rng, smoothstep, type Rng } from '../core/math';
import { addCircle } from '../game/colliders';
import { Batch, kitMaterial } from './kit';
import { ARENA, BAMBOO_FOREST, PALACE_MOUNT, PEACH_HILL, STAIRS, VILLAGE, WATER_LEVEL, riverX, RIVER_HALF_WIDTH } from './layout';
import { heightAt, normalAt, pathFactor } from './terrain';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** an organic blob: icosahedron with its vertices pushed by smooth noise (stays watertight) */
function blob(r: number, seed: number, detail = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.22 * fbm(x * 1.3 + seed, z * 1.3 + y * 0.7, 2, seed);
    p.setXYZ(i, x * k, y * k * 0.85, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** a bent trunk made of tapered cylinder segments; returns the tip */
function trunk(b: Batch, R: Rng, h: number, r0: number, color: number, lean = 0.25, segs = 4) {
  let x = 0, y = 0, z = 0, r = r0;
  let ax = (R() - 0.5) * lean, az = (R() - 0.5) * lean;
  const seg = h / segs;
  for (let i = 0; i < segs; i++) {
    const r1 = r * 0.78;
    const dx = Math.sin(ax) * seg, dz = Math.sin(az) * seg, dy = seg * Math.cos(Math.hypot(ax, az));
    const len = Math.hypot(dx, dy, dz);
    const c = new THREE.CylinderGeometry(r1, r, len, 7);
    const dir = V(dx, dy, dz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    b.add(c, color, x + dx / 2, y + dy / 2, z + dz / 2, e.y, 1, 1, 1, e.x, e.z);
    x += dx; y += dy; z += dz; r = r1;
    ax += (R() - 0.5) * lean; az += (R() - 0.5) * lean;
  }
  return V(x, y, z);
}

function peachTree(seed: number) {
  const R = rng(seed), b = new Batch();
  const top = trunk(b, R, 2.6 + R() * 1.2, 0.28, 0x6b4a3a, 0.5, 3);
  const pinks = [0xf6a5c0, 0xfbc4d6, 0xee8fb0, 0xffd6e2];
  const n = 6 + Math.floor(R() * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + R(), d = 0.8 + R() * 1.1;
    const s = 0.9 + R() * 0.8;
    b.add(blob(s, seed + i), pinks[i % pinks.length], top.x + Math.cos(a) * d, top.y + R() * 1.2 - 0.2, top.z + Math.sin(a) * d);
  }
  b.add(blob(1.4, seed + 99), pinks[1], top.x, top.y + 1.0, top.z);
  return b.geometry();
}

function roundTree(seed: number) {
  const R = rng(seed), b = new Batch();
  const top = trunk(b, R, 2.2 + R() * 1.5, 0.3, 0x6e4f3a, 0.3, 3);
  const greens = [0x6ea84a, 0x5c9a3e, 0x86b955, 0x4f8a3c];
  const n = 4 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + R(), d = 0.6 + R() * 0.9;
    b.add(blob(1.1 + R() * 0.7, seed + i), greens[i % greens.length], top.x + Math.cos(a) * d, top.y + R() * 1.4, top.z + Math.sin(a) * d);
  }
  b.add(blob(1.6, seed + 50), greens[0], top.x, top.y + 1.3, top.z);
  return b.geometry();
}

/** the Chinese-painting pine: twisted trunk and flat cloud-like needle pads */
function pine(seed: number) {
  const R = rng(seed), b = new Batch();
  const h = 4 + R() * 3;
  const top = trunk(b, R, h, 0.3, 0x5b4636, 0.7, 4);
  const greens = [0x2f6b45, 0x3d7d4f, 0x285c3b];
  const pads = 3 + Math.floor(R() * 3);
  for (let i = 0; i < pads; i++) {
    const t = 0.45 + (i / pads) * 0.6;
    const a = R() * Math.PI * 2, d = 0.6 + R() * 1.4;
    const s = 1.3 + R() * 0.9;
    b.add(blob(1, seed + i * 7, 1), greens[i % 3], top.x * t + Math.cos(a) * d, h * t + 0.3, top.z * t + Math.sin(a) * d, R() * 3, s * 1.5, s * 0.45, s * 1.5);
  }
  b.add(blob(1, seed + 77, 1), greens[0], top.x, top.y + 0.2, top.z, 0, 2.2, 0.55, 2.2);
  return b.geometry();
}

function bambooCluster(seed: number) {
  const R = rng(seed), b = new Batch();
  const n = 7 + Math.floor(R() * 6);
  const stalk = [0x8fbf4a, 0x7aad3c, 0x9ccc5a];
  const leaf = [0x5d9a3a, 0x6fae44, 0x4c8a32];
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, d = R() * 1.3;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = 7 + R() * 5, r = 0.07 + R() * 0.04;
    const lx = (R() - 0.5) * 0.12, lz = (R() - 0.5) * 0.12;
    // one leaning stalk with a few darker node rings
    b.add(new THREE.CylinderGeometry(r, r * 1.1, h, 5, 1, true), stalk[i % 3], x + (lx * h) / 2, h / 2, z + (lz * h) / 2, 0, 1, 1, 1, lz, -lx);
    for (let k = 1; k < 4; k++) {
      const y = (h * k) / 4;
      b.add(new THREE.CylinderGeometry(r * 1.3, r * 1.3, 0.07, 5, 1, true), 0x5f8a30, x + lx * y, y, z + lz * y);
    }
    // leaf tufts on the upper half
    for (let k = 0; k < 3; k++) {
      const y = h * (0.6 + k * 0.15);
      const la = R() * Math.PI * 2;
      b.add(blob(0.6 + R() * 0.3, seed + i * 13 + k, 0), leaf[k % 3], x + lx * y + Math.cos(la) * 0.5, y, z + lz * y + Math.sin(la) * 0.5, la, 1.7, 0.4, 1.0);
    }
  }
  return b.geometry();
}

function rock(seed: number) {
  const b = new Batch();
  b.add(blob(1, seed, 1), seed % 2 ? 0x9a9184 : 0x8a8274, 0, 0.3, 0, 0, 1.3, 0.8, 1.1);
  return b.geometry();
}

interface Placement { x: number; z: number; ry: number; s: number }

/** instanced meshes split into map chunks so the camera and the shadow pass can cull them */
export function chunkedInstances(geos: THREE.BufferGeometry[], lists: THREE.Matrix4[][], material: THREE.Material, group: THREE.Group, shadows: boolean, chunk = 80) {
  geos.forEach((g, vi) => {
    const byChunk = new Map<string, THREE.Matrix4[]>();
    const p = new THREE.Vector3();
    for (const m of lists[vi]) {
      p.setFromMatrixPosition(m);
      const k = `${Math.floor(p.x / chunk)},${Math.floor(p.z / chunk)}`;
      let l = byChunk.get(k);
      if (!l) byChunk.set(k, (l = []));
      l.push(m);
    }
    for (const L of byChunk.values()) {
      const im = new THREE.InstancedMesh(g, material, L.length);
      L.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = shadows;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  });
}

function instanced(geos: THREE.BufferGeometry[], list: Placement[][], group: THREE.Group) {
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const lists = list.map((L) =>
    L.map((pl) => {
      p.set(pl.x, heightAt(pl.x, pl.z) - 0.15, pl.z);
      q.setFromAxisAngle(V(0, 1, 0), pl.ry);
      sc.setScalar(pl.s);
      return new THREE.Matrix4().compose(p, q, sc);
    }),
  );
  chunkedInstances(geos, lists, kitMaterial(), group, true);
}

/** can a tree grow here? */
function freeSpot(x: number, z: number, margin = 1) {
  const h = heightAt(x, z);
  if (h < WATER_LEVEL + 0.6) return false;
  if (Math.abs(x - riverX(z)) < RIVER_HALF_WIDTH + 3) return false;
  if (pathFactor(x, z) > 0.05) return false;
  if (Math.abs(x - STAIRS.x) < STAIRS.halfWidth + 3 * margin && z < STAIRS.z0 + 3 && z > STAIRS.z1 - 3) return false;
  if (Math.hypot(x - PALACE_MOUNT.x, z - PALACE_MOUNT.z) < PALACE_MOUNT.plateau + 2) return false;
  if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + 6) return false;
  if (normalAt(x, z).y < 0.72) return false;
  return true;
}

export function buildVegetation(reserved: (x: number, z: number) => boolean) {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const R = rng(4242);
  const VAR = 3;
  const peach = Array.from({ length: VAR }, (_, i) => peachTree(100 + i));
  const round = Array.from({ length: VAR }, (_, i) => roundTree(200 + i));
  const pines = Array.from({ length: VAR }, (_, i) => pine(300 + i));
  const bamboo = Array.from({ length: VAR }, (_, i) => bambooCluster(400 + i));
  const rocks = Array.from({ length: VAR }, (_, i) => rock(500 + i));
  const P = { peach: [[], [], []], round: [[], [], []], pine: [[], [], []], bamboo: [[], [], []], rock: [[], [], []] } as Record<string, Placement[][]>;
  const put = (kind: string, x: number, z: number, s: number, collide: number) => {
    P[kind][Math.floor(R() * VAR)].push({ x, z, ry: R() * Math.PI * 2, s });
    if (collide > 0) addCircle(x, z, collide * s, -100, heightAt(x, z) + (kind === 'rock' ? 1.2 * s : 2.5), kind === 'rock' ? 'rock' : 'veg');
  };

  // the sacred peach tree on its hill: a giant
  P.peach[0].push({ x: PEACH_HILL.x, z: PEACH_HILL.z, ry: 0.4, s: 2.6 });
  addCircle(PEACH_HILL.x, PEACH_HILL.z, 0.9, -100, 1000, 'veg');

  for (let k = 0; k < 9000; k++) {
    const x = (R() - 0.5) * 520, z = (R() - 0.5) * 520;
    const r = Math.hypot(x, z);
    if (r > 262) continue;
    if (reserved(x, z) || !freeSpot(x, z)) continue;
    const h = heightAt(x, z);
    const n = fbm(x * 0.02, z * 0.02, 2, 31);
    const inBamboo = x > BAMBOO_FOREST.x0 && x < BAMBOO_FOREST.x1 && z > BAMBOO_FOREST.z0 && z < BAMBOO_FOREST.z1;
    const dv = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
    const dPeach = Math.hypot(x - PEACH_HILL.x, z - PEACH_HILL.z);
    if (inBamboo) {
      if (R() < 0.5 + n * 0.5) put('bamboo', x, z, 0.8 + R() * 0.5, 0.9);
      continue;
    }
    if (h > 14 || r > 175) {
      // mountains: pines, more on the higher slopes
      if (R() < 0.18 + smoothstep(14, 60, h) * 0.3) put('pine', x, z, 0.8 + R() * 0.7, 0.35);
      else if (R() < 0.04) put('rock', x, z, 0.8 + R() * 2.2, 1.1);
      continue;
    }
    if (dPeach < PEACH_HILL.r + 15 && dPeach > 8) {
      if (R() < 0.12) put('peach', x, z, 0.7 + R() * 0.5, 0.35);
      continue;
    }
    if (dv < VILLAGE.r + 5) {
      if (R() < 0.012) put(R() < 0.6 ? 'peach' : 'round', x, z, 0.7 + R() * 0.4, 0.35);
      continue;
    }
    // open valley: scattered groves
    const grove = smoothstep(0.05, 0.35, n);
    if (R() < 0.006 + grove * 0.05) put(R() < 0.35 ? 'peach' : 'round', x, z, 0.8 + R() * 0.6, 0.35);
    else if (R() < 0.006) put('rock', x, z, 0.5 + R() * 1.2, 0.9);
  }
  // rocks along the river banks
  for (let z = -240; z < 240; z += 9) {
    if (R() < 0.6) {
      const side = R() < 0.5 ? -1 : 1;
      const x = riverX(z) + side * (RIVER_HALF_WIDTH + 1 + R() * 3);
      if (!reserved(x, z)) put('rock', x, z, 0.5 + R() * 1.0, 0.9);
    }
  }
  instanced(peach, P.peach, group);
  instanced(round, P.round, group);
  instanced(pines, P.pine, group);
  instanced(bamboo, P.bamboo, group);
  instanced(rocks, P.rock, group);
  return group;
}
