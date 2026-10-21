// What the AI can see and do. The model picks one high-level action per turn (go, talk, hit, fight...);
// a skill turns it into frame-by-frame Intents: A* paths, facing, punch timing, belly cooldowns.
// Everything here reads only the simulation state, so a recorded run replays exactly.
import type { Intent } from '../core/input';
import { Enemy } from '../game/enemy';
import { Breakable, FruitTree, Pickup } from '../game/entities';
import { LANDMARKS, type Game } from '../game/game';
import { angleDelta } from '../core/math';
import { NavGrid } from './nav';

export type ActionName = 'go' | 'talk' | 'hit' | 'fight' | 'sprint' | 'wait';
export interface Action { action: ActionName; target?: string; move?: 'punch' | 'belly' | 'slam' }

export interface Thing { id: string; kind: string; name: string; x: number; z: number; info?: string; r?: number }

/** one tick of a skill: an intent in WORLD space (wx, wz), turned into the game's Intent by the runner */
export interface Drive { wx?: number; wz?: number; run?: boolean; sprint?: boolean; face?: number | null; jump?: boolean; punch?: boolean; belly?: boolean; interact?: boolean }
export type Skill = Generator<Drive, string, void>;

/** with camYaw = 0 the game maps (moveX, moveZ) to world (moveX, -moveZ) */
export function toIntent(d: Drive): Intent {
  return {
    moveX: d.wx ?? 0, moveZ: -(d.wz ?? 0), run: d.run ?? true, sprint: d.sprint ?? false,
    jump: !!d.jump, punch: !!d.punch, kick: false, belly: !!d.belly, interact: !!d.interact, face: d.face ?? null,
  };
}

const enemyId = (e: Enemy) => (e.kind === 'tiger' ? 'overfit' : `wolf-${e.id}`);

/** everything the AI can name as a target right now */
export function things(g: Game): Thing[] {
  const out: Thing[] = [];
  for (const n of g.npcs) out.push({ id: n.id, kind: 'npc', name: n.name, x: n.x, z: n.z });
  out.push({ id: 'oracle', kind: 'npc', name: 'The Oracle', x: g.oracle.x, z: g.oracle.z });
  for (const e of g.enemies) if (e.alive && !e.ko) out.push({ id: enemyId(e), kind: 'enemy', name: e.kind === 'tiger' ? 'Overfit the tiger' : 'Wolf bandit', x: e.pos.x, z: e.pos.z, info: `hp ${Math.ceil(e.hp)}/${e.maxHp}` });
  for (const e of g.entities) {
    if (!e.alive) continue;
    if (e instanceof Pickup) out.push({ id: e.id, kind: 'item', name: e.name, x: e.x, z: e.z });
    else if (e instanceof Breakable) out.push({ id: e.id, kind: 'breakable', name: e.spec.name, x: e.x, z: e.z, info: e.locked ? 'locked' : undefined, r: e.radius });
    else if (e instanceof FruitTree && e.hitsLeft > 0) out.push({ id: e.id, kind: 'tree', name: e.name, x: e.x, z: e.z, r: e.radius });
  }
  for (const d of g.dummies) out.push({ id: d.id, kind: 'dummy', name: 'Training dummy', x: d.x, z: d.z, r: d.radius });
  out.push({ id: 'gong', kind: 'partner', name: 'Gong (sparring partner)', x: g.partner.pos.x, z: g.partner.pos.z });
  for (const l of LANDMARKS) out.push({ id: l.id, kind: 'place', name: l.name, x: l.x, z: l.z });
  return out;
}

export function findThing(g: Game, target: string | undefined): Thing | null {
  if (!target) return null;
  const t = target.trim();
  const m = /^\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?$/.exec(t);
  if (m) return { id: t, kind: 'point', name: `(${m[1]}, ${m[2]})`, x: +m[1], z: +m[2] };
  const all = things(g);
  const low = t.toLowerCase();
  return all.find((x) => x.id.toLowerCase() === low) ?? all.find((x) => x.name.toLowerCase() === low) ?? null;
}

/** live position of a target (enemies and NPCs move) */
function track(g: Game, th: Thing): Thing {
  if (th.kind === 'point' || th.kind === 'place') return th;
  return things(g).find((x) => x.id === th.id) ?? th;
}

export const heading = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz);

export class Skills {
  nav: NavGrid;
  /** dialogs seen so far (the runner counts them while it reads them) */
  dialogs = 0;
  private brokenSeen = new Set<string>();
  constructor(private g: Game) {
    this.nav = new NavGrid();
  }

  /** keep the grid in sync with smashed crates and rocks */
  private syncNav() {
    for (const e of this.g.entities)
      if (e instanceof Breakable && !e.alive && !this.brokenSeen.has(e.id)) {
        this.brokenSeen.add(e.id);
        this.nav.refresh(e.x - 3, e.z - 3, e.x + 3, e.z + 3);
      }
  }

  start(a: Action): Skill {
    this.syncNav();
    const g = this.g;
    switch (a.action) {
      case 'go': {
        const th = findThing(g, a.target);
        if (!th) return fail(`Unknown target "${a.target}".`);
        return this.goTo(th, th.kind === 'npc' ? 2.4 : th.kind === 'place' ? 4 : th.kind === 'item' ? 0.3 : 1.8, true);
      }
      case 'talk': {
        const th = findThing(g, a.target);
        if (!th || th.kind !== 'npc') return fail(`"${a.target}" is not someone you can talk to.`);
        return this.talk(th);
      }
      case 'hit': {
        const th = findThing(g, a.target);
        if (th && (th.kind === 'enemy' || th.kind === 'partner')) return this.fight(th);
        if (!th || !['breakable', 'tree', 'dummy'].includes(th.kind)) return fail(`"${a.target}" is not something to hit.`);
        return this.hit(th, a.move ?? 'punch');
      }
      case 'fight': {
        const th = a.target ? findThing(g, a.target) : null;
        if (a.target && (!th || (th.kind !== 'enemy' && th.kind !== 'partner'))) return fail(`"${a.target}" is not an enemy.`);
        return this.fight(th);
      }
      case 'sprint':
        return this.sprint();
      case 'wait':
        return this.wait(3);
      default:
        return fail(`Unknown action "${(a as Action).action}".`);
    }
  }

  // ------------------------------------------------------------------ moving
  /** walk/run along an A* path until within `near` meters of the (moving) target */
  *goTo(th: Thing, near: number, report = false): Skill {
    const g = this.g, P = g.player;
    let tgt = track(g, th);
    const start = { x: P.pos.x, z: P.pos.z };
    let path = this.nav.path(P.pos.x, P.pos.z, tgt.x, tgt.z, near);
    if (!path) return `No path to ${th.name}.`;
    let wp = 0, lastCheck = { x: P.pos.x, z: P.pos.z, t: 0 }, stuck = 0, t = 0, lastPlan = 0;
    const limit = 25 + Math.hypot(tgt.x - P.pos.x, tgt.z - P.pos.z) / 2.5;
    for (;;) {
      t += 1 / 60;
      if (th.kind === 'enemy' || th.kind === 'npc' || th.kind === 'partner') {
        const now = track(g, th);
        if (Math.hypot(now.x - tgt.x, now.z - tgt.z) > 2 && t - lastPlan > 1) {
          tgt = now;
          lastPlan = t;
          path = this.nav.path(P.pos.x, P.pos.z, tgt.x, tgt.z, near) ?? path;
          wp = 0;
        }
      }
      const dist = Math.hypot(tgt.x - P.pos.x, tgt.z - P.pos.z);
      // a place whose center is inside a building: the end of the path is as close as it gets
      const end = path[path.length - 1];
      const atEnd = !!end && Math.hypot(end.x - P.pos.x, end.z - P.pos.z) < 1.2 && dist < near + 6;
      if (dist <= near + 0.15 || atEnd) {
        return report ? `Arrived at ${th.name} (${Math.round(P.pos.x)}, ${Math.round(P.pos.z)}).` : 'ok';
      }
      if (t > limit) return `Could not reach ${th.name}: still ${Math.round(dist)} m away.`;
      // pure pursuit: aim a few meters ahead on the path
      while (wp < path.length - 1 && Math.hypot(path[wp].x - P.pos.x, path[wp].z - P.pos.z) < 1.3) wp++;
      let look = wp;
      while (look < path.length - 1 && Math.hypot(path[look + 1].x - P.pos.x, path[look + 1].z - P.pos.z) < 2.6 && this.nav.clear(P.pos.x, P.pos.z, path[look + 1].x, path[look + 1].z)) look++;
      const aim = !path.length || (wp >= path.length - 1 && dist < 3) ? tgt : path[look];
      let dx = aim.x - P.pos.x, dz = aim.z - P.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      // stuck? hop, then learn the block and plan again
      if (t - lastCheck.t > 1.2) {
        const moved = Math.hypot(P.pos.x - lastCheck.x, P.pos.z - lastCheck.z);
        lastCheck = { x: P.pos.x, z: P.pos.z, t };
        if (moved < 0.8 && !P.move && !g.dialog) {
          stuck++;
          if (stuck >= 2) {
            this.nav.learnBlock(P.pos.x + dx * 1.2, P.pos.z + dz * 1.2);
            path = this.nav.path(P.pos.x, P.pos.z, tgt.x, tgt.z, near);
            wp = 0;
            if (!path || stuck > 6) return `Stuck on the way to ${th.name} at (${Math.round(P.pos.x)}, ${Math.round(P.pos.z)}).`;
          }
          yield { wx: dx, wz: dz, jump: true };
          continue;
        } else stuck = 0;
      }
      const far = dist > 10;
      yield { wx: dx, wz: dz, run: true, sprint: far };
    }
    void start;
  }

  *talk(th: Thing): Skill {
    const g = this.g;
    if (!g.interactable() || g.interactable()!.id !== th.id) {
      const r = yield* this.goTo(th, th.id === 'oracle' ? 3.2 : 2.2);
      if (r !== 'ok') return r;
    }
    for (let i = 0; i < 90 && g.interactable()?.id !== th.id; i++) {
      const now = track(g, th);
      yield { wx: Math.sin(heading(g.player.pos.x, g.player.pos.z, now.x, now.z)), wz: Math.cos(heading(g.player.pos.x, g.player.pos.z, now.x, now.z)), run: false };
    }
    if (g.interactable()?.id !== th.id) return `${th.name} is too far to talk.`;
    const seen = this.dialogs;
    yield { interact: true };
    if (!g.dialog && this.dialogs === seen) return `${th.name} has nothing to say.`;
    // the runner reads the dialog lines aloud; wait until it ends
    while (g.dialog) yield {};
    return `Talked to ${th.name}.`;
  }

  // ------------------------------------------------------------------ hitting things
  *hit(th: Thing, move: 'punch' | 'belly' | 'slam'): Skill {
    const g = this.g, P = g.player;
    const reach = (th.r ?? 0.6) + 0.85;
    const r0 = yield* this.goTo(th, reach);
    if (r0 !== 'ok') return r0;
    const alive = () => {
      const e = g.entities.find((x) => x.id === th.id);
      if (th.kind === 'dummy') return true;
      if (!e || !e.alive) return false;
      return !(e instanceof FruitTree) || e.hitsLeft > 0;
    };
    const items0 = g.stats.items;
    let strikes = 0, t = 0;
    while (alive() && strikes < 8 && t < 20) {
      t += 1 / 60;
      const want = heading(P.pos.x, P.pos.z, th.x, th.z);
      const d = Math.hypot(th.x - P.pos.x, th.z - P.pos.z);
      if (d > reach + 1.2) {
        const r = yield* this.goTo(th, reach);
        if (r !== 'ok') return r;
        continue;
      }
      const facing = Math.abs(angleDelta(P.heading, want)) < 0.25;
      if (!facing || P.move || !P.grounded) {
        yield { face: want };
        continue;
      }
      strikes++;
      if (move === 'belly') {
        while (g.bellyCooldown > 0) yield { face: want };
        yield { belly: true, face: want };
      } else if (move === 'slam') {
        yield { jump: true, face: want };
        for (let i = 0; i < 40 && (P.grounded || P.vel.y > 2); i++) yield { face: want };
        yield { punch: true, face: want };
      } else {
        // a full J J J combo
        yield { punch: true, face: want };
        for (let k = 0; k < 2; k++) {
          for (let i = 0; i < 9; i++) yield { face: want };
          yield { punch: true, face: want };
        }
      }
      for (let i = 0; i < 120 && (P.move || !P.grounded); i++) yield { face: want };
      if (th.kind === 'dummy') break;
    }
    // grab what fell out
    yield* this.collectNear(th.x, th.z, 7);
    const got = g.stats.items - items0;
    if (th.kind === 'dummy') return `You hit the dummy with ${move}.`;
    if (!alive()) return `${th.name} ${th.kind === 'tree' ? 'is empty now' : 'broke'}.${got ? ` You picked up ${got} item(s).` : ''}`;
    return `${th.name} is still there after ${strikes} attacks with ${move}.`;
  }

  /** walk over the pickups lying close by */
  *collectNear(x: number, z: number, r: number): Generator<Drive, void, void> {
    const g = this.g;
    for (let n = 0; n < 4; n++) {
      // drops pop out and fall: give them a moment
      for (let i = 0; i < 30; i++) yield {};
      const p = g.entities.find((e) => e instanceof Pickup && e.alive && Math.hypot(e.x - x, e.z - z) < r) as Pickup | undefined;
      if (!p) return;
      const res = yield* this.goTo({ id: p.id, kind: 'item', name: p.name, x: p.x, z: p.z }, 0.3);
      if (res !== 'ok') return;
    }
  }

  // ------------------------------------------------------------------ fighting
  *fight(th: Thing | null): Skill {
    const g = this.g, P = g.player;
    const hp0 = P.hp, ko0 = g.stats.deaths;
    const pickFoe = (): Enemy | 'gong' | null => {
      if (th?.kind === 'partner') return g.partner.mode === 'spar' || g.trainStep === 'spar' ? 'gong' : null;
      if (th) {
        const e = g.enemies.find((x) => enemyId(x) === th.id);
        if (e && e.alive && !e.ko) return e;
      }
      let best: Enemy | null = null, bd = 28;
      for (const e of g.enemies) {
        if (!e.alive || e.ko) continue;
        const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    };
    let t = 0, knocked = 0;
    const seen = new Set<Enemy>();
    for (;;) {
      if (g.stats.deaths > ko0) return 'You were knocked out! You woke up in the village.';
      const foe = pickFoe();
      if (!foe) break;
      if (foe !== 'gong') seen.add(foe);
      if (t > 45) return `Fight not over after 45 s. Your health ${Math.ceil(P.hp)}/${P.maxHp}.`;
      const fx = foe === 'gong' ? g.partner.pos.x : foe.pos.x, fz = foe === 'gong' ? g.partner.pos.z : foe.pos.z;
      const d = Math.hypot(fx - P.pos.x, fz - P.pos.z);
      const want = heading(P.pos.x, P.pos.z, fx, fz);
      t += 1 / 60;
      if (d > 2.0) {
        if (d > 8) {
          const r = yield* this.goTo({ id: 'foe', kind: 'point', name: 'the enemy', x: fx, z: fz }, 1.6);
          if (r !== 'ok' && !r.startsWith('Could not')) return r;
          continue;
        }
        yield { wx: Math.sin(want), wz: Math.cos(want), run: true, face: want };
        continue;
      }
      if (P.move || !P.grounded) {
        yield { face: want };
        continue;
      }
      if (g.bellyCooldown <= 0 && (foe === 'gong' || foe.kind === 'tiger' || g.dragon || t > 0.5)) yield { belly: true, face: want };
      else {
        yield { punch: true, face: want };
        for (let k = 0; k < 2; k++) {
          for (let i = 0; i < 9; i++) yield { face: want };
          yield { punch: true, face: want };
        }
      }
      for (let i = 0; i < 90 && (P.move || !P.grounded); i++) yield { face: want };
      if (foe === 'gong' && g.trainStep !== 'spar') break;
      // the boss fight story moves on in dialogs
      if (g.dialog) break;
    }
    // knocked-out enemies need a moment to poof away (and the story to go on)
    for (let i = 0; i < 150 && [...seen].some((e) => e.ko && !e.removed); i++) yield {};
    for (const e of seen) if (e.ko || !e.alive) knocked++;
    yield* this.collectNear(P.pos.x, P.pos.z, 8);
    const lost = Math.max(0, Math.round(hp0 - P.hp));
    if (th?.kind === 'partner') return `Sparring done. Health ${Math.ceil(P.hp)}/${P.maxHp}.`;
    return `Fight over: ${knocked} enemy knocked out. You lost ${lost} health (now ${Math.ceil(P.hp)}/${P.maxHp}).`;
  }

  *sprint(): Skill {
    const P = this.g.player;
    const dir = heading(P.pos.x, P.pos.z, P.pos.x + 1, P.pos.z);
    let s = 1;
    for (let i = 0; i < 60 * 5; i++) {
      // back and forth so we stay in the arena
      if (i % 90 === 0) s = -s;
      yield { wx: Math.sin(dir) * s, wz: Math.cos(dir) * s, sprint: true };
    }
    return 'You sprinted for 5 seconds.';
  }

  *wait(sec: number): Skill {
    for (let i = 0; i < sec * 60; i++) yield {};
    return `You waited ${sec} s.`;
  }
}

function* fail(msg: string): Skill {
  return msg;
}
