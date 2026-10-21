// Procedural animation for Le Chonk's rig: every frame we compute a target pose from the movement state
// and the current move (punch, kick, belly bump...), then ease each joint toward it. Cheap, smooth, and
// deterministic (driven by sim time only).
import { clamp, damp } from '../core/math';
import type { ChonkRig } from './model';

export type MoveName = 'jab' | 'cross' | 'kick' | 'belly' | 'slam';

export interface AnimInput {
  t: number; // sim time (s)
  speed: number; // horizontal speed (m/s)
  grounded: boolean;
  vy: number;
  move: MoveName | null;
  moveT: number; // 0..1 progress through the move
  hurtT: number; // seconds since last hit (Infinity if none)
  ko: boolean;
  angry: boolean;
}

/** joint angles (radians) */
interface Pose {
  hipsY: number; hipsX: number; hipsYaw: number; hipsRoll: number;
  bodyX: number; bodyYaw: number; bodyRoll: number;
  headX: number; headYaw: number; headRoll: number;
  shLX: number; shLZ: number; shLY: number; elL: number;
  shRX: number; shRZ: number; shRY: number; elR: number;
  legLX: number; legLZ: number; knL: number;
  legRX: number; legRZ: number; knR: number;
  tail: number; tailSide: number;
  squash: number; brow: number;
}

const zero = (): Pose => ({
  hipsY: 0, hipsX: 0, hipsYaw: 0, hipsRoll: 0, bodyX: 0, bodyYaw: 0, bodyRoll: 0, headX: 0, headYaw: 0, headRoll: 0,
  shLX: 0, shLZ: 0, shLY: 0, elL: 0, shRX: 0, shRZ: 0, shRY: 0, elR: 0,
  legLX: 0, legLZ: 0, knL: 0, legRX: 0, legRZ: 0, knR: 0, tail: 0, tailSide: 0, squash: 1, brow: 0,
});

/** keyframe helper: piecewise-linear eased curve through (t, value) points */
function curve(t: number, keys: [number, number][]) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      let u = (t - t0) / (t1 - t0);
      u = u * u * (3 - 2 * u);
      return v0 + (v1 - v0) * u;
    }
  }
  return keys[keys.length - 1][1];
}

/** strike windows: the fraction of each move during which the hit can land */
export const MOVES: Record<MoveName, { duration: number; hit: [number, number]; reach: number; damage: number; knock: number; arc: number }> = {
  jab: { duration: 0.32, hit: [0.25, 0.5], reach: 1.5, damage: 8, knock: 3, arc: 1.0 },
  cross: { duration: 0.4, hit: [0.3, 0.55], reach: 1.6, damage: 11, knock: 5, arc: 1.0 },
  kick: { duration: 0.55, hit: [0.3, 0.6], reach: 1.9, damage: 15, knock: 7, arc: 2.2 },
  belly: { duration: 0.85, hit: [0.42, 0.62], reach: 2.4, damage: 22, knock: 13, arc: 3.2 },
  slam: { duration: 0.5, hit: [0.0, 0.25], reach: 3.2, damage: 18, knock: 9, arc: Math.PI * 2 },
};

export class Animator {
  private cur = zero();
  private phase = 0;

  private browY: number;
  constructor(private rig: ChonkRig) {
    this.browY = rig.browL.position.y;
  }

  update(inp: AnimInput, dt: number) {
    const P = zero();
    const run = clamp(inp.speed / 5, 0, 1.2);
    // gait phase advances with distance travelled
    this.phase += dt * (inp.speed > 0.2 ? 2.2 + inp.speed * 1.05 : 0) * Math.PI;
    const ph = this.phase;

    // idle: breathing belly, little sway, tail swish
    const breathe = Math.sin(inp.t * 2.2);
    P.squash = 1 + breathe * 0.015;
    P.shLZ = 0.28 + breathe * 0.03; P.shRZ = -0.28 - breathe * 0.03;
    P.elL = -0.25; P.elR = -0.25;
    P.tail = 0.25 + Math.sin(inp.t * 1.7) * 0.1;
    P.tailSide = Math.sin(inp.t * 1.3) * 0.35;
    P.headX = Math.sin(inp.t * 1.1) * 0.03;
    P.brow = inp.angry ? 1 : 0;

    if (inp.grounded && inp.speed > 0.2) {
      // waddle: big belly bounce, swinging arms, short fast steps
      const s = Math.sin(ph), c = Math.cos(ph);
      const amp = 0.45 + run * 0.4;
      P.legLX = s * amp; P.legRX = -s * amp;
      P.knL = Math.max(0, -c) * (0.6 + run * 0.6); P.knR = Math.max(0, c) * (0.6 + run * 0.6);
      P.hipsY = Math.abs(c) * 0.05 * (0.5 + run);
      P.hipsRoll = s * 0.07;
      P.hipsYaw = s * 0.12;
      P.bodyX = 0.08 + run * 0.18;
      P.bodyRoll = -s * 0.05;
      P.squash = 1 - Math.abs(c) * 0.04 * run;
      P.shLX = -s * (0.5 + run * 0.6); P.shRX = s * (0.5 + run * 0.6);
      P.elL = -0.4 - run * 0.7; P.elR = -0.4 - run * 0.7;
      P.headX = -0.06 - run * 0.1 + Math.abs(c) * 0.04;
      P.tail = 0.5 + run * 0.4;
      P.tailSide = s * 0.4;
    }

    if (!inp.grounded) {
      // jump / fall: tuck the legs, arms up and out
      const rising = inp.vy > 0;
      P.legLX = rising ? 0.7 : 0.3; P.legRX = rising ? 0.2 : 0.3;
      P.knL = rising ? 1.2 : 0.5; P.knR = rising ? 0.5 : 0.5;
      P.shLZ = 1.2; P.shRZ = -1.2; P.shLX = -0.3; P.shRX = -0.3;
      P.elL = -0.5; P.elR = -0.5;
      P.squash = rising ? 1.05 : 0.98;
      P.tail = 1.2;
    }

    if (inp.move) this.applyMove(P, inp.move, inp.moveT);

    if (inp.hurtT < 0.35) {
      const k = 1 - inp.hurtT / 0.35;
      P.bodyX -= 0.35 * k; P.headX -= 0.3 * k;
      P.shLZ += 0.6 * k; P.shRZ -= 0.6 * k;
      P.brow = 2;
    }
    if (inp.ko) {
      P.hipsY = -0.32; P.hipsX = -1.35; P.bodyX = -0.1; P.headX = 0.2; P.headRoll = 0.3;
      P.shLZ = 1.4; P.shRZ = -1.4; P.legLX = -1.2; P.legRX = -1.4; P.knL = 0.2; P.knR = 0.1;
      P.tail = -0.2; P.brow = 2;
    }

    this.apply(P, dt, inp.move ? 26 : 14);
  }

  private applyMove(P: Pose, move: MoveName, u: number) {
    switch (move) {
      case 'jab': {
        // quick left straight: twist, extend the left arm
        const e = curve(u, [[0, 0], [0.2, -0.3], [0.38, 1], [0.7, 1], [1, 0]]);
        P.bodyYaw = -0.35 * e; P.hipsYaw = -0.15 * e;
        P.shLX = -1.5 * Math.max(0, e) + 0.3 * Math.min(0, e); P.shLZ = 0.15; P.elL = -0.1 - 0.9 * (1 - Math.abs(e));
        P.shLY = 0.3 * e;
        P.shRX = -0.9; P.elR = -1.7; P.shRZ = -0.2; // guard
        P.legLX = -0.3; P.legRX = 0.3; P.knR = 0.2;
        P.headYaw = 0.2 * e;
        P.brow = 1;
        break;
      }
      case 'cross': {
        const e = curve(u, [[0, 0], [0.25, -0.4], [0.45, 1], [0.75, 1], [1, 0]]);
        P.bodyYaw = 0.5 * e; P.hipsYaw = 0.25 * e;
        P.shRX = -1.55 * Math.max(0, e) + 0.3 * Math.min(0, e); P.shRZ = -0.15; P.elR = -0.1 - 0.9 * (1 - Math.abs(e));
        P.shRY = -0.3 * e;
        P.shLX = -0.9; P.elL = -1.7; P.shLZ = 0.2;
        P.legLX = -0.4; P.legRX = 0.4; P.knL = 0.3;
        P.bodyX = 0.15 * e;
        P.headYaw = -0.25 * e;
        P.brow = 1;
        break;
      }
      case 'kick': {
        // roundhouse with the right leg: lean away, leg sweeps out to the side and around
        const lift = curve(u, [[0, 0], [0.25, 0.7], [0.45, 1], [0.7, 1], [1, 0]]);
        const sweep = curve(u, [[0, -0.6], [0.3, -0.6], [0.55, 0.5], [0.75, 0.7], [1, 0]]);
        P.legRZ = -1.45 * lift; P.legRX = -0.4 * lift; P.knR = 0.9 * (1 - lift) * lift * 4 * 0.5;
        P.hipsYaw = sweep; P.bodyYaw = sweep * 0.4;
        P.hipsRoll = 0.45 * lift; P.bodyRoll = 0.2 * lift;
        P.hipsY = 0.05 * lift;
        P.legLX = 0.1; P.knL = 0.25 * lift;
        P.shLZ = 1.1 * lift + 0.3; P.shRZ = -0.8 * lift - 0.3; P.elL = -0.6; P.elR = -0.6;
        P.tail = 0.9; P.tailSide = -0.8 * lift;
        P.brow = 1;
        break;
      }
      case 'belly': {
        // the signature move: lean back, then BOING the belly forward with a hop
        const back = curve(u, [[0, 0], [0.35, 1], [0.45, -0.2], [0.65, -0.35], [1, 0]]);
        const hop = curve(u, [[0, 0], [0.38, 0], [0.48, 0.25], [0.6, 0.05], [1, 0]]);
        P.bodyX = -0.55 * back; P.hipsX = -0.25 * back;
        P.hipsY = hop;
        P.squash = 1 + 0.12 * Math.max(0, -back) * 2 - 0.05 * Math.max(0, back);
        P.shLX = 0.6 * back; P.shRX = 0.6 * back; P.shLZ = 0.9 + 0.4 * back; P.shRZ = -0.9 - 0.4 * back;
        P.elL = -0.3; P.elR = -0.3;
        P.legLX = -0.2 * back; P.legRX = -0.2 * back; P.knL = 0.4 * Math.max(0, back); P.knR = 0.4 * Math.max(0, back);
        P.headX = 0.25 * back;
        P.tail = 1.3;
        P.brow = 1;
        break;
      }
      case 'slam': {
        // landing ground pound: squash flat, fists down
        const k = curve(u, [[0, 1], [0.3, 1], [1, 0]]);
        P.squash = 1 - 0.18 * k;
        P.hipsY = -0.12 * k;
        P.shLX = -1.2 * k; P.shRX = -1.2 * k; P.shLZ = 0.6 * k; P.shRZ = -0.6 * k; P.elL = -0.2; P.elR = -0.2;
        P.knL = 0.8 * k; P.knR = 0.8 * k; P.legLX = -0.6 * k; P.legRX = -0.6 * k; P.legLZ = 0.3 * k; P.legRZ = -0.3 * k;
        P.brow = 1;
        break;
      }
    }
  }

  private apply(P: Pose, dt: number, lambda: number) {
    const c = this.cur as unknown as Record<string, number>;
    const p = P as unknown as Record<string, number>;
    for (const k in p) c[k] = damp(c[k], p[k], lambda, dt);
    const r = this.rig, C = this.cur;
    r.hips.position.y = r.hipBase + C.hipsY;
    r.hips.rotation.set(C.hipsX, C.hipsYaw, C.hipsRoll, 'YXZ');
    r.body.rotation.set(C.bodyX, C.bodyYaw, C.bodyRoll, 'YXZ');
    r.body.scale.set(1 + (1 - C.squash) * 0.6, C.squash, 1 + (1 - C.squash) * 0.6);
    r.head.rotation.set(C.headX, C.headYaw, C.headRoll, 'YXZ');
    r.shoulderL.rotation.set(C.shLX, C.shLY, C.shLZ, 'XYZ');
    r.shoulderR.rotation.set(C.shRX, C.shRY, C.shRZ, 'XYZ');
    r.elbowL.rotation.x = C.elL;
    r.elbowR.rotation.x = C.elR;
    r.legL.rotation.set(-C.legLX, 0, C.legLZ);
    r.legR.rotation.set(-C.legRX, 0, C.legRZ);
    r.kneeL.rotation.x = C.knL;
    r.kneeR.rotation.x = C.knR;
    r.tail[0].rotation.x = -1.1 + C.tail * 0.5;
    for (let i = 1; i < r.tail.length; i++) {
      r.tail[i].rotation.x = -0.12 * C.tail;
      r.tail[i].rotation.z = C.tailSide * 0.18;
    }
    // eyebrows: 0 calm, 1 determined (angled), 2 ouch
    const b = C.brow;
    r.browL.rotation.z = -0.35 * Math.min(b, 1) + (b > 1 ? 0.6 * (b - 1) : 0);
    r.browR.rotation.z = 0.35 * Math.min(b, 1) - (b > 1 ? 0.6 * (b - 1) : 0);
    r.browL.position.y = r.browR.position.y = this.browY - 0.02 * Math.min(b, 1);
    r.mouth.scale.set(1, b > 1.5 ? -1.5 : 1, 1);
  }
}
