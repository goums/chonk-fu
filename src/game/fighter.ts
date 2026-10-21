// A kung-fu fighter: kinematic body on the heightfield, a move set with strike windows, hit reactions,
// swimming in deep water (river / pond).
// Le Chonk (Player), the bandits and the boss (Enemy) all extend this.
import * as THREE from 'three';
import { BELLY_LAND, BELLY_TAKEOFF, MOVES, type MoveName } from '../chonk/animator';
import { makeAnimator, type CharacterAnimator } from '../chonk/motion';
import type { ChonkRig } from '../chonk/model';
import { angleDelta, clamp, damp } from '../core/math';
import { WATER_LEVEL } from '../world/layout';
import { groundAt } from '../world/world';
import { resolve } from './colliders';

const GRAVITY = 24;
/** forward speed (m/s) during the belly jump's flight */
const BELLY_HOP_SPEED = 3.6;
let nextId = 1;

export class Fighter {
  id = nextId++;
  anim: CharacterAnimator;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  heading = 0; // radians, 0 = facing +z
  /** current turning speed (rad/s), drives the lean into turns */
  turnRate = 0;
  private lean = 0;
  grounded = true;
  move: MoveName | null = null;
  moveTime = 0;
  strikeActive = false;
  strikeId = 0;
  /** ids of fighters already hit by the current strike */
  hitThisStrike = new Set<number>();
  hurtT = Infinity;
  stunT = 0; // can't act while > 0
  hp: number;
  ko = false;
  koT = 0;
  t = 0;
  angry = false;
  /** in a fight stance (enemies set this while engaging) */
  fighting = false;
  /** damage and knockback multipliers (the boss hits harder) */
  power = 1;
  radius: number;
  height: number;
  invulnT = 0;
  protected slamPending = false;
  /**
   * floating in deep water: swim pose (motion.ts), 45 % speed, no attacks, Space = splash-hop. Not
   * grounded while swimming (so no jumps / slams / belly jumps start), the anim gets its own flag.
   */
  swimming = false;

  constructor(public rig: ChonkRig, x: number, z: number, public maxHp: number, radius = 0.6, height = 1.6) {
    this.anim = makeAnimator(rig);
    this.hp = maxHp;
    this.radius = radius;
    this.height = height;
    this.pos.set(x, groundAt(x, z), z);
    rig.root.position.copy(this.pos);
  }

  get object() {
    return this.rig.root;
  }
  /** replace the character model (same joint layout), e.g. to compare art variants */
  swapRig(rig: ChonkRig) {
    const parent = this.rig.root.parent;
    parent?.remove(this.rig.root);
    this.rig = rig;
    this.anim = makeAnimator(rig);
    parent?.add(rig.root);
  }
  get alive() {
    return !this.ko;
  }

  startMove(m: MoveName) {
    if (this.swimming) return; // no kung fu while dog-paddling
    this.move = m;
    this.moveTime = 0;
    this.strikeId++;
    this.hitThisStrike.clear();
  }
  moveProgress() {
    return this.move ? clamp(this.moveTime / MOVES[this.move].duration, 0, 1) : 0;
  }
  canAct() {
    return !this.ko && this.stunT <= 0;
  }

  /** advance the current move; returns the move that just finished, if any */
  protected tickMove(dt: number): MoveName | null {
    if (!this.move) {
      this.strikeActive = false;
      return null;
    }
    this.moveTime += dt;
    const def = MOVES[this.move];
    const u = this.moveTime / def.duration;
    this.strikeActive = u >= def.hit[0] && u <= def.hit[1];
    if (u >= 1) {
      const done = this.move;
      this.move = null;
      this.strikeActive = false;
      return done;
    }
    return null;
  }

  /** take a hit from `from` */
  takeHit(damage: number, knock: number, from: THREE.Vector3, stun = 0.35) {
    if (this.ko || this.invulnT > 0) return false;
    this.hp = Math.max(0, this.hp - damage);
    this.hurtT = 0;
    this.stunT = Math.max(this.stunT, stun);
    this.move = null;
    this.strikeActive = false;
    const dx = this.pos.x - from.x, dz = this.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    this.vel.x = (dx / d) * knock;
    this.vel.z = (dz / d) * knock;
    if (knock > 6) {
      this.vel.y = Math.min(7, knock * 0.45);
      this.grounded = false;
    }
    if (this.hp <= 0) {
      this.ko = true;
      this.koT = 0;
    }
    return true;
  }

  /**
   * physics step. (wx, wz): desired direction (world, length <= 1), speed in m/s, face: heading to turn to
   * (null = face the movement direction).
   */
  protected physics(dt: number, wx: number, wz: number, speed: number, face: number | null, jump = false) {
    this.t += dt;
    this.hurtT += dt;
    this.stunT = Math.max(0, this.stunT - dt);
    this.invulnT = Math.max(0, this.invulnT - dt);
    if (this.ko) this.koT += dt;
    if (!this.canAct()) { wx = 0; wz = 0; }

    // water: deep enough (relative to the legs) = swim, else wade
    const ground = groundAt(this.pos.x, this.pos.z);
    const depth = WATER_LEVEL - ground;
    const hb = this.rig.hipBase;
    const swimDepth = Math.max(0.6, hb * 0.9);
    // float with the head and shoulders out (the swim pose pitches the body forward around the hips)
    // (touching the bottom in the shallows, rising onto the feet where the swim ends: no pop)
    const floatY = Math.max(WATER_LEVEL - hb * 1.38, ground - 0.25 * clamp((depth - swimDepth + 0.15) / 0.3, 0, 1));
    if (!this.swimming) {
      if (!this.ko && depth > swimDepth && this.pos.y < WATER_LEVEL - swimDepth + 0.05 && this.vel.y <= 0) {
        this.swimming = true;
        this.grounded = false;
        this.slamPending = false;
        this.move = null;
        this.strikeActive = false;
      }
    } else if (this.ko || depth < swimDepth - 0.15) this.swimming = false;
    if (this.swimming) speed *= 0.45;
    else if (depth > 0.25 && this.pos.y < WATER_LEVEL - 0.2) speed *= 0.65; // wading
    if (this.move) speed *= this.move === 'belly' ? 0.25 : 0.35;
    // velocity eases toward the target (time constant ~0.15 s on the ground, sluggish in the air / stunned / in water)
    const tau = this.swimming ? 0.4 : !this.grounded ? 0.6 : this.stunT > 0 ? 0.45 : Math.hypot(wx, wz) > 0.05 ? 0.15 : 0.1;
    const k = 1 - Math.exp(-dt / tau);
    this.vel.x += (wx * speed - this.vel.x) * k;
    this.vel.z += (wz * speed - this.vel.z) * k;
    if (!this.ko) {
      // turn toward the movement direction with a capped turn rate, like a real body
      const want = face ?? (Math.hypot(wx, wz) > 0.1 ? Math.atan2(wx, wz) : null);
      if (want !== null) {
        const maxTurn = (this.swimming ? 4 : this.move ? 5 : 11) * dt;
        const d = angleDelta(this.heading, want);
        const step = Math.max(-maxTurn, Math.min(maxTurn, d));
        this.turnRate = step / dt;
        this.heading += step;
      } else this.turnRate = 0;
    }
    if (this.move === 'belly') {
      // the belly jump travels while airborne (the hop itself is animation: the body stays grounded
      // for gameplay) and lands ~1.4 m ahead, where the strike goes off
      const u = this.moveProgress();
      if (u > BELLY_TAKEOFF && u < BELLY_LAND) {
        this.vel.x = Math.sin(this.heading) * BELLY_HOP_SPEED;
        this.vel.z = Math.cos(this.heading) * BELLY_HOP_SPEED;
      }
    } else if (this.move && this.strikeActive && this.move !== 'slam') {
      // lunge on the strike frames
      this.vel.x += Math.sin(this.heading) * 4 * dt * 6;
      this.vel.z += Math.cos(this.heading) * 4 * dt * 6;
    }
    if (jump && this.grounded && !this.move && this.canAct()) {
      this.vel.y = 8.5;
      this.grounded = false;
    } else if (jump && this.swimming && this.canAct()) {
      // splash-hop: out of the water and onto a bank
      this.swimming = false;
      this.vel.y = 8;
      this.vel.x += Math.sin(this.heading) * 1.5;
      this.vel.z += Math.cos(this.heading) * 1.5;
    }
    if (this.swimming) {
      // buoyancy: a damped spring to the float height with a gentle bob (no gravity)
      const bob = Math.sin(this.t * 2.4 + this.id) * 0.035;
      this.vel.y += ((floatY + bob - this.pos.y) * 40 - this.vel.y * 8) * dt;
    } else this.vel.y -= GRAVITY * dt;

    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const hHere = groundAt(this.pos.x, this.pos.z), hNext = groundAt(nx, nz);
    const stepLen = Math.hypot(nx - this.pos.x, nz - this.pos.z);
    // cliffs block, stairs and hills don't
    if (stepLen > 1e-4 && (hNext - hHere) / stepLen > 1.9 && hNext > this.pos.y + 0.4) {
      nx = this.pos.x;
      nz = this.pos.z;
      this.vel.x *= 0.2;
      this.vel.z *= 0.2;
    }
    const r = resolve(nx, nz, this.radius, this.pos.y, this.height);
    this.pos.x = clamp(r.x, -268, 268);
    this.pos.z = clamp(r.z, -268, 268);
    this.pos.y += this.vel.y * dt;
    const floor = Math.max(groundAt(this.pos.x, this.pos.z), WATER_LEVEL - 1.1);
    if (this.swimming) {
      this.pos.y = Math.max(this.pos.y, groundAt(this.pos.x, this.pos.z) - 0.3);
      this.grounded = false;
    } else if (this.pos.y <= floor + (this.grounded && this.vel.y <= 0 ? 0.35 : 0)) {
      if (!this.grounded && this.slamPending) {
        this.slamPending = false;
        this.startMove('slam');
      }
      this.pos.y = floor;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    } else this.grounded = false;
    if (this.grounded && (Math.hypot(wx, wz) < 0.05 || this.ko)) {
      this.vel.x *= Math.exp(-10 * dt);
      this.vel.z *= Math.exp(-10 * dt);
    } else if (this.swimming && Math.hypot(wx, wz) < 0.05) {
      this.vel.x *= Math.exp(-2.5 * dt); // glide to a stop
      this.vel.z *= Math.exp(-2.5 * dt);
    }

    this.anim.update(
      {
        t: this.t,
        speed: Math.hypot(this.vel.x, this.vel.z),
        grounded: this.grounded || this.swimming,
        vy: this.vel.y,
        move: this.move,
        moveT: this.moveProgress(),
        hurtT: this.hurtT,
        ko: this.ko,
        angry: this.angry,
        fighting: this.fighting,
        turn: this.turnRate,
        swimming: this.swimming,
      },
      dt,
    );
    this.object.position.copy(this.pos);
    this.object.rotation.y = this.heading;
    // lean into turns, proportional to speed (Sketchbook-style)
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.lean = damp(this.lean, this.swimming ? 0 : clamp(-this.turnRate * sp * 0.035, -0.28, 0.28), 8, dt);
    this.object.rotation.z = this.lean;
  }
}
