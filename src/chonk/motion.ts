// Mocap-driven animation for the pipeline characters: CC0 human clips (Mesh2Motion / Quaternius,
// retargeted in retarget.ts) on an AnimationMixer, with a procedural layer on top for what mocap can't
// know about a chubby cat: breathing, belly jiggle, the tail, and the belly bump special.
// Same update(AnimInput, dt) interface as the procedural Animator, so fighters and NPCs use either.
//
// Locomotion: Walk and Jog share one gait phase (they start on the same foot), so the blend never
// scissors, and the phase advances with ground speed: cadence is chosen per speed (quick little steps,
// a fat cat patters) and the thigh swing is scaled so the planted foot moves at the ground speed (no
// sliding, also while slowing to a stop). The human Jog leans ~40 deg forward and sinks the hips, which
// on a short-legged cat reads as crawling: after the mixer the hips / chest / head are pulled back
// toward upright and the hips lifted (legs keep their swing), and a walk gets a small hop and a waddle.
// Sprint (more lean still) is not used: the jog played faster carries the sprint. Turning on the spot
// takes little steps. In deep water a procedural dog paddle replaces all of it (no swim clip exists).
// NPC body language: AnimInput.gesture plays an upper-body clip over idle / walk, AnimInput.lookAt turns
// the head (and a little of the chest) toward a point.
import * as THREE from 'three';
import { Animator, type AnimInput, type MoveName } from './animator';
import type { ChonkRig } from './model';
import { clipGroundSpeed, describeRig, loadAnimLibrary, retargetClips, type AnimLibrary, type TargetRig } from './retarget';
import { clamp, damp } from '../core/math';

let lib: AnimLibrary | null = null;
export async function initMotionLibrary() {
  try {
    lib = await loadAnimLibrary(`${import.meta.env.BASE_URL}anims/human.glb`);
  } catch (e) {
    console.warn('animation library unavailable, using procedural animation', e);
  }
}

const LOCO = { idle: 'Idle_A', fight: 'Fighting Idle', talk: 'Idle_Talking', walk: 'Walk', jog: 'Jog' };
const MOVE_CLIP: Partial<Record<MoveName, string>> = { jab: 'Punch_Jab', cross: 'Punch_Cross', kick: 'Kick_Breach', slam: 'Attack_Ground_Pound', belly: 'Power Up' };
type Gesture = NonNullable<AnimInput['gesture']>;
/** gesture -> clips (alternating when there are several), played on the upper body only */
const GESTURE_CLIP: Record<Gesture, string[]> = {
  wave: ['Greeting', 'Cheer_One_arm'], nod: ['Head Nod'], yes: ['Yes'], talk: [LOCO.talk],
  cheer: ['Cheering_Two_Hands', 'Victory Fist Pump'], angry: ['Angry', 'Insult'],
};
const UPPER: J[] = ['body', 'head', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR'];
const USED = [...new Set([...Object.values(LOCO), ...Object.values(MOVE_CLIP), ...Object.values(GESTURE_CLIP).flat(), 'Jump_air', 'Jump_Land', 'Hit_Chest', 'Hit_Knockback', 'Death_D'])];

/** the joints the clips drive, parents first */
const JOINTS = ['hips', 'body', 'head', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'legL', 'kneeL', 'legR', 'kneeR'] as const;
type J = (typeof JOINTS)[number];
const PARENT: Record<J, J | null> = {
  hips: null, body: 'hips', head: 'body', shoulderL: 'body', elbowL: 'shoulderL', shoulderR: 'body', elbowR: 'shoulderR',
  legL: 'hips', kneeL: 'legL', legR: 'hips', kneeR: 'legR',
};
/** a joint and everything below it */
const SUB = Object.fromEntries(JOINTS.map((j) => [j, JOINTS.filter((c) => { for (let p: J | null = c; p; p = PARENT[p]) if (p === j) return true; return false; })])) as Record<J, J[]>;

interface ClipSet {
  clips: Map<string, THREE.AnimationClip>;
  /** natural ground speed (m/s at the rig's scale) and distance per gait cycle (m) of the walk / jog */
  speed: Record<string, number>;
  cycle: Record<string, number>;
  /** bind pose rotations in rig.root space, and the hips' parent rotation */
  rest: Record<J, THREE.Quaternion>;
  restInv: Record<J, THREE.Quaternion>;
  /** gesture clips with the upper-body tracks only (keyed by source clip name) */
  upper: Map<string, THREE.AnimationClip>;
  /** head joint, bind pose, rig.root space */
  headPos: THREE.Vector3;
  /** leg forward kinematics from the bind pose (rig.root space): hip joint, knee and sole offsets */
  legFK: { leg: 'legL' | 'legR'; knee: 'kneeL' | 'kneeR'; hip: THREE.Vector3; knee2: THREE.Vector3; sole: THREE.Vector3 }[];
  soleRestY: number;
  hipsParent: THREE.Quaternion;
  hipsParentInv: THREE.Quaternion;
}
const cache = new Map<string, ClipSet>();

function clipsFor(rig: ChonkRig): ClipSet | null {
  if (!lib) return null;
  const key = rig.root.name;
  let set = cache.get(key);
  if (!set) {
    const names = USED.filter((n) => lib!.clips.has(n));
    const clips = retargetClips(lib, rig, names);
    const T = describeRig(rig);
    const speed: Record<string, number> = {}, cycle: Record<string, number> = {};
    for (const n of [LOCO.walk, LOCO.jog]) {
      if (!clips.has(n)) continue;
      // measured on the rig itself: our rigid paws plant differently from the human ball of the foot
      speed[n] = Math.max(0.2, rigGroundSpeed(rig, T, clips.get(n)!) || clipGroundSpeed(lib, n, T));
      cycle[n] = speed[n] * clips.get(n)!.duration;
    }
    const rest = {} as Record<J, THREE.Quaternion>, restInv = {} as Record<J, THREE.Quaternion>;
    for (const j of JOINTS) {
      rest[j] = T.restQuat[j].clone();
      restInv[j] = rest[j].clone().invert();
    }
    const upperBones = new Set(UPPER.map((j) => T.bones[j].name));
    const upper = new Map<string, THREE.AnimationClip>();
    for (const n of Object.values(GESTURE_CLIP).flat()) {
      const c = clips.get(n);
      if (!c) continue;
      const tracks = c.tracks.filter((t) => upperBones.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName));
      upper.set(n, new THREE.AnimationClip(`${n}:upper`, c.duration, tracks));
    }
    cache.set(key, (set = {
      clips, speed, cycle, rest, restInv, upper, headPos: T.restPos.head.clone(),
      legFK: ([['legL', 'kneeL'], ['legR', 'kneeR']] as const).map(([leg, knee]) => ({
        leg, knee,
        hip: T.restPos[leg].clone().sub(T.restPos.hips),
        knee2: T.restPos[knee].clone().sub(T.restPos[leg]),
        sole: T.seg[knee].dir.clone().multiplyScalar(T.seg[knee].len),
      })),
      soleRestY: Math.min(...(['kneeL', 'kneeR'] as const).map((k) => T.restPos[k].y + T.seg[k].dir.y * T.seg[k].len)),
      hipsParent: T.hipsParent.clone(), hipsParentInv: T.hipsParent.clone().invert(),
    }));
  }
  return set;
}

/**
 * Natural ground speed (m/s) of an in-place locomotion clip on a rig: how fast the planted paw (the sole
 * centre, within 1.5 cm of its lowest point) moves back under the body. 0 if no stance was found.
 */
function rigGroundSpeed(rig: ChonkRig, T: TargetRig, clip: THREE.AnimationClip) {
  const saved = JOINTS.map((j) => [rig[j].position.clone(), rig[j].quaternion.clone()] as const);
  const mixer = new THREE.AnimationMixer(rig.root);
  mixer.clipAction(clip).play();
  const n = Math.max(16, Math.round(clip.duration * 120));
  const rootInv = new THREE.Matrix4();
  const feet = (['kneeL', 'kneeR'] as const).map((k) => ({
    bone: rig[k],
    local: T.seg[k].dir.clone().applyQuaternion(T.restQuat[k].clone().invert()).multiplyScalar(T.seg[k].len),
    pts: [] as THREE.Vector3[],
  }));
  for (let i = 0; i <= n; i++) {
    mixer.setTime((i / n) * clip.duration);
    rig.root.updateMatrixWorld(true);
    rootInv.copy(rig.root.matrixWorld).invert();
    for (const f of feet) f.pts.push(f.bone.localToWorld(f.local.clone()).applyMatrix4(rootInv));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(rig.root);
  JOINTS.forEach((j, k) => {
    rig[j].position.copy(saved[k][0]);
    rig[j].quaternion.copy(saved[k][1]);
  });
  const minY = Math.min(...feet.flatMap((f) => f.pts.map((p) => p.y)));
  const dt = clip.duration / n;
  let dist = 0, time = 0;
  for (const f of feet) for (let i = 1; i <= n; i++) {
    if (f.pts[i].y > minY + 0.015 || f.pts[i - 1].y > minY + 0.015) continue;
    dist += f.pts[i - 1].z - f.pts[i].z;
    time += dt;
  }
  return time > 0 ? Math.max(0, dist / time) : 0;
}

export interface CharacterAnimator {
  update(inp: AnimInput, dt: number): void;
}

/** mocap animation when the library and the rig allow it, else the procedural animator */
export function makeAnimator(rig: ChonkRig): CharacterAnimator {
  const set = rig.belly && (rig.belly as unknown as THREE.SkinnedMesh).isSkinnedMesh && rig.root.userData.mocap !== false ? clipsFor(rig) : null;
  return set ? new Motion(rig, set) : new Animator(rig);
}

export class Motion implements CharacterAnimator {
  private mixer: THREE.AnimationMixer;
  private act = new Map<string, THREE.AnimationAction>();
  private oneShot: THREE.AnimationAction | null = null;
  private oneShotMove: MoveName | null = null;
  private wasGrounded = true;
  private lastHurt = Infinity;
  private belly = 0;
  private bellyV = 0;
  private lastHipsY: number;
  private hipsVy = 0;
  private koPlayed = false;
  /** gait cycle phase (0..1), shared by walk and jog */
  private phase = 0;
  /** swim blend (0..1) and paddle phase (rad) */
  private swim = 0;
  private swimPh = 0;
  /** upper-body gesture in progress */
  private gestureAct: THREE.AnimationAction | null = null;
  private lastGesture: Gesture | null = null;
  private gestureFading = false;
  private gestureCount = 0;
  /** smoothed head turn toward AnimInput.lookAt (rad) and its blend */
  private lookYaw = 0;
  private lookPitch = 0;
  private lookW = 0;
  /** root-space joint rotations of the current frame (post-mixer corrections work on these) */
  private W = Object.fromEntries(JOINTS.map((j) => [j, new THREE.Quaternion()])) as Record<J, THREE.Quaternion>;

  constructor(private rig: ChonkRig, private set: ClipSet) {
    this.mixer = new THREE.AnimationMixer(rig.root);
    for (const [name, clip] of set.clips) this.act.set(name, this.mixer.clipAction(clip));
    for (const n of Object.values(LOCO)) {
      const a = this.act.get(n);
      if (!a) continue;
      a.enabled = true;
      a.setEffectiveWeight(n === LOCO.idle ? 1 : 0);
      a.play();
    }
    this.lastHipsY = rig.hips.position.y;
  }

  private playOnce(name: string, fade: number, timeScale = 1, move: MoveName | null = null) {
    const a = this.act.get(name);
    if (!a) return;
    if (this.oneShot && this.oneShot !== a) this.oneShot.fadeOut(fade);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = timeScale;
    a.setEffectiveWeight(1);
    a.fadeIn(fade);
    a.play();
    this.oneShot = a;
    this.oneShotMove = move;
  }

  update(inp: AnimInput, dt: number) {
    const swimming = !!inp.swimming && !inp.ko;
    const sp = inp.grounded && !swimming ? inp.speed : 0;

    // ---- one-shots: attacks, hits, jumps, KO ----
    if (inp.ko) {
      if (!this.koPlayed) this.playOnce('Death_D', 0.15);
      this.koPlayed = true;
    } else {
      if (this.koPlayed) {
        this.koPlayed = false;
        this.oneShot?.fadeOut(0.3);
        this.oneShot = null;
      }
      if (inp.move && inp.move !== this.oneShotMove) {
        const clip = MOVE_CLIP[inp.move];
        if (clip && this.act.has(clip)) {
          // fit the clip's strike into the move's gameplay duration (fighter.ts timing stays the boss)
          const moveDur = { jab: 0.32, cross: 0.4, kick: 0.55, belly: 0.85, slam: 0.5 }[inp.move];
          const dur = this.set.clips.get(clip)!.duration;
          this.playOnce(clip, 0.06, clamp((dur * 0.75) / moveDur, 0.8, 4), inp.move);
        }
      } else if (!inp.move && this.oneShotMove) {
        this.oneShot?.fadeOut(0.2);
        this.oneShot = null;
        this.oneShotMove = null;
      }
      if (inp.hurtT < this.lastHurt && inp.hurtT < 0.05 && !inp.move) this.playOnce(inp.hurtT < 0.05 && inp.vy > 2 ? 'Hit_Knockback' : 'Hit_Chest', 0.05, 1.3);
      if (!inp.grounded && this.wasGrounded && !inp.move) this.playOnce('Jump_air', 0.12, 1);
      if (inp.grounded && !this.wasGrounded && !inp.move && !swimming) this.playOnce('Jump_Land', 0.06, 1.8);
      // let the land / hit clips hand back to locomotion quickly once the character moves
      if (this.oneShot && !this.oneShotMove && sp > 1 && this.oneShot.getClip().name !== 'Jump_air') {
        this.oneShot.fadeOut(0.15);
        this.oneShot = null;
      }
      if (this.oneShot && !this.oneShotMove && inp.grounded && this.oneShot.getClip().name === 'Jump_air') {
        this.oneShot.fadeOut(0.1);
        this.oneShot = null;
      }
    }
    this.lastHurt = inp.hurtT;
    this.wasGrounded = inp.grounded;
    this.gestures(inp.ko || swimming ? null : inp.gesture ?? null);

    // ---- locomotion: idle -> walk -> jog by ground speed, one shared gait phase driven by distance ----
    // turning on the spot takes little steps instead of spinning on a turntable
    const turnStep = inp.grounded && !swimming && !inp.move ? Math.min(0.9, Math.abs(inp.turn ?? 0) * 0.12) : 0;
    const g = Math.max(sp, turnStep);
    const loco = smooth(g, 0.12, 0.5), jogT = smooth(g, 1.7, 2.6);
    const w = { idle: 1 - loco, walk: loco * (1 - jogT), jog: loco * jogT };
    const idleName = inp.talking ? LOCO.talk : inp.angry && inp.fighting ? LOCO.fight : LOCO.idle;
    const shotW = this.oneShot ? this.oneShot.getEffectiveWeight() : 0;
    const base = 1 - shotW * (inp.ko ? 1 : 0.85);
    const walkA = this.act.get(LOCO.walk), jogA = this.act.get(LOCO.jog);
    for (const [a, target] of [[walkA, w.walk], [jogA, w.jog]] as const) if (a) a.setEffectiveWeight(damp(a.getEffectiveWeight(), target * base, 12, dt));
    const ww = walkA?.getEffectiveWeight() ?? 0, wj = jogA?.getEffectiveWeight() ?? 0;
    // cadence (gait cycles / s): a walk speeds its steps up to 2.4 Hz; a jog patters (never below 1.45 Hz,
    // up to 3.4 Hz at a sprint). Blended by the live weights so a stop never treadmills.
    const LW = this.set.cycle[LOCO.walk] ?? 0.65, LJ = this.set.cycle[LOCO.jog] ?? 2.9;
    const cW = clamp(g / LW, 0.6, 2.4), cJ = clamp(0.4 + (0.85 * g) / LJ, 1.45, 3.4);
    const wsum = ww + wj;
    const cad = wsum > 1e-3 ? (ww * cW + wj * cJ) / wsum : cW;
    this.phase = (this.phase + cad * dt) % 1;
    for (const a of [walkA, jogA]) {
      if (!a) continue;
      a.timeScale = 0; // the phase drives the clip time
      a.time = this.phase * a.getClip().duration;
    }
    // leg swing scale that makes the stance foot travel at the ground speed for this cadence
    const sW = clamp(sp / (cad * LW), 0.5, 1.5), sJ = clamp(sp / (cad * LJ), 0.55, 1.3);
    const stride = wsum > 1e-3 ? (ww * sW + wj * sJ) / wsum : 1;
    for (const n of [LOCO.idle, LOCO.fight, LOCO.talk]) {
      const a = this.act.get(n);
      if (!a) continue;
      const target = n === idleName ? w.idle * base : 0;
      if (target > 0 && !a.isRunning()) a.play();
      a.setEffectiveWeight(damp(a.getEffectiveWeight(), target, 6, dt));
    }

    this.mixer.update(dt);

    // ---- procedural layer ----
    const r = this.rig;
    this.swim = clamp(this.swim + (swimming ? dt : -dt) / 0.25, 0, 1);
    if (swimming) this.swimPh += dt * Math.PI * 2 * (0.75 + inp.speed * 0.3);
    this.updateLook(inp, dt);
    this.posture(ww, wj, stride);
    // breathing + belly jiggle: a damped spring driven by the hips' vertical acceleration
    const hy = r.hips.position.y;
    const vy = (hy - this.lastHipsY) / Math.max(dt, 1e-3);
    const ay = (vy - this.hipsVy) / Math.max(dt, 1e-3);
    this.lastHipsY = hy;
    this.hipsVy = vy;
    this.bellyV += (-this.belly * 120 - this.bellyV * 9 - clamp(ay, -60, 60) * 0.004) * dt;
    this.belly += this.bellyV * dt;
    const breathe = Math.sin(inp.t * 2.2) * 0.012;
    let bump = 0;
    if (inp.move === 'belly') bump = Math.sin(clamp((inp.moveT - 0.35) / 0.35, 0, 1) * Math.PI) * 0.12;
    const sq = 1 + breathe + this.belly + bump;
    r.body.scale.set(1 + (sq - 1) * 0.6 + bump * 0.5, 1 / Math.sqrt(sq), 1 + (sq - 1) * 0.8 + bump);
    // tail: lazy sway, livelier when running; trailing flat on the water (rudder swish) when swimming
    const run = clamp(sp / 7, 0, 1);
    const tail = r.tail, sw = this.swim * this.swim * (3 - 2 * this.swim);
    if (tail.length) {
      const swish = Math.sin(this.swimPh * 0.5) * 0.35;
      tail[0].rotation.x = lerp(-1.1 + 0.25 + run * 0.3 + Math.sin(inp.t * 1.7) * 0.06, -2.3, sw);
      tail[0].rotation.z = swish * sw;
      for (let i = 1; i < tail.length; i++) {
        tail[i].rotation.x = lerp(-0.05 - run * 0.05, 0, sw);
        tail[i].rotation.z = lerp(Math.sin(inp.t * (1.3 + run * 4) - i * 0.6) * (0.08 + run * 0.06), Math.sin(this.swimPh * 0.5 - i * 0.7) * 0.2, sw);
      }
    }
    // eyes and mouth (face.ts)
    r.face?.update(dt, inp);
  }

  /** lowest paw sole height (rig.root space) of the current W pose with the hips at `hips` */
  private lowestSole(hips: THREE.Vector3) {
    const S = this.set, W = this.W;
    let low = Infinity;
    for (const f of S.legFK) {
      _p.copy(f.hip).applyQuaternion(_d.multiplyQuaternions(W.hips, S.restInv.hips)).add(hips);
      _p.add(_v.copy(f.knee2).applyQuaternion(_d.multiplyQuaternions(W[f.leg], S.restInv[f.leg])));
      _p.add(_v.copy(f.sole).applyQuaternion(_d.multiplyQuaternions(W[f.knee], S.restInv[f.knee])));
      low = Math.min(low, _p.y);
    }
    return low;
  }

  /** start / hold / end the upper-body gesture (a change to a non-null value starts one) */
  private gestures(g: Gesture | null) {
    if (g !== this.lastGesture) {
      if (this.gestureAct) this.gestureAct.fadeOut(0.3);
      this.gestureAct = null;
      this.gestureFading = false;
      if (g) {
        const names = GESTURE_CLIP[g].filter((n) => this.set.upper.has(n));
        if (names.length) {
          const a = this.mixer.clipAction(this.set.upper.get(names[this.gestureCount++ % names.length])!);
          a.reset();
          if (g === 'talk') a.setLoop(THREE.LoopRepeat, Infinity);
          else {
            a.setLoop(THREE.LoopOnce, 1);
            a.clampWhenFinished = true;
          }
          // weight 5 against the ~1 of idle / walk: the gesture owns ~85 % of the upper body
          a.setEffectiveWeight(5);
          a.fadeIn(0.2);
          a.play();
          this.gestureAct = a;
        }
      }
      this.lastGesture = g;
    }
    // a one-shot that ends before the gesture is released eases back to idle / walk
    const a = this.gestureAct;
    if (a && !this.gestureFading && a.loop === THREE.LoopOnce && a.time > a.getClip().duration - 0.3) {
      a.fadeOut(0.3);
      this.gestureFading = true;
    }
  }

  /** smoothed, clamped head turn toward inp.lookAt (world point) */
  private updateLook(inp: AnimInput, dt: number) {
    const root = this.rig.root;
    let on = 0;
    if (inp.lookAt && !inp.ko && !inp.swimming) {
      // world -> rig.root space (the root sits in the scene, unscaled)
      _p.copy(inp.lookAt).sub(root.position).applyQuaternion(_d.copy(root.quaternion).invert()).sub(this.set.headPos);
      const yaw = clamp(Math.atan2(_p.x, _p.z), -1.22, 1.22);
      const pitch = clamp(-Math.atan2(_p.y, Math.hypot(_p.x, _p.z)), -0.52, 0.52);
      this.lookYaw = this.lookW < 1e-3 ? yaw : damp(this.lookYaw, yaw, 6, dt);
      this.lookPitch = this.lookW < 1e-3 ? pitch : damp(this.lookPitch, pitch, 6, dt);
      on = 1;
    }
    this.lookW = damp(this.lookW, on, 6, dt);
  }

  /**
   * Post-mixer pose corrections, in rig.root space: stride scaling, upright running, hip height, walk hop
   * and waddle, then the swim pose blended over everything. ww / wj: live walk / jog weights.
   */
  private posture(ww: number, wj: number, stride: number) {
    const r = this.rig, S = this.set, W = this.W;
    const loco = ww + wj, sw = this.swim * this.swim * (3 - 2 * this.swim);
    if (loco < 0.01 && sw <= 0 && this.lookW < 1e-3) return;
    for (const j of JOINTS) {
      const p = PARENT[j];
      W[j].multiplyQuaternions(p ? W[p] : S.hipsParent, r[j].quaternion);
    }
    const rotate = (j: J, R: THREE.Quaternion) => { for (const c of SUB[j]) W[c].premultiply(R); };
    const ph = this.phase;
    const hips = r.hips.position;
    if (loco >= 0.01) {
      // 1. stride: scale each thigh's swing (rotation from rest) so the planted foot matches the ground
      const s = lerp(1, stride, Math.min(1, loco));
      if (Math.abs(s - 1) > 1e-3) for (const [leg, knee] of [['legL', 'kneeL'], ['legR', 'kneeR']] as const) {
        // thigh and shin both (with bent knees the shin carries most of the foot's travel)
        for (const j of [leg, knee]) {
          _d.multiplyQuaternions(W[j], S.restInv[j]);
          W[j].multiplyQuaternions(scaleRotation(_d, s, _q), S.rest[j]);
        }
      }
      // 2. upright: the human jog leans the hips, chest and head far forward. Pull each back toward its
      //    rest lean (the legs keep their swing when the hips straighten)
      if (wj > 0.01) {
        uprightFix(W.hips, S.restInv.hips, 0.03, 0.8 * wj, _q);
        rotate('hips', _q);
        _q.invert();
        rotate('legL', _q);
        rotate('legR', _q);
        rotate('body', uprightFix(W.body, S.restInv.body, 0.33, 0.75 * wj, _q));
        rotate('head', uprightFix(W.head, S.restInv.head, 0.2, 0.7 * wj, _q));
      }
      // 3. hips: no crouching jog, a bouncy little hop in the walk (high at mid-stance, two steps per
      //    cycle), but never so high that the planted paw leaves the ground: the lift shows in the flight
      //    phase of the run, a bob in the walk
      let lift = 0;
      if (wj > 0.01 && hips.y < r.hipBase) lift += (r.hipBase - hips.y) * 0.6 * wj;
      const u = 0.5 + 0.5 * Math.cos(4 * Math.PI * (ph - 0.25));
      lift += (u * u - 0.2) * 0.035 * ww * (r.hipBase / 0.65);
      hips.y += lift;
      if (lift > 0) {
        const over = this.lowestSole(hips) - (S.soleRestY + 0.01);
        if (over > 0) hips.y -= Math.min(lift, over);
      }
      _e.set(0, 0, -Math.sin(2 * Math.PI * ph) * (0.07 * ww + 0.03 * wj));
      rotate('body', _q.setFromEuler(_e));
    }
    if (sw > 0) {
      // 4. swim: belly-down dog paddle. Targets are root-space rotations from the bind pose
      const s = Math.sin(this.swimPh), kick = Math.sin(this.swimPh * 2) * 0.35;
      const target = (j: J, x: number, y = 0, z = 0) => {
        _e.set(x, y, z, 'XYZ');
        _q.setFromEuler(_e).multiply(S.rest[j]);
        W[j].slerp(_q, sw);
      };
      target('hips', 1.1, s * 0.07);
      target('body', 0.85, s * 0.1);
      target('head', 0.05 + Math.sin(this.swimPh * 2) * 0.04, -s * 0.1);
      // paws: reach forward and high, pull down under the chest, alternating
      // (swung in front of the chest first: the rest arms reach out to the sides around the belly)
      const aL = -(0.7 + 0.5 * s), aR = -(0.7 - 0.5 * s);
      target('shoulderL', aL, -0.65);
      target('elbowL', aL - 0.25 * Math.max(0, -s), -0.65);
      target('shoulderR', aR, 0.65);
      target('elbowR', aR - 0.25 * Math.max(0, s), 0.65);
      // legs trail behind the body and flutter-kick
      target('legL', 1.35 + kick);
      target('kneeL', 1.45 + kick);
      target('legR', 1.35 - kick);
      target('kneeR', 1.45 - kick);
      hips.set(lerp(hips.x, 0, sw), lerp(hips.y, r.hipBase + Math.sin(this.swimPh * 2) * 0.015, sw), lerp(hips.z, 0, sw));
    }
    if (this.lookW >= 1e-3) {
      // 5. look at: 30 % of the turn in the chest, the rest in the neck; the nod about the turned side axis
      const yaw = this.lookYaw * this.lookW, pitch = this.lookPitch * this.lookW;
      rotate('body', _q.setFromAxisAngle(_axisY, yaw * 0.3));
      _v.set(1, 0, 0).applyAxisAngle(_axisY, yaw);
      rotate('head', _q.setFromAxisAngle(_v, pitch).multiply(_d.setFromAxisAngle(_axisY, yaw * 0.7)));
    }
    for (const j of JOINTS) {
      const p = PARENT[j];
      r[j].quaternion.copy(_d.copy(p ? W[p] : S.hipsParent).invert().multiply(W[j]));
    }
  }
}

const _d = new THREE.Quaternion(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _e = new THREE.Euler();
const _axisX = new THREE.Vector3(1, 0, 0), _axisY = new THREE.Vector3(0, 1, 0), _p = new THREE.Vector3();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (x: number, a: number, b: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** q's rotation angle scaled by s (same axis), into out */
function scaleRotation(q: THREE.Quaternion, s: number, out: THREE.Quaternion) {
  const sign = q.w < 0 ? -1 : 1;
  const w = clamp(q.w * sign, -1, 1), sinHalf = Math.sqrt(1 - w * w);
  if (sinHalf < 1e-5) return out.identity();
  _v.set((q.x * sign) / sinHalf, (q.y * sign) / sinHalf, (q.z * sign) / sinHalf);
  return out.setFromAxisAngle(_v, 2 * Math.acos(w) * s);
}

/**
 * Rotation (about the character's side axis) that takes a joint's forward lean from its rest pose down
 * toward `allow` (rad) by the fraction k. Identity when it leans less. wq: root-space rotation.
 */
function uprightFix(wq: THREE.Quaternion, restInv: THREE.Quaternion, allow: number, k: number, out: THREE.Quaternion) {
  _d.multiplyQuaternions(wq, restInv);
  _v.set(0, 1, 0).applyQuaternion(_d);
  const excess = Math.atan2(_v.z, _v.y) - allow;
  return excess > 0 && k > 0 ? out.setFromAxisAngle(_axisX, -excess * k) : out.identity();
}
