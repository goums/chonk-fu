// Le Chonk, the playable character: kinematic movement on the heightfield, jumps, and a small
// kung-fu move set (jab -> cross -> kick combo, belly bump, ground slam).
import * as THREE from 'three';
import { Animator, MOVES, type MoveName } from '../chonk/animator';
import { buildChonk, type ChonkRig } from '../chonk/model';
import { clamp, dampAngle } from '../core/math';
import type { Intent } from '../core/input';
import { WATER_LEVEL } from '../world/layout';
import { heightAt } from '../world/terrain';
import { groundAt } from '../world/world';
import { resolve } from './colliders';

export const PLAYER_RADIUS = 0.6;
const GRAVITY = 24;

export class Player {
  rig: ChonkRig;
  anim: Animator;
  pos = new THREE.Vector3(0, 0, 0);
  vel = new THREE.Vector3();
  heading = 0; // radians, 0 = facing +z
  grounded = true;
  move: MoveName | null = null;
  moveTime = 0;
  /** queued follow-up in the jab -> cross -> kick combo */
  private comboNext: MoveName | null = null;
  private comboStep = 0;
  hurtT = Infinity;
  hp = 100;
  maxHp = 100;
  ko = false;
  /** strikes that landed this tick (consumed by the combat system) */
  strikeActive = false;
  strikeId = 0;
  t = 0;

  constructor(x: number, z: number) {
    this.rig = buildChonk();
    this.anim = new Animator(this.rig);
    this.pos.set(x, heightAt(x, z), z);
  }

  get object() {
    return this.rig.root;
  }

  startMove(m: MoveName) {
    this.move = m;
    this.moveTime = 0;
    this.strikeId++;
  }

  /** one 60 Hz step. camYaw: camera heading so input is camera-relative */
  step(dt: number, intent: Intent, camYaw: number) {
    this.t += dt;
    this.hurtT += dt;

    // --- moves (attacks) ---
    if (!this.ko) {
      if (intent.belly && !this.move && this.grounded) this.startMove('belly');
      if (intent.kick && (!this.move || this.moveProgress() > 0.6) && this.grounded) this.startMove('kick');
      if (intent.punch) {
        if (!this.move && this.grounded) {
          this.comboStep = 0;
          this.startMove('jab');
        } else if (this.move && this.move !== 'belly' && this.move !== 'slam') {
          // buffer the next hit of the combo
          this.comboNext = this.comboStep === 0 ? 'cross' : this.comboStep === 1 ? 'kick' : null;
        } else if (!this.grounded && !this.move && this.vel.y < 4) {
          // in the air: dive into a ground slam
          this.vel.y = -18;
          this.slamPending = true;
        }
      }
    }
    if (this.move) {
      this.moveTime += dt;
      const def = MOVES[this.move];
      const u = this.moveTime / def.duration;
      this.strikeActive = u >= def.hit[0] && u <= def.hit[1];
      if (u >= 1) {
        const next = this.comboNext;
        this.comboNext = null;
        this.move = null;
        this.strikeActive = false;
        if (next && !this.ko) {
          this.comboStep++;
          this.startMove(next);
        }
      }
    } else this.strikeActive = false;

    // --- locomotion ---
    let ix = intent.moveX, iz = intent.moveZ;
    const len = Math.hypot(ix, iz);
    if (len > 1) { ix /= len; iz /= len; }
    if (this.ko) { ix = 0; iz = 0; }
    const sn = Math.sin(camYaw), cs = Math.cos(camYaw);
    // camera looks along (-sin yaw, -cos yaw); forward input moves that way
    const wx = -sn * iz + cs * ix, wz = -cs * iz - sn * ix;
    const inWater = this.pos.y < WATER_LEVEL - 0.3;
    let speed = intent.run ? 7.5 : 3.2;
    if (inWater) speed *= 0.5;
    if (this.move) speed *= this.move === 'belly' ? 0.25 : 0.35;
    const want = new THREE.Vector2(wx * speed, wz * speed);
    const accel = this.grounded ? 40 : 12;
    const dvx = want.x - this.vel.x, dvz = want.y - this.vel.z;
    const dl = Math.hypot(dvx, dvz), maxDv = accel * dt;
    const k = dl > maxDv ? maxDv / dl : 1;
    this.vel.x += dvx * k;
    this.vel.z += dvz * k;
    if (Math.hypot(wx, wz) > 0.1 && !this.ko) {
      const target = Math.atan2(wx, wz);
      this.heading = dampAngle(this.heading, target, this.move ? 4 : 14, dt);
    }
    // lunge forward on the strike frames
    if (this.move && this.strikeActive && this.move !== 'slam') {
      const lunge = this.move === 'belly' ? 9 : 4;
      this.vel.x += Math.sin(this.heading) * lunge * dt * 6;
      this.vel.z += Math.cos(this.heading) * lunge * dt * 6;
    }

    // jump
    if (intent.jump && this.grounded && !this.move && !this.ko) {
      this.vel.y = 8.5;
      this.grounded = false;
    }
    this.vel.y -= GRAVITY * dt;

    // integrate + collide
    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    // block very steep climbs (cliffs), allow stairs and hills
    const hHere = groundAt(this.pos.x, this.pos.z), hNext = groundAt(nx, nz);
    const stepLen = Math.hypot(nx - this.pos.x, nz - this.pos.z);
    if (this.grounded && stepLen > 1e-4 && (hNext - hHere) / stepLen > 1.9) {
      nx = this.pos.x;
      nz = this.pos.z;
      this.vel.x *= 0.2;
      this.vel.z *= 0.2;
    }
    const r = resolve(nx, nz, PLAYER_RADIUS, this.pos.y, 1.6);
    this.pos.x = clamp(r.x, -270, 270);
    this.pos.z = clamp(r.z, -270, 270);
    this.pos.y += this.vel.y * dt;
    const ground = groundAt(this.pos.x, this.pos.z);
    const floor = Math.max(ground, WATER_LEVEL - 1.1); // wade, don't drown
    if (this.pos.y <= floor + (this.grounded ? 0.35 : 0)) {
      // snap down slopes while walking; land when falling
      if (!this.grounded && this.slamPending) {
        this.slamPending = false;
        this.startMove('slam');
      }
      this.pos.y = floor;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    } else this.grounded = false;

    // friction on the ground when not driving
    if (this.grounded && len < 0.05) {
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
        angry: false,
      },
      dt,
    );
    this.object.position.copy(this.pos);
    this.object.rotation.y = this.heading;
  }
  private slamPending = false;

  moveProgress() {
    return this.move ? clamp(this.moveTime / MOVES[this.move].duration, 0, 1) : 0;
  }
}
