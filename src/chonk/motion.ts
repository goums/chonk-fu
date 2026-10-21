// Mocap-driven animation for the pipeline characters: CC0 human clips (Mesh2Motion / Quaternius,
// retargeted in retarget.ts) on an AnimationMixer, with a procedural layer on top for what mocap can't
// know about a chubby cat: breathing, belly jiggle, the tail, and the belly bump special.
// Same update(AnimInput, dt) interface as the procedural Animator, so fighters and NPCs use either.
import * as THREE from 'three';
import { Animator, type AnimInput, type MoveName } from './animator';
import type { ChonkRig } from './model';
import { clipGroundSpeed, loadAnimLibrary, retargetClips, type AnimLibrary } from './retarget';
import { clamp, damp } from '../core/math';

let lib: AnimLibrary | null = null;
export async function initMotionLibrary() {
  try {
    lib = await loadAnimLibrary(`${import.meta.env.BASE_URL}anims/human.glb`);
  } catch (e) {
    console.warn('animation library unavailable, using procedural animation', e);
  }
}

const LOCO = { idle: 'Idle_A', fight: 'Fighting Idle', talk: 'Idle_Talking', walk: 'Walk', jog: 'Jog', sprint: 'Sprint' };
const MOVE_CLIP: Partial<Record<MoveName, string>> = { jab: 'Punch_Jab', cross: 'Punch_Cross', kick: 'Kick_Breach', slam: 'Attack_Ground_Pound', belly: 'Power Up' };
const USED = [...Object.values(LOCO), ...Object.values(MOVE_CLIP), 'Jump_air', 'Jump_Land', 'Hit_Chest', 'Hit_Knockback', 'Death_D'];

interface ClipSet { clips: Map<string, THREE.AnimationClip>; speed: Record<string, number> }
const cache = new Map<string, ClipSet>();

function clipsFor(rig: ChonkRig): ClipSet | null {
  if (!lib) return null;
  const key = rig.root.name;
  let set = cache.get(key);
  if (!set) {
    const names = USED.filter((n) => lib!.clips.has(n));
    const clips = retargetClips(lib, rig, names);
    const speed: Record<string, number> = {};
    for (const n of [LOCO.walk, LOCO.jog, LOCO.sprint]) if (clips.has(n)) speed[n] = Math.max(0.2, clipGroundSpeed(lib, n, rig));
    cache.set(key, (set = { clips, speed }));
  }
  return set;
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
    const sp = inp.grounded ? inp.speed : 0;

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
      if (inp.grounded && !this.wasGrounded && !inp.move) this.playOnce('Jump_Land', 0.06, 1.8);
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

    // ---- locomotion blend: idle -> walk -> jog -> sprint by ground speed, playback synced to speed ----
    const w = { idle: 0, walk: 0, jog: 0, sprint: 0 };
    if (sp < 0.15) w.idle = 1;
    else if (sp < 1.4) { const t = clamp((sp - 0.15) / 0.5, 0, 1); w.idle = 1 - t; w.walk = t; }
    else if (sp < 3.4) { const t = clamp((sp - 1.4) / 1.0, 0, 1); w.walk = 1 - t; w.jog = t; }
    else { const t = clamp((sp - 3.4) / 1.0, 0, 1); w.jog = 1 - t; w.sprint = t; }
    const idleName = inp.talking ? LOCO.talk : inp.angry && inp.fighting ? LOCO.fight : LOCO.idle;
    const shotW = this.oneShot ? this.oneShot.getEffectiveWeight() : 0;
    const base = 1 - shotW * (inp.ko ? 1 : 0.85);
    for (const [k, n] of [['walk', LOCO.walk], ['jog', LOCO.jog], ['sprint', LOCO.sprint]] as const) {
      const a = this.act.get(n);
      if (!a) continue;
      const cur = a.getEffectiveWeight();
      a.setEffectiveWeight(damp(cur, w[k] * base, 10, dt));
      a.timeScale = clamp(sp / (this.set.speed[n] ?? 1), 0.6, 2.2);
    }
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
    // tail: lazy sway, livelier when running
    const run = clamp(sp / 5, 0, 1);
    const tail = r.tail;
    if (tail.length) {
      tail[0].rotation.x = -1.1 + 0.25 + run * 0.3 + Math.sin(inp.t * 1.7) * 0.06;
      for (let i = 1; i < tail.length; i++) {
        tail[i].rotation.x = -0.05 - run * 0.05;
        tail[i].rotation.z = Math.sin(inp.t * (1.3 + run * 4) - i * 0.6) * (0.08 + run * 0.06);
      }
    }
  }
}
