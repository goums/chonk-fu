// Offline-rendered buffers: computed once in plain JS when the audio starts (or the first time a
// pluck pitch is needed), then reused by every voice. No audio files: everything is synthesized here.
import { rng } from '../core/math';

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function make(ctx: BaseAudioContext, seconds: number, channels = 1) {
  return ctx.createBuffer(channels, Math.max(1, Math.round(seconds * ctx.sampleRate)), ctx.sampleRate);
}

function normalize(d: Float32Array, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
}

/** render `len + fade` samples with fill(), then crossfade the tail into the head: a seamless loop */
function loopFill(out: Float32Array, fade: number, fill: (tmp: Float32Array) => void) {
  const len = out.length;
  const tmp = new Float32Array(len + fade);
  fill(tmp);
  for (let i = 0; i < len; i++) {
    if (i < fade) {
      const u = (i / fade) * Math.PI * 0.5;
      out[i] = tmp[i] * Math.sin(u) + tmp[len + i] * Math.cos(u); // equal power (uncorrelated noise)
    } else out[i] = tmp[i];
  }
}

/** a decaying sine added into d (phasor rotation: no Math.sin per sample) */
function ping(d: Float32Array, sr: number, t0: number, f: number, amp: number, tau: number, wrap = false) {
  const n0 = Math.floor(t0 * sr), n = Math.min(Math.floor(tau * 6 * sr), wrap ? d.length : d.length - n0);
  const w = (2 * Math.PI * f) / sr, c = Math.cos(w), s = Math.sin(w), k = Math.exp(-1 / (tau * sr));
  let x = 0, y = amp, e = 1;
  for (let i = 0; i < n; i++) {
    const j = wrap ? (n0 + i) % d.length : n0 + i;
    d[j] += x * e;
    const nx = x * c + y * s;
    y = y * c - x * s;
    x = nx;
    e *= k;
  }
}

export function whiteNoise(ctx: BaseAudioContext, seconds = 2) {
  const b = make(ctx, seconds);
  const d = b.getChannelData(0), R = rng(11);
  for (let i = 0; i < d.length; i++) d[i] = R() * 2 - 1;
  return b;
}

/** soft brown-ish noise, stereo, loopable: the base of the wind and leaves */
export function windNoise(ctx: BaseAudioContext, seconds = 5) {
  const b = make(ctx, seconds, 2), sr = ctx.sampleRate;
  for (let c = 0; c < 2; c++) {
    const R = rng(21 + c);
    loopFill(b.getChannelData(c), Math.floor(sr * 0.5), (t) => {
      let br = 0, lp = 0;
      for (let i = 0; i < t.length; i++) {
        br = (br + (R() * 2 - 1) * 0.04) * 0.996;
        lp += ((R() * 2 - 1) - lp) * 0.25;
        t[i] = br * 3 + lp * 0.35;
      }
    });
    normalize(b.getChannelData(c), 0.8);
  }
  return b;
}

/** babbling brook: hissy flow plus hundreds of tiny rising bubbles, stereo, loopable */
export function waterBabble(ctx: BaseAudioContext, seconds = 5) {
  const b = make(ctx, seconds, 2), sr = ctx.sampleRate;
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c), R = rng(31 + c);
    loopFill(d, Math.floor(sr * 0.4), (t) => {
      let lp = 0, hp = 0;
      for (let i = 0; i < t.length; i++) {
        lp += ((R() * 2 - 1) - lp) * 0.3;
        hp = lp - hp * 0.6;
        t[i] = hp * 0.12 * (0.75 + 0.25 * Math.sin(i * 0.00031 + c));
      }
    });
    // bubbles: chirps rising in pitch (resonating air pockets), wrapped so the loop stays seamless
    for (let k = 0; k < 170; k++) {
      const t0 = R() * seconds, f0 = 350 + R() * R() * 1600, tau = 0.006 + R() * 0.02, amp = 0.08 + R() * 0.25;
      const n0 = Math.floor(t0 * sr), n = Math.floor(tau * 5 * sr);
      let ph = 0, e = amp;
      const kk = Math.exp(-1 / (tau * sr));
      for (let i = 0; i < n; i++) {
        const f = f0 * (1 + (i / sr) * 7);
        ph += (2 * Math.PI * f) / sr;
        d[(n0 + i) % d.length] += Math.sin(ph) * e;
        e *= kk;
      }
    }
    normalize(d, 0.8);
  }
  return b;
}

/** a field of crickets: groups of short 4-5 kHz pulses, each cricket on its own period (loopable) */
export function crickets(ctx: BaseAudioContext, seconds = 4) {
  const b = make(ctx, seconds, 2), sr = ctx.sampleRate;
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c), R = rng(41 + c);
    for (let k = 0; k < 4; k++) {
      const f = 4200 + R() * 1200, groups = 5 + Math.floor(R() * 5), period = seconds / groups;
      const off = R() * period, pulses = 3 + Math.floor(R() * 3), amp = 0.3 + R() * 0.5;
      for (let g = 0; g < groups; g++) {
        if (R() < 0.15) continue;
        for (let p = 0; p < pulses; p++) ping(d, sr, off + g * period + p * 0.032, f, amp, 0.004, true);
      }
    }
    normalize(d, 0.7);
  }
  return b;
}

/** stereo reverb impulse: decaying noise that gets darker over time (a valley / wooden hall) */
export function reverbImpulse(ctx: BaseAudioContext, seconds = 2.6) {
  const b = make(ctx, seconds, 2), sr = ctx.sampleRate;
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c), R = rng(51 + c);
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr, a = 0.5 + 0.45 * Math.min(1, t / seconds);
      lp += ((R() * 2 - 1) - lp) * (1 - a);
      d[i] = lp * Math.exp(-t * 2.6) * (t < 0.01 ? t / 0.01 : 1);
    }
    normalize(d, 0.5);
  }
  return b;
}

/** a big Chinese chau gong: inharmonic partials with beating pairs, high partials blooming late */
export function gong(ctx: BaseAudioContext, seconds = 5) {
  const b = make(ctx, seconds), sr = ctx.sampleRate, d = b.getChannelData(0);
  const f0 = 92;
  const P: [number, number, number, number][] = [
    // ratio, amp, decay, bloom
    [1, 1, 3.2, 0.002], [1.007, 0.6, 3.6, 0.002], [1.51, 0.55, 2.4, 0.05], [1.98, 0.5, 2.2, 0.12], [2.44, 0.45, 1.8, 0.25],
    [2.93, 0.4, 1.5, 0.35], [3.61, 0.32, 1.2, 0.45], [4.27, 0.25, 1.0, 0.5], [5.12, 0.18, 0.8, 0.55], [6.3, 0.12, 0.6, 0.5],
  ];
  for (const [r, amp, tau, bloom] of P) {
    const w = (2 * Math.PI * f0 * r) / sr, c = Math.cos(w), s = Math.sin(w), k = Math.exp(-1 / (tau * sr));
    const kb = Math.exp(-1 / (bloom * sr));
    let x = 0, y = amp, e = 1, b = 1;
    for (let i = 0; i < d.length; i++) {
      d[i] += x * e * (1 - b);
      b *= kb;
      const nx = x * c + y * s;
      y = y * c - x * s;
      x = nx;
      e *= k;
    }
  }
  // mallet thump
  const R = rng(61);
  let lp = 0;
  for (let i = 0; i < sr * 0.08; i++) {
    lp += ((R() * 2 - 1) - lp) * 0.08;
    d[i] += lp * 2.5 * Math.exp(-i / (sr * 0.015));
  }
  for (let i = d.length - 2000; i < d.length; i++) d[i] *= (d.length - i) / 2000;
  normalize(d, 0.85);
  return b;
}

export type PluckStyle = 'shami' | 'koto';

/**
 * Karplus-Strong string. 'shami': shamisen, short sustain, a one-sided clip in the loop (the sawari
 * buzz: the string grazing the nut), and the bachi slap on the skin baked in. 'koto': longer, rounder.
 * Returns the buffer and the playbackRate that corrects the integer delay to the exact pitch.
 */
export function pluck(ctx: BaseAudioContext, midi: number, style: PluckStyle = 'shami') {
  const sr = ctx.sampleRate, f = mtof(midi), shami = style === 'shami';
  const N = Math.max(4, Math.floor(sr / f - 0.5));
  const actual = sr / (N + 0.5);
  const t60 = shami ? Math.max(0.8, Math.min(1.6, 1.6 - (midi - 45) * 0.018)) : Math.max(1.0, Math.min(3.2, 3.2 - (midi - 45) * 0.05));
  const seconds = t60 + 0.15;
  const b = make(ctx, seconds), d = b.getChannelData(0);
  const R = rng((shami ? 1000 : 2000) + midi);
  // excitation: struck close to the bridge (bright, asymmetric triangle) plus noise, zero mean
  const p = shami ? 0.08 : 0.18;
  let mean = 0;
  for (let i = 0; i < N; i++) {
    const u = i / N, tri = u < p ? u / p : (1 - u) / (1 - p);
    d[i] = tri * 0.8 + (R() * 2 - 1) * (shami ? 0.6 : 0.3);
    mean += d[i];
  }
  mean /= N;
  for (let i = 0; i < N; i++) d[i] -= mean;
  const rho = Math.pow(0.001, 1 / (t60 * actual));
  const s = shami ? 0.62 + Math.min(0.25, (midi - 45) * 0.005) : 0.5 + Math.min(0.2, (midi - 50) * 0.005);
  // sawari: displacement beyond the nut bump is squashed, feeding high partials (gentler up high,
  // where the string passes the bump many more times per second)
  const th = 0.4, keep = 1 - 0.25 * Math.min(1, 220 / f);
  for (let i = N; i < d.length; i++) {
    let v = rho * (s * d[i - N] + (1 - s) * d[i - N - 1 < 0 ? 0 : i - N - 1]);
    if (shami && v > th) v = th + (v - th) * keep;
    d[i] = v;
  }
  normalize(d, 0.75); // level the string itself, then add the transient on top
  if (shami) {
    // bachi slap: a bright click and a short thump of the skin-covered body
    let lp = 0;
    for (let i = 0; i < Math.min(d.length, sr * 0.035); i++) {
      const t = i / sr;
      lp += ((R() * 2 - 1) - lp) * 0.5;
      d[i] += lp * 0.35 * Math.exp(-t / 0.004) + Math.sin(2 * Math.PI * 165 * t) * 0.18 * Math.exp(-t / 0.012);
    }
  } else for (let i = 0; i < Math.min(d.length, 90); i++) d[i] += (R() * 2 - 1) * 0.2 * (1 - i / 90);
  const fade = Math.floor(sr * 0.08);
  for (let i = d.length - fade; i < d.length; i++) d[i] *= (d.length - i) / fade;
  for (let i = 0; i < d.length; i++) d[i] = Math.max(-0.98, Math.min(0.98, d[i]));
  return { buffer: b, rate: f / actual };
}

/** porcelain vase: a crack, then dozens of glassy shard pings bouncing away */
export function shatter(ctx: BaseAudioContext) {
  const sr = ctx.sampleRate, b = make(ctx, 1.0), d = b.getChannelData(0), R = rng(71);
  let prev = 0;
  for (let i = 0; i < sr * 0.06; i++) {
    const w = R() * 2 - 1;
    d[i] += (w - prev) * 0.9 * Math.exp(-i / (sr * 0.012));
    prev = w;
  }
  for (let k = 0; k < 55; k++) {
    const t0 = 0.003 + R() * R() * 0.7;
    ping(d, sr, t0, 2400 + R() * 6000, (0.15 + R() * 0.4) * (1 - t0), 0.015 + R() * 0.07);
  }
  for (let k = 0; k < 7; k++) ping(d, sr, 0.08 + R() * 0.5, 1100 + R() * 900, 0.35, 0.05 + R() * 0.06);
  normalize(d, 0.9);
  return b;
}

/** rock / boulder: a low boom under a rain of gravel grains */
export function crumble(ctx: BaseAudioContext) {
  const sr = ctx.sampleRate, b = make(ctx, 1.2), d = b.getChannelData(0), R = rng(81);
  for (let k = 0; k < 90; k++) {
    const t0 = Math.pow(R(), 1.6) * 0.95, tau = 0.008 + R() * 0.035, a = (0.2 + R() * 0.8) * (1 - t0 * 0.7), cut = 0.04 + R() * 0.25;
    const n0 = Math.floor(t0 * sr), n = Math.min(Math.floor(tau * 5 * sr), d.length - n0);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += ((R() * 2 - 1) - lp) * cut;
      d[n0 + i] += lp * a * Math.exp(-i / (tau * sr)) * Math.min(1, i / (sr * 0.002));
    }
  }
  // boom with a pitch drop
  let ph = 0;
  for (let i = 0; i < sr * 0.7; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * (40 + 45 * Math.exp(-t * 8))) / sr;
    d[i] += Math.sin(ph) * 1.4 * Math.exp(-t / 0.18);
  }
  normalize(d, 0.9);
  return b;
}

/** wooden crate: snap, hollow board resonances, then splinters */
export function crack(ctx: BaseAudioContext) {
  const sr = ctx.sampleRate, b = make(ctx, 0.7), d = b.getChannelData(0), R = rng(91);
  let prev = 0;
  for (let i = 0; i < sr * 0.012; i++) {
    const w = R() * 2 - 1;
    d[i] += (w - prev) * 1.2 * (1 - i / (sr * 0.012));
    prev = w;
  }
  for (let k = 0; k < 7; k++) ping(d, sr, R() * 0.025, 260 + R() * 900, 0.5 + R() * 0.4, 0.015 + R() * 0.05);
  ping(d, sr, 0, 120, 0.9, 0.06);
  for (let k = 0; k < 16; k++) {
    const t0 = 0.03 + R() * R() * 0.4;
    ping(d, sr, t0, 1300 + R() * 3000, 0.25 * (1 - t0), 0.004 + R() * 0.008);
    ping(d, sr, t0 + 0.001, 350 + R() * 500, 0.18 * (1 - t0), 0.012);
  }
  normalize(d, 0.9);
  return b;
}
