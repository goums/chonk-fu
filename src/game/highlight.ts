// "You can use this" cues for the things Le Chonk interacts with: a pulsing fresnel rim drawn as an
// additive shell over the object's own meshes (skinned ones too), a soft ground ring, and sparkles that
// rise from pickups. All cheap: a shell only renders while its object is highlighted, the sparkles are a
// handful of points animated entirely on the GPU, and no full-screen outline pass is needed.
import * as THREE from 'three';
import { groundAt } from '../world/world';

/** sim time shared by every highlight/sparkle shader (set once per step) */
export const fxClock = { value: 0 };
export function setFxTime(t: number) {
  fxClock.value = t;
}

// ------------------------------------------------------------------ keep overlays out of the AO pass
// GTAOPass renders the whole scene with a normal-material override to build its depth/normal buffer.
// Points and lines are skipped there, but sprites and transparent meshes are not: a marker sprite turns
// into an opaque quad in the AO buffer, which shows up as a grey square. These hooks collapse the object
// to a point during any override-material render, so it only ever draws with its own material.
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const saved = new THREE.Matrix4();
export function excludeFromAO<T extends THREE.Object3D>(obj: T): T {
  obj.traverse((o) => {
    o.onBeforeRender = (_r, scene) => {
      if (!scene.overrideMaterial) return;
      saved.copy(o.matrixWorld);
      o.matrixWorld.copy(ZERO);
    };
    o.onAfterRender = (_r, scene) => {
      if (scene.overrideMaterial) o.matrixWorld.copy(saved);
    };
  });
  return obj;
}

// ------------------------------------------------------------------ fresnel rim shell
const RIM_VERT = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    vN = normalize(transformedNormal);
    vV = -mvPosition.xyz;
  }`;
const RIM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = max(0.0, 1.0 - abs(dot(normalize(vN), normalize(vV)))); // never a negative pow() base (NaN)
    float a = uStrength * (pow(f, 2.4) * 1.5 + 0.07);
    gl_FragColor = vec4(uColor, a);
  }`;

const ringTexture = (() => {
  let tex: THREE.Texture | null = null;
  return () => {
    if (tex) return tex;
    const S = 256, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d')!;
    const c = S / 2;
    // soft filled glow + a crisp ring + four little ticks (a kung-fu "target" mat)
    const fill = g.createRadialGradient(c, c, 0, c, c, c);
    fill.addColorStop(0, 'rgba(255,255,255,0.0)');
    fill.addColorStop(0.62, 'rgba(255,255,255,0.10)');
    fill.addColorStop(0.8, 'rgba(255,255,255,0.55)');
    fill.addColorStop(0.86, 'rgba(255,255,255,1)');
    fill.addColorStop(0.9, 'rgba(255,255,255,0.5)');
    fill.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = fill;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(c, c, c * 0.68, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#fff';
    for (let k = 0; k < 4; k++) {
      g.save();
      g.translate(c, c);
      g.rotate((k * Math.PI) / 2 + Math.PI / 4);
      g.beginPath();
      g.moveTo(0, -c * 0.95);
      g.lineTo(7, -c * 0.8);
      g.lineTo(-7, -c * 0.8);
      g.closePath();
      g.fill();
      g.restore();
    }
    tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
})();
const ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);

const UP = new THREE.Vector3(0, 1, 0);
const tmpN = new THREE.Vector3();
const tmpP = new THREE.Vector3();

/**
 * A highlight on one object. set(level) every step: 0 off, 1 "in range", 2 "this is what Enter does".
 * The rim shells are built lazily the first time the object lights up.
 */
export class Highlight {
  private uniforms: { uColor: { value: THREE.Color }; uStrength: { value: number }; uTime: typeof fxClock };
  private shells: THREE.Mesh[] | null = null;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private level = 0;
  private lastGround = { x: NaN, z: NaN };

  constructor(private target: THREE.Object3D, scene: THREE.Object3D, color: THREE.ColorRepresentation, private ringRadius: number) {
    this.uniforms = { uColor: { value: new THREE.Color(color) }, uStrength: { value: 0 }, uTime: fxClock };
    this.ringMat = new THREE.MeshBasicMaterial({
      map: ringTexture(), color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.visible = false;
    this.ring.renderOrder = 2;
    excludeFromAO(this.ring);
    scene.add(this.ring);
  }

  setColor(c: THREE.ColorRepresentation) {
    this.uniforms.uColor.value.set(c);
    this.ringMat.color.set(c);
  }

  private build() {
    const meshes: THREE.Mesh[] = [];
    this.target.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.fx && m.geometry?.attributes.normal) meshes.push(m);
    });
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: RIM_VERT, fragmentShader: RIM_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, depthFunc: THREE.LessEqualDepth,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    });
    this.shells = meshes.map((m) => {
      let s: THREE.Mesh;
      const sk = m as THREE.SkinnedMesh;
      if (sk.isSkinnedMesh) {
        const ss = new THREE.SkinnedMesh(sk.geometry, mat);
        ss.bindMode = sk.bindMode;
        ss.bind(sk.skeleton, sk.bindMatrix);
        s = ss;
        s.frustumCulled = false;
      } else s = new THREE.Mesh(m.geometry, mat);
      s.userData.fx = true;
      s.castShadow = s.receiveShadow = false;
      s.renderOrder = 3;
      s.visible = false;
      excludeFromAO(s);
      m.add(s);
      return s;
    });
  }

  /** level: 0 off, 1 in range, 2 focused. t: sim time */
  set(level: number, dt: number, t: number) {
    this.level += (level - this.level) * (1 - Math.exp(-8 * dt));
    const on = this.level > 0.01;
    if (on && !this.shells) this.build();
    const focus = Math.max(0, this.level - 1);
    const pulse = 0.62 + 0.38 * Math.sin(t * (3.2 + focus * 2.2));
    const k = Math.min(1, this.level);
    this.uniforms.uStrength.value = k * (0.55 + focus * 0.6) * pulse;
    if (this.shells) for (const s of this.shells) s.visible = on;
    this.ring.visible = on && this.target.visible;
    if (!this.ring.visible) return;
    // the ring sits on the ground under the object, tilted with the terrain
    this.target.getWorldPosition(tmpP);
    if (Math.abs(tmpP.x - this.lastGround.x) + Math.abs(tmpP.z - this.lastGround.z) > 0.05) {
      this.lastGround = { x: tmpP.x, z: tmpP.z };
      const e = 0.6, y = groundAt(tmpP.x, tmpP.z);
      tmpN.set(groundAt(tmpP.x - e, tmpP.z) - groundAt(tmpP.x + e, tmpP.z), 2 * e, groundAt(tmpP.x, tmpP.z - e) - groundAt(tmpP.x, tmpP.z + e)).normalize();
      this.ring.quaternion.setFromUnitVectors(UP, tmpN);
      this.ring.position.set(tmpP.x, y + 0.05, tmpP.z);
    }
    const breathe = 1 + 0.05 * Math.sin(t * 2.6) + focus * 0.12;
    this.ring.scale.setScalar(this.ringRadius * breathe);
    this.ring.rotateOnAxis(UP, dt * (0.25 + focus * 0.5));
    this.ringMat.opacity = k * (0.32 + focus * 0.4) * (0.75 + 0.25 * pulse);
  }

  dispose(scene: THREE.Object3D) {
    scene.remove(this.ring);
  }
}

// ------------------------------------------------------------------ sparkles
const SPARK_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uRise;
  attribute float aPhase;
  attribute float aSpeed;
  varying float vA;
  void main() {
    float k = fract(uTime * aSpeed + aPhase);
    vec3 p = position;
    float ang = uTime * 0.9 + aPhase * 6.2832;
    p.x += sin(ang) * 0.1;
    p.z += cos(ang) * 0.1;
    p.y += k * uRise;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.5 + 0.5 * sin(uTime * 8.0 + aPhase * 40.0);
    vA = sin(k * 3.14159) * (0.45 + 0.55 * tw);
    gl_PointSize = uSize * (0.6 + 0.8 * fract(aPhase * 7.13)) * (0.7 + 0.3 * tw) * 700.0 / max(1.0, -mv.z);
  }`;
const SPARK_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float core = pow(max(0.0, 1.0 - d * 2.0), 3.0);
    float star = max(0.0, 1.0 - abs(c.x) * 16.0) * max(0.0, 1.0 - abs(c.y) * 2.0)
               + max(0.0, 1.0 - abs(c.y) * 16.0) * max(0.0, 1.0 - abs(c.x) * 2.0);
    float a = (core * 1.3 + star * 0.9) * vA;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }`;
const sparkMats = new Map<string, THREE.ShaderMaterial>();
function sparkMaterial(color: THREE.ColorRepresentation, size: number, rise: number) {
  const key = `${new THREE.Color(color).getHexString()}|${size}|${rise}`;
  let m = sparkMats.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { uTime: fxClock, uColor: { value: new THREE.Color(color) }, uSize: { value: size }, uRise: { value: rise } },
      vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    sparkMats.set(key, m);
  }
  return m;
}

/** a few twinkling motes rising around a point (for pickups); deterministic layout from the seed */
export function sparkles(color: THREE.ColorRepresentation, count: number, radius: number, seed: number, size = 0.05, rise = 1.4) {
  const pos = new Float32Array(count * 3), phase = new Float32Array(count), speed = new Float32Array(count);
  let s = seed * 9301 + 49297;
  const R = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < count; i++) {
    const a = R() * Math.PI * 2, r = radius * (0.35 + 0.65 * Math.sqrt(R()));
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = 0.15 + R() * 0.5;
    pos[i * 3 + 2] = Math.sin(a) * r;
    phase[i] = R();
    speed[i] = 0.35 + R() * 0.4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  const p = new THREE.Points(g, sparkMaterial(color, size, rise));
  p.frustumCulled = false;
  p.userData.fx = true;
  p.renderOrder = 4;
  return p;
}
