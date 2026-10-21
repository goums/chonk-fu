// The AI harness: observe (short text) -> ask the model for ONE high-level action -> run it in the
// simulation -> repeat. The world waits while the model thinks. A run is recorded turn by turn; since the
// sim and the skills are deterministic, a replay re-runs the recorded actions and gets the same game.
import type { Game, Line } from '../game/game';
import { Skills, findThing, things, toIntent, type Action, type ActionName, type Drive, type Skill } from './skills';
import { callTool, type Provider, type ToolDef } from './llm';
import { scriptedAction } from './script';
import { groundAt } from '../world/world';

export interface AgentConfig {
  provider: Provider;
  model: string;
  apiKey?: string;
  maxTurns: number;
  /** recent turns shown to the model */
  history: number;
  temperature: number;
  /** stop when the run has cost this much (USD) */
  maxCost: number;
}
export const DEFAULT_AGENT: AgentConfig = { provider: 'mistral', model: 'mistral-large-4', maxTurns: 160, history: 6, temperature: 0.3, maxCost: 1 };

export interface TurnRecord {
  turn: number;
  t: number;
  stage: string;
  obs: string;
  thought: string;
  action: Action;
  note?: string;
  result: string;
  heard: Line[];
  said: string[];
  pos: [number, number];
  hp: number;
  tokens: [number, number, number];
  cost: number;
  ms: number;
  error?: string;
}

export interface RunStats {
  completed: boolean;
  gameTime: number;
  turns: number;
  actions: Record<string, number>;
  failedActions: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUSD: number;
  wallSec: number;
  avgLatencySec: number;
  deaths: number;
  smashed: number;
  items: number;
  distance: number;
  jade: number;
  dragon: boolean;
  training: string;
  stage: string;
  /** game time (s) and turn when each quest stage started */
  milestones: { stage: string; t: number; turn: number }[];
}

export interface RunFile {
  version: 1;
  game: 'chonk-fu';
  provider: Provider;
  model: string;
  date: string;
  turns: TurnRecord[];
  track: [number, number, number][];
  stats: RunStats;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** north is -z (the Palace), east is +x (the Bamboo Forest) */
function dirName(dx: number, dz: number) {
  const a = Math.atan2(dx, -dz);
  return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const ACT_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'act',
    description: 'Choose the next action for Le Chonk.',
    parameters: {
      type: 'object',
      properties: {
        thought: { type: 'string', description: 'One short sentence: why this action.' },
        action: { type: 'string', enum: ['go', 'talk', 'hit', 'fight', 'sprint', 'wait'] },
        target: { type: 'string', description: 'An id from the lists (e.g. "canard", "crate-1", "boulder", "wolf-12", "palace") or "x,z" coordinates.' },
        move: { type: 'string', enum: ['punch', 'belly', 'slam'], description: 'For hit: the attack to use (default punch).' },
        note: { type: 'string', description: 'Optional: short memo for yourself, shown in the next turns (replaces the old memo).' },
      },
      required: ['thought', 'action'],
    },
  },
};

export function systemPrompt(g: Game) {
  const places = things(g).filter((t) => t.kind === 'place').map((t) => `${t.id} (${Math.round(t.x)},${Math.round(t.z)}) ${t.name}`).join('; ');
  return `You play CHONK FU, a 3D kung fu adventure. You are Le Chonk, a chubby orange cat. Finish the main quest.
Map: 560 m valley. North is -z (the Palace on its mountain), east is +x (Bamboo Forest). Places: ${places}.
Each turn call the tool "act" once. Actions (the game walks, aims and times the keys for you):
- go <target>: walk/run there (path finding, swims across water).
- talk <npc>: go to someone and talk. Dialogs give quests and hints.
- hit <target> [move]: go and attack an object (crate, vase, rock, boulder, chest, tree, dummy) until it breaks; picks up what falls out. move: punch (default), belly (belly jump, breaks very hard things), slam (jump + punch).
- fight [enemy]: fight enemies near you (or one id) until they are knocked out. "gong" = sparring partner at the Training Arena.
- sprint: sprint for 5 s (training). wait: let 3 s pass.
Rules: items are picked up by walking on them. Health comes back slowly; dumplings heal. If knocked out you wake up in the village. Follow the QUEST lines: they say what to do and where. Read HEARD: people answer you there. Prefer ids from the lists. Do not wait unless there is a reason. Keep thoughts short.`;
}

export class Agent {
  cfg: AgentConfig;
  skills: Skills;
  turns: TurnRecord[] = [];
  track: [number, number, number][] = [];
  note = '';
  status: 'idle' | 'thinking' | 'acting' | 'done' | 'stopped' | 'error' = 'idle';
  error = '';
  current: { thought: string; action: Action } | null = null;
  usage = { prompt: 0, completion: 0, cached: 0, cost: 0, ms: 0 };
  milestones: { stage: string; t: number; turn: number }[] = [];
  onTurn: (rec: TurnRecord) => void = () => {};
  onThink: () => void = () => {};
  /** ticks per animation frame in live play (1 = real time); headless runs ignore it */
  speed = 2;
  private stopReq = false;
  private heard: Line[] = [];
  private said: string[] = [];
  private distance = 0;
  private t0 = 0;
  private replay: RunFile | null;

  constructor(public game: Game, cfg: Partial<AgentConfig> = {}, replay: RunFile | null = null, private headless = false) {
    this.cfg = { ...DEFAULT_AGENT, ...cfg };
    this.replay = replay;
    this.skills = new Skills(game);
    // listen to the game: dialog lines, toasts and floating texts become part of the next observation
    const ev = game.events;
    const push = ev.push.bind(ev);
    ev.push = (...items) => {
      for (const e of items) if (e.type === 'toast') this.saidOnce(e.text);
      return push(...items);
    };
    const text = game.fx.text.bind(game.fx);
    game.fx.text = (s, ...rest) => {
      if (/[A-Z]{3,}/.test(s) || s.includes('!')) this.saidOnce(s);
      return text(s, ...rest);
    };
  }

  private saidOnce(s: string) {
    if (!this.said.includes(s) && this.said.length < 8) this.said.push(s);
  }

  stop() {
    this.stopReq = true;
  }

  // ------------------------------------------------------------------ observation
  observe(): string {
    const g = this.game, P = g.player;
    const px = P.pos.x, pz = P.pos.z;
    const all = things(g);
    const where = (x: number, z: number) => `${Math.round(Math.hypot(x - px, z - pz))} m ${dirName(x - px, z - pz)}`;
    const L: string[] = [];
    const inv = g.inv;
    L.push(`Time ${mmss(g.t)}. Health ${Math.ceil(P.hp)}/${P.maxHp}. Belly jump ${g.bellyCooldown > 0 ? 'recharging' : 'ready'}.${g.dragon ? ' You are DRAGON CHONK (super strong).' : ''}`);
    L.push(`Bag: jade ${inv.jade}, peach ${inv.peach}, bamboo shoot ${inv.shoot}, mushroom ${inv.mushroom}.`);
    const place = all.filter((t) => t.kind === 'place').sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz))[0];
    L.push(`You are at (${Math.round(px)}, ${Math.round(pz)})${P.swimming ? ', swimming' : ''}, ${place ? `near ${place.name}` : ''}.`);
    L.push('QUEST:');
    for (const o of g.objectives()) {
      let s = `${o.side ? '[side] ' : '- '}${o.done ? '[done] ' : ''}${o.text}`;
      if (o.target && !o.done) {
        // name the thing at the objective (not a wolf walking by)
        const tx = o.target.x, tz = o.target.z;
        const near = all
          .filter((t) => t.kind !== 'place' && t.kind !== 'enemy' && Math.hypot(t.x - tx, t.z - tz) < 5)
          .sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz))[0]
          ?? (o.target.name === 'Overfit' ? all.find((t) => t.id === 'overfit') : undefined);
        s += ` -> ${near ? `id ${near.id}` : `at ${Math.round(o.target.x)},${Math.round(o.target.z)}`} (${where(o.target.x, o.target.z)})`;
      }
      L.push(s);
    }
    const near = all
      .filter((t) => t.kind !== 'place' && Math.hypot(t.x - px, t.z - pz) < 32)
      .sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz))
      .slice(0, 10);
    if (near.length) {
      L.push('NEAR YOU:');
      for (const t of near) L.push(`- ${t.id}: ${t.name}${t.info ? ` (${t.info})` : ''}, ${where(t.x, t.z)}`);
    }
    const past = this.turns.slice(-this.cfg.history);
    if (past.length) {
      L.push('LAST ACTIONS:');
      for (const r of past) L.push(`- ${r.action.action}${r.action.target ? ' ' + r.action.target : ''}${r.action.move ? ' ' + r.action.move : ''} -> ${r.result}`);
    }
    const last = this.turns[this.turns.length - 1];
    if (last?.heard.length) L.push('HEARD: ' + last.heard.map((l) => `${l.who}: "${l.text}"`).join(' '));
    if (last?.said.length) L.push('GAME: ' + last.said.map((s) => `"${s}"`).join(' '));
    if (this.note) L.push(`YOUR MEMO: ${this.note}`);
    return L.join('\n');
  }

  // ------------------------------------------------------------------ the loop
  async run(): Promise<RunFile> {
    const g = this.game;
    this.t0 = performance.now();
    const system = systemPrompt(g);
    this.milestones.push({ stage: g.stage, t: 0, turn: 0 });
    const replayTurns = this.replay?.turns ?? null;
    while (!g.ended && !this.stopReq && this.usage.cost < this.cfg.maxCost && this.turns.length < (replayTurns ? replayTurns.length : this.cfg.maxTurns)) {
      const obs = this.observe();
      const turn = this.turns.length + 1;
      let thought = '', action: Action = { action: 'wait' }, note: string | undefined, err: string | undefined;
      const u0 = { ...this.usage };
      let ms = 0;
      if (replayTurns) {
        const r = replayTurns[this.turns.length];
        // a run recorded with older code can drift: put Le Chonk back where the recording says
        const prev = replayTurns[this.turns.length - 1];
        const P = g.player;
        if (prev && Math.hypot(prev.pos[0] - P.pos.x, prev.pos[1] - P.pos.z) > 1.5 && !P.ko) {
          P.pos.set(prev.pos[0], groundAt(prev.pos[0], prev.pos[1]), prev.pos[1]);
          P.vel.set(0, 0, 0);
        }
        thought = r.thought;
        action = r.action;
        note = r.note;
      } else if (this.cfg.model === 'script') {
        action = scriptedAction(g);
        thought = 'Scripted test player.';
      } else {
        this.status = 'thinking';
        this.onThink();
        try {
          const r = await callTool({ provider: this.cfg.provider, model: this.cfg.model, apiKey: this.cfg.apiKey, temperature: this.cfg.temperature }, system, obs, ACT_TOOL);
          ms = r.ms;
          this.usage.prompt += r.usage.prompt;
          this.usage.completion += r.usage.completion;
          this.usage.cached += r.usage.cached;
          this.usage.cost += r.usage.cost;
          this.usage.ms += r.ms;
          const a = r.args ?? {};
          thought = String(a.thought ?? r.text ?? '').slice(0, 240);
          const name = String(a.action ?? 'wait') as ActionName;
          action = { action: name };
          if (a.target !== undefined && a.target !== '') action.target = String(a.target);
          if (a.move === 'punch' || a.move === 'belly' || a.move === 'slam') action.move = a.move;
          if (typeof a.note === 'string' && a.note.trim()) note = a.note.trim().slice(0, 200);
          if (!r.args) err = 'no tool call';
        } catch (e) {
          err = String((e as Error).message ?? e);
          if (/HTTP 4\d\d/.test(err)) {
            this.status = 'error';
            this.error = err;
            break;
          }
        }
      }
      if (note) this.note = note;
      this.current = { thought, action };
      this.status = 'acting';
      this.heard = [];
      this.said = [];
      const result = await this.execute(this.skills.start(action), action.action === 'talk');
      const P = g.player;
      const rec: TurnRecord = {
        turn, t: +g.t.toFixed(2), stage: g.stage, obs, thought, action, note, result,
        heard: this.heard, said: this.said,
        pos: [+P.pos.x.toFixed(2), +P.pos.z.toFixed(2)], hp: Math.ceil(P.hp),
        tokens: [this.usage.prompt - u0.prompt, this.usage.completion - u0.completion, this.usage.cached - u0.cached],
        cost: +(this.usage.cost - u0.cost).toFixed(6), ms: Math.round(ms), error: err,
      };
      if (replayTurns) {
        const want = replayTurns[this.turns.length].pos;
        if (Math.hypot(want[0] - rec.pos[0], want[1] - rec.pos[1]) > 1.5) console.warn(`[replay] turn ${turn} diverged: ${rec.pos} vs ${want}`);
      }
      this.turns.push(rec);
      this.onTurn(rec);
    }
    this.status = g.ended ? 'done' : this.status === 'error' ? 'error' : 'stopped';
    return this.file();
  }

  /** drive one skill to its end; dialogs are read and clicked through on the way */
  private async execute(skill: Skill, talking: boolean): Promise<string> {
    const g = this.game, P = g.player;
    const hp0 = P.hp, deaths0 = g.stats.deaths;
    let lineShown = -1, lineT = 0, sawDialog = false, ticks = 0;
    let curDialog: unknown = null;
    let result: string | null = null;
    const fight = this.current?.action.action === 'fight';
    const step = (d: Drive) => {
      const x = P.pos.x, z = P.pos.z;
      g.step(1 / 60, toIntent(d), 0);
      this.distance += Math.hypot(P.pos.x - x, P.pos.z - z);
      ticks++;
      if (ticks % 30 === 0) this.track.push([+g.t.toFixed(1), +P.pos.x.toFixed(1), +P.pos.z.toFixed(1)]);
      const m = this.milestones[this.milestones.length - 1];
      if (m.stage !== g.stage) this.milestones.push({ stage: g.stage, t: +g.t.toFixed(1), turn: this.turns.length + 1 });
    };
    for (;;) {
      // pace: live play advances `speed` ticks per animation frame, headless runs yield now and then
      const budget = this.headless ? 900 : Math.max(1, Math.round(this.speed));
      for (let b = 0; b < budget; b++) {
        if (g.dialog) {
          sawDialog = true;
          const d = g.dialog;
          if (d !== curDialog) {
            curDialog = d;
            this.skills.dialogs++;
            lineShown = -1;
          }
          if (d.i !== lineShown) {
            lineShown = d.i;
            lineT = 0;
            const line = d.lines[d.i];
            if (line && this.heard.length < 12) this.heard.push({ who: line.who, text: line.text });
          }
          lineT++;
          // read time: the same beat per line live and headless (NPCs keep moving: replays must match)
          step({ interact: lineT > 45 });
          continue;
        }
        if (sawDialog && !talking) {
          result = 'Stopped: a dialog happened.';
          break;
        }
        if (g.ended) {
          result = 'The game is finished!';
          break;
        }
        if (g.stats.deaths > deaths0) {
          result = 'You were knocked out! You woke up in the village.';
          break;
        }
        if (!fight && P.hp < hp0 - 20 && g.enemies.some((e) => e.alive && !e.ko && Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) < 8)) {
          result = `Stopped: enemies attack you! Health ${Math.ceil(P.hp)}/${P.maxHp}.`;
          break;
        }
        const n = skill.next();
        if (n.done) {
          result = n.value;
          // an action that did nothing still lets half a second pass (the world goes on)
          for (let i = ticks; i < 30 && !g.dialog; i++) step({});
          break;
        }
        step(n.value);
        if (ticks > 60 * 240) {
          result = 'Stopped: the action took too long.';
          break;
        }
      }
      if (result !== null) break;
      await new Promise<void>((res) => (this.headless ? setTimeout(res, 0) : requestAnimationFrame(() => res())));
      if (this.stopReq) return 'Stopped by the user.';
    }
    if (sawDialog && result && !result.startsWith('Talked')) result = result.startsWith('Stopped: a dialog') ? result : `${result} (a dialog happened)`;
    return result;
  }

  stats(): RunStats {
    const g = this.game;
    const actions: Record<string, number> = {};
    for (const t of this.turns) actions[t.action.action] = (actions[t.action.action] ?? 0) + 1;
    const failed = this.turns.filter((t) => /^(Unknown|No path|Could not|Stuck|".*" is not)/.test(t.result) || t.error).length;
    const lat = this.turns.filter((t) => t.ms > 0);
    return {
      completed: g.ended,
      gameTime: +g.t.toFixed(1),
      turns: this.turns.length,
      actions,
      failedActions: failed,
      tokensIn: this.usage.prompt,
      tokensOut: this.usage.completion,
      tokensCached: this.usage.cached,
      costUSD: +this.usage.cost.toFixed(4),
      wallSec: +((performance.now() - this.t0) / 1000).toFixed(1),
      avgLatencySec: lat.length ? +(lat.reduce((a, t) => a + t.ms, 0) / lat.length / 1000).toFixed(2) : 0,
      deaths: g.stats.deaths,
      smashed: g.stats.smashed,
      items: g.stats.items,
      distance: Math.round(this.distance),
      jade: g.jadeFound.size,
      dragon: g.dragon,
      training: g.training,
      stage: g.stage,
      milestones: this.milestones,
    };
  }

  file(): RunFile {
    return {
      version: 1, game: 'chonk-fu', provider: this.cfg.provider, model: this.cfg.model, date: new Date().toISOString(),
      turns: this.turns, track: this.track, stats: this.stats(),
    };
  }
}

export { findThing };
