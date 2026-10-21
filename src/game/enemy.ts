// Enemy fighters: wolf bandits that guard camps, and OVERFIT the tiger. Simple deterministic AI:
// idle at home -> notice Le Chonk -> chase -> circle and strike (at most two attackers at once) -> go home.
import { buildCharacter } from '../chonk/characters';
import type { MoveName } from '../chonk/animator';
import { angleDelta, rng, type Rng } from '../core/math';
import { Fighter } from './fighter';

export interface EnemyDef { kind: 'wolf' | 'tiger'; x: number; z: number; camp: string; loot?: string }

const STATS = {
  wolf: { hp: 45, run: 5.4, walk: 1.8, reach: 1.75, aggro: 15, leash: 32, power: 0.6, cool: [1.0, 1.9], radius: 0.55, height: 1.8 },
  // the tiger guards the palace plateau: he never follows Le Chonk far down the Thousand Steps
  tiger: { hp: 320, run: 6.0, walk: 2.2, reach: 2.2, aggro: 20, leash: 30, power: 1.0, cool: [0.8, 1.4], radius: 0.75, height: 2.3 },
};

/** shared attack tokens so only a couple of enemies strike at once */
export const tokens = { holders: new Set<number>(), max: 2 };

export class Enemy extends Fighter {
  kind: 'wolf' | 'tiger';
  home: { x: number; z: number };
  camp: string;
  loot?: string;
  state: 'idle' | 'chase' | 'fight' | 'return' = 'idle';
  private R: Rng;
  private cooldown = 1;
  private strafeDir = 1;
  private strafeT = 0;
  private wanderT = 0;
  private wanderTo: { x: number; z: number } | null = null;
  private combo: MoveName[] = [];
  removed = false;
  stats: (typeof STATS)['wolf'];
  phase2 = false;

  constructor(def: EnemyDef, seed: number) {
    const st = STATS[def.kind];
    super(buildCharacter(def.kind), def.x, def.z, st.hp, st.radius, st.height);
    this.kind = def.kind;
    this.stats = st;
    this.home = { x: def.x, z: def.z };
    this.camp = def.camp;
    this.loot = def.loot;
    this.power = st.power;
    this.R = rng(seed);
    this.heading = this.R() * Math.PI * 2;
    this.angry = true;
  }

  step(dt: number, target: Fighter) {
    const st = this.stats;
    const dx = target.pos.x - this.pos.x, dz = target.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const toTarget = Math.atan2(dx, dz);
    const fromHome = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);
    let wx = 0, wz = 0, speed = st.walk, face: number | null = null, jump = false;
    this.cooldown -= dt;

    if (this.ko) {
      tokens.holders.delete(this.id);
      this.physics(dt, 0, 0, 0, null);
      return;
    }
    if (this.kind === 'tiger' && !this.phase2 && this.hp < this.maxHp / 2) {
      this.phase2 = true;
      this.stats = { ...st, run: 6.2, cool: [0.4, 0.9] };
    }

    // state transitions
    const targetOk = target.alive;
    if (this.state === 'idle' && targetOk && dist < st.aggro) this.state = 'chase';
    if ((this.state === 'chase' || this.state === 'fight') && (!targetOk || fromHome > st.leash)) this.state = 'return';
    if (this.state === 'return' && fromHome < 2) this.state = 'idle';
    if (this.state === 'return' && this.hurtT < 1 && targetOk) this.state = 'chase';
    if (this.state === 'chase' && dist < 3.2) this.state = 'fight';
    if (this.state === 'fight' && dist > 5) this.state = 'chase';
    if (this.state !== 'fight') tokens.holders.delete(this.id);

    const dirTo = (x: number, z: number) => {
      const ddx = x - this.pos.x, ddz = z - this.pos.z, d = Math.hypot(ddx, ddz) || 1;
      return [ddx / d, ddz / d];
    };

    switch (this.state) {
      case 'idle': {
        // wander around the camp
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = 2 + this.R() * 4;
          this.wanderTo = this.R() < 0.5 ? null : { x: this.home.x + (this.R() - 0.5) * 8, z: this.home.z + (this.R() - 0.5) * 8 };
        }
        if (this.wanderTo && Math.hypot(this.wanderTo.x - this.pos.x, this.wanderTo.z - this.pos.z) > 0.6) [wx, wz] = dirTo(this.wanderTo.x, this.wanderTo.z);
        speed = st.walk * 0.6;
        break;
      }
      case 'return':
        [wx, wz] = dirTo(this.home.x, this.home.z);
        speed = st.run * 0.8;
        break;
      case 'chase': {
        [wx, wz] = [dx / (dist || 1), dz / (dist || 1)];
        speed = st.run;
        // the tiger pounces from range
        if (this.kind === 'tiger' && dist > 6 && dist < 11 && this.cooldown <= 0 && this.grounded && !this.move) {
          this.vel.x = (dx / dist) * dist * 1.05;
          this.vel.z = (dz / dist) * dist * 1.05;
          jump = true;
          this.slamPending = true;
          this.cooldown = 2.5;
        }
        break;
      }
      case 'fight': {
        face = toTarget;
        const hasToken = tokens.holders.has(this.id) || (tokens.holders.size < tokens.max && (tokens.holders.add(this.id), true));
        if (hasToken) {
          if (dist > st.reach * 0.85) {
            [wx, wz] = [dx / dist, dz / dist];
            speed = st.run * 0.7;
          } else if (this.cooldown <= 0 && !this.move && this.canAct() && Math.abs(angleDelta(this.heading, toTarget)) < 0.6) {
            this.combo = this.pickCombo();
            this.startMove(this.combo.shift()!);
            const [c0, c1] = this.stats.cool;
            this.cooldown = c0 + this.R() * (c1 - c0);
          }
        } else {
          // wait your turn: circle at a respectful distance
          const want = 4.2;
          const radial = dist < want - 0.5 ? -1 : dist > want + 0.5 ? 1 : 0;
          this.strafeT -= dt;
          if (this.strafeT <= 0) {
            this.strafeT = 1.5 + this.R() * 2;
            this.strafeDir = this.R() < 0.5 ? -1 : 1;
          }
          const ux = dx / dist, uz = dz / dist;
          wx = ux * radial + -uz * this.strafeDir * 0.7;
          wz = uz * radial + ux * this.strafeDir * 0.7;
          speed = st.walk;
        }
        break;
      }
    }
    this.fighting = this.state === 'fight' || this.state === 'chase';
    const done = this.tickMove(dt);
    if (done && this.combo.length && this.canAct()) this.startMove(this.combo.shift()!);
    this.physics(dt, wx, wz, speed, face, jump);
  }

  private pickCombo(): MoveName[] {
    const r = this.R();
    if (this.kind === 'wolf') return r < 0.5 ? ['jab'] : r < 0.85 ? ['jab', 'cross'] : ['kick'];
    if (this.phase2) return r < 0.4 ? ['jab', 'cross', 'kick'] : r < 0.7 ? ['kick', 'cross'] : ['cross', 'jab', 'cross', 'kick'];
    return r < 0.45 ? ['jab', 'cross'] : r < 0.75 ? ['kick'] : ['jab', 'jab', 'cross'];
  }
}
