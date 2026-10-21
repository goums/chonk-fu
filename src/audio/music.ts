// Generative score, inspired by Japanese shamisen music: a tsugaru-style shamisen (bachi strokes,
// hammer-ons, pull-offs, slides) over taiko and wood, with a breathy shakuhachi in the calm moods and a
// bright fue for the festive ones. Scales: yo (1 2 4 5 6) and in / miyako-bushi (1 b2 4 5 b6).
// Phrases come from a seeded RNG, one bar is composed and scheduled ahead on the AudioContext clock.
// Each mood plays into its own section bus, so changing mood is a crossfade between two sections.
import { rng, type Rng } from '../core/math';
import { Lead, type Synth } from './voices';

export type Mood = 'village' | 'palace' | 'combat' | 'ending';

const YO = [0, 2, 5, 7, 9];
const IN = [0, 1, 5, 7, 8];

interface MoodDef {
  bpm: number;
  /** midi of the shamisen's low open string, the tonic */
  root: number;
  scale: number[];
  lead: 'shaku' | 'fue';
  /** scale-step ranges (0 = root) */
  leadRange: [number, number];
  shamiRange: [number, number];
  /** probability that a 4-bar phrase has a flute part */
  leadChance: number;
  /** flute rhythm cells in eighths (each sums to 8), and cells that end a phrase on a long note */
  cells: number[][];
  endCells: number[][];
  /** shamisen bars, 16 steps: X accent stroke, x stroke, u upstroke (sukui), h hammer-on,
   *  p pull-off (hajiki), s slide, - ring, . mute */
  shami: string[];
  /** percussion bars, 16 steps: D taiko, d soft taiko, k rim (ka), c hyoshigi, g kane, o shime */
  perc: string[];
  fill?: string;
  shamiVel: number;
  leadVel: number;
  percVel: number;
  pad: number;
  padCut: number;
  reverb: number;
  gain: number;
  fadeIn: number;
}

const CALM = [[4, 4], [6, 2], [3, 1, 4], [8], [2, 2, 4], [4, 2, 2]];
const MOODS: Record<Mood, MoodDef> = {
  village: {
    bpm: 84, root: 50, scale: YO, lead: 'shaku', leadRange: [5, 12], shamiRange: [2, 11], leadChance: 0.55,
    cells: CALM, endCells: [[4, 4], [8], [2, 2, 4], [3, 1, 4]],
    shami: ['X--uX-h-x-u-X---', 'X-x-u-X-h-x-X-u-', 'X---x-uhX---x-s-', 'X-u-X-u-x-h-p-u-', 'X-------x-u-X-h-', 'X-uxX---X-uhx---'],
    perc: ['d.......k.......', 'd.......k...c...', 'd...........c.c.', '................'],
    shamiVel: 0.55, leadVel: 0.5, percVel: 0.45, pad: 0.05, padCut: 850, reverb: 0.3, gain: 1, fadeIn: 2.5,
  },
  palace: {
    bpm: 58, root: 45, scale: IN, lead: 'shaku', leadRange: [7, 14], shamiRange: [2, 10], leadChance: 0.8,
    cells: [[8], [6, 2], [4, 4], [8], [3, 1, 4]], endCells: [[8], [4, 4]],
    shami: ['X-------u---h---', 'X-----------x-s-', 'X-------X---u---', 'x---h-------X---', '................'],
    perc: ['d...............', '................', 'd.......d.......'],
    shamiVel: 0.5, leadVel: 0.55, percVel: 0.5, pad: 0.07, padCut: 650, reverb: 0.6, gain: 1, fadeIn: 3,
  },
  combat: {
    bpm: 140, root: 52, scale: IN, lead: 'fue', leadRange: [10, 16], shamiRange: [2, 12], leadChance: 0.4,
    cells: [[2, 1, 1, 2, 2], [1, 1, 2, 4], [3, 3, 2], [2, 2, 2, 2]], endCells: [[1, 1, 2, 4], [2, 2, 4]],
    shami: ['XuxuXuxhXuxuXuxs', 'XxuXxuXxuXxuXuhp', 'X.xuX.xuXhxuX.Xu', 'XuxuxuXuxuxuXhps', 'X-xuX-xuX-xuXxXx'],
    perc: ['D..kD.k.D..kD.kk', 'D.kkD..kD.kkD.DD', 'D..D..D.k.D.D.kk'],
    fill: 'DkDkD.kkDDDDDDDD',
    shamiVel: 0.75, leadVel: 0.4, percVel: 0.85, pad: 0, padCut: 600, reverb: 0.18, gain: 0.9, fadeIn: 0.6,
  },
  ending: {
    bpm: 112, root: 55, scale: YO, lead: 'fue', leadRange: [7, 14], shamiRange: [2, 11], leadChance: 0.75,
    cells: [[2, 2, 4], [3, 1, 2, 2], [4, 2, 2], [2, 1, 1, 4]], endCells: [[4, 4], [2, 2, 4], [8]],
    shami: ['X-uxX-uxX-uhX-ux', 'XuxuX-uxXuxhX-X-', 'X-x-X-uxX-x-XuXu'],
    perc: ['D.k.D.kkD.k.Dkk.', 'D.k.DgkgD.k.Dgkg', 'D.kgD.kgD.kgDkDk'],
    shamiVel: 0.65, leadVel: 0.45, percVel: 0.6, pad: 0.045, padCut: 1200, reverb: 0.3, gain: 1, fadeIn: 1.5,
  },
};
/** drones (semitones above the root, two bars each): root, 4th and 5th are in both scales */
const PROGS = [[0, 0, 5, 7], [0, 5, 0, 7], [0, 7, 5, 0], [0, 0, 7, 0], [0, 5, 7, 0]];

const clampi = (v: number, a: number, b: number) => (v < a ? a + (a - v) : v > b ? b - (v - b) : v);

export class Key {
  constructor(public root: number, public scale: number[]) {}
  /** scale step -> midi */
  m(i: number) {
    const o = Math.floor(i / 5);
    return this.root + 12 * o + this.scale[i - o * 5];
  }
  /** scale step of an open string (0, 5 or 7 semitones above the root) */
  open(off: number) {
    return Math.max(0, this.scale.indexOf(off));
  }
  /** nearest step that belongs to the drone (root + off, its fifth) */
  chord(i: number, off: number) {
    for (const d of [0, -1, 1, -2, 2]) {
      const pc = (((this.m(i + d) - this.root - off) % 12) + 12) % 12;
      if (pc === 0 || pc === 7) return i + d;
    }
    return i;
  }
}

class Section {
  readonly bus: GainNode;
  readonly barDur: number;
  readonly key: Key;
  private def: MoodDef;
  private R: Rng;
  private e16: number;
  private ch: Record<'shami' | 'lead' | 'pad' | 'perc' | 'koto', GainNode>;
  private lead: Lead;
  private bar = 0;
  private prog = PROGS[0];
  private mel: number;
  private sIdx: number;
  private leadPhrase = false;
  private tplA = '';
  private tplB = '';

  constructor(private music: Music, readonly mood: Mood, t0: number, seed: number) {
    const s = music.synth, ctx = s.ctx, d = MOODS[mood];
    this.def = d;
    this.key = new Key(d.root, d.scale);
    this.R = rng(seed);
    this.barDur = (60 / d.bpm) * 4;
    this.e16 = this.barDur / 16;
    this.mel = Math.round((d.leadRange[0] + d.leadRange[1]) / 2);
    this.sIdx = 5;
    this.bus = ctx.createGain();
    this.bus.gain.setValueAtTime(0, t0);
    this.bus.gain.linearRampToValueAtTime(d.gain, t0 + d.fadeIn);
    this.bus.connect(music.out);
    const chan = (gain: number, pan: number, rev: number, shaper = false) => {
      const g = ctx.createGain();
      g.gain.value = gain;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      if (shaper) {
        // a gentle tanh: a touch more bite on the bachi attacks
        const ws = ctx.createWaveShaper();
        const curve = new Float32Array(1024);
        for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / 1023) * 2 - 1) * 1.8) / Math.tanh(1.8);
        ws.curve = curve;
        g.connect(ws).connect(p);
      } else g.connect(p);
      p.connect(this.bus);
      const send = ctx.createGain();
      send.gain.value = rev * d.reverb;
      p.connect(send).connect(music.reverb);
      return g;
    };
    this.ch = {
      shami: chan(0.7, -0.12, 0.8, true),
      lead: chan(0.32, 0.18, 1.3),
      pad: chan(1, 0, 1.2),
      perc: chan(0.6, 0.05, 0.6),
      koto: chan(0.35, -0.3, 1.4),
    };
    this.lead = new Lead(s, this.ch.lead, d.lead, t0);
  }

  private pick<T>(a: T[]) {
    return a[Math.floor(this.R() * a.length)];
  }
  private walk(i: number, [lo, hi]: [number, number], big = 0.2) {
    const R = this.R();
    const step = R < big * 0.5 ? -2 : R < big ? 2 : R < big + (0.95 - big) / 2 ? 1 : R < 0.95 ? -1 : 0;
    return clampi(i + step, lo, hi);
  }

  scheduleBar(t: number) {
    const s = this.music.synth, d = this.def, R = this.R, K = this.key, ch = this.ch, e16 = this.e16;
    const b = this.bar++, ph = b % 4;
    if (b % 8 === 0) this.prog = this.pick(PROGS);
    const off = this.prog[Math.floor(b / 2) % 4];
    if (ph === 0) {
      this.leadPhrase = R() < d.leadChance;
      this.tplA = this.pick(d.shami);
      this.tplB = this.pick(d.shami);
    }
    const hum = () => (R() - 0.5) * 0.008;

    // ---- drone pad
    if (d.pad > 0 && b % 2 === 0) s.pad(ch.pad, t, [d.root + off, d.root + off + 7, d.root + off + 12], this.barDur * 2, d.pad, d.padCut);

    // ---- shamisen
    let tpl = ph === 3 ? this.pick(d.shami) : ph === 1 ? this.tplB : this.tplA;
    const calm = this.mood === 'village' || this.mood === 'palace';
    if (calm && this.leadPhrase && ph < 3) tpl = tpl.replace(/u/g, '-'); // leave room for the flute
    type Stroke = { k: number; idx: number; midi0: number; vel: number; open: boolean; steps: { dt: number; midi: number; slide?: boolean }[]; mute?: number; slideFrom?: number };
    const strokes: Stroke[] = [];
    let cur: Stroke | null = null;
    const [lo, hi] = d.shamiRange;
    for (let k = 0; k < 16; k++) {
      const c = tpl[k];
      if (c === 'X' || c === 'x' || c === 'u') {
        const open = (c === 'X' && k % 8 === 0 && R() < 0.6) || (c === 'u' && R() < 0.3);
        let idx: number;
        if (open) idx = K.open(off) + (c === 'u' || R() < 0.3 ? 5 : 0);
        else idx = this.sIdx = this.walk(this.sIdx, [lo, hi], this.mood === 'combat' ? 0.3 : 0.2);
        if (ph === 3 && k >= 12 && c === 'X') idx = this.sIdx = K.chord(idx, off);
        cur = { k, idx, midi0: K.m(idx), vel: (c === 'X' ? 1 : c === 'x' ? 0.72 : 0.5) * (0.92 + R() * 0.16), open, steps: [] };
        if (!open && R() < 0.12) cur.slideFrom = K.m(idx - 1);
        strokes.push(cur);
      } else if (cur && cur.mute === undefined && (c === 'h' || c === 'p' || c === 's')) {
        const di = c === 'h' ? 1 : c === 'p' ? -1 : R() < 0.5 ? 2 : -1;
        cur.idx = clampi(cur.idx + di, lo, hi + 2);
        if (!cur.open) this.sIdx = cur.idx;
        cur.steps.push({ dt: (k - cur.k) * e16, midi: K.m(cur.idx), slide: c === 's' });
      } else if (cur && c === '.' && cur.mute === undefined) cur.mute = (k - cur.k) * e16; // left hand stops the string
    }
    strokes.forEach((st, j) => {
      const next = strokes[j + 1];
      const damp = st.mute !== undefined ? st.mute + 0.01 : next ? (next.k - st.k) * e16 + 0.012 : this.mood === 'combat' ? 4 * e16 : 0;
      s.pluck(ch.shami, t + st.k * e16 + hum(), st.midi0, st.vel * d.shamiVel, { steps: st.steps, slideFrom: st.slideFrom, damp, glide: 0.03 + R() * 0.05 });
    });

    // ---- flute
    if (this.leadPhrase && ph < 3) {
      const e8 = this.barDur / 8;
      const cell = this.pick(ph === 2 ? d.endCells : d.cells);
      type N = { t: number; idx: number; midi: number; dur: number; slide: boolean; rest: boolean };
      const notes: N[] = [];
      let tt = 0;
      cell.forEach((len, j) => {
        this.mel = j === 0 && R() < 0.5 ? K.chord(this.mel, off) : this.walk(this.mel, d.leadRange);
        const last = j === cell.length - 1;
        if (ph === 2 && last) this.mel = K.chord(this.mel, off);
        notes.push({ t: t + tt * e8, idx: this.mel, midi: K.m(this.mel), dur: len * e8, slide: j > 0 && R() < (d.lead === 'shaku' ? 0.3 : 0.15), rest: !last && j > 0 && R() < 0.12 });
        tt += len;
      });
      notes.forEach((n, j) => {
        if (n.rest) return;
        const next = notes[j + 1];
        const hold = !!next && next.slide && !next.rest;
        const vel = d.leadVel * (0.85 + R() * 0.2);
        if (!n.slide && n.dur >= 3 * e8 * 0.99 && R() < 0.3) {
          // grace note from above, then lean into the main note
          this.lead.note(n.t, K.m(n.idx + 1), 0.08, vel, false, true);
          this.lead.note(n.t + 0.08, n.midi, n.dur - 0.08, vel, true, hold);
        } else this.lead.note(n.t, n.midi, n.dur, vel, n.slide && !notes[j - 1]?.rest, hold);
      });
    }

    // ---- koto arpeggio (palace) and wind-chime koto in the village rests
    if (this.mood === 'palace' && (ph === 0 || ph === 2)) {
      const o = K.open(off) + 5;
      [0, 2, 3, 5].forEach((di, j) => s.pluck(ch.koto, t + j * e16 * 2 + hum(), K.m(o + di), 0.5 - j * 0.06, { style: 'koto' }));
    } else if (this.mood === 'village' && ph === 3 && R() < 0.5) {
      const o = K.open(off) + 10;
      [0, -1, -2, 0].forEach((di, j) => s.pluck(ch.koto, t + 8 * e16 + j * e16 * 2 + hum(), K.m(o + di), 0.3, { style: 'koto' }));
    }

    // ---- percussion
    const ptpl = ph === 3 && d.fill ? d.fill : this.pick(d.perc);
    const pv = d.percVel;
    for (let k = 0; k < 16; k++) {
      const c = ptpl[k], tk = t + k * e16 + hum();
      if (c === 'D') s.taiko(ch.perc, tk, pv * (k % 4 === 0 ? 0.9 : 0.65));
      else if (c === 'd') s.taiko(ch.perc, tk, pv * 0.35, 62);
      else if (c === 'k') s.woodBlock(ch.perc, tk, 2100, pv * 0.22);
      else if (c === 'c') s.clap(ch.perc, tk, pv * 0.3);
      else if (c === 'g') s.kane(ch.perc, tk, pv * 0.18);
      if (this.mood === 'combat' && k % 2 === 0) s.drum(ch.perc, tk, pv * (k % 4 === 0 ? 0.16 : 0.1));
    }
    if (this.mood === 'combat' && b % 8 === 0) {
      s.cymbal(ch.perc, t, 0.45);
      s.gong(ch.perc, t, 0.3, 1.1);
    }
    if (this.mood === 'ending' && b % 8 === 0) s.gong(ch.perc, t, 0.35, 1);
    if (this.mood === 'palace' && b % 4 === 0) {
      s.gong(ch.perc, t, 0.4, 0.7); // the temple bell
      s.bell(ch.koto, t, d.root + 24, 0.12, 3);
    }
    if (this.mood === 'village' && b % 16 === 8) s.gong(ch.perc, t, 0.16, 0.95);
  }

  fade(t: number, dur: number) {
    const g = this.bus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + dur);
    this.lead.stop(t + dur + 0.1);
    setTimeout(() => this.bus.disconnect(), (dur + this.barDur + 4) * 1000);
  }
}

export class Music {
  readonly out: GainNode;
  readonly reverb: AudioNode;
  private duckG: GainNode;
  private sting: GainNode;
  private sec: Section | null = null;
  private mood: Mood | null = null;
  private want: Mood = 'village';
  private nextBar = 0;
  private holdUntil = 0;
  private seed = 7;

  constructor(readonly synth: Synth, dest: AudioNode, reverb: AudioNode) {
    const ctx = synth.ctx;
    this.reverb = reverb;
    this.duckG = ctx.createGain();
    this.duckG.connect(dest);
    this.out = ctx.createGain();
    this.out.connect(this.duckG);
    this.sting = ctx.createGain();
    this.sting.gain.value = 0.55;
    this.sting.connect(dest);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    this.sting.connect(send).connect(reverb);
  }

  set(m: Mood) {
    this.want = m;
  }
  get current() {
    return this.mood;
  }
  key() {
    return this.sec?.key ?? new Key(MOODS.village.root, MOODS.village.scale);
  }

  update() {
    const now = this.synth.ctx.currentTime;
    if (now >= this.holdUntil && (this.want !== this.mood || !this.sec)) {
      this.sec?.fade(now, this.want === 'combat' ? 1.2 : 2.5);
      this.mood = this.want;
      this.sec = new Section(this, this.want, now + 0.05, this.seed++);
      this.nextBar = now + 0.05;
    }
    if (!this.sec) return;
    if (this.nextBar < now) this.nextBar = now + 0.05; // fell behind (throttled tab)
    while (this.nextBar < now + 0.6) {
      this.sec.scheduleBar(this.nextBar);
      this.nextBar += this.sec.barDur;
    }
  }

  /** lower the score under a sting */
  duck(level: number, dur: number) {
    const g = this.duckG.gain, now = this.synth.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(level, now, 0.08);
    g.setTargetAtTime(1, now + dur, 0.6);
  }

  // ---------------------------------------------------------------- stings
  /** a new place: temple gong and a flute flourish */
  discover() {
    const s = this.synth, t = s.ctx.currentTime + 0.03, K = this.key(), o = this.sting;
    this.duck(0.5, 2.4);
    s.gong(o, t, 0.5, 0.9);
    s.pluck(o, t, K.m(5), 0.5, { slideFrom: K.m(4) });
    const run = [5, 6, 7, 8, 9];
    run.forEach((i, j) => s.flute(o, t + 0.12 + j * 0.07, K.m(i), 0.08, 0.28));
    s.flute(o, t + 0.12 + run.length * 0.07, K.m(10), 1.4, 0.32);
  }

  /** new quest: a quick shamisen flourish, kane and clappers */
  fanfare() {
    const s = this.synth, t = s.ctx.currentTime + 0.03, K = this.key(), o = this.sting;
    this.duck(0.6, 1.4);
    [5, 7, 8, 10].forEach((i, j) => s.pluck(o, t + j * 0.08, K.m(i), 0.6 + j * 0.1, { damp: j < 3 ? 0.09 : 0 }));
    s.pluck(o, t + 0.34, K.m(5), 0.5);
    s.taiko(o, t + 0.34, 0.5);
    s.kane(o, t + 0.34, 0.3);
    s.clap(o, t + 0.5, 0.35);
    s.clap(o, t + 0.58, 0.25);
  }

  /** the end: a festival flourish, then the ending section takes over */
  victory() {
    const s = this.synth, ctx = s.ctx, T = ctx.currentTime + 0.05, o = this.sting;
    this.sec?.fade(T, 0.8);
    this.sec = null;
    this.mood = null;
    this.holdUntil = T + 6.6;
    const K = new Key(55, YO), beat = 60 / 112;
    for (let i = 0; i < 16; i++) s.taiko(o, T + i * 0.065, 0.15 + (i / 16) * 0.5, 80);
    const T1 = T + 1.05;
    s.taiko(o, T1, 1, 60);
    s.gong(o, T1, 0.8, 1);
    s.cymbal(o, T1, 0.5, 1.4);
    [5, 7, 8, 7, 5, 8, 10, 8, 10, 12, 10, 8].forEach((i, j) => s.pluck(o, T1 + 0.1 + j * beat * 0.25, K.m(i), j % 4 === 0 ? 0.9 : 0.55, { damp: beat * 0.25 }));
    const T2 = T1 + 0.1 + 12 * beat * 0.25;
    const mel: [number, number][] = [[74, 0.5], [76, 0.5], [79, 1], [81, 1], [79, 0.5], [76, 0.5], [74, 0.5], [76, 0.5], [79, 2]];
    let tt = T2;
    for (const [m, len] of mel) {
      s.flute(o, tt, m, len * beat * 0.95, 0.4);
      tt += len * beat;
    }
    for (let i = 0; i < 8; i++) {
      const tb = T2 + i * beat;
      s.taiko(o, tb, i % 2 ? 0.35 : 0.6);
      s.kane(o, tb + beat / 2, 0.15);
      s.pluck(o, tb, K.m(i % 2 ? 3 : 0), 0.6, { damp: beat * 0.5 });
    }
    s.gong(o, tt, 0.7, 1.05);
    s.cymbal(o, tt, 0.4, 1.6);
    for (const i of [0, 3, 5]) s.pluck(o, tt + i * 0.01, K.m(i), 0.7);
  }
}
