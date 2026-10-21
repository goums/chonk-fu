// The valley around Le Chonk: wind (stronger up the palace mountain), leaves in the bamboo forest,
// the river and the lotus pond (by distance and direction), crickets, and scheduled one-shots: birds
// (with an uguisu, the bush warbler), a kite crying above the mountain, frogs, furin wind bells in the
// village, the shishi-odoshi bamboo knocker by the pond and bamboo stalks clacking in the wind.
import { clamp, smoothstep } from '../core/math';
import { BAMBOO_FOREST, GROUND, PEACH_HILL, POND, RIVER_HALF_WIDTH, VILLAGE, riverX } from '../world/layout';
import type { Synth } from './voices';

export interface Listener {
  x: number;
  y: number;
  z: number;
  /** camera yaw (FollowCamera convention: camera sits at target + (sin yaw, cos yaw) * dist) */
  yaw: number;
}

export class Ambience {
  private windG: GainNode;
  private gustD: GainNode;
  private leavesG: GainNode;
  private riverG: GainNode;
  private riverP: StereoPannerNode;
  private pondG: GainNode;
  private pondP: StereoPannerNode;
  private crickG: GainNode;
  private oneShots: GainNode;
  private next = { bird: 2, kite: 20, frog: 3, furin: 4, shishi: 9, bamboo: 5 };
  private last = 0;

  constructor(private s: Synth, out: AudioNode, reverb: AudioNode) {
    const ctx = s.ctx, t0 = ctx.currentTime + 0.05;
    const filter = (type: BiquadFilterType, f: number, q = 0.7) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const gain = (v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    // wind: brown noise through a wandering bandpass, with slow gusts
    const wind = s.loop(s.wind);
    const wf = filter('bandpass', 480, 0.6);
    this.windG = gain();
    wind.connect(wf).connect(this.windG).connect(out);
    const sweep = ctx.createOscillator(), sweepD = gain(260);
    sweep.frequency.value = 0.07;
    sweep.connect(sweepD).connect(wf.frequency);
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.13;
    this.gustD = gain();
    gust.connect(this.gustD).connect(this.windG.gain);
    // leaves: the same wind, faster and high-passed
    const leaves = s.loop(s.wind, 1.9);
    this.leavesG = gain();
    leaves.connect(filter('highpass', 2600)).connect(this.leavesG).connect(out);
    gust.connect(gain(0.006)).connect(this.leavesG.gain);
    // river and pond
    const river = s.loop(s.water);
    this.riverP = ctx.createStereoPanner();
    this.riverG = gain();
    river.connect(filter('highpass', 280)).connect(this.riverG).connect(this.riverP).connect(out);
    const pond = s.loop(s.water, 0.72);
    this.pondP = ctx.createStereoPanner();
    this.pondG = gain();
    pond.connect(filter('lowpass', 1300)).connect(this.pondG).connect(this.pondP).connect(out);
    // crickets
    const cr = s.loop(s.crickets);
    this.crickG = gain();
    cr.connect(this.crickG).connect(out);
    // one-shots, with a little reverb
    this.oneShots = gain(1);
    this.oneShots.connect(out);
    this.oneShots.connect(gain(0.4)).connect(reverb);
    for (const n of [wind, leaves, river, pond, cr, sweep, gust]) n.start(t0);
    this.last = t0;
  }

  update(L: Listener) {
    const now = this.s.ctx.currentTime;
    if (now - this.last < 0.1) return;
    const dt = Math.min(1, now - this.last);
    this.last = now;
    const alt = L.y - GROUND;
    const high = smoothstep(8, 50, alt), low = 1 - smoothstep(10, 40, alt);
    const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw); // camera right vector
    const panTo = (dx: number, dz: number, d: number) => {
      const len = Math.hypot(dx, dz) || 1;
      return clamp(((dx * rx + dz * rz) / len) * Math.min(1, d / 8), -0.85, 0.85);
    };
    const set = (p: AudioParam, v: number, tc = 0.4) => p.setTargetAtTime(v, now, tc);

    const bamboo =
      Math.min(smoothstep(BAMBOO_FOREST.x0 - 15, BAMBOO_FOREST.x0, L.x), 1 - smoothstep(BAMBOO_FOREST.x1, BAMBOO_FOREST.x1 + 15, L.x)) *
      Math.min(smoothstep(BAMBOO_FOREST.z0 - 15, BAMBOO_FOREST.z0, L.z), 1 - smoothstep(BAMBOO_FOREST.z1, BAMBOO_FOREST.z1 + 15, L.z));
    const dHill = Math.hypot(L.x - PEACH_HILL.x, L.z - PEACH_HILL.z);
    const hill = 1 - smoothstep(PEACH_HILL.r * 0.6, PEACH_HILL.r * 1.3, dHill);
    const dVillage = Math.hypot(L.x - VILLAGE.x, L.z - VILLAGE.z);
    const village = 1 - smoothstep(VILLAGE.r * 0.5, VILLAGE.r, dVillage);

    const wind = 0.05 + 0.28 * high + 0.03 * bamboo;
    set(this.windG.gain, wind);
    set(this.gustD.gain, wind * 0.45);
    set(this.leavesG.gain, (0.012 + 0.07 * bamboo + 0.03 * hill) * low);

    const rdx = riverX(L.z) - L.x, dRiver = Math.max(0, Math.abs(rdx) - RIVER_HALF_WIDTH);
    set(this.riverG.gain, 0.25 * (1 - smoothstep(0, 50, dRiver)) * low);
    set(this.riverP.pan, panTo(rdx, 0, dRiver));
    const pdx = POND.x - L.x, pdz = POND.z - L.z, dPond = Math.max(0, Math.hypot(pdx, pdz) - POND.r);
    const nearPond = 1 - smoothstep(0, 40, dPond);
    set(this.pondG.gain, 0.16 * nearPond * low);
    set(this.pondP.pan, panTo(pdx, pdz, dPond));
    set(this.crickG.gain, (0.018 + 0.05 * nearPond) * low * (1 - 0.5 * village));

    // ---- one-shots
    const n = this.next, R = Math.random;
    for (const k of Object.keys(n) as (keyof typeof n)[]) n[k] -= dt;
    const birdy = 0.4 + 0.6 * Math.max(bamboo, hill) + 0.3 * nearPond;
    if (n.bird <= 0) {
      n.bird = (1.5 + R() * 5) / birdy;
      if (alt < 30) this.bird(R() * 1.6 - 0.8, 0.5 + 0.5 * birdy);
    }
    if (n.kite <= 0) {
      n.kite = 14 + R() * 20;
      if (high > 0.3) this.kite(R() * 1.6 - 0.8, 0.6 * high);
    }
    if (n.frog <= 0) {
      n.frog = 1.5 + R() * 4;
      if (nearPond > 0.2) this.frog(panTo(pdx + (R() - 0.5) * 20, pdz + (R() - 0.5) * 20, dPond + 6), nearPond);
    }
    if (n.furin <= 0) {
      n.furin = 4 + R() * 9;
      if (village > 0.1) this.furin(R() * 1.2 - 0.6, village);
    }
    if (n.shishi <= 0) {
      n.shishi = 11 + R() * 4;
      if (nearPond > 0.1) this.shishi(panTo(pdx, pdz, dPond + 4), nearPond);
    }
    if (n.bamboo <= 0) {
      n.bamboo = 2 + R() * 5;
      if (bamboo > 0.2) this.bamboo(R() * 1.6 - 0.8, bamboo);
    }
  }

  private dest(vol: number, pan: number) {
    const ctx = this.s.ctx;
    const g = ctx.createGain();
    g.gain.value = vol;
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    g.connect(p).connect(this.oneShots);
    return g;
  }
  private whistle(o: AudioNode, t: number, f0: number, f1: number, dur: number, gain: number) {
    this.s.tone(o, t, { f0, f1, dur, gain, attack: Math.min(0.015, dur * 0.3) });
  }

  private bird(pan: number, vol: number) {
    const o = this.dest(0.05 * vol, pan), t = this.s.ctx.currentTime + 0.02, R = Math.random;
    const kind = R();
    if (kind < 0.22) {
      // uguisu: "hoooo ... ho-ke-kyo"
      const f = 1000 + R() * 200;
      this.s.tone(o, t, { f0: f * 0.9, f1: f * 1.25, glide: 0.9, dur: 0.9, gain: 0.8, attack: 0.15 });
      this.whistle(o, t + 1.05, f * 1.6, f * 1.55, 0.11, 0.9);
      this.whistle(o, t + 1.2, f * 2.3, f * 1.9, 0.09, 0.9);
      this.whistle(o, t + 1.33, f * 2.7, f * 2.05, 0.28, 0.9);
    } else if (kind < 0.65) {
      // sparrow chirps
      const c = 2 + Math.floor(R() * 4), up = R() < 0.5;
      for (let i = 0; i < c; i++) this.whistle(o, t + i * (0.09 + R() * 0.05), up ? 3400 : 4600, up ? 4800 : 3100, 0.045, 0.7 + R() * 0.3);
    } else {
      // a warbler's little tune
      const c = 5 + Math.floor(R() * 6);
      let f = 2600 + R() * 1500;
      for (let i = 0; i < c; i++) {
        const g = f * (0.85 + R() * 0.3);
        this.whistle(o, t + i * 0.055, f, g, 0.04, 0.6);
        f = clamp(g, 2200, 5000);
      }
    }
  }

  /** tobi (black kite) over the mountain: "pi-hyoro-ro-ro" */
  private kite(pan: number, vol: number) {
    const o = this.dest(0.05 * vol, pan), t = this.s.ctx.currentTime + 0.02;
    this.whistle(o, t, 2500, 2700, 0.18, 0.8);
    this.whistle(o, t + 0.25, 2900, 2200, 0.5, 0.9);
    for (let i = 0; i < 3; i++) this.whistle(o, t + 0.8 + i * 0.16, 2400 - i * 80, 2150 - i * 80, 0.12, 0.6 - i * 0.12);
  }

  /** "kero kero" */
  private frog(pan: number, vol: number) {
    const ctx = this.s.ctx, o = this.dest(0.07 * vol, pan), t = ctx.currentTime + 0.02;
    const c = 2 + Math.floor(Math.random() * 2), f = 110 + Math.random() * 60;
    for (let i = 0; i < c; i++) {
      const tt = t + i * 0.16;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, tt);
      osc.frequency.linearRampToValueAtTime(f * 0.8, tt + 0.07);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 700;
      bp.Q.value = 4;
      osc.connect(bp).connect(this.s.env(o, tt, 1, 0.005, 0.07));
      osc.start(tt);
      osc.stop(tt + 0.1);
    }
  }

  /** furin: glass wind bells on the village eaves */
  private furin(pan: number, vol: number) {
    const o = this.dest(0.03 * vol, pan), t = this.s.ctx.currentTime + 0.02, R = Math.random;
    const base = 93 + Math.floor(R() * 4);
    const c = 1 + Math.floor(R() * 3);
    for (let i = 0; i < c; i++) this.s.chime(o, t + i * (0.18 + R() * 0.3), base + (R() < 0.5 ? 0 : 0.3), 0.8 - i * 0.2, 1.6);
  }

  /** shishi-odoshi: the bamboo pipe fills, tips, and knocks the stone */
  private shishi(pan: number, vol: number) {
    const o = this.dest(0.18 * vol, pan), t = this.s.ctx.currentTime + 0.02;
    this.s.noiseHit(o, t, { attack: 0.05, dur: 0.18, gain: 0.25, f0: 1200, f1: 2200, q: 1 }); // water pours out
    this.s.woodBlock(o, t + 0.32, 620, 0.9);
    this.s.tone(o, t + 0.32, { f0: 330, f1: 300, dur: 0.18, gain: 0.5 });
  }

  /** bamboo stalks clacking in the wind */
  private bamboo(pan: number, vol: number) {
    const o = this.dest(0.06 * vol, pan), t = this.s.ctx.currentTime + 0.02, R = Math.random;
    const c = 1 + Math.floor(R() * 3);
    for (let i = 0; i < c; i++) this.s.woodBlock(o, t + i * (0.08 + R() * 0.12), 450 + R() * 450, 0.7);
  }
}
