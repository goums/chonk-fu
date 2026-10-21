// Dragon Chonk: what the Dragon Noodles do to Le Chonk. He grows ~15 %, a golden electric aura crackles
// around him (lightning arcs, additive glow, rising motes, a warm sheen on his fur), sparks fly from his
// feet when he moves, and his belly bump becomes the Dragon Belly (a golden shockwave on the ground).
// Every transparent piece is kept out of the AO pass (excludeFromAO), or it would show as grey quads.
import * as THREE from 'three';
import { clamp, rng } from '../core/math';
import { groundAt } from '../world/world';
import type { Fighter } from './fighter';
import { excludeFromAO, sparkles } from './highlight';
import { glowTexture } from './itemIcons';

export const DRAGON_SCALE = 1.15;
const GOLD = 0xffc23a;

// ------------------------------------------------------------------ lightning arcs
/** a jagged bolt as two crossed ribbons (lines are 1 px in WebGL, ribbons read at any distance) */
class Arc {
  mesh: THREE.Mesh;
  private pos: Float32Array;
  life = 0;
  private pts: THREE.Vector3[] = [];
  static readonly N = 9;
  constructor(private mat: THREE.MeshBasicMaterial) {
    const N = Arc.N;
    // per point: 4 vertices (ribbon A left/right, ribbon B left/right)
    this.pos = new Float32Array(N * 4 * 3);
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) {
      for (const r of [0, 2]) {
        const a = i * 4 + r, b = a + 1, c = (i + 1) * 4 + r, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.userData.fx = true;
    for (let i = 0; i < N; i++) this.pts.push(new THREE.Vector3());
  }
  /** a new bolt between two points on a capsule around the body (local space of the rig root) */
  strike(R: () => number, size: number) {
    const N = Arc.N;
    const onBody = (v: THREE.Vector3) => {
      const a = R() * Math.PI * 2, y = 0.2 + R() * 1.25;
      const r = 0.5 + 0.12 * Math.sin(y * 2.2) + R() * 0.15;
      return v.set(Math.sin(a) * r, y, Math.cos(a) * r);
    };
    const a = onBody(new THREE.Vector3()), b = onBody(new THREE.Vector3());
    if (a.distanceTo(b) < 0.5) b.y = clamp(a.y + (R() < 0.5 ? -0.7 : 0.7), 0.15, 1.5);
    const out = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      const p = this.pts[i].lerpVectors(a, b, u);
      // bow outward from the body, then jitter (the ends stay pinned)
      out.set(p.x, 0, p.z).normalize();
      const bow = Math.sin(u * Math.PI) * (0.18 + R() * 0.2);
      const j = i === 0 || i === N - 1 ? 0 : 0.11 * size;
      p.addScaledVector(out, bow);
      p.x += (R() - 0.5) * j * 2;
      p.y += (R() - 0.5) * j * 2;
      p.z += (R() - 0.5) * j * 2;
    }
    const w = 0.034 * size;
    for (let i = 0; i < N; i++) {
      const p = this.pts[i];
      const k = i * 12;
      const taper = w * (0.5 + Math.sin((i / (N - 1)) * Math.PI));
      // ribbon A spreads horizontally, ribbon B vertically
      this.pos[k] = p.x - taper; this.pos[k + 1] = p.y; this.pos[k + 2] = p.z;
      this.pos[k + 3] = p.x + taper; this.pos[k + 4] = p.y; this.pos[k + 5] = p.z;
      this.pos[k + 6] = p.x; this.pos[k + 7] = p.y - taper; this.pos[k + 8] = p.z;
      this.pos[k + 9] = p.x; this.pos[k + 10] = p.y + taper; this.pos[k + 11] = p.z;
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.life = 0.07 + R() * 0.13;
    this.mesh.visible = true;
  }
  get material() {
    return this.mat;
  }
}

// ------------------------------------------------------------------ world-space sparks
const SPARK_VERT = /* glsl */ `
  attribute float aLife;
  varying float vA;
  void main() {
    vA = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (0.06 + 0.07 * aLife) * 900.0 / max(1.0, -mv.z);
  }`;
const SPARK_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float core = pow(max(0.0, 1.0 - d * 2.0), 2.0);
    float a = core * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.6), a);
  }`;

class Sparks {
  points: THREE.Points;
  private p: Float32Array;
  private life: Float32Array;
  private v: Float32Array;
  private ttl: Float32Array;
  private next = 0;
  constructor(private n = 160) {
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.ttl = new Float32Array(n).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffd45a) } },
      vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    excludeFromAO(this.points);
  }
  emit(x: number, y: number, z: number, R: () => number, speed = 3, up = 3) {
    const i = this.next++ % this.n;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    const a = R() * Math.PI * 2, s = speed * (0.4 + R() * 0.8);
    this.v[i * 3] = Math.cos(a) * s;
    this.v[i * 3 + 1] = up * (0.4 + R());
    this.v[i * 3 + 2] = Math.sin(a) * s;
    this.ttl[i] = 0.3 + R() * 0.35;
    this.life[i] = 1;
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] = Math.max(0, this.life[i] - dt / this.ttl[i]);
      this.v[i * 3 + 1] -= 14 * dt;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const gy = groundAt(this.p[i * 3], this.p[i * 3 + 2]) + 0.03;
      if (this.p[i * 3 + 1] < gy) {
        this.p[i * 3 + 1] = gy;
        this.v[i * 3 + 1] *= -0.35;
        this.v[i * 3] *= 0.5;
        this.v[i * 3 + 2] *= 0.5;
      }
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ------------------------------------------------------------------ shockwave ring
let RING_TEX: THREE.Texture | null = null;
function ringTex() {
  if (RING_TEX) return RING_TEX;
  const S = 256, c = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const r = g.createRadialGradient(c, c, 0, c, c, c);
  r.addColorStop(0, 'rgba(255,255,255,0)');
  r.addColorStop(0.55, 'rgba(255,255,255,0.08)');
  r.addColorStop(0.82, 'rgba(255,255,255,0.7)');
  r.addColorStop(0.9, 'rgba(255,255,255,1)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, S, S);
  RING_TEX = new THREE.CanvasTexture(cv);
  RING_TEX.colorSpace = THREE.SRGBColorSpace;
  return RING_TEX;
}
interface Wave { mesh: THREE.Mesh; flash: THREE.Sprite; t: number; life: number; r: number }

// ------------------------------------------------------------------ the aura
export class DragonAura {
  /** attached to the rig root: scales and turns with Le Chonk */
  group = new THREE.Group();
  /** 0..1 power-up animation (grows, flares), then stays at 1 */
  private intro = 0;
  private arcs: Arc[] = [];
  private arcMat: THREE.MeshBasicMaterial;
  private halo: THREE.Sprite;
  private core: THREE.Sprite;
  private rim: THREE.Sprite;
  private floor: THREE.Mesh;
  private sparks = new Sparks();
  private waves: Wave[] = [];
  private R = rng(888);
  private sheen: (THREE.MeshStandardMaterial | THREE.MeshToonMaterial)[] = [];
  private zapT = 0.5;
  private t = 0;

  constructor(private player: Fighter, private scene: THREE.Scene) {
    this.arcMat = new THREE.MeshBasicMaterial({ color: 0xfff0a8, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 9; i++) {
      const a = new Arc(this.arcMat);
      a.mesh.visible = false;
      this.arcs.push(a);
      this.group.add(a.mesh);
    }
    const glow = glowTexture();
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: GOLD, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    this.halo.position.y = 0.85;
    this.halo.renderOrder = 5;
    this.core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff2c0, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false, blending: THREE.AdditiveBlending }));
    this.core.position.y = 0.85;
    this.core.renderOrder = 5;
    // a faint glow over the body (drawn on top) and a golden pool of light on the ground
    this.rim = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffd24a, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false, blending: THREE.AdditiveBlending }));
    this.rim.position.y = 0.8;
    this.rim.renderOrder = 5;
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glow, color: GOLD, transparent: true, opacity: 0.5, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    this.floor.position.y = 0.06;
    this.floor.renderOrder = 4;
    this.floor.userData.fx = true;
    this.group.add(this.halo, this.core, this.rim, this.floor, sparkles(0xffd25a, 22, 0.75, 4242, 0.065, 2.0));
    excludeFromAO(this.group);
    this.group.visible = false;
    player.object.add(this.group);
    scene.add(this.sparks.points);
  }

  get active() {
    return this.group.visible;
  }

  /** the transformation moment */
  start() {
    this.group.visible = true;
    this.intro = 0.0001;
    // a warm golden sheen on the fur: own copies of the materials so nobody else turns gold
    this.player.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.fx) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const out = mats.map((mat) => {
        const sm = mat as THREE.MeshStandardMaterial;
        if (!('emissive' in sm) || !(sm.emissive instanceof THREE.Color)) return mat;
        const c = sm.clone();
        c.emissive = new THREE.Color(0xffa21a);
        c.emissiveIntensity = 0;
        this.sheen.push(c);
        return c;
      });
      m.material = Array.isArray(m.material) ? out : out[0];
    });
    const P = this.player.pos;
    for (let i = 0; i < 50; i++) this.sparks.emit(P.x, P.y + 0.3 + this.R() * 1.2, P.z, this.R, 5, 5);
    this.wave(P.x, P.z, 4.5, 0.7);
  }

  /** the Dragon Belly shockwave */
  dragonBelly(x: number, z: number) {
    this.wave(x, z, 6.5, 0.55);
    this.wave(x, z, 4, 0.4);
    const y = groundAt(x, z);
    for (let i = 0; i < 45; i++) this.sparks.emit(x, y + 0.2 + this.R() * 0.8, z, this.R, 7, 4);
    for (const a of this.arcs) a.strike(this.R, 2.2);
  }

  private wave(x: number, z: number, r: number, life: number) {
    const mat = new THREE.MeshBasicMaterial({ map: ringTex(), color: GOLD, transparent: true, opacity: 1, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), mat);
    mesh.position.set(x, groundAt(x, z) + 0.08, z);
    mesh.renderOrder = 6;
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffe08a, transparent: true, opacity: 1, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    flash.position.set(x, groundAt(x, z) + 0.9, z);
    flash.renderOrder = 6;
    excludeFromAO(mesh);
    excludeFromAO(flash);
    this.scene.add(mesh, flash);
    this.waves.push({ mesh, flash, t: 0, life, r });
  }

  /** one sim step; returns true when an electric "zap" sound should play */
  update(dt: number): boolean {
    this.t += dt;
    const t = this.t;
    // shockwaves (they outlive nothing: they also run while the aura is off)
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.t += dt;
      const u = w.t / w.life;
      const ease = 1 - (1 - Math.min(1, u)) ** 3;
      w.mesh.scale.setScalar(0.4 + w.r * ease);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - u) ** 1.3;
      w.flash.scale.setScalar(1.5 + w.r * 0.8 * ease);
      w.flash.material.opacity = Math.max(0, 1 - u * 1.6) * 0.9;
      if (u >= 1) {
        this.scene.remove(w.mesh, w.flash);
        w.mesh.geometry.dispose();
        (w.mesh.material as THREE.Material).dispose();
        w.flash.material.dispose();
        this.waves.splice(i, 1);
      }
    }
    this.sparks.update(dt);
    if (!this.group.visible) return false;

    const P = this.player;
    // the transformation: grow with a springy overshoot, the aura flares
    let flare = 0;
    if (this.intro > 0 && this.intro < 1) {
      this.intro = Math.min(1, this.intro + dt / 1.6);
      const u = this.intro;
      const grow = 1 - Math.exp(-6 * u) * Math.cos(u * 14);
      P.object.scale.setScalar(1 + (DRAGON_SCALE - 1) * grow);
      flare = Math.sin(u * Math.PI);
      if (this.R() < 0.5) this.sparks.emit(P.pos.x, P.pos.y + this.R() * 1.6, P.pos.z, this.R, 3, 4);
    } else P.object.scale.setScalar(DRAGON_SCALE);

    // flickering glow
    const flick = 0.75 + 0.25 * Math.sin(t * 23) * Math.sin(t * 7.1);
    this.halo.scale.setScalar(2.9 + flare * 2.5 + Math.sin(t * 3) * 0.15);
    this.halo.material.opacity = (0.13 + flare * 0.45) * flick;
    this.rim.scale.setScalar(2.2 + Math.sin(t * 5) * 0.1);
    this.rim.material.opacity = (0.05 + flare * 0.3) * flick;
    this.floor.scale.setScalar(1.3 + flare * 1.5 + Math.sin(t * 3.3) * 0.08);
    (this.floor.material as THREE.MeshBasicMaterial).opacity = (0.6 + flare * 0.4) * (0.85 + 0.15 * flick);
    this.core.scale.setScalar(1.2 + flare * 3);
    this.core.material.opacity = flare * 0.45;
    for (const m of this.sheen) m.emissiveIntensity = 0.2 + 0.08 * Math.sin(t * 4.5) + flare * 0.6 + (flick - 0.75) * 0.25;

    // lightning: a few bolts alive at any time, more while flaring or moving fast
    const speed = Math.hypot(P.vel.x, P.vel.z);
    const busy = 0.7 + flare * 1.2 + clamp(speed / 10, 0, 1) * 0.35;
    for (const a of this.arcs) {
      if (a.mesh.visible) {
        a.life -= dt;
        if (a.life <= 0) a.mesh.visible = false;
      } else if (this.R() < busy * dt * 9) a.strike(this.R, 1 + flare);
    }
    this.arcMat.opacity = 0.75 + 0.25 * flick;

    // sparks from the feet when moving
    let zap = false;
    if (speed > 2 && P.grounded) {
      if (this.R() < clamp(speed / 10, 0.2, 1) * 0.8) this.sparks.emit(P.pos.x + (this.R() - 0.5) * 0.6, P.pos.y + 0.05, P.pos.z + (this.R() - 0.5) * 0.6, this.R, 2, 2.5);
      this.zapT -= dt;
      if (this.zapT <= 0) {
        this.zapT = 0.6 + this.R() * 0.5;
        zap = true;
      }
    }
    return zap || (flare > 0.3 && this.R() < dt * 4);
  }
}
