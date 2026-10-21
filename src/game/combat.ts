// Melee resolution: during a move's strike window, every opponent inside its reach and arc gets hit
// once per strike. Returns hit events so the game can add hit-stop, shake, FX and sounds.
import { MOVES } from '../chonk/animator';
import { angleDelta } from '../core/math';
import type { Fighter } from './fighter';

export interface HitEvent {
  attacker: Fighter;
  victim: Fighter;
  move: string;
  damage: number;
  ko: boolean;
  x: number; y: number; z: number;
}

export function resolveStrikes(attackers: Fighter[], victims: Fighter[]): HitEvent[] {
  const out: HitEvent[] = [];
  for (const a of attackers) {
    if (!a.strikeActive || !a.move || a.ko) continue;
    const def = MOVES[a.move];
    for (const v of victims) {
      if (v === a || v.ko || a.hitThisStrike.has(v.id)) continue;
      const dx = v.pos.x - a.pos.x, dz = v.pos.z - a.pos.z, dy = v.pos.y - a.pos.y;
      const d = Math.hypot(dx, dz);
      if (d > def.reach * (a.object.scale.x || 1) + v.radius || Math.abs(dy) > 1.6) continue;
      if (def.arc < Math.PI * 2 && Math.abs(angleDelta(a.heading, Math.atan2(dx, dz))) > def.arc / 2 + 0.35) continue;
      a.hitThisStrike.add(v.id);
      const damage = Math.round(def.damage * a.power);
      if (v.takeHit(damage, def.knock * Math.min(1.5, a.power + 0.2), a.pos, a.move === 'belly' || a.move === 'slam' ? 0.8 : 0.35)) {
        out.push({ attacker: a, victim: v, move: a.move, damage, ko: v.ko, x: v.pos.x, y: v.pos.y + v.height * 0.6, z: v.pos.z });
      }
    }
  }
  return out;
}
