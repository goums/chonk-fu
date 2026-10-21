// Generic sculpted creature: a definition gives the skeleton proportions, the torso/head sculpt (SDF
// primitives with paint functions) and the face; arms, legs, skinning, fur shells and the tail are
// built here. Every character in the game (Le Chonk, Overfit, the wolves, the villagers) uses it, so
// they all share the same soft, furry animated-film look and the same procedural Animator.
import * as THREE from 'three';
import type { ChonkRig } from './model';
import { meshSDF, paintAndSkin, type Prim, type V3 } from './sdf';

export const BONES = ['hips', 'body', 'head', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'legL', 'kneeL', 'legR', 'kneeR', 'tail0'] as const;
export type BoneName = (typeof BONES)[number];
export type Paint = Prim['color'];

export interface FaceDef {
  eyeSep: number; eyeY: number; eyeZ: number; eyeR: number; eyeYaw?: number;
  iris: number; slit?: boolean; lids?: number; // 0..1 how closed the eyelids are (sleepy master)
  lidColor?: number;
  browY: number; browZ: number; browW?: number; brow: number;
  nose?: { y: number; z: number; r: number; color: number };
  mouthY: number; mouthZ: number; mouthR?: number;
  whiskers?: number; // whisker length, 0 = none
}

export interface SculptCtx {
  W: Record<BoneName, THREE.Vector3>;
  /** ellipsoid */
  E: (bone: BoneName, a: V3, r: V3, color: Paint, k?: number) => void;
  /** tapered capsule */
  C: (bone: BoneName, a: V3, b: V3, ra: number, rb: number, color: Paint, k?: number) => void;
  /** point relative to the head joint */
  h: (x: number, y: number, z: number) => V3;
}

export interface CreatureDef {
  name: string;
  hip: number;
  neck: V3; // head joint offset from the body joint
  shoulder: V3; // left shoulder offset from the body joint
  upperArm: number; foreArm: number; armR: [number, number, number]; // upper, fore, paw radius
  legX: number; legDrop?: number; thigh: number; legR: [number, number]; foot: V3; footColor: number;
  armColor: Paint; pawColor: number; legColor: Paint;
  tail?: { at: V3; segments: number; r: number; taper: number; colors: number[]; droop?: number };
  cloth: number[]; // colors that get no fur
  shells: number; furLen: number;
  cell?: number;
  sculpt: (ctx: SculptCtx) => void;
  face: FaceDef;
  extras?: (B: Record<BoneName, THREE.Bone>, W: Record<BoneName, THREE.Vector3>) => void;
  sheen?: number;
}

const APOSE = 0.9;
const geoCache = new Map<string, THREE.BufferGeometry>();

function sculptGeometry(def: CreatureDef, W: Record<BoneName, THREE.Vector3>) {
  const cached = geoCache.get(def.name);
  if (cached) return cached;
  const prims: Prim[] = [];
  const E: SculptCtx['E'] = (bone, a, r, color, k = 0.08) => prims.push({ kind: 'ellipsoid', bone, a, r, color, k });
  const C: SculptCtx['C'] = (bone, a, b, ra, rb, color, k = 0.06) => prims.push({ kind: 'capsule', bone, a, b, ra, rb, color, k });
  const h = (x: number, y: number, z: number): V3 => [W.head.x + x, W.head.y + y, W.head.z + z];
  def.sculpt({ W, E, C, h });
  // arms in the A-pose
  for (const s of [-1, 1]) {
    const sh = W[s > 0 ? 'shoulderL' : 'shoulderR'];
    const dir = new THREE.Vector3(s * Math.sin(APOSE), -Math.cos(APOSE), 0);
    const el = sh.clone().addScaledVector(dir, def.upperArm);
    const wr = el.clone().addScaledVector(dir, def.foreArm * 0.85);
    const pw = el.clone().addScaledVector(dir, def.foreArm + def.armR[2] * 0.4);
    const sb: BoneName = s > 0 ? 'shoulderL' : 'shoulderR', eb: BoneName = s > 0 ? 'elbowL' : 'elbowR';
    C(sb, sh.clone().addScaledVector(dir, 0.04).toArray() as V3, el.toArray() as V3, def.armR[0], def.armR[1] * 1.05, def.armColor, 0.06);
    C(eb, el.toArray() as V3, wr.toArray() as V3, def.armR[1], def.armR[1] * 0.92, def.armColor, 0.05);
    E(eb, pw.toArray() as V3, [def.armR[2], def.armR[2] * 0.92, def.armR[2]], def.pawColor, 0.05);
  }
  // legs
  for (const s of [-1, 1]) {
    const lb: BoneName = s > 0 ? 'legL' : 'legR', kb: BoneName = s > 0 ? 'kneeL' : 'kneeR';
    const hip = W[lb], knee = W[kb];
    C(lb, [hip.x, hip.y + 0.04, hip.z], [knee.x, knee.y, knee.z], def.legR[0], def.legR[0] * 0.92, def.legColor, 0.07);
    const ankle = def.foot[1] + 0.02;
    C(kb, [knee.x, knee.y, knee.z], [knee.x, ankle, 0], def.legR[1], def.legR[1] * 0.85, def.legColor, 0.04);
    E(kb, [knee.x, def.foot[1], def.foot[2] * 0.35], def.foot, def.footColor, 0.05);
  }
  const g = meshSDF(prims, def.cell ?? 0.02);
  const boneIndex: Record<string, number> = {};
  BONES.forEach((b, i) => (boneIndex[b] = i));
  paintAndSkin(g, prims, boneIndex);
  // cloth (by paint colour) gets no fur
  const col = g.attributes.color as THREE.BufferAttribute, fur = g.attributes.fur as THREE.BufferAttribute;
  const cloth = def.cloth.map((c) => new THREE.Color(c));
  const c = new THREE.Color();
  for (let i = 0; i < fur.count; i++) {
    c.fromBufferAttribute(col, i);
    let d = Infinity;
    for (const k of cloth) d = Math.min(d, Math.abs(c.r - k.r) + Math.abs(c.g - k.g) + Math.abs(c.b - k.b));
    fur.setX(i, d < 0.12 ? 0 : 1);
  }
  geoCache.set(def.name, g);
  return g;
}

export function furMaterial(sheen = 1) {
  return new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.78, metalness: 0, sheen, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffe2b8),
  });
}

export function buildCreature(def: CreatureDef): ChonkRig {
  // joint rest positions
  const local: Record<BoneName, { parent: BoneName | null; p: V3 }> = {
    hips: { parent: null, p: [0, def.hip, 0] },
    body: { parent: 'hips', p: [0, 0, 0] },
    head: { parent: 'body', p: def.neck },
    shoulderL: { parent: 'body', p: def.shoulder },
    elbowL: { parent: 'shoulderL', p: [0, -def.upperArm, 0] },
    shoulderR: { parent: 'body', p: [-def.shoulder[0], def.shoulder[1], def.shoulder[2]] },
    elbowR: { parent: 'shoulderR', p: [0, -def.upperArm, 0] },
    legL: { parent: 'hips', p: [def.legX, -(def.legDrop ?? 0.24 * def.hip), 0] },
    kneeL: { parent: 'legL', p: [0, -def.thigh, 0] },
    legR: { parent: 'hips', p: [-def.legX, -(def.legDrop ?? 0.24 * def.hip), 0] },
    kneeR: { parent: 'legR', p: [0, -def.thigh, 0] },
    tail0: { parent: 'body', p: def.tail?.at ?? [0, 0, -0.3] },
  };
  const W = {} as Record<BoneName, THREE.Vector3>;
  const wp = (n: BoneName): THREE.Vector3 => {
    const r = local[n];
    const v = new THREE.Vector3(...r.p);
    if (!r.parent) return v;
    // the arms hang in the A-pose: rotate the elbow offset by the shoulder's bind angle
    if (n === 'elbowL') v.applyAxisAngle(new THREE.Vector3(0, 0, 1), APOSE);
    if (n === 'elbowR') v.applyAxisAngle(new THREE.Vector3(0, 0, 1), -APOSE);
    return v.add(wp(r.parent));
  };
  for (const n of BONES) W[n] = wp(n);
  const geometry = sculptGeometry(def, W);

  const B = {} as Record<BoneName, THREE.Bone>;
  for (const n of BONES) {
    B[n] = new THREE.Bone();
    B[n].name = n;
    B[n].position.set(...local[n].p);
  }
  for (const n of BONES) if (local[n].parent) B[local[n].parent!].add(B[n]);

  const root = new THREE.Group();
  root.name = def.name;
  const mesh = new THREE.SkinnedMesh(geometry, furMaterial(def.sheen ?? 1));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.add(B.hips);
  root.add(mesh);
  B.shoulderL.rotation.z = APOSE;
  B.shoulderR.rotation.z = -APOSE;
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONES.map((n) => B[n]));
  mesh.bind(skeleton);
  if (def.shells > 0) addFurShells(root, mesh, skeleton, def.shells, def.furLen);

  const face = buildFace(B.head, def.face);
  def.extras?.(B, W);

  // tail: rigid furry segments
  const tail: THREE.Object3D[] = [B.tail0];
  if (def.tail) {
    B.tail0.rotation.x = -(def.tail.droop ?? 1.1);
    let parent: THREE.Object3D = B.tail0;
    const tm = furMaterial(def.sheen ?? 1);
    const segLen = def.tail.r * 1.8;
    for (let i = 0; i < def.tail.segments; i++) {
      const seg = new THREE.Group();
      seg.position.y = i === 0 ? 0 : segLen;
      const r = def.tail.r * (1 - (i / def.tail.segments) * def.tail.taper);
      const g = new THREE.CapsuleGeometry(r, segLen * 0.7, 6, 12);
      const col = new THREE.Color(def.tail.colors[i % def.tail.colors.length]);
      const n = g.attributes.position.count, ca = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) col.toArray(ca, k * 3);
      g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
      const m = new THREE.Mesh(g, tm);
      m.position.y = segLen / 2;
      m.castShadow = true;
      seg.add(m);
      parent.add(seg);
      tail.push(seg);
      parent = seg;
    }
  }

  const G = (b: THREE.Bone) => b as unknown as THREE.Group;
  return {
    root, hipBase: def.hip, hips: G(B.hips), body: G(B.body), head: G(B.head),
    browL: face.browL, browR: face.browR, mouth: face.mouth,
    shoulderL: G(B.shoulderL), shoulderR: G(B.shoulderR), elbowL: G(B.elbowL), elbowR: G(B.elbowR),
    legL: G(B.legL), legR: G(B.legR), kneeL: G(B.kneeL), kneeR: G(B.kneeR),
    tail: tail as THREE.Group[],
    belly: mesh as unknown as THREE.Mesh,
  };
}

const gloss = (c: number, rough = 0.3) => new THREE.MeshPhysicalMaterial({ color: c, roughness: rough, clearcoat: 0.6, clearcoatRoughness: 0.2 });

function buildFace(head: THREE.Bone, F: FaceDef) {
  const white = gloss(0xffffff, 0.25), iris = gloss(F.iris, 0.3), pupil = gloss(0x16100d, 0.2);
  const browMat = new THREE.MeshStandardMaterial({ color: F.brow, roughness: 0.9 });
  let browL!: THREE.Mesh, browR!: THREE.Mesh;
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(s * F.eyeSep, F.eyeY, F.eyeZ);
    eye.rotation.y = s * (F.eyeYaw ?? 0.3);
    const r = F.eyeR;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), white);
    ball.scale.set(1, 1.12, 0.6);
    const ir = new THREE.Mesh(new THREE.SphereGeometry(r * 0.73, 20, 14), iris);
    ir.position.z = r * 0.34;
    ir.scale.set(1, 1.12, 0.55);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(r * 0.42, 16, 12), pupil);
    pu.position.z = r * 0.58;
    pu.scale.set(F.slit ? 0.45 : 0.8, F.slit ? 1.35 : 0.9, 0.4);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(r * 0.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    hl.position.set(-s * r * 0.2, r * 0.34, r * 0.75);
    eye.add(ball, ir, pu, hl);
    if (F.lids) {
      // heavy upper eyelid
      const lid = new THREE.Mesh(new THREE.SphereGeometry(r * 1.06, 20, 12, 0, Math.PI * 2, 0, Math.PI * (0.25 + 0.4 * F.lids)), new THREE.MeshStandardMaterial({ color: F.lidColor ?? 0x8fbf6a, roughness: 0.8 }));
      lid.scale.set(1, 1.12, 0.66);
      lid.rotation.x = 0.35;
      eye.add(lid);
    }
    head.add(eye);
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(F.eyeR * 0.2, (F.browW ?? F.eyeR * 1.1), 4, 8), browMat);
    brow.rotation.z = Math.PI / 2;
    const bw = new THREE.Group();
    bw.position.set(s * F.eyeSep * 1.05, F.browY, F.browZ);
    bw.add(brow);
    head.add(bw);
    if (s < 0) browL = bw as unknown as THREE.Mesh;
    else browR = bw as unknown as THREE.Mesh;
  }
  if (F.nose) {
    const nose = new THREE.Mesh(new THREE.SphereGeometry(F.nose.r, 16, 12), gloss(F.nose.color, 0.35));
    nose.position.set(0, F.nose.y, F.nose.z);
    nose.scale.set(1.25, 0.8, 0.8);
    head.add(nose);
  }
  const mr = F.mouthR ?? 0.045;
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(mr, mr * 0.24, 6, 16, Math.PI), new THREE.MeshBasicMaterial({ color: 0x3a1a12 }));
  mouth.position.set(0, F.mouthY, F.mouthZ);
  mouth.rotation.z = Math.PI;
  head.add(mouth);
  if (F.whiskers) {
    const L = F.whiskers;
    const wpts: number[] = [];
    const y0 = F.nose ? F.nose.y - 0.07 : F.mouthY + 0.05, z0 = F.nose ? F.nose.z - 0.02 : F.mouthZ;
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) wpts.push(s * 0.15, y0 + k * 0.03, z0, s * (0.15 + L), y0 - 0.06 + k * 0.08, z0 - 0.09);
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wpts, 3));
    head.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0xfff4e0 })));
  }
  return { browL, browR, mouth };
}

/**
 * Shell fur: N copies of the skinned body pushed further along the normals, drawing only noisy strands
 * that thin out toward the tips. Base shells are darker (self-shadowing), tips catch the light.
 */
export function addFurShells(root: THREE.Object3D, base: THREE.SkinnedMesh, skeleton: THREE.Skeleton, n: number, length: number, map?: THREE.Texture | null) {
  for (let i = 1; i <= n; i++) {
    const h = i / n;
    const mat = new THREE.MeshStandardMaterial(map ? { map, roughness: 0.9, alphaTest: 0.5 } : { vertexColors: true, roughness: 0.9, alphaTest: 0.5 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uShell = { value: h };
      sh.uniforms.uLen = { value: length };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float fur;\nuniform float uShell;\nuniform float uLen;\nvarying vec3 vRest;\nvarying float vFur;')
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>
          vRest = position;
          vFur = fur;
          transformed += normalize(objectNormal) * uShell * uLen * fur + vec3(0.0, -0.25, 0.0) * uShell * uShell * uLen * fur;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uShell;
          varying vec3 vRest;
          varying float vFur;
          float fh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
          float fn(vec3 x) {
            vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(fh(i), fh(i + vec3(1,0,0)), f.x), mix(fh(i + vec3(0,1,0)), fh(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(fh(i + vec3(0,0,1)), fh(i + vec3(1,0,1)), f.x), mix(fh(i + vec3(0,1,1)), fh(i + vec3(1,1,1)), f.x), f.y), f.z);
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float strand = fn(vRest * 330.0) * 0.65 + fn(vRest * 97.0 + 3.1) * 0.35;
          if (vFur < 0.5 || strand < 0.3 + uShell * 0.55) discard;
          diffuseColor.rgb *= mix(0.72, 1.12, uShell);`);
    };
    const shell = new THREE.SkinnedMesh(base.geometry, mat);
    shell.bind(skeleton, base.bindMatrix);
    shell.frustumCulled = false;
    shell.castShadow = false;
    shell.receiveShadow = true;
    shell.userData.isFur = true;
    root.add(shell);
  }
}
