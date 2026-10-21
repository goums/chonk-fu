// Things in the world Le Chonk interacts with: breakables (crates, barrels, vases, cracked boulders,
// mossy rocks, the bandits' chest), shakeable trees, and pickups (Jade Stones, food, ingredients).
// Every entity has a stable id and a name, so the HUD, the quests and the AI harness can refer to it.
import * as THREE from 'three';
import { fbm, rng } from '../core/math';
import { Batch, box, cyl, kitMaterial } from '../world/kit';
import { groundAt } from '../world/world';
import { addCircle, removeCollider, type Collider } from './colliders';
import { excludeFromAO, sparkles } from './highlight';
import { glowTexture, type ItemCue } from './itemIcons';

export type ItemKind = 'jade' | 'peach' | 'shoot' | 'mushroom' | 'dumpling';
export const ITEM_NAMES: Record<ItemKind, string> = {
  jade: 'Jade Stone', peach: 'Peach', shoot: 'Bamboo shoot', mushroom: 'Mushroom', dumpling: 'Dumpling',
};

export abstract class Entity {
  alive = true;
  obj = new THREE.Group();
  /** floating icon over things an active quest needs (set by the game) */
  cue?: ItemCue;
  constructor(public id: string, public name: string, public x: number, public z: number, public radius: number) {
    this.obj.position.set(x, groundAt(x, z), z);
  }
  get y() {
    return this.obj.position.y;
  }
  update(_dt: number, _t: number) {}
}

// ------------------------------------------------------------------ pickups
const itemGeo = new Map<ItemKind, () => THREE.Object3D>();
const phys = (c: number, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.45, ...extra });

itemGeo.set('jade', () => {
  const g = new THREE.Group();
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), phys(0x3fd88a, { roughness: 0.08, clearcoat: 1, emissive: 0x0d6b3a, emissiveIntensity: 1.2, flatShading: true }));
  gem.scale.set(1, 1.5, 1);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xbfffd8 }));
  g.add(gem, core);
  // a cloud-shaped golden setting
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.04, 8, 24), phys(0xe8b83a, { metalness: 0.8, roughness: 0.25 }));
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  return g;
});
itemGeo.set('peach', () => {
  const g = new THREE.Group();
  const p = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), phys(0xffa08a, { sheen: 1, sheenColor: new THREE.Color(0xffd0c0), roughness: 0.6 }));
  p.scale.set(1, 0.95, 1);
  const blush = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), phys(0xf06a6a, { roughness: 0.6 }));
  blush.position.set(0.08, 0.04, 0.1);
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), phys(0x5c9a3e));
  leaf.scale.set(1.6, 0.3, 0.8);
  leaf.position.set(0.08, 0.22, 0);
  g.add(p, blush, leaf);
  return g;
});
itemGeo.set('shoot', () => {
  const g = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.16 - k * 0.03, 0.22, 10), phys(k % 2 ? 0xc9c46a : 0xa8b84e));
    c.position.y = 0.1 + k * 0.12;
    g.add(c);
  }
  return g;
});
itemGeo.set('mushroom', () => {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 10), phys(0xf2e8d2));
  stem.position.y = 0.1;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), phys(0xd2452e));
  cap.position.y = 0.18;
  cap.scale.set(1, 0.7, 1);
  g.add(stem, cap);
  for (let k = 0; k < 5; k++) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), phys(0xffffff));
    const a = k * 1.3;
    dot.position.set(Math.cos(a) * 0.1, 0.27, Math.sin(a) * 0.1);
    g.add(dot);
  }
  return g;
});
itemGeo.set('dumpling', () => {
  const g = new THREE.Group();
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), phys(0xfff6e6, { roughness: 0.7, sheen: 0.6 }));
  bun.scale.set(1, 0.75, 1);
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.12, 8), bun.material);
  top.position.y = 0.19;
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.14, 16), phys(0xc9a36a, { roughness: 0.8 }));
  basket.position.y = -0.17;
  g.add(bun, top, basket);
  return g;
});

export class Pickup extends Entity {
  private model: THREE.Object3D;
  private beam?: THREE.Mesh;
  private glow?: THREE.Sprite;
  t0: number;
  /** pop-out animation when spawned from something broken */
  private pop = 0;
  constructor(id: string, public item: ItemKind, x: number, z: number, y?: number) {
    super(id, ITEM_NAMES[item], x, z, 1.3);
    if (y !== undefined) this.obj.position.y = y;
    this.model = itemGeo.get(item)!();
    this.model.traverse((o) => (o.castShadow = true));
    this.model.position.y = 0.6;
    this.obj.add(this.model);
    if (item === 'jade') {
      this.beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.7, 30, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x6bffa8, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending }),
      );
      this.beam.position.y = 15;
      this.beam.userData.fx = true; // not part of the highlight rim
      excludeFromAO(this.beam);
      this.obj.add(this.beam);
      const light = new THREE.PointLight(0x6bffa8, 6, 8, 2);
      light.position.y = 1;
      this.obj.add(light);
    }
    // noodle ingredients: a warm glow around the item and a short golden light column, easy to spot
    // between the bamboo stalks
    const ingredient = item === 'peach' || item === 'shoot' || item === 'mushroom';
    if (ingredient) {
      this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc85a, transparent: true, opacity: 0.6, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
      this.glow.scale.setScalar(1.9);
      this.glow.position.y = 0.6;
      this.glow.renderOrder = 4;
      this.beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.35, 7, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending }),
      );
      this.beam.position.y = 3.5;
      this.beam.userData.fx = true;
      this.obj.add(excludeFromAO(this.glow), excludeFromAO(this.beam));
    }
    // twinkling motes rising around it: "pick me up"
    let seed = 0;
    for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) % 100000;
    this.obj.add(item === 'jade' ? sparkles(0x7dffb8, 14, 0.75, seed, 0.06, 1.8) : ingredient ? sparkles(0xffe08a, 14, 0.7, seed, 0.06, 1.8) : sparkles(0xffe7a0, 8, 0.55, seed, 0.045, 1.2));
    this.t0 = (seed % 600) / 100;
  }
  spawnPop() {
    this.pop = 1;
  }
  update(dt: number, t: number) {
    this.model.rotation.y += dt * (this.item === 'jade' ? 1.6 : 1.0);
    let y = 0.55 + Math.sin((t + this.t0) * 2.4) * 0.12;
    if (this.pop > 0) {
      this.pop = Math.max(0, this.pop - dt * 1.6);
      y += Math.sin((1 - this.pop) * Math.PI) * 1.6;
    }
    this.model.position.y = y;
    if (this.beam) (this.beam.material as THREE.MeshBasicMaterial).opacity = (this.item === 'jade' ? 0.14 : 0.17) + Math.sin(t * 3 + this.t0) * 0.05;
    if (this.glow) {
      this.glow.position.y = y + 0.1;
      this.glow.material.opacity = 0.5 + Math.sin(t * 3.4 + this.t0) * 0.15;
    }
  }
}

// ------------------------------------------------------------------ breakables
export type BreakKind = 'crate' | 'barrel' | 'vase' | 'boulder' | 'rock' | 'chest';
interface BreakSpec { hp: number; needsBelly: boolean; colors: number[]; radius: number; name: string; height: number }
const BREAK: Record<BreakKind, BreakSpec> = {
  crate: { hp: 1, needsBelly: false, colors: [0xa8743e, 0x8a5a2e, 0xc08a50], radius: 0.6, name: 'Crate', height: 1.1 },
  barrel: { hp: 2, needsBelly: false, colors: [0x8a5a3a, 0x5a3a26, 0x9a9a9a], radius: 0.55, name: 'Barrel', height: 1.2 },
  vase: { hp: 1, needsBelly: false, colors: [0xf4f1ea, 0x2f5fa8, 0xe8b83a], radius: 0.5, name: 'Vase', height: 1.3 },
  boulder: { hp: 1, needsBelly: true, colors: [0x8f8676, 0x7a7262, 0xa59c8a], radius: 1.6, name: 'Cracked boulder', height: 2.6 },
  rock: { hp: 2, needsBelly: false, colors: [0x7f8a6a, 0x6a7458, 0x8a9a6a], radius: 0.8, name: 'Mossy rock', height: 1.0 },
  chest: { hp: 3, needsBelly: false, colors: [0xa8322a, 0xe8b83a, 0x5a3324], radius: 0.8, name: 'Bandit chest', height: 1.0 },
};

function breakModel(kind: BreakKind, seed: number): THREE.Object3D {
  const b = new Batch();
  const R = rng(seed);
  switch (kind) {
    case 'crate':
      b.add(box(1, 1, 1), 0xb07a44, 0, 0.5, 0);
      for (const y of [0.1, 0.9]) for (const s of [-1, 1]) {
        b.add(box(1.04, 0.12, 0.12), 0x7a4e26, 0, y, s * 0.47);
        b.add(box(0.12, 0.12, 1.04), 0x7a4e26, s * 0.47, y, 0);
      }
      b.add(box(1.04, 0.1, 0.1), 0x7a4e26, 0, 0.5, 0.5, 0, 1, 1, 1, 0, 0.78);
      break;
    case 'barrel':
      b.add(cyl(0.45, 0.45, 1.1, 16), 0x8a5a3a, 0, 0.55, 0);
      b.add(cyl(0.5, 0.5, 0.5, 16), 0x9a6a46, 0, 0.55, 0);
      for (const y of [0.15, 0.95]) b.add(cyl(0.47, 0.47, 0.06, 16), 0x6a6a72, 0, y, 0);
      break;
    case 'vase': {
      const pts = [[0, 0], [0.22, 0], [0.38, 0.25], [0.42, 0.55], [0.3, 0.9], [0.16, 1.05], [0.2, 1.25], [0, 1.25]].map(([r, y]) => new THREE.Vector2(r, y));
      const lathe = new THREE.LatheGeometry(new THREE.SplineCurve(pts).getPoints(20), 20);
      const n = lathe.attributes.position.count, col = new Float32Array(n * 3);
      const white = new THREE.Color(0xf4f1ea), blue = new THREE.Color(0x2f5fa8), c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const x = lathe.attributes.position.getX(i), y = lathe.attributes.position.getY(i), z = lathe.attributes.position.getZ(i);
        const a = Math.atan2(x, z);
        // blue-and-white porcelain: bands and a wavy cloud pattern
        const band = Math.abs(y - 0.25) < 0.05 || Math.abs(y - 0.95) < 0.04;
        const cloud = Math.sin(a * 5 + Math.sin(y * 12) * 1.5) > 0.6 && y > 0.35 && y < 0.85;
        c.copy(band || cloud ? blue : white);
        c.toArray(col, i * 3);
      }
      lathe.setAttribute('color', new THREE.BufferAttribute(col, 3));
      b.add(lathe, null, 0, 0, 0);
      break;
    }
    case 'boulder': {
      const g = new THREE.IcosahedronGeometry(1.6, 3);
      const p = g.attributes.position;
      const col = new Float32Array(p.count * 3), c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 1 + 0.15 * fbm(x * 0.9 + seed, z * 0.9 + y, 3, seed);
        p.setXYZ(i, x * k, Math.max(-0.5, y * k * 0.85), z * k);
        // a big glowing crack hints that something is inside
        const crack = Math.abs(x * 0.8 + Math.sin(y * 4) * 0.25) < 0.09 && z > 0;
        c.set(crack ? 0x3fd88a : fbm(x * 2, y * 2 + z, 2, 3) > 0.1 ? 0x8f8676 : 0x7a7262);
        c.toArray(col, i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      b.add(g, null, 0, 1.0, 0);
      break;
    }
    case 'rock': {
      const g = new THREE.IcosahedronGeometry(0.75, 2);
      const p = g.attributes.position;
      const col = new Float32Array(p.count * 3), c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 1 + 0.2 * fbm(x * 1.5 + seed, z * 1.5 + y, 2, seed);
        p.setXYZ(i, x * k, Math.max(-0.2, y * k * 0.7), z * k);
        c.set(y > 0.25 ? 0x6f9a48 : 0x8a8a7a);
        c.toArray(col, i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      b.add(g, null, 0, 0.35, 0, R() * 3);
      break;
    }
    case 'chest':
      b.add(box(1.3, 0.75, 0.85), 0xa8322a, 0, 0.38, 0);
      b.add(new THREE.CylinderGeometry(0.43, 0.43, 1.3, 16, 1, false, 0, Math.PI), 0xa8322a, 0, 0.75, 0, 0, 1, 1, 1, 0, Math.PI / 2);
      for (const x of [-0.5, 0, 0.5]) b.add(box(0.1, 0.8, 0.9), 0xe8b83a, x, 0.42, 0);
      b.add(box(0.25, 0.3, 0.1), 0xe8b83a, 0, 0.62, 0.45);
      break;
  }
  const m = b.mesh(kitMaterial());
  m.castShadow = true;
  return m;
}

export class Breakable extends Entity {
  spec: BreakSpec;
  hp: number;
  private model: THREE.Object3D;
  private shake = 0;
  private collider: Collider;
  /** locked until something happens (the chest opens when its guards are gone) */
  locked = false;
  constructor(id: string, public kind: BreakKind, x: number, z: number, public contents: ItemKind | null, ry = 0, seed = 1) {
    const spec = BREAK[kind];
    super(id, spec.name, x, z, spec.radius);
    this.spec = spec;
    this.hp = spec.hp;
    this.model = breakModel(kind, seed);
    this.model.rotation.y = ry;
    this.obj.add(this.model);
    this.collider = addCircle(x, z, spec.radius * 0.9, -100, this.obj.position.y + spec.height);
  }
  /** returns 'broken', 'hit', 'immune' (needs the belly bump) or 'locked' */
  hit(move: string): 'broken' | 'hit' | 'immune' | 'locked' {
    if (!this.alive) return 'immune';
    if (this.locked) {
      this.shake = 0.3;
      return 'locked';
    }
    if (this.spec.needsBelly && move !== 'belly' && move !== 'slam') {
      this.shake = 0.25;
      return 'immune';
    }
    this.hp -= move === 'belly' || move === 'slam' || move === 'kick' ? 2 : 1;
    this.shake = 0.3;
    if (this.hp > 0) return 'hit';
    this.alive = false;
    this.obj.visible = false;
    removeCollider(this.collider);
    return 'broken';
  }
  update(dt: number) {
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      this.model.position.x = Math.sin(this.shake * 80) * this.shake * 0.25;
    }
  }
}

// ------------------------------------------------------------------ shakeable trees
export class FruitTree extends Entity {
  private model: THREE.Object3D;
  private wobble = 0;
  hitsLeft: number;
  constructor(id: string, name: string, x: number, z: number, public drops: ItemKind, hits: number, scale: number, seed: number) {
    super(id, name, x, z, 0.8 * scale);
    this.hitsLeft = hits;
    this.model = treeModel(seed, scale, drops === 'jade');
    this.obj.add(this.model);
    addCircle(x, z, 0.55 * scale, -100, this.obj.position.y + 3 * scale);
  }
  /** returns true when it drops its fruit */
  hit(): boolean {
    this.wobble = 0.8;
    if (this.hitsLeft <= 0) return false;
    this.hitsLeft--;
    return this.hitsLeft === 0;
  }
  update(dt: number, t: number) {
    this.wobble = Math.max(0, this.wobble - dt);
    const w = Math.sin(this.wobble * 30) * this.wobble * 0.08;
    this.model.rotation.z = w + Math.sin(t * 0.8 + this.x) * 0.01;
    this.model.rotation.x = w * 0.5;
  }
}

function treeModel(seed: number, scale: number, old: boolean) {
  const R = rng(seed);
  const b = new Batch();
  // a gnarled trunk
  let x = 0, y = 0, z = 0, r = old ? 0.55 : 0.28;
  for (let i = 0; i < 4; i++) {
    const dx = (R() - 0.5) * 0.7, dz = (R() - 0.5) * 0.7, dy = 0.9;
    const len = Math.hypot(dx, dy, dz);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    b.add(new THREE.CylinderGeometry(r * 0.8, r, len, 9), old ? 0x5a4234 : 0x6b4a3a, x + dx / 2, y + dy / 2, z + dz / 2, e.y, 1, 1, 1, e.x, e.z);
    x += dx; y += dy; z += dz; r *= 0.8;
  }
  const pinks = old ? [0xe98aa9, 0xf6a5c0, 0xd97898] : [0xf6a5c0, 0xfbc4d6, 0xee8fb0];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, d = 0.9 + R() * 0.9;
    const g = new THREE.IcosahedronGeometry(0.9 + R() * 0.6, 2);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const vx = p.getX(k), vy = p.getY(k), vz = p.getZ(k);
      const f = 1 + 0.18 * fbm(vx * 1.4 + seed + i, vz * 1.4 + vy, 2, seed);
      p.setXYZ(k, vx * f, vy * f * 0.85, vz * f);
    }
    g.computeVertexNormals();
    b.add(g, pinks[i % 3], x + Math.cos(a) * d, y + R() * 1.0, z + Math.sin(a) * d);
  }
  // peaches hanging in the canopy
  for (let i = 0; i < 6; i++) {
    const a = R() * Math.PI * 2;
    b.add(new THREE.SphereGeometry(0.16, 10, 8), 0xffa08a, x + Math.cos(a) * 1.5, y - 0.6, z + Math.sin(a) * 1.5);
  }
  const m = b.mesh(kitMaterial());
  m.scale.setScalar(scale);
  m.castShadow = true;
  return m;
}

// ------------------------------------------------------------------ debris
export class Debris {
  private parts: { m: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3; t: number }[] = [];
  private mats = new Map<number, THREE.MeshStandardMaterial>();
  constructor(private scene: THREE.Scene) {}
  burst(x: number, y: number, z: number, colors: number[], n: number, size: number, seed: number) {
    const R = rng(seed);
    for (let i = 0; i < n; i++) {
      const c = colors[i % colors.length];
      let mat = this.mats.get(c);
      if (!mat) this.mats.set(c, (mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })));
      const s = size * (0.4 + R() * 0.8);
      const m = new THREE.Mesh(i % 2 ? new THREE.BoxGeometry(s, s * 0.5, s * 0.8) : new THREE.TetrahedronGeometry(s * 0.6), mat);
      m.position.set(x + (R() - 0.5) * size * 2, y + R() * size * 2, z + (R() - 0.5) * size * 2);
      m.castShadow = true;
      const a = R() * Math.PI * 2, sp = 2 + R() * 4;
      this.scene.add(m);
      this.parts.push({ m, v: new THREE.Vector3(Math.cos(a) * sp, 4 + R() * 5, Math.sin(a) * sp), w: new THREE.Vector3(R() * 10, R() * 10, R() * 10), t: 0 });
    }
  }
  update(dt: number) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      p.v.y -= 22 * dt;
      p.m.position.addScaledVector(p.v, dt);
      const g = groundAt(p.m.position.x, p.m.position.z) + 0.05;
      if (p.m.position.y < g) {
        p.m.position.y = g;
        p.v.multiplyScalar(0.4);
        p.v.y = Math.abs(p.v.y) * 0.3;
        p.w.multiplyScalar(0.5);
      }
      p.m.rotation.x += p.w.x * dt;
      p.m.rotation.y += p.w.y * dt;
      p.m.rotation.z += p.w.z * dt;
      if (p.t > 2.2) p.m.scale.multiplyScalar(0.9);
      if (p.t > 2.8) {
        this.scene.remove(p.m);
        p.m.geometry.dispose();
        this.parts.splice(i, 1);
      }
    }
  }
}
