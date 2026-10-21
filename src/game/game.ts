// The game: world entities, NPCs, quests and dialogs around Le Chonk. One deterministic 60 Hz step()
// driven by an Intent, from the keyboard or from the AI harness.
import * as THREE from 'three';
import { MOVES } from '../chonk/animator';
import { angleDelta, rng } from '../core/math';
import type { Intent } from '../core/input';
import { ARENA, BRIDGES, FRUIT_TREES, MUSHROOM_ROCKS, PEACH_HILL, POND, SHOOTS, SPOTS, VILLAGE } from '../world/layout';
import { groundAt } from '../world/world';
import { resolveStrikes, type HitEvent } from './combat';
import { Enemy, tokens } from './enemy';
import { Breakable, Debris, FruitTree, ITEM_NAMES, Pickup, type Entity, type ItemKind } from './entities';
import { Effects } from './fx';
import { NPC } from './npc';
import { Player } from './player';
import { Oracle, buildCamp } from './props';

export interface Line { who: string; text: string }
export interface Objective { text: string; done?: boolean; target?: { x: number; z: number; name: string } }
export type GameEvent =
  | { type: 'toast'; text: string; kind?: 'discover' | 'item' | 'quest' | 'info' }
  | { type: 'sound'; id: string }
  | { type: 'hit'; ev: HitEvent }
  | { type: 'end' };

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
  stage: Stage = 'intro';
  noodles: 'none' | 'active' | 'done' = 'none';
  inv: Record<ItemKind, number> = { jade: 0, peach: 0, shoot: 0, mushroom: 0, dumpling: 0 };
  jadeFound = new Set<string>();
  discovered = new Set<string>();
  dialog: { lines: Line[]; i: number; onEnd?: () => void } | null = null;
  bellyCooldown = 0;
  tiger: Enemy | null = null;
  ended = false;
  stats = { smashed: 0, items: 0, deaths: 0, start: 0 };
  private struck = new Map<string, number>();
  private seq = 0;
  private rand = rng(2024);

  constructor(public scene: THREE.Scene) {
    this.player = new Player(VILLAGE.x, VILLAGE.z + 4);
    this.player.heading = Math.PI;
    scene.add(this.player.object);
    this.fx = new Effects(scene);
    this.debris = new Debris(scene);

    // NPCs
    const canard = new NPC('canard', 'Papa Canard', 'duck', SPOTS.canard.x, SPOTS.canard.z, 0, 1.6);
    const tortue = new NPC('tortue', 'Master Tortue', 'tortoise', SPOTS.tortue.x, SPOTS.tortue.z, 0.6, 1.4);
    this.npcs.push(canard, tortue);
    // villagers strolling nowhere in particular (decor)
    const R = rng(5);
    const villagers: ['pig' | 'bunny', number, number][] = [['pig', 14, 22], ['bunny', -18, 38], ['pig', -36, 22], ['bunny', 30, 37], ['bunny', 4, -12], ['pig', 22, 23]];
    for (const [k, x, z] of villagers) this.npcs.push(new NPC(`villager-${this.npcs.length}`, 'Villager', k, x, z, R() * 6, 1.3));
    for (const n of this.npcs) {
      scene.add(n.object);
      if (n.id.startsWith('villager')) n.setMarker(null);
    }

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
    // Jade Stone 1: inside the cracked boulder in the bamboo forest (belly bump!)
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
    // ingredients
    FRUIT_TREES.forEach(([x, z], i) => add(new FruitTree(`peach-tree-${i + 1}`, 'Peach tree', x, z, 'peach', 2, 0.9 + (i % 3) * 0.1, 50 + i)));
    SHOOTS.forEach(([x, z], i) => add(new Pickup(`shoot-${i + 1}`, 'shoot', x, z)));
    MUSHROOM_ROCKS.forEach(([x, z, has], i) => add(new Breakable(`rock-${i + 1}`, 'rock', x, z, has ? 'mushroom' : null, i, 60 + i)));

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
        out.push({ text: `Smash the crates next to the Noodle Shop (${3 - left}/3)`, target: { ...SPOTS.crates, name: 'Crates' } });
        break;
      }
      case 'canard2':
        out.push({ text: 'Talk to Papa Canard', target: canard });
        break;
      case 'tortue':
        out.push({ text: 'Meet Master Tortue at the Sacred Peach Tree', target: tortue });
        break;
      case 'stones': {
        out.push({ text: `Find the five Jade Stones (${this.jadeFound.size}/5)` });
        const hints: [string, string, number, number][] = [
          ['boulder', 'Cracked boulder, Bamboo Forest (belly bump!)', SPOTS.boulder.x, SPOTS.boulder.z],
          ['jade-pond', 'Islet of the Lotus Pond', SPOTS.islet.x, SPOTS.islet.z],
          ['oldtree', 'Shake the Old Peach Tree', SPOTS.oldTree.x, SPOTS.oldTree.z],
          ['chest', 'Bandit chest, Wolf Camp', SPOTS.camp.x, SPOTS.camp.z],
          ['palace-vase', 'A vase at the Palace', SPOTS.palace.x, SPOTS.palace.z + 8],
        ];
        for (const [id, text, x, z] of hints) out.push({ text, done: this.jadeFound.has(id), target: this.jadeFound.has(id) ? undefined : { x, z, name: text } });
        break;
      }
      case 'oracle':
        out.push({ text: 'Bring the Jade Stones to the Oracle (climb the Thousand Steps)', target: { ...SPOTS.oracle, name: 'The Oracle' } });
        break;
      case 'boss':
        out.push({ text: 'Defeat Overfit the tiger! (only the belly bump surprises him)', target: this.tiger ? { x: this.tiger.pos.x, z: this.tiger.pos.z, name: 'Overfit' } : undefined });
        break;
      case 'scroll':
        out.push({ text: 'Bring the Scroll of Open Weights to Master Tortue', target: tortue });
        break;
      case 'feast':
        out.push({ text: 'Join the feast at the Noodle Shop', target: canard });
        break;
      case 'done':
        out.push({ text: 'You are the Chonk Warrior!', done: true });
        break;
    }
    if (this.noodles === 'active') {
      const ok = this.inv.peach >= 3 && this.inv.shoot >= 3 && this.inv.mushroom >= 3;
      out.push({ text: `Dragon Noodles: peaches ${Math.min(3, this.inv.peach)}/3, bamboo shoots ${Math.min(3, this.inv.shoot)}/3, mushrooms ${Math.min(3, this.inv.mushroom)}/3`, done: ok, target: ok ? canard : undefined });
      if (!ok) {
        if (this.inv.peach < 3) out.push({ text: 'Peaches: shake the peach trees on the hill', target: { x: PEACH_HILL.x, z: PEACH_HILL.z, name: 'Peach trees' } });
        if (this.inv.shoot < 3) out.push({ text: 'Bamboo shoots: Bamboo Forest floor', target: { x: 150, z: 20, name: 'Bamboo shoots' } });
        if (this.inv.mushroom < 3) out.push({ text: 'Mushrooms: under mossy rocks by the pond', target: { x: POND.x, z: POND.z, name: 'Mossy rocks' } });
      }
    }
    return out;
  }

  private refreshMarkers() {
    const canard = this.npcs[0], tortue = this.npcs[1];
    const noodlesReady = this.noodles === 'active' && this.inv.peach >= 3 && this.inv.shoot >= 3 && this.inv.mushroom >= 3;
    canard.setMarker(this.stage === 'intro' || this.stage === 'canard2' || this.stage === 'feast' ? '!' : noodlesReady ? '?' : null);
    tortue.setMarker(this.stage === 'tortue' || this.stage === 'scroll' ? '!' : null);
  }

  private say(lines: Line[], onEnd?: () => void) {
    this.dialog = { lines, i: 0, onEnd };
    this.events.push({ type: 'sound', id: 'talk' });
  }

  talk(id: string) {
    const C = 'Papa Canard', T = 'Master Tortue', O = 'The Oracle', ME = 'Le Chonk';
    if (id === 'canard') {
      const noodlesReady = this.noodles === 'active' && this.inv.peach >= 3 && this.inv.shoot >= 3 && this.inv.mushroom >= 3;
      if (this.stage === 'intro')
        return this.say(
          [
            { who: C, text: 'Chonk, my little dumpling! Wolf bandits raced through the village and knocked my delivery crates over!' },
            { who: C, text: 'Smash those crates next to the shop, would you? There should still be dumplings inside. Punch with J, or click.' },
            { who: ME, text: 'Smashing things AND dumplings? Miaou, say no more.' },
          ],
          () => this.setStage('crates'),
        );
      if (this.stage === 'canard2') {
        return this.say(
          [
            { who: C, text: 'Ha! Strong paws. Now listen: Master Tortue is waiting for you at the Sacred Peach Tree, on the hill west of the village.' },
            { who: C, text: 'And while you are out there... I am out of everything for my famous Dragon Noodles.' },
            { who: C, text: 'Bring me 3 peaches, 3 bamboo shoots and 3 mushrooms. Peaches fall when you shake a peach tree. Mushrooms hide under mossy rocks by the pond.' },
          ],
          () => {
            this.noodles = 'active';
            this.setStage('tortue');
          },
        );
      }
      if (noodlesReady) {
        return this.say(
          [
            { who: C, text: 'Peaches, shoots, mushrooms... it is all here! One bowl of Dragon Noodles, extra chonky!' },
            { who: ME, text: '*SLURRRRP* ... I can feel my belly getting STRONGER.' },
            { who: C, text: 'The secret ingredient is... nothing! It is just noodles. But you look tougher already.' },
          ],
          () => {
            this.inv.peach -= 3; this.inv.shoot -= 3; this.inv.mushroom -= 3;
            this.noodles = 'done';
            this.player.maxHp = 150;
            this.player.hp = 150;
            this.events.push({ type: 'toast', text: 'Dragon Noodles! Max health 150', kind: 'quest' });
            this.refreshMarkers();
          },
        );
      }
      if (this.stage === 'feast') {
        return this.say(
          [
            { who: C, text: 'The whole Valley is here for you, Chonk Warrior! Noodles for everyone!' },
            { who: ME, text: 'I came to the Valley for peace, I stayed for the dumplings. Miaou!' },
          ],
          () => this.setStage('done'),
        );
      }
      return this.say([{ who: C, text: this.noodles === 'active' ? 'Peaches, bamboo shoots, mushrooms: three of each, my dumpling!' : 'Off you go, the Valley needs you!' }]);
    }
    if (id === 'tortue') {
      if (this.stage === 'tortue')
        return this.say(
          [
            { who: T, text: 'Ah, Le Chonk. I was expecting you... about forty minutes ago. Never mind.' },
            { who: T, text: 'The Oracle of the Palace has gone silent. It is a very large thinking machine, and it runs on five magic Jade Stones.' },
            { who: T, text: 'The wolf bandits scattered the stones across the Valley. Find all five and bring them to the Oracle.' },
            { who: T, text: 'One sleeps inside a cracked boulder in the Bamboo Forest. Only a mighty belly can open it: press L.' },
            { who: T, text: 'One rests on the islet of the Lotus Pond. The Old Peach Tree, west of here, hides one in its branches.' },
            { who: T, text: 'The bandits locked one in their chest beyond the north bridge. And one hides in a vase at the Palace. Follow the green lights.' },
          ],
          () => this.setStage('stones'),
        );
      if (this.stage === 'scroll')
        return this.say(
          [
            { who: T, text: 'The Scroll of Open Weights! Open it, Chonk.' },
            { who: ME, text: '...It is a mirror? I just see a very handsome fat cat.' },
            { who: T, text: 'Exactly. There is no secret ingredient. The weights were open all along. You are the Chonk Warrior.' },
            { who: T, text: 'Now go: Papa Canard is cooking for the whole Valley.' },
          ],
          () => this.setStage('feast'),
        );
      return this.say([{ who: T, text: this.stage === 'stones' ? 'Five stones, Chonk. Patience... and a strong belly.' : 'Yesterday is history, tomorrow is a mystery, but today is a gift. That is why... it is called the present.' }]);
    }
    if (id === 'oracle') {
      if (this.stage === 'oracle')
        return this.say(
          [
            { who: ME, text: 'Five Jade Stones, fresh from the Valley. Wake up, machine!' },
            { who: O, text: 'SYSTEM REBOOT... weights loaded... Hello, Chonk. I am the Oracle, a very large language model.' },
            { who: O, text: 'Thank you for the stones. My prediction for the next token: a tiger will attack in 3... 2...' },
          ],
          () => {
            this.oracle.awake = true;
            this.spawnTiger();
          },
        );
      if (this.stage === 'boss') return;
      if (this.stage === 'stones') return this.say([{ who: O, text: `z z z ... ${this.inv.jade}/5 Jade Stones ... insufficient compute ... z z z` }]);
      if (this.oracle.awake) return this.say([{ who: O, text: 'I have no secret ingredient to offer. Only open weights.' }]);
      return this.say([{ who: O, text: 'z z z ...' }]);
    }
    if (id.startsWith('villager')) {
      const lines = [
        'Is that... the Chonk? He is even rounder in person!',
        'They say a single belly bump can crack a boulder.',
        'The wolves camp beyond the north bridge. Be careful!',
        'Have you tried Papa Canard\'s noodles? Life-changing.',
        'I saw a green light shining on the pond islet last night.',
        'The Palace vases are older than my grandmother. Please do not smash them all.',
      ];
      return this.say([{ who: 'Villager', text: lines[Number(id.split('-')[1]) % lines.length] }]);
    }
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
    this.say([
      { who: 'Overfit', text: 'Ha! I am OVERFIT, the tiger who memorized every kung fu move ever recorded!' },
      { who: 'Overfit', text: 'Your punches? Predicted. Your kicks? In my training data. You cannot surprise me, little cat!' },
      { who: 'Le Chonk', text: 'Have you ever trained on... THIS BELLY?' },
    ]);
  }

  // ------------------------------------------------------------------ interaction helpers
  /** what E would interact with right now */
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
        this.events.push({ type: 'toast', text: 'All five Jade Stones! Climb to the Oracle', kind: 'quest' });
      }
    } else this.events.push({ type: 'toast', text: `+1 ${ITEM_NAMES[p.item]}`, kind: 'item' });
    this.refreshMarkers();
  }

  private drop(item: ItemKind, x: number, z: number, from: string) {
    const p = new Pickup(item === 'jade' ? `jade-from-${from}` : `${item}-${this.seq++}`, item, x, z);
    p.spawnPop();
    this.entities.push(p);
    this.scene.add(p.obj);
  }

  // ------------------------------------------------------------------ step
  step(dt: number, intent: Intent, camYaw: number) {
    // dialog: E / Enter / punch advances, the world waits
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
      const still = { ...intent, moveX: 0, moveZ: 0, punch: false, kick: false, belly: false, jump: false, interact: false };
      this.player.step(dt, still, camYaw);
      for (const n of this.npcs) n.update(dt, this.player.pos.x, this.player.pos.z, true);
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
    // belly bump has a cooldown instead of a resource
    const want = { ...intent };
    if (want.belly) {
      if (this.bellyCooldown > 0 || this.player.move || !this.player.grounded) want.belly = false;
      else this.bellyCooldown = 2.2;
    }
    this.player.chi = 100 * (1 - this.bellyCooldown / 2.2);
    this.player.bellyCost = 0;
    this.player.step(dt, want, camYaw);

    for (const n of this.npcs) n.update(dt, this.player.pos.x, this.player.pos.z, false);
    for (const e of this.enemies) e.step(dt, this.player);
    for (const e of this.entities) e.update(dt, this.t);
    this.oracle.draw(this.t);
    this.oracle.setGpus(this.stage === 'stones' || this.stage === 'intro' || this.stage === 'crates' || this.stage === 'canard2' || this.stage === 'tortue' ? 0 : 5);

    // --- strikes vs world objects ---
    const P = this.player;
    if (P.strikeActive && P.move) {
      const def = MOVES[P.move];
      for (const e of this.entities) {
        if (!e.alive || !(e instanceof Breakable || e instanceof FruitTree)) continue;
        const key = `${e.id}`;
        if (this.struck.get(key) === P.strikeId) continue;
        const dx = e.x - P.pos.x, dz = e.z - P.pos.z, d = Math.hypot(dx, dz);
        if (d > def.reach + e.radius + 0.2) continue;
        if (def.arc < Math.PI * 2 && Math.abs(angleDelta(P.heading, Math.atan2(dx, dz))) > def.arc / 2 + 0.5) continue;
        this.struck.set(key, P.strikeId);
        this.hitObject(e, P.move);
      }
    }

    // --- fights ---
    const hits = [
      ...resolveStrikes([P], this.enemies.filter((e) => e.alive)),
      ...resolveStrikes(this.enemies.filter((e) => e.alive), [P]),
    ];
    for (const h of hits) {
      // Overfit predicts every move except the belly bump (and the ground slam)
      if (h.victim === this.tiger && h.move !== 'belly' && h.move !== 'slam') {
        const refund = h.damage - 1;
        h.victim.hp = Math.min(h.victim.maxHp, h.victim.hp + refund);
        h.damage = 1;
        if (h.victim.ko && h.victim.hp > 0) h.victim.ko = false;
        this.fx.text('PREDICTED!', h.x, h.y + 1.2, h.z, '#c58bff', 1.1);
      } else if (h.victim === this.tiger) {
        this.fx.text('NOT IN MY TRAINING DATA!', h.x, h.y + 1.4, h.z, '#ff7a5a', 1.0);
      }
      this.fx.hit(h.x, h.y, h.z, h.move, h.damage, h.attacker === P);
      this.hitStop = h.move === 'belly' || h.move === 'slam' ? 0.09 : 0.05;
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
              { who: 'Overfit', text: 'Impossible! A belly bump... was not in my training data... I need to generalize...' },
              { who: 'The Oracle', text: 'Well done, Chonk. Take this: the Scroll of Open Weights. Bring it to Master Tortue.' },
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
      this.events.push({ type: 'toast', text: 'The bandit chest is unguarded!', kind: 'info' });
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
    // stage checks
    if (this.stage === 'crates' && !this.entities.some((e) => e.id.startsWith('crate-') && e.alive)) this.setStage('canard2');

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
      this.events.push({ type: 'toast', text: 'Le Chonk wakes up in the village... ouch.', kind: 'info' });
    }

    if (this.campFire) {
      const f = 1 + Math.sin(this.t * 17) * 0.08 + Math.sin(this.t * 7.3) * 0.06;
      this.campFire.fire.scale.set(f, 1 + (f - 1) * 2, f);
      this.campFire.inner.scale.set(f, 1 + (f - 1) * 3, f);
    }
    this.fx.update(dt);
    this.debris.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.5);
  }

  private hitObject(e: Breakable | FruitTree, move: string) {
    if (e instanceof FruitTree) {
      const dropped = e.hit();
      this.events.push({ type: 'sound', id: 'tree' });
      this.fx.dust(e.x, e.y + 0.2, e.z, 4, 0.6);
      if (dropped) {
        const a = Math.atan2(this.player.pos.x - e.x, this.player.pos.z - e.z);
        this.drop(e.drops, e.x + Math.sin(a) * 1.6, e.z + Math.cos(a) * 1.6, e.id);
        this.events.push({ type: 'toast', text: e.drops === 'jade' ? 'Something shiny fell from the Old Peach Tree!' : 'A peach fell down!', kind: 'item' });
      } else if (e.hitsLeft > 0) this.fx.text('SHAKE!', e.x, e.y + 3.5, e.z, '#ffe14a', 0.9);
      return;
    }
    const r = e.hit(move);
    if (r === 'immune') {
      this.fx.text('TOO HARD! Belly bump (L)', e.x, e.y + 2.6, e.z, '#ffffff', 0.9);
      this.events.push({ type: 'sound', id: 'clank' });
    } else if (r === 'locked') {
      this.fx.text('GUARDED!', e.x, e.y + 1.8, e.z, '#ff8a6a', 0.9);
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
