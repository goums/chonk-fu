// CHONK FU audio: generative score, valley ambience and sound effects, all synthesized in code.
// main.ts constructs one GameAudio and calls update() every frame, before the HUD consumes and clears
// game.events. The AudioContext is created on the first key / pointer press (autoplay policy).
// M toggles mute (remembered in localStorage).
import { clamp } from '../core/math';
import type { Game } from '../game/game';
import { GROUND, PALACE_MOUNT, STAIRS, WATER_LEVEL } from '../world/layout';
import { bridgeDeckAt } from '../world/buildings';
import { Ambience } from './ambience';
import { Music, type Mood } from './music';
import { Sfx, type Surface } from './sfx';
import { Synth } from './voices';

const STORE = 'chonkfu.muted';

export type { Mood };

export class GameAudio {
  ctx: AudioContext | null = null;
  muted = false;
  /** bus levels; change with setVolume() */
  readonly volumes = { master: 0.9, music: 0.45, sfx: 0.85, ambience: 0.6 };
  private bus: Record<'master' | 'music' | 'sfx' | 'ambience', GainNode> | null = null;
  private music: Music | null = null;
  private sfx: Sfx | null = null;
  private amb: Ambience | null = null;
  private toast: string | null = null;
  // state the game doesn't announce, watched frame to frame
  private wasGrounded = true;
  private airT = 0;
  private minVy = 0;
  private lastVy = 0;
  private stepAcc = 0;
  private moves = new Map<number, { move: string | null; t: number }>();
  private enemyState = new Map<number, string>();
  private growlCd = 0;
  private hadTiger = false;
  private combatHold = 0;
  private moodCand: Mood = 'village';
  private moodT = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem(STORE) === '1';
    } catch {
      /* storage blocked: default to sound on */
    }
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'KeyM' && !e.repeat) this.toggleMute();
      this.resume();
    });
    addEventListener('pointerdown', () => this.resume());
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (!this.muted) void this.ctx.resume();
    });
  }

  /** start (first call, must be inside a user gesture) or resume the audio */
  resume() {
    if (this.muted) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.start();
    } catch (err) {
      console.warn('audio unavailable', err);
      this.ctx = null;
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    this.toast = this.muted ? 'Sound off (M)' : 'Sound on (M)';
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem(STORE, m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (!this.ctx || !this.bus) {
      if (!m) this.resume();
      return;
    }
    const g = this.bus.master.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(m ? 0 : this.volumes.master, now, 0.03);
    if (m) {
      const ctx = this.ctx;
      setTimeout(() => this.muted && void ctx.suspend(), 150);
    } else void this.ctx.resume();
  }

  setVolume(kind: keyof GameAudio['volumes'], v: number) {
    this.volumes[kind] = clamp(v, 0, 1);
    if (!this.bus || !this.ctx) return;
    if (kind === 'master' && this.muted) return;
    this.bus[kind].gain.setTargetAtTime(this.volumes[kind], this.ctx.currentTime, 0.05);
  }

  private start() {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    void ctx.resume();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    const gain = (v: number, to: AudioNode) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(to);
      return g;
    };
    const master = gain(this.volumes.master, comp);
    this.bus = {
      master,
      music: gain(this.volumes.music, master),
      sfx: gain(this.volumes.sfx, master),
      ambience: gain(this.volumes.ambience, master),
    };
    const synth = new Synth(ctx);
    // buffers render over a few tasks; the score, ambience and effects come alive when they are ready
    void synth.build().then(() => {
      const reverb = ctx.createConvolver();
      reverb.buffer = synth.impulse;
      reverb.connect(gain(0.8, master));
      const bus = this.bus!;
      synth.warm(48, 62, 'shami'); // the village strings
      this.music = new Music(synth, bus.music, reverb);
      this.amb = new Ambience(synth, bus.ambience, reverb);
      this.sfx = new Sfx(synth, bus.sfx, reverb);
      this.music.discover(); // the valley greets you
      // pre-render the other strings a few at a time instead of mid-phrase
      const chunks: [number, number, 'shami' | 'koto'][] = [[63, 70, 'shami'], [71, 78, 'shami'], [79, 92, 'shami'], [40, 47, 'shami']];
      for (let m = 50; m < 92; m += 7) chunks.push([m, m + 6, 'koto']);
      const warmNext = () => {
        const c = chunks.shift();
        if (!c) return;
        synth.warm(c[0], c[1], c[2]);
        setTimeout(warmNext, 50);
      };
      setTimeout(warmNext, 50);
    });
  }

  /** call once per frame, before game.events is cleared */
  update(game: Game, dt: number, camYaw = Math.PI) {
    if (this.toast) {
      game.events.push({ type: 'toast', text: this.toast, kind: 'info' });
      this.toast = null;
    }
    this.lastYaw = camYaw;
    const live = !!this.ctx && this.ctx.state === 'running' && !!this.sfx;
    this.watch(game, dt, live);
    if (!live) return;
    const music = this.music!, sfx = this.sfx!;

    // ---- game events
    let chimed = false, discover = false, quest = false, item = false, ended = false;
    for (const ev of game.events) {
      if (ev.type === 'sound') {
        sfx.play(ev.id);
        if (ev.id === 'pickup' || ev.id === 'jade') chimed = true;
      } else if (ev.type === 'toast') {
        if (ev.kind === 'discover') discover = true;
        else if (ev.kind === 'quest') quest = true;
        else if (ev.kind === 'item') item = true;
      } else if (ev.type === 'end') ended = true;
    }
    if (ended) music.victory();
    else if (discover) music.discover();
    else if (quest) music.fanfare();
    if (item && !chimed) sfx.play('pickup');

    // ---- mood
    const P = game.player;
    const fighting = !!game.tiger || game.enemies.some((e) => !e.removed && !e.ko && (e.state === 'chase' || e.state === 'fight'));
    this.combatHold = fighting ? 4 : Math.max(0, this.combatHold - dt);
    const nearPalace = Math.hypot(P.pos.x - PALACE_MOUNT.x, P.pos.z - PALACE_MOUNT.z) < PALACE_MOUNT.plateau + 24 && P.pos.y > GROUND + 22;
    const want: Mood = game.ended ? 'ending' : this.combatHold > 0 ? 'combat' : nearPalace ? 'palace' : 'village';
    if (want !== this.moodCand) {
      this.moodCand = want;
      this.moodT = 0;
    } else this.moodT += dt;
    if (this.moodT >= (want === 'combat' || want === 'ending' ? 0.15 : 1.5)) music.set(want);
    music.update();
    this.amb!.update({ x: P.pos.x, y: P.pos.y, z: P.pos.z, yaw: camYaw });
  }

  private surface(x: number, y: number, z: number): Surface {
    if (y < WATER_LEVEL - 0.05) return 'water';
    if (bridgeDeckAt(x, z) > -Infinity) return 'wood';
    if (Math.abs(x - STAIRS.x) < STAIRS.halfWidth + 0.5 && z < STAIRS.z0 + 2 && z > STAIRS.z1 - 2) return 'stone';
    if (Math.hypot(x - PALACE_MOUNT.x, z - PALACE_MOUNT.z) < PALACE_MOUNT.plateau && y > GROUND + 30) return 'stone';
    return 'grass';
  }

  /** sounds derived from state: footsteps, jump / dive / land, move whooshes, growls */
  private watch(game: Game, dt: number, live: boolean) {
    const P = game.player, sfx = live ? this.sfx : null;
    const speed = Math.hypot(P.vel.x, P.vel.z);
    const surf = () => this.surface(P.pos.x, P.pos.y, P.pos.z);
    if (P.grounded) {
      if (!this.wasGrounded && this.airT > 0.2) sfx?.land(clamp(-this.minVy / 16, 0.15, 1), surf());
      this.airT = 0;
      this.minVy = 0;
    } else {
      if (this.wasGrounded && P.vel.y > 4 && P.hurtT > 0.3) sfx?.jump();
      if (!this.wasGrounded && this.lastVy - P.vel.y > 6) sfx?.dive(); // the belly slam dive
      this.airT += dt;
      this.minVy = Math.min(this.minVy, P.vel.y);
    }
    this.wasGrounded = P.grounded;
    this.lastVy = P.vel.y;

    // footsteps, cadence from the speed (stride grows when running)
    if (P.grounded && speed > 0.5 && !game.dialog && !P.ko && !P.move) {
      this.stepAcc += speed * dt;
      const stride = 0.55 + speed * 0.16;
      if (this.stepAcc >= stride) {
        this.stepAcc -= stride;
        sfx?.footstep(surf(), clamp(speed / 5, 0, 1));
      }
    } else this.stepAcc = 0.45;

    // whooshes as moves start (Le Chonk and nearby enemies)
    const yaw = this.lastYaw;
    const fighters = [P, ...game.enemies];
    for (const f of fighters) {
      const m = this.moves.get(f.id);
      const started = f.move && (!m || m.move !== f.move || f.moveTime < m.t);
      if (started && sfx) {
        if (f === P) sfx.whoosh(f.move!);
        else {
          const d = Math.hypot(f.pos.x - P.pos.x, f.pos.z - P.pos.z);
          if (d < 25) sfx.whoosh(f.move!, 0.7 / (1 + d / 6), this.pan(f.pos.x - P.pos.x, f.pos.z - P.pos.z, yaw));
        }
      }
      if (m) {
        m.move = f.move;
        m.t = f.moveTime;
      } else this.moves.set(f.id, { move: f.move, t: f.moveTime });
    }

    // a wolf noticing Le Chonk growls; the tiger roars when he appears
    this.growlCd -= dt;
    for (const e of game.enemies) {
      if (e.removed) continue;
      const prev = this.enemyState.get(e.id);
      if (prev && prev !== e.state && e.state === 'chase' && (prev === 'idle' || prev === 'return') && this.growlCd <= 0 && sfx) {
        const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz);
        sfx.growl(e.kind, 0.9 / (1 + d / 10), this.pan(dx, dz, yaw));
        this.growlCd = 1.5;
      }
      this.enemyState.set(e.id, e.state);
    }
    if (game.tiger && !this.hadTiger && sfx) {
      const dx = game.tiger.pos.x - P.pos.x, dz = game.tiger.pos.z - P.pos.z;
      sfx.growl('tiger', 1, this.pan(dx, dz, yaw));
    }
    this.hadTiger = !!game.tiger;
  }

  private lastYaw = Math.PI;
  private pan(dx: number, dz: number, yaw: number) {
    const len = Math.hypot(dx, dz) || 1;
    return clamp(((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / len) * 0.8, -0.8, 0.8);
  }
}
