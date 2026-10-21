// A kung-fu fighter: kinematic body on the heightfield, a move set with strike windows, hit reactions.
// Le Chonk (Player), the bandits and the boss (Enemy) all extend this.
import * as THREE from 'three';
import { Animator, MOVES, type MoveName } from '../chonk/animator';
import type { ChonkRig } from '../chonk/model';
import { clamp, dampAngle } from '../core/math';
import { WATER_LEVEL } from '../world/layout';
import { groundAt } from '../world/world';
import { resolve } from './colliders';

const GRAVITY = 24;
let nextId = 1;

export class Fighter {
  id = nextId++;
  anim: Animator;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  heading = 0; // radians, 0 = facing +z
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
  /** damage and knockback multipliers (the boss hits harder) */
  power = 1;
  radius: number;
  height: number;
  invulnT = 0;
  protected slamPending = false;

  constructor(public rig: ChonkRig, x: number, z: number, public maxHp: number, radius = 0.6, height = 1.6) {
    this.anim = new Animator(rig);
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
    this.anim = new Animator(rig);
    parent?.add(rig.root);
  }
  get alive() {
    return !this.ko;
  }

  startMove(m: MoveName) {
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

    const inWater = this.pos.y < WATER_LEVEL - 0.3;
    if (inWater) speed *= 0.5;
    if (this.move) speed *= this.move === 'belly' ? 0.25 : 0.35;
    const accel = this.grounded ? (this.stunT > 0 ? 6 : 40) : 12;
    const dvx = wx * speed - this.vel.x, dvz = wz * speed - this.vel.z;
    const dl = Math.hypot(dvx, dvz), maxDv = accel * dt;
    const k = dl > maxDv ? maxDv / dl : 1;
    this.vel.x += dvx * k;
    this.vel.z += dvz * k;
    if (!this.ko) {
      if (face !== null) this.heading = dampAngle(this.heading, face, 12, dt);
      else if (Math.hypot(wx, wz) > 0.1) this.heading = dampAngle(this.heading, Math.atan2(wx, wz), this.move ? 4 : 14, dt);
    }
    // lunge on the strike frames
    if (this.move && this.strikeActive && this.move !== 'slam') {
      const lunge = this.move === 'belly' ? 9 : 4;
      this.vel.x += Math.sin(this.heading) * lunge * dt * 6;
      this.vel.z += Math.cos(this.heading) * lunge * dt * 6;
    }
    if (jump && this.grounded && !this.move && this.canAct()) {
      this.vel.y = 8.5;
      this.grounded = false;
    }
    this.vel.y -= GRAVITY * dt;

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
    if (this.pos.y <= floor + (this.grounded && this.vel.y <= 0 ? 0.35 : 0)) {
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
    }

    this.anim.update(
      {
        t: this.t,
        speed: Math.hypot(this.vel.x, this.vel.z),
        grounded: this.grounded,
        vy: this.vel.y,
        move: this.move,
        moveT: this.moveProgress(),
        hurtT: this.hurtT,
        ko: this.ko,
        angry: this.angry,
      },
      dt,
    );
    this.object.position.copy(this.pos);
    this.object.rotation.y = this.heading;
  }
}
