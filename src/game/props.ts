// Gameplay props: the Oracle shrine (an AI that runs on five Jade Stones), the wolf bandit camps, and
// the light beacon over the current objective.
import * as THREE from 'three';
import { rng } from '../core/math';
import { Batch, box, cyl, kitMaterial, roofGeometry } from '../world/kit';
import { groundAt } from '../world/world';
import { addCircle } from './colliders';
import { excludeFromAO } from './highlight';

/** the Oracle: a jade monolith with a screen face and five GPU slots */
export class Oracle {
  group = new THREE.Group();
  private screen: THREE.Mesh;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  slots: THREE.Group[] = [];
  awake = false;
  constructor(public x: number, public z: number, public ry = 0) {
    const y = groundAt(x, z);
    this.group.position.set(x, y, z);
    this.group.rotation.y = ry;
    const b = new Batch();
    b.add(box(4.4, 0.6, 3), 0x8f8472, 0, 0.3, 0);
    b.add(box(3.2, 4.6, 1.2), 0x2f8f6e, 0, 2.9, 0);
    b.add(box(3.5, 0.4, 1.5), 0xe8b83a, 0, 5.3, 0);
    b.add(roofGeometry(4.6, 2.6, 0.8, 0.6, 0x2f8f6e, 0x267559, 0x8a2d22), null, 0, 5.5, 0);
    for (let i = 0; i < 5; i++) b.add(box(0.5, 0.25, 0.4), 0x2b2b30, -1.2 + i * 0.6, 1.0, 0.75);
    const m = b.mesh(kitMaterial());
    this.group.add(m);
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 192;
    this.ctx = cv.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), new THREE.MeshBasicMaterial({ map: this.tex }));
    this.screen.position.set(0, 3.2, 0.61);
    this.group.add(this.screen);
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Group();
      s.position.set(-1.2 + i * 0.6, 1.25, 0.75);
      s.scale.setScalar(0.45);
      s.visible = false;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), new THREE.MeshPhysicalMaterial({ color: 0x3fd88a, roughness: 0.1, emissive: 0x0d6b3a, emissiveIntensity: 1.5, flatShading: true }));
      gem.scale.set(1, 1.5, 1);
      s.add(gem);
      this.slots.push(s);
      this.group.add(s);
    }
    addCircle(x, z, 2.2);
    this.draw(0);
  }
  setGpus(n: number) {
    this.slots.forEach((s, i) => (s.visible = i < n));
  }
  draw(t: number) {
    const g = this.ctx;
    g.fillStyle = this.awake ? '#0f2a20' : '#101418';
    g.fillRect(0, 0, 256, 192);
    g.strokeStyle = this.awake ? '#5dff8a' : '#3a4450';
    g.fillStyle = g.strokeStyle;
    g.lineWidth = 8;
    g.lineCap = 'round';
    if (this.awake) {
      // a friendly face that blinks
      const blink = Math.sin(t * 1.3) > 0.97;
      for (const x of [88, 168]) {
        g.beginPath();
        if (blink) { g.moveTo(x - 14, 78); g.lineTo(x + 14, 78); }
        else g.arc(x, 78, 14, 0, Math.PI * 2);
        blink ? g.stroke() : g.fill();
      }
      g.beginPath();
      g.arc(128, 110, 40, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
    } else {
      // asleep: "zzz" and a low-battery bar
      g.font = '700 40px Fredoka, sans-serif';
      g.fillText('z z z', 80 + Math.sin(t) * 4, 90);
      g.strokeRect(70, 120, 116, 34);
      g.fillStyle = '#d9362b';
      g.fillRect(76, 126, 14, 22);
    }
    this.tex.needsUpdate = true;
  }
}

/** a wolf bandit camp: tents, a campfire, crates and a banner */
export function buildCamp(x: number, z: number, seed: number) {
  const R = rng(seed);
  const b = new Batch();
  const y0 = groundAt(x, z);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + R();
    const tx = x + Math.cos(a) * 6, tz = z + Math.sin(a) * 6;
    b.add(new THREE.ConeGeometry(2, 2.6, 6), i % 2 ? 0x7a5a3a : 0x8a6a48, tx, groundAt(tx, tz) + 1.2, tz, R() * 3);
    b.add(cyl(0.05, 0.05, 3, 4), 0x4a3626, tx, groundAt(tx, tz) + 1.5, tz);
    addCircle(tx, tz, 1.8, -100, groundAt(tx, tz) + 2.6);
  }
  // campfire stones and logs
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.add(new THREE.DodecahedronGeometry(0.25), 0x7a7468, x + Math.cos(a) * 0.9, y0 + 0.1, z + Math.sin(a) * 0.9);
  }
  for (let k = 0; k < 3; k++) b.add(cyl(0.1, 0.1, 1.3, 6), 0x5a3a26, x, y0 + 0.2, z, (k / 3) * Math.PI, 1, 1, 1, Math.PI / 2 - 0.3);
  // crates and a banner
  for (let k = 0; k < 3; k++) {
    const cx = x + 3 + k * 0.9, cz = z - 3 + (k % 2) * 0.9;
    b.add(box(0.8, 0.8, 0.8), 0x9a6a3e, cx, groundAt(cx, cz) + 0.4, cz, R());
  }
  b.add(cyl(0.08, 0.08, 4.5, 6), 0x4a3626, x - 3, y0 + 2.2, z + 3);
  b.add(box(1.4, 1.0, 0.05), 0xc0392b, x - 2.3, y0 + 3.9, z + 3);
  const group = new THREE.Group();
  group.add(b.mesh(kitMaterial()));
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 7), new THREE.MeshBasicMaterial({ color: 0xffa53a }));
  fire.position.set(x, y0 + 0.65, z);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 7), new THREE.MeshBasicMaterial({ color: 0xfff07a }));
  inner.position.set(x, y0 + 0.5, z);
  group.add(fire, inner);
  const light = new THREE.PointLight(0xff9a3a, 8, 12, 2);
  light.position.set(x, y0 + 1.5, z);
  group.add(light);
  addCircle(x, z, 1.0, -100, y0 + 1);
  return { group, fire, inner };
}

// ------------------------------------------------------------------ objective beacon
// A soft jade light column with a floating diamond over the current objective. Unfogged and additive, so
// it reads from across the Valley; it grows with distance and fades away once Le Chonk is close.
const BEAM_H = 70;
const BEAM_VERT = /* glsl */ `
  varying float vH;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vH = position.y / ${BEAM_H.toFixed(1)};
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const BEAM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uTime;
  varying float vH;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    // brightest through the middle of the column, soft at its silhouette
    float facing = abs(dot(normalize(vN), normalize(vV)));
    float body = pow(facing, 1.6);
    float fade = pow(1.0 - vH, 1.8) * smoothstep(0.0, 0.015, vH);
    // slow bands of light rising up the column
    float bands = 0.75 + 0.25 * smoothstep(0.75, 1.0, fract(vH * 9.0 - uTime * 0.35));
    float a = uAlpha * body * fade * bands;
    gl_FragColor = vec4(uColor, a);
  }`;

export class ObjectiveBeacon {
  group = new THREE.Group();
  private beamMat: THREE.ShaderMaterial;
  private beam: THREE.Mesh;
  private gem: THREE.Group;
  private gemMat: THREE.MeshBasicMaterial;
  private haloMat: THREE.SpriteMaterial;
  private halo: THREE.Sprite;
  private fade = 0;
  private x = 0;
  private z = 0;
  private y = 0;
  private has = false;

  constructor() {
    const geo = new THREE.CylinderGeometry(1, 1, BEAM_H, 20, 1, true).translate(0, BEAM_H / 2, 0);
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x5dffb0) }, uAlpha: { value: 0 }, uTime: { value: 0 } },
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(geo, this.beamMat);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 3;
    // the floating diamond: a bright jade core inside a gold cage
    this.gem = new THREE.Group();
    this.gemMat = new THREE.MeshBasicMaterial({ color: 0xa6ffd4, fog: false, transparent: true });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), this.gemMat);
    core.scale.set(1, 1.55, 1);
    const cage = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.62, 0)),
      new THREE.LineBasicMaterial({ color: 0xf4dc9c, fog: false, transparent: true, opacity: 0.9 }),
    );
    cage.scale.set(1, 1.55, 1);
    this.gem.add(core, cage);
    this.haloMat = new THREE.SpriteMaterial({ map: haloTex(), color: 0x6bffb8, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.renderOrder = 4;
    this.group.add(this.beam, this.gem, this.halo);
    this.group.visible = false;
    excludeFromAO(this.group);
  }

  /** target: the current objective position (null hides the beacon); px/pz: Le Chonk */
  update(dt: number, t: number, target: { x: number; z: number } | null, px: number, pz: number) {
    if (target) {
      const jump = !this.has || Math.hypot(target.x - this.x, target.z - this.z) > 4;
      if (jump) {
        // a new objective: snap there and fade in again
        this.x = target.x;
        this.z = target.z;
        this.fade = 0;
      } else {
        // a moving target (the boss): follow smoothly
        const k = 1 - Math.exp(-6 * dt);
        this.x += (target.x - this.x) * k;
        this.z += (target.z - this.z) * k;
      }
      this.y = groundAt(this.x, this.z);
    }
    this.has = !!target;
    const d = Math.hypot(this.x - px, this.z - pz);
    const want = target ? Math.min(1, Math.max(0.12, (d - 5) / 10)) : 0;
    this.fade += (want - this.fade) * (1 - Math.exp(-(want > this.fade ? 1.6 : 4) * dt));
    this.group.visible = this.fade > 0.01;
    if (!this.group.visible) return;
    const s = Math.min(6, Math.max(1, d / 18));
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
    this.group.position.set(this.x, this.y, this.z);
    this.beam.scale.set(0.38 * s, 1, 0.38 * s);
    this.beamMat.uniforms.uAlpha.value = this.fade * (0.42 + 0.12 * pulse);
    this.beamMat.uniforms.uTime.value = t;
    const gy = 4.4 + 0.9 * (s - 1) + Math.sin(t * 1.8) * 0.22 * s;
    this.gem.position.y = gy;
    this.gem.rotation.y = t * 1.2;
    this.gem.scale.setScalar(0.85 * s);
    this.gemMat.opacity = this.fade;
    (this.gem.children[1] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>).material.opacity = 0.9 * this.fade;
    this.halo.position.y = gy;
    this.halo.scale.setScalar(2.6 * s * (1 + 0.15 * pulse));
    this.haloMat.opacity = this.fade * (0.45 + 0.25 * pulse);
  }
}

let HALO_TEX: THREE.Texture | null = null;
function haloTex() {
  if (HALO_TEX) return HALO_TEX;
  const S = 128, c = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const r = g.createRadialGradient(c, c, 0, c, c, c);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.4)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, S, S);
  HALO_TEX = new THREE.CanvasTexture(cv);
  HALO_TEX.colorSpace = THREE.SRGBColorSpace;
  return HALO_TEX;
}
