// Humanoid mocap -> our 12-joint rigs. The clips (public/anims/human.glb, see tools/build-anims.mjs) are
// Mesh2Motion's CC0 library on the UE-mannequin skeleton. We sample each clip at 30 fps on that skeleton
// and rebuild every frame on our rig by matching world-space directions, which makes the result
// independent of the source's T-pose and of bone roll (the idea of Mesh2Motion's MIT Retargeter):
//  - limbs: the upper bone gets the source segment direction (upperarm->lowerarm, thigh->calf) and its
//    twist from the source elbow/knee hinge axis (learnt from the clips); the lower bone swings onto the
//    source lower segment (lowerarm->hand, calf->foot) with no extra twist, so elbows and knees stay
//    hinges. Near the relaxed pose the limb is rotated onto the character's sculpted rest pose (our
//    arms reach around the belly, a human's hang at its sides), fading out as the limb moves away, and
//    the sculpted elbow / knee bend is added to the source one;
//  - hips / body / head copy the source world-rotation change from rest of pelvis / spine_03 / head
//    (stance clips: re-centred on the upright sculpted torso, see RetargetOptions.upright);
//  - hips translation = pelvis offset from rest scaled by the leg-length ratio, horizontal travel
//    filtered so locomotion plays in place; while the source stands upright the height is corrected so
//    the lowest sole sits at the (scaled) height of the lowest source foot.
// The output is plain THREE.AnimationClips (`<bone>.quaternion`, `hips.position`) for an AnimationMixer
// rooted at rig.root.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ChonkRig } from './model';

export const RETARGET_FPS = 30;
const DOWN = new THREE.Vector3(0, -1, 0);

type Joint = 'hips' | 'body' | 'head' | 'shoulderL' | 'elbowL' | 'shoulderR' | 'elbowR' | 'legL' | 'kneeL' | 'legR' | 'kneeR';
const JOINTS: Joint[] = ['hips', 'body', 'head', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'legL', 'kneeL', 'legR', 'kneeR'];
const PARENT: Record<Joint, Joint | null> = {
  hips: null, body: 'hips', head: 'body', shoulderL: 'body', elbowL: 'shoulderL', shoulderR: 'body', elbowR: 'shoulderR',
  legL: 'hips', kneeL: 'legL', legR: 'hips', kneeR: 'legR',
};

interface Limb { up: Joint; low: Joint; src: [string, string, string]; leg: boolean }
const LIMBS: Limb[] = [
  { up: 'shoulderL', low: 'elbowL', src: ['upperarm_l', 'lowerarm_l', 'hand_l'], leg: false },
  { up: 'shoulderR', low: 'elbowR', src: ['upperarm_r', 'lowerarm_r', 'hand_r'], leg: false },
  { up: 'legL', low: 'kneeL', src: ['thigh_l', 'calf_l', 'foot_l'], leg: true },
  { up: 'legR', low: 'kneeR', src: ['thigh_r', 'calf_r', 'foot_r'], leg: true },
];
/** torso joints copy the world-rotation change of these source bones */
const SPINE: [Joint, string][] = [['hips', 'pelvis'], ['body', 'spine_03'], ['head', 'head']];
/** source bones we read every frame */
const SRC = ['pelvis', 'spine_03', 'head', ...LIMBS.flatMap((l) => l.src), 'ball_l', 'ball_r'];

/** one clip sampled at RETARGET_FPS on the source skeleton (world space: y up, faces +z, left = +x) */
export interface SampledClip {
  name: string;
  duration: number;
  frames: number;
  times: Float32Array;
  pos: Record<string, Float32Array>; // 3 floats per frame
  quat: Record<string, Float32Array>; // 4 floats per frame
}

export interface AnimLibrary {
  /** the source clips as loaded (they drive the source skeleton, not our rigs) */
  clips: Map<string, THREE.AnimationClip>;
  names: string[];
  /** source skeleton (scene graph root) */
  skeleton: THREE.Object3D;
  /** source rest pose, world space */
  restPos: Record<string, THREE.Vector3>;
  restQuat: Record<string, THREE.Quaternion>;
  /** source pelvis rest height (m) */
  hipHeight: number;
  /** source hip joints (thighs) rest height (m) */
  legHeight: number;
  /** rotation taking source world into our convention (y up, facing +z, left +x) */
  align: THREE.Quaternion;
  /** elbow / knee hinge axis in the upper bone's local frame, learnt from the clips */
  hinge: Record<string, THREE.Vector3>;
  /**
   * relaxed limb pose (average over calm clips), per upper source bone: upper segment direction,
   * hinge axis (world) and elbow / knee bend. It maps onto the target's sculpted rest pose.
   */
  neutral: Record<string, { dir: THREE.Vector3; hinge: THREE.Vector3; bend: number }>;
  sampled: Map<string, SampledClip>;
}

export interface RetargetOptions {
  /**
   * which part of the pelvis offset the hips keep: 'vertical' (y only), 'lateral' (y + x, the default:
   * locomotion in place but weight shifts kept), 'full' (y + x + z, e.g. a lunge that moves forward)
   */
  rootMotion?: 'vertical' | 'lateral' | 'full';
  /** keyframe rate of the output clips (default 30) */
  fps?: number;
  /**
   * Stance clips (idle / walk loops): re-centre the torso pitch on the sculpted rest. The torso copies
   * the source's rotation change from its T-pose, and a relaxed human's upper back curves ~15 deg
   * forward of it (pelvis ~5 deg back): on our one-bone torso that tips the whole belly and head
   * forward. When set, the clip's mean pitch of the pelvis / spine / head is removed (sway and
   * breathing stay) and the chest keeps this forward lean (rad). The legs are re-centred too: each
   * thigh's mean direction maps onto the sculpted rest.
   */
  upright?: number;
  /**
   * what `upright` measures: the clip's mean pitch (loops, default) or its first frame (one-shot
   * gestures that start from the relaxed stance; there only a forward hunch of the chest / head is
   * removed, an expressive lean back is kept)
   */
  uprightFrom?: 'mean' | 'start';
}

// ---------------------------------------------------------------------------------------------------
// source library

export async function loadAnimLibrary(url: string): Promise<AnimLibrary> {
  return animLibraryFromGLTF(await new GLTFLoader().loadAsync(url));
}

export function animLibraryFromGLTF(gltf: GLTF): AnimLibrary {
  const skeleton = gltf.scene;
  skeleton.updateMatrixWorld(true);
  const restPos: Record<string, THREE.Vector3> = {};
  const restQuat: Record<string, THREE.Quaternion> = {};
  for (const n of SRC) {
    const o = skeleton.getObjectByName(n);
    if (!o) throw new Error(`animation library: missing bone ${n}`);
    restPos[n] = o.getWorldPosition(new THREE.Vector3());
    restQuat[n] = o.getWorldQuaternion(new THREE.Quaternion());
  }
  // facing: the toes point forward, up is +y (the exporter's Z-up root rotation is already in the world)
  const fwd = restPos.ball_l.clone().add(restPos.ball_r).sub(restPos.foot_l).sub(restPos.foot_r).setY(0).normalize();
  const align = new THREE.Quaternion().setFromUnitVectors(fwd, new THREE.Vector3(0, 0, 1));
  const left = restPos.upperarm_l.clone().sub(restPos.upperarm_r).applyQuaternion(align);
  if (left.x <= 0) throw new Error('animation library: *_l bones are not on the left (mirrored skeleton?)');
  for (const n of SRC) {
    restPos[n].applyQuaternion(align);
    restQuat[n].premultiply(align);
  }
  const clips = new Map(gltf.animations.map((c) => [c.name, c]));
  const lib: AnimLibrary = {
    clips, names: [...clips.keys()], skeleton, restPos, restQuat,
    hipHeight: restPos.pelvis.y, legHeight: (restPos.thigh_l.y + restPos.thigh_r.y) / 2, align, hinge: {}, neutral: {}, sampled: new Map(),
  };
  learnHinges(lib);
  const neutral = NEUTRAL_CLIPS.filter((n) => clips.has(n));
  learnNeutral(lib, neutral.length ? neutral : lib.names.slice(0, 1));
  return lib;
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _axisX = new THREE.Vector3(1, 0, 0);

/** sample a source clip (cached) */
export function sampleClip(lib: AnimLibrary, name: string): SampledClip {
  const hit = lib.sampled.get(name);
  if (hit) return hit;
  const clip = lib.clips.get(name);
  if (!clip) throw new Error(`no clip ${name}`);
  const nodes: THREE.Object3D[] = [];
  lib.skeleton.traverse((o) => nodes.push(o));
  const rest = nodes.map((o) => [o.position.clone(), o.quaternion.clone(), o.scale.clone()] as const);
  const drive: { node: THREE.Object3D; prop: 'position' | 'quaternion' | 'scale'; interp: THREE.Interpolant }[] = [];
  for (const track of clip.tracks) {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
    const node = lib.skeleton.getObjectByName(nodeName);
    if (!node || !(propertyName === 'position' || propertyName === 'quaternion' || propertyName === 'scale')) continue;
    drive.push({ node, prop: propertyName, interp: (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant() });
  }
  const objs = SRC.map((n) => lib.skeleton.getObjectByName(n)!);
  const frames = Math.max(2, Math.round(clip.duration * RETARGET_FPS) + 1);
  const s: SampledClip = { name, duration: clip.duration, frames, times: new Float32Array(frames), pos: {}, quat: {} };
  for (const n of SRC) {
    s.pos[n] = new Float32Array(frames * 3);
    s.quat[n] = new Float32Array(frames * 4);
  }
  for (let i = 0; i < frames; i++) {
    const t = Math.min(clip.duration, i / RETARGET_FPS);
    s.times[i] = t;
    for (const d of drive) {
      const r = d.interp.evaluate(t);
      if (d.prop === 'quaternion') d.node.quaternion.fromArray(r).normalize();
      else d.node[d.prop].fromArray(r);
    }
    lib.skeleton.updateMatrixWorld(true);
    objs.forEach((o, k) => {
      const n = SRC[k];
      o.matrixWorld.decompose(_v, _q, _w);
      _v.applyQuaternion(lib.align).toArray(s.pos[n], i * 3);
      _q.premultiply(lib.align).toArray(s.quat[n], i * 4);
    });
  }
  nodes.forEach((o, k) => {
    o.position.copy(rest[k][0]);
    o.quaternion.copy(rest[k][1]);
    o.scale.copy(rest[k][2]);
  });
  lib.skeleton.updateMatrixWorld(true);
  lib.sampled.set(name, s);
  return s;
}

const vec = (a: Float32Array, i: number, out = new THREE.Vector3()) => out.fromArray(a, i * 3);
const quat = (a: Float32Array, i: number, out = new THREE.Quaternion()) => out.fromArray(a, i * 4);

/**
 * Elbow / knee hinge axis in the upper bone's frame: the average of upper x lower over every frame of
 * every clip (elbows and knees only bend one way, so the bent frames all agree). Independent of the
 * rest pose and of bone roll.
 */
function learnHinges(lib: AnimLibrary) {
  const acc: Record<string, THREE.Vector3> = {};
  for (const l of LIMBS) acc[l.src[0]] = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Quaternion();
  for (const name of lib.names) {
    const s = sampleClip(lib, name);
    for (const l of LIMBS) {
      const [u, lo, e] = l.src;
      for (let i = 0; i < s.frames; i++) {
        vec(s.pos[u], i, a);
        vec(s.pos[lo], i, b);
        vec(s.pos[e], i, c);
        const n = _v.subVectors(b, a).normalize().cross(_w.subVectors(c, b).normalize());
        acc[u].add(n.applyQuaternion(quat(s.quat[u], i, q).invert()));
      }
    }
  }
  for (const l of LIMBS) {
    const u = l.src[0];
    if (acc[u].lengthSq() < 1e-8) {
      // no bent frame at all: fall back to the anatomical axis in the rest pose
      const dir = lib.restPos[l.src[1]].clone().sub(lib.restPos[u]).normalize();
      acc[u] = hingeRef(dir, l.leg).applyQuaternion(lib.restQuat[u].clone().invert());
    }
    lib.hinge[u] = acc[u].normalize();
  }
}

/** clips whose average pose is the relaxed, symmetric stance (Idle_A holds the arms back) */
const NEUTRAL_CLIPS = ['Head Nod', 'Walk'];

/** signed angle from u to l around axis h */
const signedAngle = (u: THREE.Vector3, l: THREE.Vector3, h: THREE.Vector3) => Math.atan2(_w.crossVectors(u, l).dot(h), u.dot(l));

function learnNeutral(lib: AnimLibrary, names: string[]) {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Quaternion();
  for (const l of LIMBS) {
    const [su, sl, se] = l.src;
    const dir = new THREE.Vector3(), hinge = new THREE.Vector3();
    let n = 0, bend = 0;
    for (const s of names.map((nm) => sampleClip(lib, nm))) {
      for (let i = 0; i < s.frames; i++) {
        vec(s.pos[su], i, a); vec(s.pos[sl], i, b); vec(s.pos[se], i, c);
        const du = b.clone().sub(a).normalize(), h = lib.hinge[su].clone().applyQuaternion(quat(s.quat[su], i, q));
        dir.add(du);
        hinge.add(h);
        bend += signedAngle(du, c.sub(b).normalize(), h);
        n++;
      }
    }
    if (!n) dir.copy(DOWN);
    dir.normalize();
    if (!n) hinge.copy(hingeRef(dir, l.leg));
    hinge.addScaledVector(dir, -hinge.dot(dir)).normalize();
    lib.neutral[su] = { dir, hinge, bend: n ? bend / n : 0 };
  }
}

/** anatomical hinge axis for a limb pointing along `dir` (elbows bend forward, knees backward) */
function hingeRef(dir: THREE.Vector3, leg: boolean) {
  const f = new THREE.Vector3(0, 0, leg ? -1 : 1);
  const h = dir.clone().cross(f);
  if (h.lengthSq() < 1e-6) h.set(dir.z * (leg ? -1 : 1), 0, 0); // limb along +-z: the side axis
  return h.normalize();
}

// ---------------------------------------------------------------------------------------------------
// target rig

export interface TargetRig {
  bones: Record<Joint, THREE.Object3D>;
  /** rest (bind) pose in rig.root space */
  restPos: Record<Joint, THREE.Vector3>;
  restQuat: Record<Joint, THREE.Quaternion>;
  /** rotation of the hips' parent in rig.root space */
  hipsParent: THREE.Quaternion;
  hipsParentPos: THREE.Vector3;
  /** rest direction (root space) and length of each limb segment: upper = joint->child joint, lower = joint->paw / sole */
  seg: Record<Joint, { dir: THREE.Vector3; len: number }>;
  hipHeight: number;
  /** hip joints (legL / legR) rest height */
  legHeight: number;
}

/**
 * Rest pose and limb geometry of one of our rigs. The rest is the skin's bind pose when the rig has a
 * skinned mesh (so call this on any rig, animated or not), else the rig's current pose. The forearm and
 * shin directions come from the mesh: elbow -> tip of the paw, knee -> centre of the sole.
 */
export function describeRig(rig: ChonkRig): TargetRig {
  const bones = {} as Record<Joint, THREE.Object3D>;
  for (const j of JOINTS) {
    bones[j] = rig[j];
    if (!bones[j].name) bones[j].name = j; // tracks bind by name
  }
  rig.root.updateMatrixWorld(true);
  const rootInv = rig.root.matrixWorld.clone().invert();
  const mesh = rig.belly as unknown as THREE.SkinnedMesh;
  const skel = mesh.isSkinnedMesh ? mesh.skeleton : null;
  const restPos = {} as Record<Joint, THREE.Vector3>, restQuat = {} as Record<Joint, THREE.Quaternion>;
  const m = new THREE.Matrix4(), sc = new THREE.Vector3();
  for (const j of JOINTS) {
    const k = skel ? skel.bones.indexOf(bones[j] as THREE.Bone) : -1;
    // bind pose: the skeleton was bound with the rig root at the origin (gltfRig.ts / creature.ts)
    if (k >= 0) m.copy(skel!.boneInverses[k]).invert();
    else m.multiplyMatrices(rootInv, bones[j].matrixWorld);
    restPos[j] = new THREE.Vector3();
    restQuat[j] = new THREE.Quaternion();
    m.decompose(restPos[j], restQuat[j], sc);
  }
  const hp = bones.hips.parent!;
  hp.updateMatrixWorld(true);
  m.multiplyMatrices(rootInv, hp.matrixWorld);
  const hipsParentPos = new THREE.Vector3(), hipsParent = new THREE.Quaternion();
  m.decompose(hipsParentPos, hipsParent, sc);

  const seg = {} as TargetRig['seg'];
  for (const l of LIMBS) {
    const d = restPos[l.low].clone().sub(restPos[l.up]);
    seg[l.up] = { dir: d.clone().normalize(), len: d.length() };
    const end = skel ? limbEnd(mesh, skel, bones[l.low], restPos[l.low], l.leg) : null;
    if (end && end.distanceTo(restPos[l.low]) > 1e-3) {
      const e = end.sub(restPos[l.low]);
      seg[l.low] = { dir: e.clone().normalize(), len: e.length() };
    } else seg[l.low] = { dir: seg[l.up].dir.clone(), len: seg[l.up].len }; // straight limb
  }
  return { bones, restPos, restQuat, hipsParent, hipsParentPos, seg, hipHeight: rig.hipBase, legHeight: (restPos.legL.y + restPos.legR.y) / 2 };
}

/** bind-pose end of a lower limb from the skin: arms -> paw tip, legs -> centre of the sole */
function limbEnd(mesh: THREE.SkinnedMesh, skel: THREE.Skeleton, bone: THREE.Object3D, joint: THREE.Vector3, leg: boolean) {
  const g = mesh.geometry;
  const P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  if (!P || !SI || !SW) return null;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < P.count; i++) {
    let best = -1, bw = 0;
    for (let c = 0; c < 4; c++) {
      const w = SW.getComponent(i, c);
      if (w > bw) { bw = w; best = SI.getComponent(i, c); }
    }
    if (skel.bones[best] === bone && bw > 0.5) pts.push(new THREE.Vector3().fromBufferAttribute(P, i).applyMatrix4(mesh.bindMatrix));
  }
  if (pts.length < 8) return null;
  let sel: THREE.Vector3[];
  if (leg) {
    const minY = Math.min(...pts.map((p) => p.y));
    const lim = minY + 0.15 * (joint.y - minY);
    sel = pts.filter((p) => p.y <= lim);
  } else {
    const d = pts.map((p) => p.distanceTo(joint)).sort((a, b) => b - a);
    const lim = d[Math.floor(d.length * 0.1)];
    sel = pts.filter((p) => p.distanceTo(joint) >= lim);
  }
  const c = new THREE.Vector3();
  for (const p of sel) c.add(p);
  return c.divideScalar(sel.length);
}

// ---------------------------------------------------------------------------------------------------
// retargeting

const basis = (u: THREE.Vector3, h: THREE.Vector3) => new THREE.Matrix4().makeBasis(u, h, new THREE.Vector3().crossVectors(u, h));
const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** source contact height: lowest foot / ball point relative to its rest height */
const FEET = ['foot_l', 'ball_l', 'foot_r', 'ball_r'];

/**
 * Retarget library clips onto a rig. Returns AnimationClips (keyed by source clip name) for an
 * AnimationMixer whose root is rig.root. All clips by default.
 */
export function retargetClips(lib: AnimLibrary, rig: ChonkRig, names: string[] = lib.names, opts: RetargetOptions | ((name: string) => RetargetOptions) = {}): Map<string, THREE.AnimationClip> {
  const T = describeRig(rig);
  const out = new Map<string, THREE.AnimationClip>();
  for (const n of names) out.set(n, retargetClip(lib, T, n, typeof opts === 'function' ? opts(n) : opts));
  return out;
}

/** target / source leg length (hip joints above the ground): scales hips motion and ground speed */
export const legScale = (lib: AnimLibrary, T: TargetRig) => T.legHeight / lib.legHeight;

export function retargetClip(lib: AnimLibrary, T: TargetRig, name: string, opts: RetargetOptions = {}): THREE.AnimationClip {
  const s = sampleClip(lib, name);
  const fps = opts.fps ?? RETARGET_FPS;
  const frames = Math.max(2, Math.round(s.duration * fps) + 1);
  const times = new Float32Array(frames);
  const q = {} as Record<Joint, Float32Array>;
  for (const j of JOINTS) q[j] = new Float32Array(frames * 4);
  const hipsPos = new Float32Array(frames * 3);
  const scale = legScale(lib, T);
  const mode = opts.rootMotion ?? 'lateral';
  const inv = (j: Joint) => T.restQuat[j].clone().invert();

  // Per limb constants.
  //  hang: takes the source's relaxed limb direction (idle) onto the target's sculpted rest direction
  //    (our arms reach forward around the belly, a human's hang at its sides): applied in full near the
  //    relaxed pose, faded out as the limb moves away (punches, raised arms keep their exact direction);
  //  bend: added to the source elbow / knee angle. Arms: sculpted minus relaxed source angle (a relaxed
  //    arm gives the sculpted arm); legs: the sculpted angle (a straight source leg gives the sculpted
  //    leg; it mostly accounts for the sole centre sitting ahead of the knee). The result never
  //    straightens past the sculpted shape or a straight limb.
  //  restFrame: target rest frame (upper segment direction + hinge axis), inverted.
  const limbs = LIMBS.map((l) => {
    const u = T.seg[l.up].dir, lo = T.seg[l.low].dir, N = lib.neutral[l.src[0]];
    const hang = new THREE.Quaternion().setFromUnitVectors(N.dir, u);
    const hRest = N.hinge.clone().applyQuaternion(hang);
    hRest.addScaledVector(u, -hRest.dot(u)).normalize();
    const restBend = signedAngle(u, lo, hRest);
    // stance clips: each thigh's mean direction over the clip maps onto the sculpted rest (the human idle
    // stands staggered, one foot back; the walk swings the feet mostly behind the hips), so the legs
    // stand under the body and the stance / gait keeps only its swing around it
    let stance: { hang: THREE.Quaternion; dir: THREE.Vector3 } | null = null;
    if (l.leg && opts.upright !== undefined && opts.uprightFrom !== 'start') {
      const dir = new THREE.Vector3();
      for (let i = 0; i < s.frames; i++) dir.add(vec(s.pos[l.src[1]], i, _v).sub(vec(s.pos[l.src[0]], i, _w)).normalize());
      dir.normalize();
      stance = { hang: new THREE.Quaternion().setFromUnitVectors(dir, u), dir };
    }
    return {
      l, hang, N, stance,
      bend: restBend - (l.leg ? 0 : N.bend),
      minBend: Math.min(0, restBend),
      restFrame: basis(u, hRest).transpose(), // orthonormal: transpose = inverse
      lowLocal: lo.clone().applyQuaternion(inv(l.low)),
      lowRestLocal: inv(l.up).multiply(T.restQuat[l.low]),
      // forward kinematics for the foot contact
      upOff: T.restPos[l.up].clone().sub(T.restPos.hips).applyQuaternion(inv('hips')),
      lowOff: T.restPos[l.low].clone().sub(T.restPos[l.up]).applyQuaternion(inv(l.up)),
    };
  });
  const legs = limbs.filter((L) => L.l.leg);
  const soleRest = Math.min(...legs.map((L) => T.restPos[L.l.low].y + T.seg[L.l.low].dir.y * T.seg[L.l.low].len));
  const srcRestInv = Object.fromEntries(SPINE.map(([, b]) => [b, lib.restQuat[b].clone().invert()]));
  // upright stance: a pitch (about the side axis) that cancels each spine bone's mean forward lean
  const pitchFix = Object.fromEntries(SPINE.map(([j, b]) => {
    const fix = new THREE.Quaternion();
    if (opts.upright !== undefined) {
      const start = opts.uprightFrom === 'start', n = start ? 1 : s.frames;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        _w.set(0, 1, 0).applyQuaternion(quat(s.quat[b], i, _q).multiply(srcRestInv[b]));
        sum += Math.atan2(_w.z, _w.y);
      }
      const fwd = sum / n - (j === 'body' ? opts.upright : 0);
      fix.setFromAxisAngle(_axisX, start && j !== 'hips' ? -Math.max(0, fwd) : -fwd);
    }
    return [b, fix];
  }));
  const world = {} as Record<Joint, THREE.Quaternion>;
  for (const j of JOINTS) world[j] = new THREE.Quaternion();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), du = new THREE.Vector3(), h = new THREE.Vector3(), dl = new THREE.Vector3();
  const qs = new THREE.Quaternion(), A = new THREE.Quaternion(), loc = new THREE.Quaternion(), prev = new THREE.Quaternion();
  const R = new THREE.Matrix4(), off = new THREE.Vector3(), fk = new THREE.Vector3(), up = new THREE.Vector3();
  const hipsParentInv = T.hipsParent.clone().invert();
  const ID = new THREE.Quaternion();

  for (let i = 0; i < frames; i++) {
    const t = Math.min(s.duration, i / fps);
    times[i] = t;
    // the source is sampled at RETARGET_FPS: interpolate between the two nearest samples
    const f = t * RETARGET_FPS, i0 = Math.min(s.frames - 1, Math.floor(f)), i1 = Math.min(s.frames - 1, i0 + 1), k = f - i0;
    const P = (bone: string, out: THREE.Vector3) => vec(s.pos[bone], i0, out).lerp(_v.fromArray(s.pos[bone], i1 * 3), k);
    const Q = (bone: string, out: THREE.Quaternion) => quat(s.quat[bone], i0, out).slerp(_q.fromArray(s.quat[bone], i1 * 4), k);

    // torso: world-rotation change from rest
    for (const [j, src] of SPINE) world[j].multiplyQuaternions(Q(src, qs).multiply(srcRestInv[src]).premultiply(pitchFix[src]), T.restQuat[j]);
    // limbs
    for (const L of limbs) {
      const [su, sl, se] = L.l.src;
      P(su, a); P(sl, b); P(se, c);
      du.subVectors(b, a).normalize();
      dl.subVectors(c, b).normalize();
      // hinge axis carried by the source upper bone (fixes the twist, even with a straight limb)
      h.copy(lib.hinge[su]).applyQuaternion(Q(su, qs));
      h.addScaledVector(du, -h.dot(du));
      if (h.lengthSq() < 1e-8) h.copy(hingeRef(du, L.l.leg));
      h.normalize();
      const srcBend = signedAngle(du, dl, h);
      if (L.stance) A.copy(ID).slerp(L.stance.hang, smooth(du.dot(L.stance.dir), 0, 1));
      else A.copy(ID).slerp(L.hang, smooth(du.dot(L.N.dir), 0, 1));
      du.applyQuaternion(A);
      h.applyQuaternion(A);
      dl.applyQuaternion(A).applyAxisAngle(h, Math.max(L.minBend, srcBend + L.bend) - srcBend);
      R.multiplyMatrices(basis(du, h), L.restFrame);
      world[L.l.up].setFromRotationMatrix(R).multiply(T.restQuat[L.l.up]);
      // lower bone: no-twist swing from where it would point with a rest elbow / knee
      const lw = world[L.l.low].multiplyQuaternions(world[L.l.up], L.lowRestLocal);
      const cur = _w.copy(L.lowLocal).applyQuaternion(lw);
      lw.premultiply(qs.setFromUnitVectors(cur, dl));
    }
    // to local, keeping quaternion signs continuous
    for (const j of JOINTS) {
      const p = PARENT[j];
      if (p) loc.copy(world[p]).invert().multiply(world[j]);
      else loc.copy(hipsParentInv).multiply(world[j]);
      if (i > 0 && loc.dot(prev.fromArray(q[j], (i - 1) * 4)) < 0) loc.set(-loc.x, -loc.y, -loc.z, -loc.w);
      loc.toArray(q[j], i * 4);
    }
    // hips translation: pelvis offset from rest scaled by the leg ratio, horizontal travel filtered
    P('pelvis', off).sub(lib.restPos.pelvis);
    if (mode !== 'full') off.z = 0;
    if (mode === 'vertical') off.x = 0;
    off.multiplyScalar(scale).add(T.restPos.hips);
    // foot contact: while the source stands upright, put the lowest target sole at the (scaled) height
    // of the lowest source foot, so crouches and steps neither float nor sink with our leg proportions
    const upright = smooth(P('spine_03', up).sub(P('pelvis', a)).normalize().y, 0.4, 0.8);
    if (upright > 0) {
      let lowest = Infinity;
      for (const L of legs) {
        fk.copy(L.upOff).applyQuaternion(world.hips).add(off);
        fk.add(b.copy(L.lowOff).applyQuaternion(world[L.l.up]));
        fk.add(b.copy(L.lowLocal).applyQuaternion(world[L.l.low]).multiplyScalar(T.seg[L.l.low].len));
        lowest = Math.min(lowest, fk.y);
      }
      let srcLow = Infinity;
      for (const ft of FEET) srcLow = Math.min(srcLow, P(ft, a).y - lib.restPos[ft].y);
      off.y += upright * (soleRest + srcLow * scale - lowest);
    }
    off.sub(T.hipsParentPos).applyQuaternion(hipsParentInv);
    off.toArray(hipsPos, i * 3);
  }
  const tracks: THREE.KeyframeTrack[] = JOINTS.map((j) => new THREE.QuaternionKeyframeTrack(`${T.bones[j].name}.quaternion`, times, q[j]));
  tracks.push(new THREE.VectorKeyframeTrack(`${T.bones.hips.name}.position`, times, hipsPos));
  return new THREE.AnimationClip(name, s.duration, tracks);
}

// ---------------------------------------------------------------------------------------------------
// clip info

export function clipDuration(lib: AnimLibrary, name: string) {
  const c = lib.clips.get(name);
  if (!c) throw new Error(`no clip ${name}`);
  return c.duration;
}

/**
 * Natural ground speed of a locomotion clip (m/s, in source metres; pass the rig to get it at the rig's
 * scale): the pelvis travel if the clip moves, else the speed at which the planted foot slides back
 * under the in-place body. Playback rate to match a character moving at v m/s: v / clipGroundSpeed(...).
 */
export function clipGroundSpeed(lib: AnimLibrary, name: string, rig?: ChonkRig | TargetRig) {
  const s = sampleClip(lib, name);
  const k = rig ? legScale(lib, 'seg' in rig ? rig : describeRig(rig)) : 1;
  const n = s.frames;
  const a = vec(s.pos.pelvis, 0), b = vec(s.pos.pelvis, n - 1);
  const travel = Math.hypot(b.x - a.x, b.z - a.z);
  if (travel > 0.1 * s.duration) return (travel / s.duration) * k;
  // in place: how fast the planted foot slides back under the body (each stance = a run of frames
  // with the ball of the foot near its lowest point)
  let dist = 0, time = 0;
  for (const foot of ['ball_l', 'ball_r']) {
    const F = s.pos[foot];
    let minY = Infinity;
    for (let i = 0; i < n; i++) minY = Math.min(minY, F[i * 3 + 1]);
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const down = i < n && F[i * 3 + 1] < minY + 0.04;
      if (down && start < 0) start = i;
      if (!down && start >= 0) {
        if (i - 1 - start >= 2) {
          dist += Math.hypot(F[(i - 1) * 3] - F[start * 3], F[(i - 1) * 3 + 2] - F[start * 3 + 2]);
          time += s.times[i - 1] - s.times[start];
        }
        start = -1;
      }
    }
  }
  return time > 0 ? (dist / time) * k : 0;
}
