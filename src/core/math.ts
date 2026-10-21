// Small deterministic math helpers shared by the world generator and the simulation.
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));
/** shortest signed angle from a to b */
export const angleDelta = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const dampAngle = (a: number, b: number, lambda: number, dt: number) =>
  a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));

/** mulberry32 seeded RNG */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rng = ReturnType<typeof rng>;

const perlin = new ImprovedNoise();
/** 2D noise in [-1, 1] (Perlin, fixed permutation: deterministic) */
export const noise2 = (x: number, y: number, seed = 0) => perlin.noise(x, y, seed * 17.13 + 0.5);
/** fractal noise, roughly [-1, 1] */
export function fbm(x: number, y: number, octaves = 4, seed = 0) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * noise2(x * f, y * f, seed + i);
    norm += a;
    a *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** distance from point to segment, plus the segment parameter */
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return { d: Math.hypot(x, z), t };
}
export function polyDist(px: number, pz: number, pts: [number, number][]) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const { d } = segDist(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}
