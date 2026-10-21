// The game: world entities, NPCs, quests and dialogs around Le Chonk. One deterministic 60 Hz step()
// driven by an Intent, from the keyboard or from the AI harness.
// All the text is short, simple English (A2 level): many players do not speak English as a first language.
import * as THREE from 'three';
import { MOVES, type MoveName } from '../chonk/animator';
import { angleDelta, rng } from '../core/math';
import type { Intent } from '../core/input';
import { ARENA, BRIDGES, FRUIT_TREES, MUSHROOM_ROCKS, PEACH_HILL, POND, SHOOTS, SPOTS, VILLAGE } from '../world/layout';
import { groundAt } from '../world/world';
import { resolveStrikes, type HitEvent } from './combat';
import { Enemy, tokens } from './enemy';
import { Breakable, Debris, FruitTree, ITEM_NAMES, Pickup, type Entity, type ItemKind } from './entities';
import { Effects } from './fx';
import { Highlight, setFxTime } from './highlight';
import { ItemCue } from './itemIcons';
import { NPC, type NpcContext } from './npc';
import { Player } from './player';
import { DRAGON_SCALE, DragonAura } from './powerup';
import { ObjectiveBeacon, Oracle, buildCamp } from './props';
import { Dummy, SparPartner } from './training';

export interface Line { who: string; text: string }
export interface Objective {
  text: string;
  done?: boolean;
  target?: { x: number; z: number; name: string };
  /** the first line of a side quest (the HUD groups them) */
  side?: 'noodles' | 'training';
  /** a side quest the main quest now needs */
  required?: boolean;
}
export type GameEvent =
  | { type: 'toast'; text: string; kind?: 'discover' | 'item' | 'quest' | 'info' }
  | { type: 'sound'; id: string }
  | { type: 'hit'; ev: HitEvent }
  | { type: 'end' };
/** the on-screen key hint while Le Chonk trains */
export interface Tutorial { keys: string[]; sep?: string; text: string; count?: string; progress?: number }

export const LANDMARKS = [
  { id: 'square', name: 'Village Square', x: VILLAGE.x, z: VILLAGE.z, r: 14 },
  { id: 'noodle', name: 'Noodle Shop', x: -2, z: 8, r: 9 },
  { id: 'peach', name: 'Sacred Peach Tree', x: PEACH_HILL.x, z: PEACH_HILL.z, r: 16 },
  { id: 'steps', name: 'The Thousand Steps', x: 0, z: -48, r: 10 },
  { id: 'palace', name: 'Palace of the Chonk', x: 0, z: -158, r: 24 },
  { id: 'bamboo', name: 'Bamboo Forest', x: 150, z: 20, r: 45 },
  { id: 'pond', name: 'Lotus Pond', x: POND.x, z: POND.z, r: 26 },
  { id: 'arena', name: 'Training Arena', x: ARENA.x, z: ARENA.z, r: ARENA.r },
  { id: 'camp', name: 'Wolf Camp', x: SPOTS.camp.x, z: SPOTS.camp.z, r: 16 },
  { id: 'oldtree', name: 'Old Peach Tree', x: SPOTS.oldTree.x, z: SPOTS.oldTree.z, r: 12 },
  { id: 'pagoda', name: 'Hill Pagoda', x: PEACH_HILL.x + 22, z: PEACH_HILL.z - 26, r: 10 },
  { id: 'bridge', name: 'East Bridge', x: BRIDGES[0].x, z: BRIDGES[0].z, r: 12 },
];

type Stage = 'intro' | 'crates' | 'canard2' | 'tortue' | 'stones' | 'oracle' | 'boss' | 'scroll' | 'feast' | 'done';
type Ingredient = 'peach' | 'shoot' | 'mushroom';
export type TrainStep = 'combo' | 'belly' | 'slam' | 'sprint' | 'spar' | 'reward';
const TRAIN_ORDER: TrainStep[] = ['combo', 'belly', 'slam', 'sprint', 'spar', 'reward'];
const SPRINT_GOAL = 2;
const SPAR_GOAL = 4;
const COACH = 'Tao';
const PARTNER = 'Gong';
/** the arena layout: Tao by the entrance, three dummies, Gong on his mat */
const TRAIN_SPOTS = {
  coach: { x: ARENA.x + 5, z: ARENA.z - 12 },
  dummies: [[-5, -6], [0, -4], [5, -6]].map(([dx, dz]) => ({ x: ARENA.x + dx, z: ARENA.z + dz })),
  partner: { x: ARENA.x, z: ARENA.z + 3 },
};

export class Game {
  player: Player;
  npcs: NPC[] = [];
  enemies: Enemy[] = [];
  entities: Entity[] = [];
  oracle: Oracle;
  fx: Effects;
  debris: Debris;
  events: GameEvent[] = [];
  t = 0;
  hitStop = 0;
  shake = 0;
  /** 0..1 full-screen flash (the Dragon Chonk transformation), the HUD draws it */
  flash = 0;
  stage: Stage = 'intro';
  noodles: 'none' | 'active' | 'done' = 'none';
  inv: Record<ItemKind, number> = { jade: 0, peach: 0, shoot: 0, mushroom: 0, dumpling: 0 };
  jadeFound = new Set<string>();
  discovered = new Set<string>();
  /** the dialog on screen; `with` is the id of the NPC Le Chonk is talking to */
  dialog: { lines: Line[]; i: number; onEnd?: () => void; with?: string } | null = null;
  bellyCooldown = 0;
  /** seconds for the belly jump to recharge (the Chi Charm from training makes it faster) */
  bellyRecharge = 2.2;
  tiger: Enemy | null = null;
  ended = false;
  stats = { smashed: 0, items: 0, deaths: 0, start: 0 };
  /** Dragon Chonk: ate the Dragon Noodles (bigger, golden aura, the Dragon Belly beats Overfit) */
  dragon = false;
  aura: DragonAura;
  /** Overfit fight before the noodles: time spent near him, hits he "predicted", the noodle hint shown */
  private bossT = 0;
  private predicted = 0;
  noodleHint = false;
  // training arena
  training: 'none' | 'known' | 'active' | 'done' = 'none';
  trainStep: TrainStep = 'combo';
  coach: NPC;
  partner: SparPartner;
  dummies: Dummy[] = [];
  private comboSeen = new Set<string>();
  private sprintT = 0;
  private sparHits = 0;
  private hinted = new Set<string>();
  private lastBellyStrike = -1;
  private struck = new Map<string, number>();
  private seq = 0;
  private rand = rng(2024);
  private highlights = new Map<object, Highlight>();
  private beacon = new ObjectiveBeacon();
  private fxT = 0;

  constructor(public scene: THREE.Scene) {
    this.player = new Player(VILLAGE.x, VILLAGE.z + 4);
    this.player.heading = Math.PI;
    scene.add(this.player.object);
    this.fx = new Effects(scene);
    this.debris = new Debris(scene);
    this.aura = new DragonAura(this.player, scene);

    // NPCs
    const canard = new NPC('canard', 'Papa Canard', 'duck', SPOTS.canard.x, SPOTS.canard.z, 0, 1.6);
    const tortue = new NPC('tortue', 'Master Tortue', 'tortoise', SPOTS.tortue.x, SPOTS.tortue.z, 0.6, 1.4);
    this.npcs.push(canard, tortue);
    // villagers strolling around their homes; each has a name (their dialog portrait follows their species)
    const R = rng(5);
    const villagers: [string, 'pig' | 'bunny', number, number][] = [
      ['Bao', 'pig', 14, 22], ['Lin', 'bunny', -18, 38], ['Dou Dou', 'pig', -36, 22], ['Yue', 'bunny', 30, 37], ['Xiao Tu', 'bunny', 4, -12], ['Pang', 'pig', 22, 23],
    ];
    for (const [name, k, x, z] of villagers) {
      const v = new NPC(`villager-${this.npcs.length}`, name, k, x, z, R() * 6, 1.3);
      v.wanders = true;
      this.npcs.push(v);
    }
    // Tao, Master Tortue's student, runs the Training Arena
    this.coach = new NPC('coach', COACH, 'bunny', TRAIN_SPOTS.coach.x, TRAIN_SPOTS.coach.z, Math.PI, 1.3);
    this.npcs.push(this.coach);
    for (const n of this.npcs) {
      scene.add(n.object);
      if (n.id.startsWith('villager')) n.setMarker(null);
    }
    scene.add(this.beacon.group);
    TRAIN_SPOTS.dummies.forEach(({ x, z }, i) => {
      const d = new Dummy(`dummy-${i + 1}`, x, z, Math.PI);
      this.dummies.push(d);
      scene.add(d.obj);
    });
    this.partner = new SparPartner(TRAIN_SPOTS.partner.x, TRAIN_SPOTS.partner.z, Math.PI);
    scene.add(this.partner.object);

    this.oracle = new Oracle(SPOTS.oracle.x, SPOTS.oracle.z, 0);
    scene.add(this.oracle.group);

    // --- breakables and pickups ---
    const add = <T extends Entity>(e: T) => {
      this.entities.push(e);
      scene.add(e.obj);
      return e;
    };
    // the crates next to the noodle shop (tutorial)
    const cr: [number, number, ItemKind | null][] = [[0, 0, 'dumpling'], [1.3, 1.2, 'peach'], [-0.2, 1.6, 'dumpling']];
    cr.forEach(([dx, dz, it], i) => add(new Breakable(`crate-${i + 1}`, 'crate', SPOTS.crates.x + dx, SPOTS.crates.z + dz, it, i * 0.4, i)));
    // barrels and vases around the village
    const vv: [number, number, 'barrel' | 'vase', ItemKind | null][] = [
      [-22, 22.5, 'barrel', 'dumpling'], [26, 37.5, 'vase', null], [-40, 37.5, 'vase', 'peach'], [40, 22.5, 'barrel', null], [-8, -6, 'vase', 'dumpling'], [8, -20, 'barrel', null],
    ];
    vv.forEach(([x, z, k, it], i) => add(new Breakable(`${k}-${i + 1}`, k, x, z, it, i, 10 + i)));
    // Jade Stone 1: inside the cracked boulder in the bamboo forest (belly jump!)
    add(new Breakable('boulder', 'boulder', SPOTS.boulder.x, SPOTS.boulder.z, 'jade', 0.3, 3));
    // Jade Stone 2: on the islet of the lotus pond
    add(new Pickup('jade-pond', 'jade', SPOTS.islet.x, SPOTS.islet.z));
    // Jade Stone 3: in the branches of the Old Peach Tree (shake it)
    add(new FruitTree('oldtree', 'Old Peach Tree', SPOTS.oldTree.x, SPOTS.oldTree.z, 'jade', 3, 1.6, 77));
    // Jade Stone 4: in the bandits' chest (locked while its guards stand)
    const camp = buildCamp(SPOTS.camp.x, SPOTS.camp.z, 9);
    scene.add(camp.group);
    this.campFire = camp;
    const chest = add(new Breakable('chest', 'chest', SPOTS.camp.x + 3.5, SPOTS.camp.z - 1.5, 'jade', -0.5, 4));
    chest.locked = true;
    // Jade Stone 5: in one of the palace vases
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1;
      const k = i % 4;
      const x = side * (6 + (k % 2) * 1.2), z = SPOTS.palace.z + 4 + k * 3.2;
      add(new Breakable(`palace-vase-${i + 1}`, 'vase', x, z, i === 5 ? 'jade' : i % 3 === 0 ? 'dumpling' : null, i, 30 + i));
    }
    // ingredients, each with a floating icon that shows while the noodle quest needs it
    const cue = (e: Entity, kind: Ingredient, y: number, seed: number) => {
      e.cue = new ItemCue(kind, y, seed);
      e.obj.add(e.cue.group);
    };
    FRUIT_TREES.forEach(([x, z], i) => {
      const s = 0.9 + (i % 3) * 0.1;
      cue(add(new FruitTree(`peach-tree-${i + 1}`, 'Peach tree', x, z, 'peach', 2, s, 50 + i)), 'peach', 5.6 * s, i);
    });
    SHOOTS.forEach(([x, z], i) => cue(add(new Pickup(`shoot-${i + 1}`, 'shoot', x, z)), 'shoot', 2.1, 10 + i));
    MUSHROOM_ROCKS.forEach(([x, z, has], i) => {
      const r = add(new Breakable(`rock-${i + 1}`, 'rock', x, z, has ? 'mushroom' : null, i, 60 + i));
      if (has) cue(r, 'mushroom', 2.0, 20 + i);
    });

    // wolf bandits: three at the camp, two prowling near the cracked boulder
    const wolves: [number, number, string][] = [
      [SPOTS.camp.x - 3, SPOTS.camp.z + 2, 'camp'], [SPOTS.camp.x + 2, SPOTS.camp.z + 4, 'camp'], [SPOTS.camp.x, SPOTS.camp.z - 4, 'camp'],
      [SPOTS.boulder.x - 6, SPOTS.boulder.z + 5, 'forest'], [SPOTS.boulder.x + 5, SPOTS.boulder.z - 6, 'forest'],
    ];
    wolves.forEach(([x, z, c], i) => {
      const e = new Enemy({ kind: 'wolf', x, z, camp: c }, 100 + i);
      this.enemies.push(e);
      scene.add(e.object);
    });
    this.refreshMarkers();
    this.events.push({ type: 'toast', text: 'The Valley of Peace', kind: 'discover' });
  }
  campFire: { fire: THREE.Mesh; inner: THREE.Mesh } | null = null;

  // ------------------------------------------------------------------ quests
  private noodlesReady() {
    return this.noodles === 'active' && this.inv.peach >= 3 && this.inv.shoot >= 3 && this.inv.mushroom >= 3;
  }
  /** the noodle quest still needs this ingredient */
  private wants(kind: ItemKind) {
    return this.noodles === 'active' && (kind === 'peach' || kind === 'shoot' || kind === 'mushroom') && this.inv[kind] < 3;
  }
  /** the closest place to get an ingredient: one lying on the ground, a peach tree with fruit, a mossy rock with a mushroom */
  nearestIngredient(kind: Ingredient): { x: number; z: number; name: string } | null {
    const P = this.player.pos;
    let best: { x: number; z: number; name: string } | null = null, bd = Infinity;
    for (const e of this.entities) {
      if (!e.alive) continue;
      let name: string | null = null;
      if (e instanceof Pickup && e.item === kind) name = ITEM_NAMES[kind];
      else if (kind === 'peach' && e instanceof FruitTree && e.drops === 'peach' && e.hitsLeft > 0) name = 'Peach tree';
      else if (kind === 'mushroom' && e instanceof Breakable && e.contents === 'mushroom') name = 'Mossy rock';
      if (!name) continue;
      const d = Math.hypot(e.x - P.x, e.z - P.z);
      if (d < bd) {
        bd = d;
        best = { x: e.x, z: e.z, name };
      }
    }
    return best;
  }

  objectives(): Objective[] {
    const canard = { x: SPOTS.canard.x, z: SPOTS.canard.z, name: 'Papa Canard' };
    const tortue = { x: SPOTS.tortue.x, z: SPOTS.tortue.z, name: 'Master Tortue' };
    const out: Objective[] = [];
    switch (this.stage) {
      case 'intro':
        out.push({ text: 'Talk to Papa Canard at the Noodle Shop', target: canard });
        break;
      case 'crates': {
        const left = this.entities.filter((e) => e.id.startsWith('crate-') && e.alive).length;
        out.push({ text: `Smash the crates next to the shop (${3 - left}/3)`, target: { ...SPOTS.crates, name: 'Crates' } });
        break;
      }
      case 'canard2':
        out.push({ text: 'Talk to Papa Canard', target: canard });
        break;
      case 'tortue':
        out.push({ text: 'Find Master Tortue at the Sacred Peach Tree (west)', target: tortue });
        break;
      case 'stones': {
        out.push({ text: `Find the five Jade Stones (${this.jadeFound.size}/5)` });
        const hints: [string, string, number, number][] = [
          ['boulder', 'Big cracked rock, Bamboo Forest (press K)', SPOTS.boulder.x, SPOTS.boulder.z],
          ['jade-pond', 'Little island in the Lotus Pond', SPOTS.islet.x, SPOTS.islet.z],
          ['oldtree', 'Hit the Old Peach Tree', SPOTS.oldTree.x, SPOTS.oldTree.z],
          ['chest', 'Wolf chest, Wolf Camp', SPOTS.camp.x, SPOTS.camp.z],
          ['palace-vase', 'A vase at the Palace', SPOTS.palace.x, SPOTS.palace.z + 8],
        ];
        for (const [id, text, x, z] of hints) out.push({ text, done: this.jadeFound.has(id), target: this.jadeFound.has(id) ? undefined : { x, z, name: text } });
        break;
      }
      case 'oracle':
        out.push({ text: 'Take the stones to the Oracle (climb the Thousand Steps)', target: { ...SPOTS.oracle, name: 'The Oracle' } });
        break;
      case 'boss': {
        const tg = this.tiger ? { x: this.tiger.pos.x, z: this.tiger.pos.z, name: 'Overfit' } : undefined;
        if (this.dragon) out.push({ text: 'Beat Overfit! One Dragon Belly (K) is enough', target: tg });
        else if (this.noodleHint) out.push({ text: 'Overfit is too strong! Eat the Dragon Noodles first', target: this.noodlesReady() ? canard : undefined });
        else out.push({ text: 'Fight Overfit the tiger!', target: tg });
        break;
      }
      case 'scroll':
        out.push({ text: 'Take the Scroll to Master Tortue', target: tortue });
        break;
      case 'feast':
        out.push({ text: 'Go to the party at the Noodle Shop', target: canard });
        break;
      case 'done':
        out.push({ text: 'You are the Chonk Warrior!', done: true });
        break;
    }
    if (this.noodles === 'active') {
      const ok = this.noodlesReady();
      const required = this.stage === 'boss';
      out.push({
        text: ok ? 'Dragon Noodles: bring the food to Papa Canard' : `Dragon Noodles: peaches ${Math.min(3, this.inv.peach)}/3, shoots ${Math.min(3, this.inv.shoot)}/3, mushrooms ${Math.min(3, this.inv.mushroom)}/3`,
        done: ok, target: ok ? canard : undefined, side: 'noodles', required,
      });
      if (!ok) {
        const area: Record<Ingredient, { x: number; z: number; name: string }> = {
          peach: { x: PEACH_HILL.x, z: PEACH_HILL.z, name: 'Peach trees' },
          shoot: { x: 150, z: 20, name: 'Bamboo Forest' },
          mushroom: { x: POND.x, z: POND.z, name: 'Mossy rocks' },
        };
        const lines: [Ingredient, string][] = [
          ['peach', 'Peaches: hit a peach tree (J)'],
          ['shoot', 'Bamboo shoots: in the Bamboo Forest'],
          ['mushroom', 'Mushrooms: break mossy rocks near the pond'],
        ];
        for (const [k, text] of lines) if (this.inv[k] < 3) out.push({ text, target: this.nearestIngredient(k) ?? area[k] });
      }
    }
    const coach = { x: this.coach.x, z: this.coach.z, name: COACH };
    if (this.training === 'known') out.push({ text: `Training: meet ${COACH} at the Training Arena`, target: coach, side: 'training' });
    else if (this.training === 'active') {
      const tut = this.stepInfo();
      const target = this.trainStep === 'reward' ? coach
        : this.trainStep === 'spar' ? { x: this.partner.pos.x, z: this.partner.pos.z, name: PARTNER }
          : this.trainStep === 'sprint' ? undefined : { ...this.nearestDummy(), name: 'Dummy' };
      out.push({ text: `Training with ${COACH}`, target, side: 'training' });
      out.push({ text: `${tut.text}: ${tut.keys.join(tut.sep ? ` ${tut.sep} ` : ' ')}${tut.count ? ` (${tut.count})` : ''}` });
    }
    return out;
  }

  private nearestDummy() {
    const P = this.player.pos;
    let best = this.dummies[0];
    for (const d of this.dummies) if (Math.hypot(d.x - P.x, d.z - P.z) < Math.hypot(best.x - P.x, best.z - P.z)) best = d;
    return { x: best.x, z: best.z };
  }

  private stepInfo(): Tutorial {
    switch (this.trainStep) {
      case 'combo': return { keys: ['J', 'J', 'J'], text: 'Punch combo on a dummy', count: `${this.comboSeen.size}/3` };
      case 'belly': return { keys: ['K'], text: 'Stand still and belly jump onto a dummy' };
      case 'slam': return { keys: ['Space', 'J'], sep: 'then', text: 'Jump, then punch in the air: Ground Slam a dummy' };
      case 'sprint': return { keys: ['Shift'], text: 'Hold Shift and run: sprint!', progress: Math.min(1, this.sprintT / SPRINT_GOAL) };
      case 'spar': return { keys: ['J', 'K'], sep: 'or', text: `Spar with ${PARTNER}: hit him ${SPAR_GOAL} times`, count: `${this.sparHits}/${SPAR_GOAL}` };
      case 'reward': return { keys: ['Enter'], text: `Talk to ${COACH}` };
    }
  }

  /** the key hint shown in the HUD while Le Chonk is at the Training Arena */
  tutorial(): Tutorial | null {
    if (this.dialog || this.ended) return null;
    const P = this.player.pos;
    const near = Math.hypot(P.x - ARENA.x, P.z - ARENA.z) < ARENA.r + 8;
    if (!near) return null;
    if (this.training === 'active') return this.stepInfo();
    if (this.training !== 'done') return { keys: ['Enter'], text: `Walk to ${COACH} and press Enter to talk` };
    return null;
  }

  private refreshMarkers() {
    const canard = this.npcs[0], tortue = this.npcs[1];
    canard.setMarker(this.stage === 'intro' || this.stage === 'canard2' || this.stage === 'feast' ? '!' : this.noodlesReady() ? '?' : null);
    tortue.setMarker(this.stage === 'tortue' || this.stage === 'scroll' ? '!' : null);
    this.coach.setMarker(this.training === 'none' || this.training === 'known' ? '!' : this.training === 'active' && this.trainStep === 'reward' ? '?' : null);
  }

  private say(lines: Line[], onEnd?: () => void) {
    this.dialog = { lines, i: 0, onEnd };
    this.events.push({ type: 'sound', id: 'talk' });
  }

  talk(id: string) {
    const before = this.dialog;
    this.talkLines(id);
    if (this.dialog && this.dialog !== before) this.dialog.with = id;
  }

  private talkLines(id: string) {
    const C = 'Papa Canard', T = 'Master Tortue', O = 'The Oracle', ME = 'Le Chonk';
    if (id === 'canard') {
      if (this.stage === 'intro')
        return this.say(
          [
            { who: C, text: 'Chonk! Wolf bandits ran through the village. They knocked over my boxes!' },
            { who: C, text: 'Please smash the crates next to my shop. There are dumplings inside. Press J to punch.' },
            { who: ME, text: 'Smash boxes and eat dumplings? Yes, please!' },
          ],
          () => this.setStage('crates'),
        );
      if (this.stage === 'canard2') {
        return this.say(
          [
            { who: C, text: 'Very good! Now go and see Master Tortue. He is at the big peach tree, on the hill to the west.' },
            { who: C, text: 'One more thing. I want to cook my Dragon Noodles. They make you very, very strong!' },
            { who: C, text: 'Please bring me 3 peaches, 3 bamboo shoots and 3 mushrooms.' },
            { who: C, text: 'Hit a peach tree to get a peach. Bamboo shoots grow in the Bamboo Forest. Mushrooms hide under mossy rocks near the pond.' },
          ],
          () => {
            this.noodles = 'active';
            this.setStage('tortue');
          },
        );
      }
      if (this.noodlesReady()) {
        const boss = this.stage === 'boss';
        return this.say(
          [
            { who: C, text: 'Peaches, bamboo shoots, mushrooms... you have everything! Here are your Dragon Noodles!' },
            { who: ME, text: '*SLURP* ... Oh! My belly is hot... and STRONG!' },
            { who: C, text: 'Wow! Look at you! You are big and golden. You are DRAGON CHONK!' },
            ...(boss ? [{ who: C, text: 'Now go back to the Palace. One Dragon Belly will beat Overfit!' }] : []),
          ],
          () => {
            this.inv.peach -= 3; this.inv.shoot -= 3; this.inv.mushroom -= 3;
            this.noodles = 'done';
            this.player.maxHp = 150;
            this.player.hp = 150;
            this.becomeDragon();
            this.refreshMarkers();
          },
        );
      }
      if (this.stage === 'feast') {
        return this.say(
          [
            { who: C, text: 'Everybody is here for you, Chonk Warrior! Noodles for everyone!' },
            { who: ME, text: 'I came for peace. I stay for the dumplings!' },
          ],
          () => this.setStage('done'),
        );
      }
      if (this.noodles === 'active')
        return this.say([{ who: C, text: this.stage === 'boss' ? 'Overfit is too strong? You need my Dragon Noodles! Bring me 3 peaches, 3 bamboo shoots and 3 mushrooms.' : 'Bring me 3 peaches, 3 bamboo shoots and 3 mushrooms, please!' }]);
      return this.say([{ who: C, text: 'Go, Chonk! The Valley needs you!' }]);
    }
    if (id === 'tortue') {
      if (this.stage === 'tortue')
        return this.say(
          [
            { who: T, text: 'Ah, Le Chonk. You are late. That is OK.' },
            { who: T, text: 'The Oracle in the Palace is asleep. It is a big thinking machine. It needs five magic Jade Stones.' },
            { who: T, text: 'The wolf bandits took the stones. Find all five and bring them to the Oracle.' },
            { who: T, text: 'One stone is inside a big cracked rock in the Bamboo Forest. Only a belly can break it: press K.' },
            { who: T, text: 'One is on the little island in the Lotus Pond. One is in the Old Peach Tree, to the west. Hit the tree!' },
            { who: T, text: 'One is in the wolf chest, past the north bridge. One is in a vase at the Palace. Follow the green light.' },
            { who: T, text: 'And eat Papa Canard\'s Dragon Noodles. They give great power.' },
          ],
          () => this.setStage('stones'),
        );
      if (this.stage === 'scroll')
        return this.say(
          [
            { who: T, text: 'The Scroll of Open Weights! Open it, Chonk.' },
            { who: ME, text: 'It is... a mirror? I only see a big, beautiful cat.' },
            { who: T, text: 'Yes! There is no secret. The weights were open all the time. You are the Chonk Warrior!' },
            { who: T, text: 'Now go to Papa Canard. He is cooking for everyone.' },
          ],
          () => this.setStage('feast'),
        );
      if (this.stage === 'boss' && !this.dragon) return this.say([{ who: T, text: 'Overfit knows every move. You need more power. Eat the Dragon Noodles!' }]);
      return this.say([{ who: T, text: this.stage === 'stones' ? 'Find the five stones, Chonk. Be patient. Use your belly.' : 'Yesterday is gone. Tomorrow is a mystery. Today is a gift.' }]);
    }
    if (id === 'oracle') {
      if (this.stage === 'oracle')
        return this.say(
          [
            { who: ME, text: 'Here are five Jade Stones. Wake up, machine!' },
            { who: O, text: 'BEEP... Starting... Hello, Chonk. I am the Oracle, a very big AI.' },
            { who: O, text: 'Thank you for the stones. But I see danger. A tiger is coming! 3... 2...' },
          ],
          () => {
            this.oracle.awake = true;
            this.spawnTiger();
          },
        );
      if (this.stage === 'boss') return this.say([{ who: O, text: this.dragon ? 'Now, Dragon Chonk! Use your belly: press K!' : 'Overfit knows every move. You need more power. Eat Papa Canard\'s Dragon Noodles!' }]);
      if (this.stage === 'stones') return this.say([{ who: O, text: `z z z ... ${this.inv.jade}/5 Jade Stones ... not enough power ... z z z` }]);
      if (this.oracle.awake) return this.say([{ who: O, text: 'I have no secret for you. Only open weights.' }]);
      return this.say([{ who: O, text: 'z z z ...' }]);
    }
    if (id === 'coach') return this.talkCoach();
    if (id.startsWith('villager')) {
      const lines = [
        'Is that the Chonk? He is very round!',
        'People say one belly jump can break a big rock.',
        'The wolves live past the north bridge. Be careful!',
        'Papa Canard\'s Dragon Noodles make you very strong!',
        'I saw a green light on the pond island last night.',
        'The Palace vases are very old. Please do not break them all!',
      ];
      const v = this.npcs.find((n) => n.id === id);
      const who = v?.name ?? 'Villager';
      const said: Line[] = [{ who, text: lines[Number(id.split('-')[1]) % lines.length] }];
      if (this.training === 'none') {
        said.push({ who, text: `Do you want to learn kung fu? ${COACH} trains at the Training Arena, south of the village.` });
        return this.say(said, () => this.setTraining('known'));
      }
      return this.say(said);
    }
  }

  // ------------------------------------------------------------------ training
  private talkCoach() {
    const T = COACH, ME = 'Le Chonk';
    if (this.training === 'none' || this.training === 'known')
      return this.say(
        [
          { who: T, text: 'Hello, Le Chonk! I am Tao, a student of Master Tortue.' },
          { who: T, text: 'This is the Training Arena. Do you want to train? Great! I will show you the moves.' },
          { who: T, text: 'First, hit a wooden dummy. Press J three times: punch, punch, kick!' },
        ],
        () => {
          this.training = 'active';
          this.trainStep = 'combo';
          this.comboSeen.clear();
          this.refreshMarkers();
        },
      );
    if (this.training === 'active') {
      if (this.trainStep === 'reward')
        return this.say(
          [
            { who: T, text: 'Wow! You know all the moves now!' },
            { who: T, text: 'Here is a Chi Charm. With it, your belly jump is ready faster.' },
            { who: ME, text: 'Thank you, Tao! My belly is ready!' },
          ],
          () => {
            this.training = 'done';
            this.bellyRecharge = 1.3;
            this.events.push({ type: 'toast', text: 'You got the Chi Charm! Your belly jump is ready faster', kind: 'quest' });
            this.events.push({ type: 'sound', id: 'jade' });
            this.refreshMarkers();
          },
        );
      const tips: Record<TrainStep, string> = {
        combo: 'Stand near a dummy and press J three times: punch, punch, kick!',
        belly: 'Now the belly jump! Stand still and press K.',
        slam: 'Press Space to jump. In the air, press J. BOOM!',
        sprint: 'Hold Shift while you run. Fast like the wind!',
        spar: `${PARTNER} wants to spar. Hit him ${SPAR_GOAL} times! Do not worry, he is friendly.`,
        reward: '',
      };
      return this.say([{ who: T, text: tips[this.trainStep] }]);
    }
    return this.say([{ who: T, text: 'You can train here any time, Chonk!' }]);
  }

  private setTraining(s: 'known') {
    if (this.training !== 'none') return;
    this.training = s;
    this.events.push({ type: 'toast', text: `New quest: Training with ${COACH}`, kind: 'quest' });
    this.refreshMarkers();
  }

  private coachShout(text: string) {
    this.fx.text(text, this.coach.x, groundAt(this.coach.x, this.coach.z) + 2.5, this.coach.z, '#ffe14a', 0.9);
  }

  private advanceTraining() {
    const i = TRAIN_ORDER.indexOf(this.trainStep);
    this.trainStep = TRAIN_ORDER[Math.min(TRAIN_ORDER.length - 1, i + 1)];
    this.coachShout(['Good!', 'Great!', 'Very good!', 'Super!', 'Wow!'][i] ?? 'Good!');
    this.events.push({ type: 'sound', id: 'pickup' });
    if (this.trainStep === 'spar') {
      this.partner.mode = 'spar';
      this.sparHits = 0;
      this.fx.text(`${PARTNER}: Let's spar!`, this.partner.pos.x, this.partner.pos.y + 2.4, this.partner.pos.z, '#ffe14a', 0.8);
    }
    if (this.trainStep === 'reward') this.events.push({ type: 'toast', text: `Training done! Talk to ${COACH}`, kind: 'info' });
    this.refreshMarkers();
  }

  /** a dummy got hit: training progress */
  private trainHit(move: MoveName) {
    if (this.training !== 'active') return;
    if (this.trainStep === 'combo' && (move === 'jab' || move === 'cross' || move === 'kick')) {
      this.comboSeen.add(move);
      if (this.comboSeen.size >= 3) this.advanceTraining();
    } else if (this.trainStep === 'belly' && move === 'belly') this.advanceTraining();
    else if (this.trainStep === 'slam' && move === 'slam') this.advanceTraining();
  }

  private hitDummy(d: Dummy, move: MoveName) {
    const P = this.player;
    d.hit(move, P.pos.x, P.pos.z);
    const y = d.obj.position.y + 1.6;
    this.fx.hit(d.x, y, d.z, move, Math.round(MOVES[move].damage * P.power), true);
    this.events.push({ type: 'sound', id: `hit-${move}` });
    this.hitStop = Math.max(this.hitStop, 0.04);
    this.shake = Math.max(this.shake, move === 'belly' || move === 'slam' ? 0.2 : 0.08);
    this.trainHit(move);
  }

  // ------------------------------------------------------------------ Dragon Chonk
  private becomeDragon() {
    if (this.dragon) return;
    this.dragon = true;
    const P = this.player;
    this.aura.start();
    P.radius = 0.6 * DRAGON_SCALE;
    P.height = 1.6 * DRAGON_SCALE;
    P.power = 1.25;
    this.flash = 1;
    this.shake = Math.max(this.shake, 0.9);
    this.events.push({ type: 'sound', id: 'powerup' });
    this.fx.text('DRAGON CHONK!', P.pos.x, P.pos.y + 2.9, P.pos.z, '#ffd23a', 0.9);
    this.events.push({ type: 'toast', text: 'Dragon Noodles! You are Dragon Chonk now', kind: 'quest' });
    if (this.stage === 'boss') this.events.push({ type: 'toast', text: 'Go back to the Palace. One Dragon Belly beats Overfit!', kind: 'info' });
  }

  private setStage(s: Stage) {
    this.stage = s;
    if (s === 'crates') this.events.push({ type: 'toast', text: 'New quest: Smash the crates', kind: 'quest' });
    if (s === 'tortue') this.events.push({ type: 'toast', text: 'New quest: Find Master Tortue', kind: 'quest' });
    if (s === 'stones') this.events.push({ type: 'toast', text: 'New quest: The five Jade Stones', kind: 'quest' });
    if (s === 'scroll') this.events.push({ type: 'toast', text: 'You got the Scroll of Open Weights!', kind: 'quest' });
    if (s === 'done') {
      this.ended = true;
      this.events.push({ type: 'end' });
    }
    this.refreshMarkers();
  }

  private spawnTiger() {
    const t = new Enemy({ kind: 'tiger', x: SPOTS.palace.x, z: SPOTS.palace.z + 18, camp: 'palace' }, 999);
    t.heading = Math.PI;
    this.tiger = t;
    this.enemies.push(t);
    this.scene.add(t.object);
    this.setStage('boss');
    if (this.noodles === 'none') this.noodles = 'active';
    const O = 'Overfit';
    if (this.dragon)
      return this.say([
        { who: O, text: 'Ha! I am OVERFIT! I learned every kung fu move in the world!' },
        { who: O, text: 'Wait... why are you so big? And why are you shining?' },
        { who: 'Le Chonk', text: 'Dragon Noodles! Now try THIS BELLY!' },
      ]);
    this.say([
      { who: O, text: 'Ha! I am OVERFIT! I learned every kung fu move in the world!' },
      { who: O, text: 'Punch? I know it. Kick? I know it. Belly jump? I know it too! You cannot win, little cat!' },
      { who: 'Le Chonk', text: 'We will see!' },
    ]);
  }

  /** a few seconds into a fight he cannot win, the Oracle points Le Chonk to the noodles */
  private noodleHintNow() {
    this.noodleHint = true;
    if (this.noodles === 'none') this.noodles = 'active';
    this.say([
      { who: 'The Oracle', text: 'Chonk! Overfit knows all your moves. You need more power!' },
      { who: 'The Oracle', text: 'Papa Canard\'s Dragon Noodles give great power! Go and get them.' },
    ], () => this.events.push({ type: 'toast', text: 'Get the Dragon Noodles! They give great power', kind: 'quest' }));
    this.dialog!.with = 'oracle';
    this.refreshMarkers();
  }

  // ------------------------------------------------------------------ interaction helpers
  /** what Enter would interact with right now */
  interactable(): { id: string; name: string } | null {
    const p = this.player.pos;
    let best: { id: string; name: string; d: number } | null = null;
    for (const n of this.npcs) {
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < n.talkRadius && (!best || d < best.d)) best = { id: n.id, name: n.name, d };
    }
    const od = Math.hypot(this.oracle.x - p.x, this.oracle.z - p.z);
    if (od < 4.2 && (!best || od < best.d)) best = { id: 'oracle', name: 'The Oracle', d: od };
    return best;
  }

  private collect(p: Pickup) {
    p.alive = false;
    this.scene.remove(p.obj);
    this.highlights.get(p)?.dispose(this.scene);
    this.highlights.delete(p);
    this.stats.items++;
    this.events.push({ type: 'sound', id: p.item === 'jade' ? 'jade' : 'pickup' });
    if (p.item === 'dumpling') {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 35);
      this.events.push({ type: 'toast', text: 'Dumpling! +35 health', kind: 'item' });
      return;
    }
    this.inv[p.item]++;
    if (p.item === 'jade') {
      const src = p.id.startsWith('jade-from-') ? p.id.slice('jade-from-'.length) : p.id;
      this.jadeFound.add(src.startsWith('palace-vase') ? 'palace-vase' : src);
      this.events.push({ type: 'toast', text: `Jade Stone ${this.jadeFound.size}/5!`, kind: 'quest' });
      this.fx.text('JADE!', p.x, p.y + 2.2, p.z, '#6bffa8', 1.4);
      if (this.jadeFound.size >= 5 && this.stage === 'stones') {
        this.setStage('oracle');
        this.events.push({ type: 'toast', text: 'All five Jade Stones! Go to the Oracle', kind: 'quest' });
      }
    } else {
      this.events.push({ type: 'toast', text: `+1 ${ITEM_NAMES[p.item]}`, kind: 'item' });
      if (this.noodlesReady()) this.events.push({ type: 'toast', text: 'You have all the food! Go to Papa Canard', kind: 'info' });
    }
    this.refreshMarkers();
  }

  private drop(item: ItemKind, x: number, z: number, from: string) {
    const p = new Pickup(item === 'jade' ? `jade-from-${from}` : `${item}-${this.seq++}`, item, x, z);
    p.spawnPop();
    if (item === 'peach' || item === 'shoot' || item === 'mushroom') {
      p.cue = new ItemCue(item, 2.1, this.seq);
      p.obj.add(p.cue.group);
    }
    this.entities.push(p);
    this.scene.add(p.obj);
  }

  /** who Le Chonk is talking to (for the dialog camera and to face them) */
  dialogPartner(): { pos: THREE.Vector3; head: number } | null {
    const d = this.dialog;
    if (!d) return null;
    const npc = d.with ? this.npcs.find((n) => n.id === d.with) : undefined;
    if (npc) return { pos: npc.object.position, head: npc.height };
    if (d.with === 'oracle') return { pos: new THREE.Vector3(this.oracle.x, this.oracle.group.position.y, this.oracle.z), head: 3.6 };
    if (this.tiger) return { pos: this.tiger.pos, head: 2.4 };
    return null;
  }
  /** is the current dialog line spoken by Le Chonk? */
  chonkSpeaks() {
    const line = this.dialog?.lines[this.dialog.i];
    return !!line && line.who === 'Le Chonk';
  }

  // ------------------------------------------------------------------ step
  step(dt: number, intent: Intent, camYaw: number) {
    this.flash = Math.max(0, this.flash - dt * 1.4);
    // dialog: Enter / punch advances, the world waits
    if (this.dialog) {
      if (intent.interact || intent.punch) {
        this.dialog.i++;
        this.events.push({ type: 'sound', id: 'tick' });
        if (this.dialog.i >= this.dialog.lines.length) {
          const end = this.dialog.onEnd;
          this.dialog = null;
          end?.();
        }
      }
      const partner = this.dialogPartner();
      const face = partner ? Math.atan2(partner.pos.x - this.player.pos.x, partner.pos.z - this.player.pos.z) : null;
      // keep a comfortable talking distance: if we walked right up to their nose, take a few steps back
      // (a real walk, still facing them, so the dialog camera can frame both)
      let backX = 0, backZ = 0;
      if (partner) {
        const P = this.player.pos, dx = P.x - partner.pos.x, dz = P.z - partner.pos.z, d = Math.hypot(dx, dz) || 1;
        if (d < 1.9) {
          // world direction -> camera-relative stick input (inverse of Player.step's mapping)
          const sn = Math.sin(camYaw), cs = Math.cos(camYaw), wx = dx / d, wz = dz / d;
          backX = cs * wx - sn * wz;
          backZ = -sn * wx - cs * wz;
        }
      }
      const still = { ...intent, moveX: backX, moveZ: backZ, run: false, sprint: false, punch: false, kick: false, belly: false, jump: false, interact: false, face };
      this.player.step(dt, still, camYaw);
      const ctx = this.npcContext();
      for (const n of this.npcs) n.update(dt, ctx);
      this.aura.update(dt);
      this.updateCues(dt, true);
      return;
    }
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }
    this.t += dt;
    this.bellyCooldown = Math.max(0, this.bellyCooldown - dt);

    if (intent.interact) {
      const it = this.interactable();
      if (it) this.talk(it.id);
    }
    // belly jump has a cooldown instead of a resource
    const want = { ...intent };
    if (want.belly) {
      // (no cooldown spent on a jump that cannot start: stunned, swimming, mid-move or in the air)
      if (this.bellyCooldown > 0 || this.player.move || !this.player.grounded || !this.player.canAct() || this.player.swimming) want.belly = false;
      else this.bellyCooldown = this.bellyRecharge;
    }
    this.player.chi = 100 * (1 - this.bellyCooldown / this.bellyRecharge);
    this.player.bellyCost = 0;
    this.player.step(dt, want, camYaw);

    const P = this.player;
    // Dragon Chonk cannot be interrupted during his belly jump (it always lands)
    if (this.dragon && P.move === 'belly') P.invulnT = Math.max(P.invulnT, 0.05);
    // the belly jump lands belly-first: dust, a thump and a shake (Dragon Belly: a golden shockwave)
    if (P.move === 'belly' && P.strikeActive && this.lastBellyStrike !== P.strikeId) {
      this.lastBellyStrike = P.strikeId;
      // (puffs to both sides of the belly, not over it)
      const sx = Math.cos(P.heading), sz = -Math.sin(P.heading), lx = P.pos.x - sz * 0.5, lz = P.pos.z + sx * 0.5;
      for (const k of [-1, 1]) this.fx.dust(lx + sx * k * 1.1, P.pos.y, lz + sz * k * 1.1, 4, 0.6);
      this.shake = Math.max(this.shake, 0.3);
      this.events.push({ type: 'sound', id: 'slam' });
      if (this.dragon) {
        this.aura.dragonBelly(P.pos.x + Math.sin(P.heading) * 0.9, P.pos.z + Math.cos(P.heading) * 0.9);
        this.shake = Math.max(this.shake, 0.55);
        this.fx.text('DRAGON BELLY!', P.pos.x, P.pos.y + 2.9, P.pos.z, '#ffd23a', 1.1);
        this.events.push({ type: 'sound', id: 'zap' });
      }
    }
    if (this.aura.update(dt)) this.events.push({ type: 'sound', id: 'zap' });

    const ctx = this.npcContext();
    for (const n of this.npcs) n.update(dt, ctx);
    for (const e of this.enemies) e.step(dt, this.player);
    this.partner.step(dt, this.player);
    for (const e of this.entities) e.update(dt, this.t);
    for (const d of this.dummies) d.update(dt);
    this.oracle.draw(this.t);
    this.oracle.setGpus(this.stage === 'stones' || this.stage === 'intro' || this.stage === 'crates' || this.stage === 'canard2' || this.stage === 'tortue' ? 0 : 5);

    // --- strikes vs world objects (and the training dummies) ---
    if (P.strikeActive && P.move) {
      const def = MOVES[P.move];
      const reach = def.reach * (P.object.scale.x || 1);
      const inReach = (id: string, x: number, z: number, radius: number) => {
        if (this.struck.get(id) === P.strikeId) return false;
        const dx = x - P.pos.x, dz = z - P.pos.z, d = Math.hypot(dx, dz);
        if (d > reach + radius + 0.2) return false;
        if (def.arc < Math.PI * 2 && Math.abs(angleDelta(P.heading, Math.atan2(dx, dz))) > def.arc / 2 + 0.5) return false;
        this.struck.set(id, P.strikeId);
        return true;
      };
      for (const e of this.entities) {
        if (!e.alive || !(e instanceof Breakable || e instanceof FruitTree)) continue;
        if (inReach(e.id, e.x, e.z, e.radius)) this.hitObject(e, P.move);
      }
      for (const d of this.dummies) if (inReach(d.id, d.x, d.z, d.radius)) this.hitDummy(d, P.move);
    }

    // --- fights ---
    const foes = this.enemies.filter((e) => e.alive);
    const hits = [...resolveStrikes([P], foes), ...resolveStrikes(foes, [P])];
    // the Dragon Belly hits everything around Le Chonk, not just in front
    if (this.dragon && P.move === 'belly' && P.strikeActive) {
      for (const e of foes) {
        if (e.ko || P.hitThisStrike.has(e.id)) continue;
        const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
        if (d > 3.9 + e.radius || Math.abs(e.pos.y - P.pos.y) > 2) continue;
        P.hitThisStrike.add(e.id);
        const def = MOVES.belly, damage = Math.round(def.damage * P.power);
        if (e.takeHit(damage, def.knock * 1.45, P.pos, 0.8)) hits.push({ attacker: P, victim: e, move: 'belly', damage, ko: e.ko, x: e.pos.x, y: e.pos.y + e.height * 0.6, z: e.pos.z });
      }
    }
    // sparring with Gong at the arena
    if (this.partner.mode === 'spar') hits.push(...resolveStrikes([P], [this.partner]), ...resolveStrikes([this.partner], [P]));
    for (const h of hits) {
      if (h.victim === this.partner) {
        if (this.partner.block()) {
          this.partner.vel.multiplyScalar(0.2);
          this.partner.stunT = 0;
          this.fx.text('BLOCK!', h.x, h.y + 1.0, h.z, '#9fd8ff', 0.9);
          this.events.push({ type: 'sound', id: 'clank' });
          continue;
        }
        this.sparHits++;
        this.fx.text(this.partner.cheerLine(), h.x, h.y + 1.3, h.z, '#ffe14a', 0.9);
        if (this.sparHits >= SPAR_GOAL && this.trainStep === 'spar') {
          this.partner.mode = 'idle';
          this.fx.text('You are strong!', h.x, h.y + 2.0, h.z, '#ffe14a', 0.9);
          this.advanceTraining();
        }
      }
      if (h.victim === this.tiger && h.attacker === P && !this.dragon) {
        // before the noodles, Overfit predicts EVERY move, even the belly jump
        const refund = h.damage - 1;
        h.victim.hp = Math.min(h.victim.maxHp, h.victim.hp + refund);
        h.damage = 1;
        if (h.victim.ko && h.victim.hp > 0) h.victim.ko = false;
        h.ko = false;
        h.victim.vel.multiplyScalar(0.3);
        this.fx.text('PREDICTED!', h.x, h.y + 1.2, h.z, '#c58bff', 1.1);
        this.predicted++;
        if (this.predicted === 1 || this.predicted % 5 === 0) this.events.push({ type: 'toast', text: 'Overfit: "Predicted! You need more power, little cat!"', kind: 'info' });
      } else if (h.attacker === P && this.dragon && h.move === 'belly' && h.victim instanceof Enemy) {
        // the Dragon Belly: one belly jump beats Overfit, wolves fly away
        const v = h.victim;
        v.hp = 0;
        v.ko = true;
        v.koT = 0;
        h.ko = true;
        const dx = v.pos.x - P.pos.x, dz = v.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
        const fly = v === this.tiger ? 12 : 16;
        v.vel.set((dx / d) * fly, v === this.tiger ? 8 : 10, (dz / d) * fly);
        v.grounded = false;
        this.fx.text(v === this.tiger ? 'NOT PREDICTED!' : 'BYE!', h.x, h.y + 1.6, h.z, '#ffd23a', v === this.tiger ? 1.3 : 0.9);
      }
      this.fx.hit(h.x, h.y, h.z, h.move, h.damage, h.attacker === P);
      this.hitStop = h.move === 'belly' || h.move === 'slam' ? (this.dragon && h.attacker === P ? 0.14 : 0.09) : 0.05;
      this.shake = Math.max(this.shake, h.victim === P ? 0.35 : 0.2);
      this.events.push({ type: 'hit', ev: h });
      this.events.push({ type: 'sound', id: h.attacker === P ? `hit-${h.move}` : 'hurt' });
    }
    // knocked-out enemies poof away
    for (const e of this.enemies) {
      if (e.ko && !e.removed && e.koT > 1.6) {
        e.removed = true;
        this.scene.remove(e.object);
        this.fx.dust(e.pos.x, e.pos.y, e.pos.z, 10, 1.5);
        this.events.push({ type: 'sound', id: 'poof' });
        if (this.rand() < 0.5 && e.kind === 'wolf') this.drop('dumpling', e.pos.x, e.pos.z, e.camp);
        if (e === this.tiger) {
          this.tiger = null;
          this.say(
            [
              { who: 'Overfit', text: this.dragon ? 'No! That belly is too strong! It was not in my training data!' : 'No! I did not predict this!' },
              { who: 'The Oracle', text: 'Well done, Chonk! Here is the Scroll of Open Weights. Take it to Master Tortue.' },
            ],
            () => this.setStage('scroll'),
          );
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.removed);
    // the chest unlocks when its guards are gone
    const chest = this.entities.find((e) => e.id === 'chest') as Breakable | undefined;
    if (chest?.locked && !this.enemies.some((e) => e.camp === 'camp' && e.alive)) {
      chest.locked = false;
      this.events.push({ type: 'toast', text: 'The wolves are gone. Open the chest!', kind: 'info' });
    }

    // pickups
    for (const e of this.entities) {
      if (!(e instanceof Pickup) || !e.alive) continue;
      if (Math.hypot(e.x - P.pos.x, e.z - P.pos.z) < e.radius && Math.abs(e.y - P.pos.y) < 2.5) this.collect(e);
    }
    this.entities = this.entities.filter((e) => e.alive || e instanceof Breakable || e instanceof FruitTree);

    // discoveries
    for (const l of LANDMARKS) {
      if (this.discovered.has(l.id)) continue;
      if (Math.hypot(l.x - P.pos.x, l.z - P.pos.z) < l.r) {
        this.discovered.add(l.id);
        if (this.t > 1) this.events.push({ type: 'toast', text: l.name, kind: 'discover' });
      }
    }
    // the Training Arena side quest starts when Le Chonk comes near
    if (this.training === 'none' && Math.hypot(P.pos.x - ARENA.x, P.pos.z - ARENA.z) < ARENA.r + 16) this.setTraining('known');
    if (this.training === 'active' && this.trainStep === 'sprint') {
      if (Math.hypot(P.vel.x, P.vel.z) > 8.5 && P.grounded) this.sprintT += dt;
      if (this.sprintT >= SPRINT_GOAL) this.advanceTraining();
    }
    // an ingredient close by: say it once, so it is not missed between the bamboo
    for (const k of ['shoot', 'peach', 'mushroom'] as Ingredient[]) {
      if (this.hinted.has(k) || !this.wants(k)) continue;
      const n = this.nearestIngredient(k);
      if (n && Math.hypot(n.x - P.pos.x, n.z - P.pos.z) < 15) {
        this.hinted.add(k);
        const text = { shoot: 'A bamboo shoot is near! Look for the golden light.', peach: 'A peach tree is near! Hit it (J) to get a peach.', mushroom: 'A mossy rock is near! Break it (J). A mushroom may be inside.' }[k];
        this.events.push({ type: 'toast', text, kind: 'info' });
      }
    }
    // stage checks
    if (this.stage === 'crates' && !this.entities.some((e) => e.id.startsWith('crate-') && e.alive)) this.setStage('canard2');
    // Overfit before the noodles: after a few seconds of a fight he cannot lose, the Oracle helps
    if (this.stage === 'boss' && this.tiger && !this.dragon && !this.noodleHint) {
      if (Math.hypot(this.tiger.pos.x - P.pos.x, this.tiger.pos.z - P.pos.z) < 20) this.bossT += dt;
      if ((this.bossT > 8 || this.predicted >= 6) && !P.ko) this.noodleHintNow();
    }

    // knocked out: wake up in the village
    if (P.ko && P.koT > 2.5) {
      this.stats.deaths++;
      P.ko = false;
      P.hp = P.maxHp;
      P.pos.set(VILLAGE.x, groundAt(VILLAGE.x, VILLAGE.z + 4), VILLAGE.z + 4);
      P.vel.set(0, 0, 0);
      for (const e of this.enemies) {
        e.hp = e.maxHp;
        e.pos.set(e.home.x, groundAt(e.home.x, e.home.z), e.home.z);
        e.state = 'idle';
      }
      tokens.holders.clear();
      this.events.push({ type: 'toast', text: 'Ouch! Le Chonk wakes up in the village.', kind: 'info' });
    }

    if (this.campFire) {
      const f = 1 + Math.sin(this.t * 17) * 0.08 + Math.sin(this.t * 7.3) * 0.06;
      this.campFire.fire.scale.set(f, 1 + (f - 1) * 2, f);
      this.campFire.inner.scale.set(f, 1 + (f - 1) * 3, f);
    }
    this.updateCues(dt, false);
    this.fx.update(dt);
    this.debris.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.5);
  }

  private npcContext(): NpcContext {
    const P = this.player.pos, d = this.dialog;
    const line = d ? d.lines[Math.min(d.i, d.lines.length - 1)] : null;
    return {
      px: P.x, py: P.y, pz: P.z,
      dialog: d && line ? { with: d.with ?? null, i: d.i, who: line.who, text: line.text } : null,
      cheer: this.ended,
    };
  }

  // ------------------------------------------------------------------ interaction cues
  /** highlight what Le Chonk can use nearby (rim glow + ground ring), and the beacon over the objective */
  private updateCues(dt: number, inDialog: boolean) {
    this.fxT += dt;
    setFxTime(this.fxT);
    const t = this.fxT, P = this.player.pos;
    const focus = inDialog ? null : this.interactable()?.id;
    const RANGE = 6;
    const hl = (key: object, target: THREE.Object3D, color: number, ring: number) => {
      let h = this.highlights.get(key);
      if (!h) this.highlights.set(key, (h = new Highlight(target, this.scene, color, ring)));
      return h;
    };
    for (const e of this.entities) {
      const dist = Math.hypot(e.x - P.x, e.z - P.z);
      const d = dist - e.radius;
      let usable = e.alive;
      if (e instanceof FruitTree) usable &&= e.hitsLeft > 0;
      if (e.cue) {
        const kind = e instanceof Pickup ? e.item : e instanceof FruitTree ? e.drops : e instanceof Breakable ? e.contents : null;
        e.cue.update(dt, t, dist, !inDialog && usable && !!kind && this.wants(kind));
      }
      const level = !inDialog && usable && d < RANGE && Math.abs(e.y - P.y) < 4 ? 1 : 0;
      const known = this.highlights.get(e);
      if (!level && !known) continue;
      const color = e instanceof Pickup ? (e.item === 'jade' ? 0x6bffa8 : 0xffe08a) : e instanceof Breakable && e.locked ? 0xff6a4a : 0xffc861;
      const h = known ?? hl(e, e.obj, color, e.radius + 0.55);
      if (e instanceof Breakable) h.setColor(color); // the chest turns gold once unguarded
      h.set(level, dt, t);
    }
    // training dummies light up while their step is on
    const dummyStep = this.training === 'active' && (this.trainStep === 'combo' || this.trainStep === 'belly' || this.trainStep === 'slam');
    for (const dm of this.dummies) {
      const d = Math.hypot(dm.x - P.x, dm.z - P.z);
      const level = !inDialog && dummyStep && d < RANGE + 4 ? 1 : 0;
      if (!level && !this.highlights.has(dm)) continue;
      hl(dm, dm.obj, 0xffc861, 1.0).set(level, dt, t);
    }
    for (const n of this.npcs) {
      const d = Math.hypot(n.x - P.x, n.z - P.z);
      const level = inDialog ? 0 : n.id === focus ? 2 : d < RANGE ? 1 : 0;
      if (!level && !this.highlights.has(n)) continue;
      hl(n, n.object, 0xffe6a8, 0.95).set(level, dt, t);
    }
    {
      const d = Math.hypot(this.oracle.x - P.x, this.oracle.z - P.z);
      const level = inDialog ? 0 : focus === 'oracle' ? 2 : d < RANGE + 2 ? 1 : 0;
      if (level || this.highlights.has(this.oracle)) hl(this.oracle, this.oracle.group, 0x6bffa8, 2.8).set(level, dt, t);
    }
    // the light column over the current objective
    const tg = inDialog ? null : this.targets()[0] ?? null;
    this.beacon.update(dt, t, tg, P.x, P.z);
  }

  private hitObject(e: Breakable | FruitTree, move: string) {
    if (e instanceof FruitTree) {
      const dropped = e.hit();
      this.events.push({ type: 'sound', id: 'tree' });
      this.fx.dust(e.x, e.y + 0.2, e.z, 4, 0.6);
      if (dropped) {
        const a = Math.atan2(this.player.pos.x - e.x, this.player.pos.z - e.z);
        this.drop(e.drops, e.x + Math.sin(a) * 1.6, e.z + Math.cos(a) * 1.6, e.id);
        this.events.push({ type: 'toast', text: e.drops === 'jade' ? 'A shiny stone fell from the tree!' : 'A peach fell down!', kind: 'item' });
      } else if (e.hitsLeft > 0) this.fx.text('SHAKE!', e.x, e.y + 3.5, e.z, '#ffe14a', 0.9);
      return;
    }
    const r = e.hit(move);
    if (r === 'immune') {
      this.fx.text('TOO HARD! Press K', e.x, e.y + 2.6, e.z, '#ffffff', 0.9);
      this.events.push({ type: 'sound', id: 'clank' });
    } else if (r === 'locked') {
      this.fx.text('WOLVES GUARD IT!', e.x, e.y + 1.8, e.z, '#ff8a6a', 0.9);
      this.events.push({ type: 'sound', id: 'clank' });
    } else if (r === 'hit') {
      this.events.push({ type: 'sound', id: 'thud' });
      this.fx.dust(e.x, e.y + 0.3, e.z, 3, 0.5);
    } else if (r === 'broken') {
      this.stats.smashed++;
      this.debris.burst(e.x, e.y + e.spec.height * 0.4, e.z, e.spec.colors, e.kind === 'boulder' ? 22 : 12, e.kind === 'boulder' ? 0.5 : 0.22, this.seq++);
      this.fx.dust(e.x, e.y, e.z, 8, e.kind === 'boulder' ? 2 : 1);
      this.shake = Math.max(this.shake, e.kind === 'boulder' ? 0.5 : 0.15);
      this.events.push({ type: 'sound', id: e.kind === 'vase' ? 'shatter' : e.kind === 'boulder' || e.kind === 'rock' ? 'crumble' : 'crack' });
      if (e.contents) this.drop(e.contents, e.x, e.z, e.id);
    }
  }

  /** compass/HUD targets for the current objectives */
  targets() {
    return this.objectives().filter((o) => o.target && !o.done).map((o) => o.target!);
  }
}
