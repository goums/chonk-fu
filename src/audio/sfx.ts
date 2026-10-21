// Cartoon kung-fu sound effects, all synthesized: a whoosh on every move, meaty impacts, a wobbly
// belly "boing", porcelain, wood and rock breaking, glassy jade, paw pats on grass, stone, wood, water.
import { clamp } from '../core/math';
import type { Synth } from './voices';

export type Surface = 'grass' | 'stone' | 'wood' | 'water';

const vary = (x: number, amt = 0.08) => x * (1 + (Math.random() * 2 - 1) * amt);

export class Sfx {
  /** dry + a little reverb, for sounds that should bloom (chimes, poofs, gongs) */
  private verb: GainNode;

  constructor(private s: Synth, private out: AudioNode, reverb: AudioNode) {
    const ctx = s.ctx;
    this.verb = ctx.createGain();
    this.verb.connect(out);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    this.verb.connect(send).connect(reverb);
  }

  private get t() {
    return this.s.ctx.currentTime + 0.004;
  }

  /** a panned, attenuated destination for sounds in the world */
  at(vol: number, pan: number) {
    const ctx = this.s.ctx;
    const g = ctx.createGain();
    g.gain.value = vol;
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    g.connect(p).connect(this.out);
    return g;
  }

  /** a buzzing source (sawtooth) through formant bandpasses: voices, growls */
  private voiced(dest: AudioNode, t: number, f0: number, f1: number, dur: number, gain: number, formants: number[], q = 4, trem = 0) {
    const ctx = this.s.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const e = this.s.env(dest, t, gain, 0.012, dur);
    let src: AudioNode = o;
    if (trem > 0) {
      const am = ctx.createGain();
      am.gain.value = 0.6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = trem;
      const lg = ctx.createGain();
      lg.gain.value = 0.4;
      lfo.connect(lg).connect(am.gain);
      o.connect(am);
      src = am;
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    for (const f of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      src.connect(bp).connect(e);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** body hit: thump + slap + smack, `w` = weight 0..1 */
  private impact(t: number, w: number, dest: AudioNode = this.out) {
    const s = this.s;
    s.tone(dest, t, { f0: vary(150 + 60 * w), f1: 50, glide: 0.09, dur: 0.14 + 0.14 * w, gain: 0.55 + 0.35 * w });
    s.noiseHit(dest, t, { type: 'highpass', dur: 0.035, gain: 0.45, f0: 1800 });
    s.noiseHit(dest, t, { dur: 0.07 + 0.05 * w, gain: 0.35 + 0.3 * w, f0: vary(1100), f1: 450, q: 1.3 });
  }

  play(id: string) {
    const s = this.s, t = this.t, o = this.out;
    switch (id) {
      case 'hit-jab':
        this.impact(t, 0.45);
        s.noiseHit(o, t, { dur: 0.02, gain: 0.3, f0: 3200, q: 2 });
        break;
      case 'hit-cross':
        this.impact(t, 0.7);
        s.noiseHit(o, t, { dur: 0.03, gain: 0.35, f0: 2500, q: 1.5 });
        break;
      case 'hit-kick':
        this.impact(t, 1);
        s.noiseHit(o, t + 0.005, { dur: 0.11, gain: 0.5, f0: 1500, f1: 650, q: 2 });
        s.tone(o, t, { f0: 90, f1: 45, dur: 0.25, gain: 0.4 });
        break;
      case 'hit-belly': {
        // a jiggly "boing": rising pitch with a wobble that settles
        const ctx = s.ctx;
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(vary(95), t);
        osc.frequency.exponentialRampToValueAtTime(240, t + 0.38);
        const lfo = ctx.createOscillator(), depth = ctx.createGain();
        lfo.frequency.setValueAtTime(17, t);
        lfo.frequency.linearRampToValueAtTime(7, t + 0.6);
        depth.gain.setValueAtTime(40, t);
        depth.gain.linearRampToValueAtTime(5, t + 0.6);
        lfo.connect(depth).connect(osc.frequency);
        osc.connect(s.env(o, t, 0.65, 0.01, 0.6));
        osc.start(t);
        lfo.start(t);
        osc.stop(t + 0.66);
        lfo.stop(t + 0.66);
        s.tone(o, t, { type: 'triangle', f0: 140, f1: 65, dur: 0.22, gain: 0.5 });
        s.noiseHit(o, t, { type: 'lowpass', dur: 0.1, gain: 0.4, f0: 700 });
        break;
      }
      case 'hit-slam':
        s.tone(o, t, { f0: 95, f1: 32, glide: 0.4, dur: 0.8, gain: 1 });
        s.buffer(o, t, s.crumbleBuf, 0.55, vary(0.9), 1600);
        s.taiko(o, t, 0.6, 52);
        s.cymbal(this.verb, t + 0.01, 0.18, 0.8);
        break;
      case 'hurt':
        this.impact(t, 0.6);
        this.voiced(o, t + 0.02, vary(240), 150, 0.16, 0.5, [700, 1150], 3); // "oof"
        break;
      case 'poof':
        s.noiseHit(this.verb, t, { type: 'lowpass', attack: 0.012, dur: 0.45, gain: 0.55, f0: 3500, f1: 250 });
        s.tone(o, t, { f0: 1100, f1: 330, dur: 0.3, gain: 0.12 });
        s.chime(this.verb, t + 0.12, 96, 0.05, 0.4);
        s.chime(this.verb, t + 0.2, 101, 0.04, 0.4);
        break;
      case 'tree':
        for (let i = 0; i < 6; i++) {
          s.noiseHit(o, t + i * 0.06 + Math.random() * 0.04, { attack: 0.02, dur: vary(0.15, 0.3), gain: vary(0.22, 0.3), f0: vary(4500, 0.3), q: 0.8 });
        }
        s.tone(o, t, { type: 'triangle', f0: 150, f1: 105, dur: 0.16, gain: 0.25 });
        s.tone(o, t, { f0: 110, f1: 70, dur: 0.1, gain: 0.35 });
        break;
      case 'clank':
        for (const [f, g, d] of [[523, 0.3, 0.5], [1187, 0.22, 0.35], [1730, 0.16, 0.25], [2650, 0.12, 0.15]]) s.tone(this.verb, t, { f0: vary(f, 0.02), dur: d, gain: g });
        s.noiseHit(o, t, { type: 'highpass', dur: 0.03, gain: 0.35, f0: 4000 });
        s.tone(o, t, { f0: 180, f1: 140, dur: 0.08, gain: 0.3 });
        break;
      case 'thud':
        s.tone(o, t, { f0: 120, f1: 50, dur: 0.22, gain: 0.75 });
        s.noiseHit(o, t, { type: 'lowpass', dur: 0.1, gain: 0.45, f0: 500 });
        break;
      case 'shatter':
        s.buffer(this.verb, t, s.shatterBuf, 0.75, vary(1, 0.1));
        s.tone(o, t, { f0: 140, f1: 70, dur: 0.1, gain: 0.35 });
        break;
      case 'crumble':
        s.buffer(o, t, s.crumbleBuf, 0.85, vary(0.95, 0.1));
        break;
      case 'crack':
        s.buffer(o, t, s.crackBuf, 0.85, vary(1, 0.1));
        s.tone(o, t, { f0: 130, f1: 70, dur: 0.12, gain: 0.35 });
        break;
      case 'jade':
        [84, 88, 91, 96, 100].forEach((m, i) => s.chime(this.verb, t + i * 0.06, m, 0.16, 1.4));
        s.noiseHit(this.verb, t + 0.1, { type: 'highpass', attack: 0.15, dur: 0.6, gain: 0.05, f0: 7000 });
        break;
      case 'powerup':
        // Dragon Chonk: a rising rumble, a taiko hit, a gong and a crackle of electric sparks
        s.tone(o, t, { f0: 55, f1: 220, glide: 1.1, dur: 1.4, gain: 0.7 });
        s.noiseHit(this.verb, t, { type: 'bandpass', attack: 0.6, dur: 1.2, gain: 0.25, f0: 300, f1: 4000, q: 1.2 });
        s.taiko(o, t + 1.1, 1, 48);
        s.cymbal(this.verb, t + 1.1, 0.5, 2.4);
        [72, 79, 84, 91, 96].forEach((m, i) => s.chime(this.verb, t + 1.15 + i * 0.07, m, 0.14, 1.6));
        for (let i = 0; i < 10; i++) s.noiseHit(o, t + 1.15 + i * 0.05 + Math.random() * 0.04, { type: 'highpass', dur: 0.02, gain: 0.25, f0: vary(5000, 0.3) });
        break;
      case 'zap':
        // the aura's electric crackle
        for (let i = 0; i < 3; i++) s.noiseHit(o, t + i * 0.03 + Math.random() * 0.02, { type: 'highpass', dur: 0.015, gain: 0.12, f0: vary(6000, 0.3) });
        break;
      case 'pickup':
        s.tone(o, t, { type: 'triangle', f0: 880, dur: 0.06, gain: 0.25 });
        s.tone(o, t + 0.07, { type: 'triangle', f0: 1320, dur: 0.14, gain: 0.25 });
        s.chime(this.verb, t + 0.07, 93, 0.06, 0.5);
        break;
      case 'talk': {
        // "mm-hm?": two soft voiced blips, the second one rising
        const f = vary(260, 0.15);
        this.voiced(o, t, f, f * 1.1, 0.09, 0.28, [500, 1500], 2.5);
        this.voiced(o, t + 0.13, f * 1.15, f * 1.6, 0.12, 0.28, [550, 1700], 2.5);
        break;
      }
      case 'tick':
        s.woodBlock(o, t, vary(1300, 0.05), 0.16);
        break;
      default:
        s.tone(o, t, { type: 'triangle', f0: 600, dur: 0.05, gain: 0.15 });
    }
  }

  /** the swish of a move as it starts (vol / pan for enemies) */
  whoosh(move: string, vol = 1, pan = 0) {
    const s = this.s, t = this.t, o = vol < 1 || pan !== 0 ? this.at(vol, pan) : this.out;
    switch (move) {
      case 'jab':
        s.noiseHit(o, t, { attack: 0.02, dur: 0.1, gain: 0.32, f0: vary(700), f1: 2400, q: 1.2 });
        break;
      case 'cross':
        s.noiseHit(o, t, { attack: 0.025, dur: 0.13, gain: 0.4, f0: vary(550), f1: 2000, q: 1.2 });
        break;
      case 'kick':
        s.noiseHit(o, t, { attack: 0.04, dur: 0.2, gain: 0.45, f0: vary(380), f1: 1700, q: 1 });
        break;
      case 'belly':
        this.voiced(o, t, 170, 240, 0.12, 0.3, [600, 1100], 3); // "hup!"
        s.noiseHit(o, t + 0.05, { attack: 0.06, dur: 0.22, gain: 0.32, f0: 300, f1: 900, q: 0.9 });
        break;
      case 'slam':
        // the ground pound lands
        s.tone(o, t, { f0: 85, f1: 35, dur: 0.5, gain: 0.8 });
        s.noiseHit(o, t, { type: 'lowpass', dur: 0.3, gain: 0.5, f0: 900, f1: 150 });
        break;
      default:
        s.noiseHit(o, t, { attack: 0.02, dur: 0.12, gain: 0.35, f0: 600, f1: 2000 });
    }
  }

  /** the slam dive: a falling slide whistle */
  dive() {
    const s = this.s, t = this.t;
    s.tone(this.out, t, { f0: 1600, f1: 380, dur: 0.42, gain: 0.12, attack: 0.02 });
    s.noiseHit(this.out, t, { attack: 0.05, dur: 0.35, gain: 0.25, f0: 1600, f1: 450 });
  }

  /** soft paw pats; k = 0 (walk) .. 1 (run) */
  footstep(surf: Surface, k: number) {
    const s = this.s, t = this.t, o = this.out, g = 0.55 + 0.45 * k;
    switch (surf) {
      case 'grass':
        s.noiseHit(o, t, { type: 'lowpass', dur: 0.06, gain: 0.14 * g, f0: vary(900, 0.2), f1: 350 });
        s.noiseHit(o, t + 0.01, { attack: 0.01, dur: 0.05, gain: 0.05 * g, f0: vary(3200, 0.2), q: 1 });
        s.tone(o, t, { f0: vary(85), f1: 55, dur: 0.06, gain: 0.16 * g });
        break;
      case 'stone':
        s.tone(o, t, { f0: vary(115), f1: 70, dur: 0.05, gain: 0.2 * g });
        s.noiseHit(o, t, { type: 'highpass', dur: 0.025, gain: 0.08 * g, f0: 2600 });
        break;
      case 'wood':
        s.tone(o, t, { type: 'triangle', f0: vary(230), f1: 180, dur: 0.07, gain: 0.2 * g });
        s.noiseHit(o, t, { dur: 0.06, gain: 0.14 * g, f0: vary(650, 0.1), q: 5 });
        break;
      case 'water':
        s.noiseHit(o, t, { attack: 0.01, dur: 0.14, gain: 0.22 * g, f0: 900, f1: 2300, q: 0.8 });
        s.tone(o, t + 0.03, { f0: vary(500, 0.2), f1: 1100, dur: 0.05, gain: 0.05 * g });
        break;
    }
  }

  jump() {
    const s = this.s, t = this.t;
    s.noiseHit(this.out, t, { attack: 0.02, dur: 0.15, gain: 0.2, f0: 400, f1: 1400, q: 1 });
    s.tone(this.out, t, { type: 'triangle', f0: 260, f1: 420, dur: 0.09, gain: 0.08 });
  }

  /** force 0..1 from the fall speed */
  land(force: number, surf: Surface) {
    const s = this.s, t = this.t, o = this.out;
    if (surf === 'water') {
      s.noiseHit(o, t, { attack: 0.01, dur: 0.35, gain: 0.35 + 0.3 * force, f0: 700, f1: 2500, q: 0.7 });
      for (let i = 0; i < 4; i++) s.tone(o, t + 0.05 + i * 0.05, { f0: vary(450, 0.3), f1: 1200, dur: 0.05, gain: 0.05 });
      return;
    }
    s.tone(o, t, { f0: 105, f1: 40, dur: 0.12 + 0.15 * force, gain: 0.3 + 0.5 * force });
    s.noiseHit(o, t, { type: 'lowpass', dur: 0.1 + 0.08 * force, gain: 0.15 + 0.3 * force, f0: 800, f1: 200 });
    if (surf === 'wood') s.noiseHit(o, t, { dur: 0.08, gain: 0.2, f0: 600, q: 5 });
  }

  /** a wolf noticing Le Chonk, or the tiger's roar */
  growl(kind: 'wolf' | 'tiger', vol: number, pan: number) {
    const o = this.at(vol, pan), t = this.t;
    if (kind === 'tiger') {
      this.voiced(o, t, 150, 85, 1.1, 0.9, [380, 820, 1600], 2, 28);
      this.s.noiseHit(o, t, { attack: 0.1, dur: 0.9, gain: 0.3, f0: 600, f1: 300, q: 1 });
    } else {
      this.voiced(o, t, vary(115), 90, 0.5, 0.6, [420, 950], 3, 24);
    }
  }
}
