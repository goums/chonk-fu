// Instruments built from native WebAudio nodes scheduled ahead on the AudioContext clock, plus the
// pre-rendered buffers from dsp.ts. Every one-shot builds a few nodes that free themselves when done.
import * as D from './dsp';
import { mtof } from './dsp';

export interface NoiseOpts {
  dur: number;
  gain: number;
  attack?: number;
  type?: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
}
export interface ToneOpts {
  type?: OscillatorType;
  f0: number;
  f1?: number;
  /** time of the pitch glide (defaults to dur) */
  glide?: number;
  dur: number;
  gain: number;
  attack?: number;
}

export interface PluckOpts {
  style?: D.PluckStyle;
  slideFrom?: number;
  glide?: number;
  steps?: { dt: number; midi: number; slide?: boolean }[];
  bend?: number;
  damp?: number;
}

export class Synth {
  noise!: AudioBuffer;
  wind!: AudioBuffer;
  water!: AudioBuffer;
  crickets!: AudioBuffer;
  impulse!: AudioBuffer;
  gongBuf!: AudioBuffer;
  shatterBuf!: AudioBuffer;
  crumbleBuf!: AudioBuffer;
  crackBuf!: AudioBuffer;
  private plucks = new Map<number, { buffer: AudioBuffer; rate: number }>();

  constructor(public ctx: AudioContext) {}

  /** render the shared buffers, one per task so the first key press never stalls a frame */
  async build() {
    const ctx = this.ctx;
    const steps: (() => void)[] = [
      () => (this.noise = D.whiteNoise(ctx)),
      () => (this.impulse = D.reverbImpulse(ctx)),
      () => (this.wind = D.windNoise(ctx)),
      () => (this.water = D.waterBabble(ctx)),
      () => (this.crickets = D.crickets(ctx)),
      () => (this.gongBuf = D.gong(ctx)),
      () => {
        this.shatterBuf = D.shatter(ctx);
        this.crackBuf = D.crack(ctx);
      },
      () => (this.crumbleBuf = D.crumble(ctx)),
    ];
    for (const s of steps) {
      s();
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  /** render every string of a range up front so no note is rendered mid-game */
  warm(lo: number, hi: number, style: D.PluckStyle) {
    for (let m = lo; m <= hi; m++) this.pluckBuf(m, style);
  }
  private pluckBuf(midi: number, style: D.PluckStyle) {
    const m = Math.round(Math.max(30, Math.min(100, midi)));
    const key = style === 'shami' ? m : -m;
    let p = this.plucks.get(key);
    if (!p) this.plucks.set(key, (p = D.pluck(this.ctx, m, style)));
    return p;
  }

  /** a gain node with a linear attack and an exponential decay */
  env(dest: AudioNode, t: number, peak: number, attack: number, decay: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }

  loop(buf: AudioBuffer, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    return s;
  }

  buffer(dest: AudioNode, t: number, buf: AudioBuffer, gain: number, rate = 1, lowpass = 0) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    if (lowpass > 0) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      s.connect(f).connect(g);
    } else s.connect(g);
    g.connect(dest);
    s.start(t);
  }

  noiseHit(dest: AudioNode, t: number, o: NoiseOpts) {
    const a = o.attack ?? 0.002;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + a + o.dur);
    s.connect(f).connect(this.env(dest, t, o.gain, a, o.dur));
    s.start(t, Math.random() * Math.max(0, this.noise.duration - a - o.dur - 0.05));
    s.stop(t + a + o.dur + 0.02);
  }

  tone(dest: AudioNode, t: number, o: ToneOpts) {
    const a = o.attack ?? 0.003;
    const osc = this.ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide ?? a + o.dur));
    osc.connect(this.env(dest, t, o.gain, a, o.dur));
    osc.start(t);
    osc.stop(t + a + o.dur + 0.02);
    return osc;
  }

  // ---------------------------------------------------------------- instruments
  /**
   * A plucked string (shamisen by default). Left-hand ornaments without a new bachi stroke:
   * `slideFrom` starts at another pitch and glides in (suri), `steps` changes pitch later in the
   * note (hammer-on = instant, slide = 30-80 ms glide), `bend` presses the string up at the end.
   * `damp` mutes the string after that many seconds (the next stroke stops it).
   */
  pluck(dest: AudioNode, t: number, midi: number, vel: number, o: PluckOpts = {}) {
    const p = this.pluckBuf(midi, o.style ?? 'shami');
    const s = this.ctx.createBufferSource();
    s.buffer = p.buffer;
    const r = s.playbackRate;
    const rateOf = (m: number) => p.rate * Math.pow(2, (m - Math.round(midi)) / 12);
    if (o.slideFrom !== undefined) {
      r.setValueAtTime(rateOf(o.slideFrom), t);
      r.setTargetAtTime(rateOf(midi), t + 0.01, (o.glide ?? 0.05) / 3);
    } else r.setValueAtTime(rateOf(midi), t);
    let last = t;
    for (const st of o.steps ?? []) {
      const at = t + st.dt;
      if (st.slide) r.setTargetAtTime(rateOf(st.midi), at, (o.glide ?? 0.05) / 3);
      else r.setValueAtTime(rateOf(st.midi), at);
      last = at;
    }
    if (o.bend) r.setTargetAtTime(rateOf((o.steps?.length ? o.steps[o.steps.length - 1].midi : midi) + o.bend), last + 0.15, 0.08);
    const g = this.ctx.createGain();
    g.gain.value = vel;
    s.connect(g).connect(dest);
    s.start(t);
    if (o.damp && o.damp > 0) {
      g.gain.setValueAtTime(vel, t + o.damp);
      g.gain.setTargetAtTime(0, t + o.damp, 0.015);
      s.stop(t + o.damp + 0.1);
    }
  }

  woodBlock(dest: AudioNode, t: number, f: number, vel: number) {
    this.tone(dest, t, { type: 'triangle', f0: f, f1: f * 0.94, dur: 0.07, gain: vel });
    this.tone(dest, t, { f0: f * 2.6, dur: 0.025, gain: vel * 0.35 });
    this.noiseHit(dest, t, { dur: 0.012, gain: vel * 0.5, f0: f * 3, q: 2 });
  }

  /** taiko-like big drum */
  taiko(dest: AudioNode, t: number, vel: number, f = 70) {
    this.tone(dest, t, { f0: f * 2, f1: f, glide: 0.06, dur: 0.45, gain: vel });
    this.tone(dest, t, { type: 'triangle', f0: f * 3.1, f1: f * 2.2, dur: 0.09, gain: vel * 0.25 });
    this.noiseHit(dest, t, { type: 'lowpass', dur: 0.06, gain: vel * 0.45, f0: 900, f1: 200 });
  }

  /** small high drum (bangu / tanggu) */
  drum(dest: AudioNode, t: number, vel: number) {
    this.tone(dest, t, { type: 'triangle', f0: 340, f1: 250, dur: 0.1, gain: vel * 0.7 });
    this.noiseHit(dest, t, { dur: 0.05, gain: vel * 0.5, f0: 2600, q: 1.5 });
  }

  /** kane: the small festival gong struck with a horn, a bright "chang" */
  kane(dest: AudioNode, t: number, vel: number) {
    this.tone(dest, t, { f0: 1180, dur: 0.32, gain: vel * 0.6 });
    this.tone(dest, t, { f0: 2630, dur: 0.18, gain: vel * 0.35 });
    this.tone(dest, t, { f0: 4510, dur: 0.08, gain: vel * 0.25 });
    this.noiseHit(dest, t, { type: 'highpass', dur: 0.03, gain: vel * 0.4, f0: 3000 });
  }

  /** hyoshigi: two hardwood clappers */
  clap(dest: AudioNode, t: number, vel: number) {
    this.woodBlock(dest, t, 1650, vel);
    this.noiseHit(dest, t, { dur: 0.02, gain: vel * 0.6, f0: 3200, q: 3 });
  }

  /** bo: small hand cymbals */
  cymbal(dest: AudioNode, t: number, vel: number, dur = 1.1) {
    this.noiseHit(dest, t, { type: 'highpass', dur, gain: vel * 0.5, f0: 5000, f1: 7000, q: 0.5 });
    this.noiseHit(dest, t, { dur: dur * 0.6, gain: vel * 0.35, f0: 3400, q: 6 });
    this.tone(dest, t, { type: 'square', f0: 587, dur: dur * 0.4, gain: vel * 0.03 });
    this.tone(dest, t, { type: 'square', f0: 829, dur: dur * 0.35, gain: vel * 0.025 });
  }

  gong(dest: AudioNode, t: number, vel: number, rate = 1) {
    this.buffer(dest, t, this.gongBuf, vel, rate);
  }

  /** bianzhong bronze bell: two strike tones a minor third apart and a bright transient */
  bell(dest: AudioNode, t: number, midi: number, vel: number, dur = 2.6) {
    const f = mtof(midi);
    this.tone(dest, t, { f0: f, dur, gain: vel });
    this.tone(dest, t, { f0: f * 1.19, dur: dur * 0.7, gain: vel * 0.45 });
    this.tone(dest, t, { f0: f * 2.92, dur: dur * 0.25, gain: vel * 0.3 });
    this.tone(dest, t, { f0: f * 5.4, dur: 0.12, gain: vel * 0.2 });
  }

  /** glassy chime (jade, wind chimes) */
  chime(dest: AudioNode, t: number, midi: number, vel: number, dur = 1.2) {
    const f = mtof(midi);
    this.tone(dest, t, { f0: f, dur, gain: vel });
    this.tone(dest, t, { f0: f * 2.76, dur: dur * 0.45, gain: vel * 0.4 });
    this.tone(dest, t, { f0: f * 5.4, dur: dur * 0.2, gain: vel * 0.2 });
  }

  /** sheng-like reedy pad: detuned saws through a lowpass, slow swell */
  pad(dest: AudioNode, t: number, midis: number[], dur: number, vel: number, cutoff = 1100) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.Q.value = 0.4;
    const g = ctx.createGain();
    const a = Math.min(1.4, dur * 0.35), rel = 1.6;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + a);
    g.gain.setValueAtTime(vel, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + rel);
    f.connect(g).connect(dest);
    for (const m of midis) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 1 / (midis.length * 2);
        o.connect(og).connect(f);
        o.start(t);
        o.stop(t + dur + rel + 0.05);
      }
    }
  }

  /** one-shot dizi note (stings) */
  flute(dest: AudioNode, t: number, midi: number, dur: number, vel: number) {
    const ctx = this.ctx, f = mtof(midi);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.03);
    amp.gain.setValueAtTime(vel, t + dur * 0.85);
    amp.gain.linearRampToValueAtTime(0, t + dur + 0.08);
    amp.connect(dest);
    const lfo = ctx.createOscillator(), vib = ctx.createGain();
    lfo.frequency.value = 5.8;
    vib.gain.setValueAtTime(0, t);
    vib.gain.linearRampToValueAtTime(dur > 0.3 ? 22 : 4, t + Math.min(0.3, dur));
    lfo.connect(vib);
    for (const [type, g] of [['triangle', 0.7], ['sine', 0.5]] as [OscillatorType, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f * 0.97, t);
      o.frequency.setTargetAtTime(f, t, 0.02);
      vib.connect(o.detune);
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(amp);
      o.start(t);
      o.stop(t + dur + 0.12);
    }
    lfo.start(t);
    lfo.stop(t + dur + 0.12);
    this.noiseHit(dest, t, { dur: Math.min(0.12, dur), gain: vel * 0.25, f0: 2600, q: 0.8 });
  }
}

/**
 * A persistent mono flute: 'shaku' (shakuhachi: dark, very breathy, meri scoops from below, slow
 * vibrato) or 'fue' (shinobue: bright festival flute). Its oscillators run for the whole section and
 * each note only automates pitch, loudness and vibrato, so legato slides come for free.
 */
export class Lead {
  private oscs: OscillatorNode[] = [];
  private lfo: OscillatorNode;
  private vib: GainNode;
  private amp: GainNode;
  private breath: AudioBufferSourceNode;
  private breathAmp: GainNode;
  private breathF: BiquadFilterNode;
  private filt: BiquadFilterNode;

  constructor(s: Synth, dest: AudioNode, public kind: 'shaku' | 'fue', t0: number) {
    const ctx = s.ctx;
    const shaku = kind === 'shaku';
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.amp.connect(dest);
    this.filt = ctx.createBiquadFilter();
    this.filt.type = 'lowpass';
    this.filt.frequency.value = shaku ? 1600 : 4200;
    this.filt.Q.value = 0.6;
    this.filt.connect(this.amp);
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = shaku ? 4.6 : 6.2;
    this.vib = ctx.createGain();
    this.vib.gain.value = 0;
    this.lfo.connect(this.vib);
    const parts: [OscillatorType, number][] = shaku ? [['sine', 0.8], ['triangle', 0.35]] : [['triangle', 0.7], ['sine', 0.45]];
    for (const [type, g] of parts) {
      const o = ctx.createOscillator();
      o.type = type;
      this.vib.connect(o.detune);
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.filt);
      o.start(t0);
      this.oscs.push(o);
    }
    this.breath = s.loop(s.noise);
    this.breathF = ctx.createBiquadFilter();
    this.breathF.type = 'bandpass';
    this.breathF.frequency.value = shaku ? 900 : 2600;
    this.breathF.Q.value = shaku ? 2.5 : 0.9;
    this.breathAmp = ctx.createGain();
    this.breathAmp.gain.value = 0;
    this.breath.connect(this.breathF).connect(this.breathAmp).connect(dest);
    this.breath.start(t0);
    this.lfo.start(t0);
  }

  /** slideIn: glide from the previous pitch; holdOut: keep sounding into the next (legato) note */
  note(t: number, midi: number, dur: number, vel: number, slideIn = false, holdOut = false) {
    const f = mtof(midi), shaku = this.kind === 'shaku';
    // shakuhachi long notes often start "meri" (a semitone flat) and lift into pitch
    const meri = shaku && !slideIn && dur > 0.6 && Math.random() < 0.45;
    for (const o of this.oscs) {
      if (slideIn) o.frequency.setTargetAtTime(f, t, shaku ? 0.05 : 0.02);
      else {
        o.frequency.setValueAtTime(f * (meri ? 0.944 : 0.975), t);
        o.frequency.setTargetAtTime(f, t + (meri ? 0.08 : 0), meri ? 0.09 : 0.02);
      }
    }
    this.filt.frequency.setTargetAtTime(Math.min(9000, f * (shaku ? 2.2 : 3.5)), t, 0.03);
    this.breathF.frequency.setTargetAtTime(Math.min(6000, f * (shaku ? 2 : 4)), t, 0.03);
    this.amp.gain.setTargetAtTime(vel, t, slideIn ? 0.04 : shaku ? 0.06 : 0.02);
    const bv = vel * (shaku ? 0.5 : 0.16);
    if (!slideIn) {
      // muraiki: the burst of air at the attack, then a steady breathy halo
      this.breathAmp.gain.setTargetAtTime(bv * (shaku ? 1.6 : 2), t, 0.012);
      this.breathAmp.gain.setTargetAtTime(bv * 0.4, t + 0.08, 0.12);
    }
    const depth = shaku ? 22 : 16;
    if (dur > 0.35) {
      this.vib.gain.setTargetAtTime(0, t, 0.02);
      this.vib.gain.setTargetAtTime(depth, t + Math.min(shaku ? 0.5 : 0.3, dur * 0.45), 0.15);
    } else this.vib.gain.setTargetAtTime(depth * 0.2, t, 0.05);
    if (!holdOut) {
      const end = t + dur * 0.92;
      this.amp.gain.setTargetAtTime(0, end, shaku ? 0.09 : 0.045);
      this.breathAmp.gain.setTargetAtTime(0, end, shaku ? 0.1 : 0.04);
    }
  }

  stop(t: number) {
    for (const o of this.oscs) o.stop(t);
    this.lfo.stop(t);
    this.breath.stop(t);
  }
}
