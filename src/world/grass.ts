// Grass tufts and wild flowers, instanced, swaying in the wind.
import * as THREE from 'three';
import { fbm, rng } from '../core/math';
import { BAMBOO_FOREST, WATER_LEVEL } from './layout';
import { heightAt, normalAt, pathFactor } from './terrain';
import { addOcclusionCutout } from './kit';
import { chunkedInstances } from './vegetation';

function tuftGeometry(blades: number, h: number, seed: number, base: THREE.Color, tip: THREE.Color) {
  const R = rng(seed);
  const pos: number[] = [], col: number[] = [];
  for (let i = 0; i < blades; i++) {
    const a = R() * Math.PI * 2, lean = 0.15 + R() * 0.35;
    const w = 0.05 + R() * 0.04, hh = h * (0.6 + R() * 0.6);
    const cx = Math.cos(a), sz = Math.sin(a);
    const ox = (R() - 0.5) * 0.25, oz = (R() - 0.5) * 0.25;
    // one triangle per blade, facing a random direction, tip leaning outward
    pos.push(ox - sz * w, 0, oz + cx * w, ox + sz * w, 0, oz - cx * w, ox + cx * lean * hh, hh, oz + sz * lean * hh);
    col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // grass is lit as if it pointed up: softer, no dark backfaces
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

function flowerGeometry(color: number, seed: number) {
  const R = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const c = new THREE.Color(color), stem = new THREE.Color(0x4f8a3c), heart = new THREE.Color(0xf7d24a);
  const paint = (g: THREE.BufferGeometry, col: THREE.Color) => {
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    g.deleteAttribute('uv');
    return g;
  };
  for (let i = 0; i < 3; i++) {
    const x = (R() - 0.5) * 0.4, z = (R() - 0.5) * 0.4, h = 0.25 + R() * 0.2;
    parts.push(paint(new THREE.CylinderGeometry(0.012, 0.012, h, 3).translate(x, h / 2, z).toNonIndexed(), stem));
    parts.push(paint(new THREE.IcosahedronGeometry(0.07, 0).scale(1, 0.5, 1).translate(x, h, z), c));
    parts.push(paint(new THREE.IcosahedronGeometry(0.03, 0).translate(x, h + 0.03, z), heart));
  }
  const pos: number[] = [], col: number[] = [], nrm: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    pos.push(...(g.attributes.position.array as Float32Array));
    col.push(...(g.attributes.color.array as Float32Array));
    nrm.push(...(g.attributes.normal.array as Float32Array));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

export function buildGrass(reserved: (x: number, z: number) => boolean) {
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    addOcclusionCutout(sh);
    sh.uniforms.uTime = uniforms.uTime;
    // both faces of a blade are lit like its front
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sway = sin(uTime * 1.8 + ip.x * 0.15 + ip.z * 0.11) * 0.5 + sin(uTime * 3.1 + ip.x * 0.4) * 0.2;
        transformed.x += sway * 0.12 * position.y;
        transformed.z += sway * 0.06 * position.y;`,
      );
  };
  const group = new THREE.Group();
  group.name = 'grass';
  const R = rng(99);
  const tufts = [
    tuftGeometry(12, 0.4, 1, new THREE.Color(0x6f9f42), new THREE.Color(0xb8d868)),
    tuftGeometry(14, 0.32, 2, new THREE.Color(0x76a845), new THREE.Color(0xcfe07a)),
    tuftGeometry(10, 0.55, 3, new THREE.Color(0x689a3e), new THREE.Color(0xa6cc5c)),
  ];
  const flowers = [flowerGeometry(0xf6a5c0, 4), flowerGeometry(0xffffff, 5), flowerGeometry(0xf7d24a, 6), flowerGeometry(0xe0603a, 7)];
  const lists: THREE.Matrix4[][] = [...tufts, ...flowers].map(() => []);
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let k = 0; k < 140000; k++) {
    const x = (R() - 0.5) * 420, z = (R() - 0.5) * 420;
    if (Math.hypot(x, z) > 205) continue;
    const h = heightAt(x, z);
    if (h < WATER_LEVEL + 0.4 || h > 30) continue;
    if (x > BAMBOO_FOREST.x0 && x < BAMBOO_FOREST.x1 && z > BAMBOO_FOREST.z0 && z < BAMBOO_FOREST.z1 && R() < 0.5) continue;
    if (pathFactor(x, z) > 0.3 || normalAt(x, z).y < 0.8 || reserved(x, z)) continue;
    const n = fbm(x * 0.05, z * 0.05, 2, 77);
    if (R() > 0.35 + n * 0.6) continue;
    const isFlower = n > 0.2 && R() < 0.25;
    const idx = isFlower ? 3 + Math.floor(R() * 4) : Math.floor(R() * 3);
    q.setFromAxisAngle(up, R() * Math.PI * 2);
    s.setScalar(0.8 + R() * 0.6);
    lists[idx].push(new THREE.Matrix4().compose(p.set(x, h - 0.05, z), q, s));
  }
  chunkedInstances([...tufts, ...flowers], lists, mat, group, false, 60);
  return { group, update: (t: number) => (uniforms.uTime.value = t) };
}
