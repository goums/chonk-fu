// Heightfield terrain: an analytic height function sampled on a 2 m grid. The same grid (and the same
// triangulation) is used for rendering and for collision, so feet never float or sink.
import * as THREE from 'three';
import { clamp, fbm, lerp, polyDist, smoothstep } from '../core/math';
import {
  ARENA, BAMBOO_FOREST, GROUND, PALACE_MOUNT, PATHS, PEACH_HILL, PILLARS, POND, RIVER_HALF_WIDTH, STAIRS, VILLAGE,
  WATER_LEVEL, WORLD_SIZE, riverX,
} from './layout';

export const CELL = 2;
export const N = WORLD_SIZE / CELL; // cells per side
const HALF = WORLD_SIZE / 2;

const dome = (d: number, r: number) => {
  const p = clamp(1 - d / r, 0, 1);
  return 1 - (1 - p) ** 3; // steep base, rounded top: karst pillar profile
};

/** distance-to-path factor: 1 on a path, 0 away from it */
export function pathFactor(x: number, z: number) {
  let d = Infinity;
  for (const p of PATHS) d = Math.min(d, polyDist(x, z, p));
  return smoothstep(3.2, 1.6, d + fbm(x * 0.15, z * 0.15, 2, 9) * 0.8);
}

/** the stair ramp height at z (straight line from the valley floor to the plateau) */
export const stairHeight = (z: number) =>
  lerp(GROUND, PALACE_MOUNT.h, clamp((STAIRS.z0 - z) / (STAIRS.z0 - STAIRS.z1), 0, 1));

function rawHeight(x: number, z: number): number {
  let h = GROUND + fbm(x * 0.008, z * 0.008, 4, 1) * 4 + fbm(x * 0.04, z * 0.04, 2, 2) * 0.6;

  // flatten the village, the arena and the pond surroundings
  const flat = (cx: number, cz: number, r: number, to: number) => {
    const d = Math.hypot(x - cx, z - cz);
    h = lerp(h, to, smoothstep(r, r * 0.6, d));
  };
  flat(VILLAGE.x, VILLAGE.z, VILLAGE.r, GROUND);
  flat(ARENA.x, ARENA.z, ARENA.r + 12, GROUND);

  // gentle hills in the bamboo forest
  if (x > BAMBOO_FOREST.x0 - 10) h += smoothstep(BAMBOO_FOREST.x0 - 10, BAMBOO_FOREST.x0 + 30, x) * (fbm(x * 0.02, z * 0.02, 3, 3) * 6 + 3);

  // peach hill (smooth dome)
  {
    const d = Math.hypot(x - PEACH_HILL.x, z - PEACH_HILL.z);
    if (d < PEACH_HILL.r) h += PEACH_HILL.h * (0.5 + 0.5 * Math.cos((Math.PI * d) / PEACH_HILL.r));
  }

  // the ring of mountains around the valley
  const r = Math.hypot(x, z);
  h += smoothstep(185, 270, r) * (45 + 35 * fbm(x * 0.012, z * 0.012, 4, 4));

  // karst pillars
  for (const [px, pz, pr, ph] of PILLARS) {
    const d = Math.hypot(x - px, z - pz);
    if (d < pr) h = Math.max(h, GROUND + ph * dome(d, pr) + fbm(x * 0.1, z * 0.1, 2, 5) * 2 * (1 - d / pr));
  }

  // palace mountain with its flat top
  {
    const d = Math.hypot(x - PALACE_MOUNT.x, z - PALACE_MOUNT.z);
    if (d < PALACE_MOUNT.r) {
      const p = clamp(1 - (d - PALACE_MOUNT.plateau) / (PALACE_MOUNT.r - PALACE_MOUNT.plateau), 0, 1);
      const m = PALACE_MOUNT.h * (1 - (1 - p) ** 2.4) + (p < 1 ? fbm(x * 0.05, z * 0.05, 3, 6) * 3 * (1 - p) * p * 4 : 0);
      h = Math.max(h, m);
    }
  }

  // the Thousand Steps: exact ramp in the corridor, an embankment / cutting on the sides
  if (z < STAIRS.z0 + 4 && z > STAIRS.z1 - 6) {
    const ramp = stairHeight(z);
    const ax = Math.abs(x - STAIRS.x);
    if (ax < STAIRS.halfWidth + 0.5) h = ramp;
    else {
      const s = (ax - STAIRS.halfWidth - 0.5) * 1.1;
      h = clamp(h, ramp - s, ramp + s);
    }
  }

  // the river carves its bed (deeper through the mountains)
  {
    const dr = Math.abs(x - riverX(z));
    const bed = WATER_LEVEL - 2.2;
    h = lerp(h, Math.min(h, bed), smoothstep(RIVER_HALF_WIDTH + 7, RIVER_HALF_WIDTH - 1, dr));
  }

  // the pond
  {
    const d = Math.hypot(x - POND.x, z - POND.z);
    h = lerp(h, Math.min(h, WATER_LEVEL - 1.8), smoothstep(POND.r + 6, POND.r - 4, d));
  }

  // paths are slightly sunk and smoothed
  const pf = pathFactor(x, z);
  if (pf > 0 && h > WATER_LEVEL + 0.5) h -= pf * 0.12;
  return h;
}

/** (N+1)^2 heights */
export const heights = new Float32Array((N + 1) * (N + 1));
for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) heights[j * (N + 1) + i] = rawHeight(i * CELL - HALF, j * CELL - HALF);

const H = (i: number, j: number) => heights[clamp(j, 0, N) * (N + 1) + clamp(i, 0, N)];

/** exact height of the rendered terrain at (x, z) */
export function heightAt(x: number, z: number): number {
  const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
  const i = Math.floor(fx), j = Math.floor(fz);
  const u = fx - i, v = fz - j;
  // each cell is split along the a-c diagonal (see buildTerrain): triangles (a,b,c) and (a,c,d)
  const a = H(i, j), b = H(i, j + 1), c = H(i + 1, j + 1), d = H(i + 1, j);
  if (v >= u) return a + (b - a) * v + (c - b) * u; // triangle a(0,0) b(0,1) c(1,1)
  return a + (d - a) * u + (c - d) * v; // triangle a(0,0) d(1,0) c(1,1)
}

export function normalAt(x: number, z: number, out = new THREE.Vector3()) {
  const e = CELL;
  return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
}

const C = (hex: number) => new THREE.Color(hex);
const PAL = {
  grassA: C(0x7fb04a), grassB: C(0xa8c45a), grassDark: C(0x4f8a3c), meadow: C(0xc6cf6a),
  dirt: C(0xc9a36a), dirtDark: C(0xa57e4f), sand: C(0xe0cf9a), rock: C(0x9a8c7a), rockDark: C(0x6f6658),
  moss: C(0x5f9a48), bed: C(0x7b8a6a), plateau: C(0xd8c49a),
};

export function buildTerrain(): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  const V = (N + 1) * (N + 1);
  const pos = new Float32Array(V * 3), col = new Float32Array(V * 3);
  const tmp = new THREE.Color(), nrm = new THREE.Vector3();
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i, x = i * CELL - HALF, z = j * CELL - HALF, h = heights[k];
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      normalAt(x, z, nrm);
      const n1 = fbm(x * 0.03, z * 0.03, 3, 11) * 0.5 + 0.5, n2 = fbm(x * 0.2, z * 0.2, 2, 12) * 0.5 + 0.5;
      tmp.copy(PAL.grassA).lerp(PAL.grassB, n1).lerp(PAL.grassDark, smoothstep(0.55, 0.85, n2) * 0.5);
      // meadow flowers / lighter grass in the village fields
      tmp.lerp(PAL.meadow, smoothstep(0.6, 0.9, n1) * 0.4);
      // high ground is mossier (cliff rock itself is painted by the shader, per pixel)
      if (h > 30) tmp.lerp(PAL.moss, smoothstep(30, 70, h) * 0.5);
      // river banks and beds
      if (h < WATER_LEVEL + 0.9) tmp.lerp(PAL.sand, smoothstep(WATER_LEVEL + 0.9, WATER_LEVEL + 0.2, h));
      if (h < WATER_LEVEL - 0.2) tmp.copy(PAL.bed);
      // paths
      const pf = pathFactor(x, z);
      if (pf > 0) tmp.lerp(n2 > 0.55 ? PAL.dirtDark : PAL.dirt, pf);
      // stone courtyard on the palace plateau and the arena
      const dp = Math.hypot(x - PALACE_MOUNT.x, z - PALACE_MOUNT.z);
      if (dp < PALACE_MOUNT.plateau - 1 && h > PALACE_MOUNT.h - 1) tmp.copy(PAL.plateau).lerp(PAL.dirt, n2 * 0.3);
      if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r) tmp.copy(PAL.dirt).lerp(PAL.sand, n2 * 0.5);
      col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
    }
  const idx = new Uint32Array(N * N * 6);
  let o = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = (j + 1) * (N + 1) + i, c = (j + 1) * (N + 1) + i + 1, d = j * (N + 1) + i + 1;
      idx[o++] = a; idx[o++] = b; idx[o++] = c;
      idx[o++] = a; idx[o++] = c; idx[o++] = d;
    }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNrm;
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
        }`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 wn = normalize(vWNrm);
        float n1 = vnoise(vWPos.xz * 0.9), n2 = vnoise(vWPos.xz * 0.23 + 7.0), n3 = vnoise(vWPos.xz * 3.1);
        // grass detail: soft mottling plus fine blades
        diffuseColor.rgb *= 0.9 + 0.12 * n2 + 0.08 * n1 + 0.05 * n3;
        // cliffs: layered karst rock where the slope is steep
        float steep = smoothstep(0.62, 0.42, wn.y);
        float strata = fract(vWPos.y * 0.22 + vnoise(vWPos.xz * 0.08 + vWPos.y * 0.05) * 1.6);
        vec3 rockA = vec3(0.60, 0.55, 0.47), rockB = vec3(0.45, 0.42, 0.37), rockC = vec3(0.70, 0.66, 0.58);
        vec3 rock = mix(rockA, rockB, smoothstep(0.55, 0.75, strata));
        rock = mix(rock, rockC, smoothstep(0.92, 0.98, strata) * 0.8);
        rock *= 0.85 + 0.25 * n1;
        // moss clings to the ledges
        rock = mix(rock, vec3(0.38, 0.55, 0.3), smoothstep(0.55, 0.85, n2) * smoothstep(0.3, 0.55, wn.y) * 0.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, rock, steep);`,
      );
  };
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  m.name = 'terrain';
  return m;
}
