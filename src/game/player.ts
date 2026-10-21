// Le Chonk, the playable hero: camera-relative movement, jumps, and a kung-fu move set
// (jab -> cross -> kick combo, belly bump special, ground slam from the air).
import type { MoveName } from '../chonk/animator';
import { buildCharacter } from '../chonk/characters';
import type { Intent } from '../core/input';
import { Fighter } from './fighter';

/** ground speeds (m/s): a chubby cat jogs, he doesn't sprint like a car */
export const RUN_SPEED = 5;
export const WALK_SPEED = 1.8;

export class Player extends Fighter {
  /** queued follow-up in the jab -> cross -> kick combo */
  private comboNext: MoveName | null = null;
  private comboStep = 0;
  /** belly bump needs chi: filled by landing hits */
  chi = 50;
  bellyCost = 40;
  regenDelay = 0;

  constructor(x: number, z: number) {
    super(buildCharacter('chonk'), x, z, 100, 0.6, 1.6);
  }

  /** one 60 Hz step. camYaw: camera yaw so input is camera-relative */
  step(dt: number, intent: Intent, camYaw: number) {
    if (this.canAct()) {
      if (intent.belly && !this.move && this.grounded && this.chi >= this.bellyCost) {
        this.chi -= this.bellyCost;
        this.startMove('belly');
      }
      if (intent.kick && (!this.move || (this.move !== 'belly' && this.moveProgress() > 0.6)) && this.grounded) this.startMove('kick');
      if (intent.punch) {
        if (!this.move && this.grounded) {
          this.comboStep = 0;
          this.startMove('jab');
        } else if (this.move && this.move !== 'belly' && this.move !== 'slam') {
          this.comboNext = this.comboStep === 0 ? 'cross' : this.comboStep === 1 ? 'kick' : null;
        } else if (!this.grounded && !this.move && this.vel.y < 4) {
          this.vel.y = -18;
          this.slamPending = true;
        }
      }
    }
    const done = this.tickMove(dt);
    if (done) {
      const next = this.comboNext;
      this.comboNext = null;
      if (next && this.canAct()) {
        this.comboStep++;
        this.startMove(next);
      }
    }

    // camera-relative direction: the camera looks along (-sin yaw, -cos yaw)
    let ix = intent.moveX, iz = intent.moveZ;
    const len = Math.hypot(ix, iz);
    if (len > 1) { ix /= len; iz /= len; }
    const sn = Math.sin(camYaw), cs = Math.cos(camYaw);
    const wx = -sn * iz + cs * ix, wz = -cs * iz - sn * ix;
    this.physics(dt, wx, wz, intent.run ? RUN_SPEED : WALK_SPEED, intent.face ?? null, intent.jump);

    // slow regeneration out of combat
    this.regenDelay = this.hurtT < 6 ? 1 : 0;
    if (!this.ko && this.hurtT > 6) this.hp = Math.min(this.maxHp, this.hp + dt * 2);
    this.chi = Math.min(100, this.chi + dt * 1.5);
  }
}
