// The cast, as sculpt definitions: Le Chonk (hero), Overfit the tiger, wolf bandits, Master Tortue,
// Papa Canard the noodle chef, and the pig and bunny villagers.
import * as THREE from 'three';
import { buildCreature, type CreatureDef } from './creature';
import type { ChonkRig } from './model';
import { FUR } from './model';

const ang = (p: THREE.Vector3) => Math.atan2(p.x, p.z); // 0 = front

// ---------------------------------------------------------------- Le Chonk
const CHONK: CreatureDef = {
  name: 'chonk', hip: 0.5, neck: [0, 0.68, 0.02], shoulder: [0.45, 0.42, 0.02],
  upperArm: 0.33, foreArm: 0.28, armR: [0.125, 0.11, 0.13],
  legX: 0.25, thigh: 0.2, legR: [0.17, 0.15], foot: [0.14, 0.08, 0.2], footColor: FUR.orange,
  armColor: (p) => (Math.sin(Math.abs(p.x) * 34) > 0.75 && Math.abs(p.x) > 0.62 ? FUR.stripe : FUR.orange),
  pawColor: FUR.cream,
  legColor: (p) => (p.y > 0.14 ? FUR.pants : p.y > 0.11 ? FUR.pantsLight : FUR.orange),
  tail: { at: [0, -0.06, -0.46], segments: 6, r: 0.078, taper: 0.3, colors: [FUR.orange, FUR.stripe] },
  cloth: [FUR.pants, FUR.pantsLight, FUR.sash],
  shells: 10, furLen: 0.03, cell: 0.018,
  sculpt: ({ W, E, C, h }) => {
    const body = (p: THREE.Vector3) => {
      const a = ang(p);
      if (p.y < 0.47) return FUR.pants;
      if (p.y < 0.56) return FUR.sash;
      if (Math.abs(a) < 0.95 - (p.y > 1.0 ? (p.y - 1.0) * 2.5 : 0) && p.y < 1.12) return FUR.cream;
      if (Math.abs(a) > 1.7 && Math.sin(p.y * 30 + Math.sin(a * 4) * 0.8) > 0.55) return FUR.stripe;
      return FUR.orange;
    };
    const head = (p: THREE.Vector3) => {
      const hx = p.x, hy = p.y - W.head.y, hz = p.z - W.head.z;
      if (hz > 0.13 && hy > 0.36 && hy < 0.6) for (const sx of [-0.09, 0, 0.09]) if (Math.abs(hx - sx - Math.sin(hy * 20) * 0.01) < 0.022) return FUR.stripe;
      if (hz < -0.12 && Math.sin(hx * 26) > 0.6 && hy > 0.15) return FUR.stripe;
      if (Math.abs(hx) > 0.27 && hz > -0.07 && (Math.abs(hy - 0.2) < 0.02 || Math.abs(hy - 0.27) < 0.02)) return FUR.stripe;
      if (hz > 0.16 && hy < 0.2 && Math.abs(hx) < 0.24) return FUR.cream;
      return FUR.orange;
    };
    const ear = (p: THREE.Vector3) => (p.z - W.head.z > 0.02 && Math.abs(Math.abs(p.x) - 0.29) < 0.06 && p.y < W.head.y + 0.72 ? FUR.pink : FUR.orange);
    E('hips', [0, 0.43, -0.02], [0.46, 0.22, 0.42], body, 0.1);
    E('body', [0, 0.66, 0.03], [0.57, 0.46, 0.52], body, 0.16);
    E('body', [0, 0.98, -0.01], [0.43, 0.3, 0.38], body, 0.14);
    E('head', h(0, 0.3, 0), [0.41, 0.35, 0.37], head, 0.12);
    for (const s of [-1, 1]) {
      E('head', h(s * 0.27, 0.17, 0.08), [0.18, 0.15, 0.16], head, 0.08);
      C('head', h(s * 0.38, 0.18, 0.02), h(s * 0.56, 0.12, -0.02), 0.075, 0.012, FUR.orange, 0.05);
      C('head', h(s * 0.37, 0.09, 0.03), h(s * 0.5, 0.0, 0.0), 0.06, 0.01, FUR.orange, 0.05);
      E('head', h(s * 0.085, 0.15, 0.31), [0.11, 0.085, 0.085], FUR.cream, 0.05);
      C('head', h(s * 0.25, 0.55, -0.02), h(s * 0.34, 0.83, -0.04), 0.13, 0.015, ear, 0.07);
    }
    E('head', h(0, 0.06, 0.28), [0.085, 0.06, 0.07], FUR.cream, 0.05);
  },
  face: {
    eyeSep: 0.16, eyeY: 0.36, eyeZ: 0.28, eyeR: 0.118, iris: FUR.eye, slit: true,
    browY: 0.52, browZ: 0.31, brow: 0x6a2c0c, nose: { y: 0.235, z: 0.39, r: 0.05, color: 0xe9818a },
    mouthY: 0.11, mouthZ: 0.385, whiskers: 0.4,
  },
  extras: (B) => {
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 12, 40), new THREE.MeshStandardMaterial({ color: FUR.collar, roughness: 0.5 }));
    collar.position.set(0, 0.62, 0.03);
    collar.rotation.x = Math.PI / 2 - 0.12;
    collar.castShadow = true;
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 14), new THREE.MeshStandardMaterial({ color: 0xf7c843, metalness: 0.85, roughness: 0.25 }));
    bell.position.set(0, 0.55, 0.34);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), new THREE.MeshStandardMaterial({ color: FUR.sash, roughness: 0.7 }));
    knot.position.set(0.22, 0.03, 0.5);
    knot.scale.set(1, 0.8, 0.7);
    B.body.add(collar, bell, knot);
  },
};

// ---------------------------------------------------------------- Overfit the tiger
const T = { orange: 0xf0861f, white: 0xfff4e2, black: 0x1f1a1a, pants: 0x2e2a3a, pantsL: 0x45405a, sash: 0x8e2bb0 };
const TIGER: CreatureDef = {
  name: 'tiger', hip: 0.95, neck: [0, 0.95, 0.04], shoulder: [0.52, 0.78, 0],
  upperArm: 0.42, foreArm: 0.38, armR: [0.15, 0.13, 0.15],
  legX: 0.21, thigh: 0.4, legR: [0.17, 0.14], foot: [0.13, 0.08, 0.22], footColor: T.orange,
  armColor: (p) => (Math.sin(Math.hypot(p.x, p.y) * 28) > 0.72 ? T.black : T.orange),
  pawColor: T.white,
  legColor: (p) => (p.y > 0.2 ? T.pants : p.y > 0.16 ? T.pantsL : T.orange),
  tail: { at: [0, 0.02, -0.26], segments: 9, r: 0.065, taper: 0.2, colors: [T.orange, T.black], droop: 0.9 },
  cloth: [T.pants, T.pantsL, T.sash], shells: 8, furLen: 0.025,
  sculpt: ({ W, E, C, h }) => {
    const hip = W.hips.y;
    const torso = (p: THREE.Vector3) => {
      const a = ang(p), y = p.y - hip;
      if (y < 0.12) return T.pants;
      if (y < 0.2) return T.sash;
      if (Math.abs(a) < 0.6 && y < 0.82) return T.white;
      if (Math.sin(a * 6 + y * 3) > 0.62 && Math.abs(a) > 0.75) return T.black;
      return T.orange;
    };
    const head = (p: THREE.Vector3) => {
      const hx = p.x, hy = p.y - W.head.y, hz = p.z - W.head.z;
      if (hz > 0.14 && hy < 0.2 && Math.abs(hx) < 0.2) return T.white;
      if (hz > 0.1 && hy > 0.36 && Math.abs(Math.abs(hx) - 0.07) < 0.02) return T.black;
      if (Math.abs(hx) > 0.2 && Math.sin(hy * 40) > 0.7) return T.black;
      if (hz < -0.1 && Math.sin(hx * 30) > 0.65) return T.black;
      return T.orange;
    };
    E('hips', [0, hip, -0.02], [0.3, 0.2, 0.26], torso, 0.08);
    E('body', [0, hip + 0.28, 0], [0.31, 0.26, 0.26], torso, 0.14);
    E('body', [0, hip + 0.66, 0.02], [0.55, 0.36, 0.37], torso, 0.18);
    E('body', [0, hip + 0.86, -0.04], [0.42, 0.18, 0.3], torso, 0.12);
    E('head', h(0, 0.27, 0), [0.34, 0.31, 0.32], head, 0.1);
    E('head', h(0, 0.4, 0.2), [0.25, 0.07, 0.1], head, 0.06);
    for (const s of [-1, 1]) {
      E('head', h(s * 0.08, 0.15, 0.26), [0.11, 0.09, 0.09], T.white, 0.05);
      C('head', h(s * 0.28, 0.15, 0.02), h(s * 0.52, 0.05, -0.02), 0.1, 0.015, T.white, 0.05);
      C('head', h(s * 0.22, 0.5, -0.03), h(s * 0.27, 0.64, -0.05), 0.1, 0.045, (p) => (p.z - W.head.z < -0.05 ? T.black : T.orange), 0.05);
    }
    E('head', h(0, 0.06, 0.22), [0.09, 0.06, 0.07], T.white, 0.04);
  },
  face: {
    eyeSep: 0.13, eyeY: 0.32, eyeZ: 0.25, eyeR: 0.075, iris: 0xffc21f, slit: true,
    browY: 0.42, browZ: 0.3, brow: 0x1a1414, browW: 0.11, nose: { y: 0.2, z: 0.35, r: 0.05, color: 0xb85a50 },
    mouthY: 0.09, mouthZ: 0.31, mouthR: 0.05, whiskers: 0.35,
  },
  extras: (B) => {
    const padMat = new THREE.MeshStandardMaterial({ color: 0x3a3550, roughness: 0.5, metalness: 0.3 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe8b83a, roughness: 0.3, metalness: 0.8 });
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 10), padMat);
      pad.position.set(s * 0.5, 0.86, 0);
      pad.scale.set(1.2, 0.7, 1.1);
      pad.castShadow = true;
      for (let k = 0; k < 3; k++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 8), gold);
        spike.position.set((k - 1) * 0.1, 0.2, 0);
        pad.add(spike);
      }
      B.body.add(pad);
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.07, 6), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      fang.position.set(s * 0.04, 0.07, 0.3);
      fang.rotation.x = Math.PI;
      B.head.add(fang);
    }
  },
};

// ---------------------------------------------------------------- wolf bandit
const Wf = { grey: 0x8a909c, light: 0xd9dde3, dark: 0x5c616c, vest: 0x5a3f2a, pants: 0x4a3626, band: 0xc0392b };
const WOLF: CreatureDef = {
  name: 'wolf', hip: 0.72, neck: [0, 0.78, 0.06], shoulder: [0.37, 0.62, 0],
  upperArm: 0.34, foreArm: 0.31, armR: [0.1, 0.09, 0.11],
  legX: 0.16, thigh: 0.3, legR: [0.13, 0.11], foot: [0.1, 0.06, 0.18], footColor: Wf.dark,
  armColor: Wf.grey, pawColor: Wf.dark,
  legColor: (p) => (p.y > 0.12 ? Wf.pants : Wf.grey),
  tail: { at: [0, 0.02, -0.22], segments: 5, r: 0.085, taper: -0.4, colors: [Wf.grey, Wf.grey, Wf.grey, Wf.light, Wf.light], droop: 0.6 },
  cloth: [Wf.vest, Wf.pants, Wf.band], shells: 6, furLen: 0.03,
  sculpt: ({ W, E, C, h }) => {
    const hip = W.hips.y;
    const torso = (p: THREE.Vector3) => {
      const a = ang(p), y = p.y - hip;
      if (y < 0.1) return Wf.pants;
      if (y > 0.68) return Wf.band;
      if (Math.abs(a) > 0.55 && y < 0.62) return Wf.vest;
      return Math.abs(a) < 0.55 ? Wf.light : Wf.grey;
    };
    const head = (p: THREE.Vector3) => (p.z - W.head.z > 0.12 && p.y - W.head.y < 0.17 ? Wf.light : Wf.grey);
    E('hips', [0, hip, -0.02], [0.26, 0.18, 0.22], torso, 0.08);
    E('body', [0, hip + 0.25, 0], [0.26, 0.22, 0.22], torso, 0.12);
    E('body', [0, hip + 0.55, 0.02], [0.38, 0.28, 0.3], torso, 0.14);
    E('head', h(0, 0.22, -0.02), [0.26, 0.24, 0.25], head, 0.1);
    C('head', h(0, 0.16, 0.12), h(0, 0.12, 0.42), 0.12, 0.06, head, 0.08);
    for (const s of [-1, 1]) {
      C('head', h(s * 0.15, 0.4, -0.05), h(s * 0.2, 0.64, -0.07), 0.085, 0.01, Wf.grey, 0.04);
      C('head', h(s * 0.22, 0.14, -0.02), h(s * 0.38, 0.06, -0.06), 0.08, 0.01, Wf.light, 0.04);
    }
  },
  face: {
    eyeSep: 0.1, eyeY: 0.28, eyeZ: 0.18, eyeR: 0.06, iris: 0xf2e14a, eyeYaw: 0.35,
    browY: 0.35, browZ: 0.22, brow: 0x2b2b30, nose: { y: 0.14, z: 0.47, r: 0.045, color: 0x1a1a1a },
    mouthY: 0.06, mouthZ: 0.36,
  },
};

// ---------------------------------------------------------------- Master Tortue
const Tt = { skin: 0x9cc47a, plastron: 0xe8dca0, shellA: 0x6b8a3a, shellB: 0x56722d, rim: 0xc9a060, beard: 0xf4f0e8, sash: 0xd9b24a };
const TORTOISE: CreatureDef = {
  name: 'tortoise', hip: 0.42, neck: [0, 0.6, 0.14], shoulder: [0.36, 0.45, 0.05],
  upperArm: 0.25, foreArm: 0.22, armR: [0.08, 0.075, 0.09],
  legX: 0.2, thigh: 0.17, legR: [0.11, 0.1], foot: [0.11, 0.06, 0.14], footColor: Tt.skin,
  armColor: Tt.skin, pawColor: Tt.skin, legColor: Tt.skin,
  cloth: [Tt.skin, Tt.plastron, Tt.shellA, Tt.shellB, Tt.rim, Tt.beard, Tt.sash], shells: 0, furLen: 0, sheen: 0.3,
  sculpt: ({ W, E, C, h }) => {
    const hip = W.hips.y;
    const shell = (p: THREE.Vector3) => {
      const y = p.y - hip;
      if (Math.abs(y - 0.08) < 0.04) return Tt.rim;
      // hexagonal plates: a cheap hex lattice in (angle, height)
      const u = (ang(p) + Math.PI) * 2.2, v = y * 9;
      const fx = u - Math.floor(u), fy = v - Math.floor(v);
      return Math.min(fx, 1 - fx, fy, 1 - fy) < 0.07 ? Tt.shellB : Tt.shellA;
    };
    const belly = (p: THREE.Vector3) => (p.y - hip < 0.05 ? Tt.sash : Tt.plastron);
    E('body', [0, hip + 0.22, 0.06], [0.36, 0.36, 0.3], belly, 0.06);
    E('body', [0, hip + 0.3, -0.1], [0.5, 0.47, 0.36], shell, 0.03);
    C('body', [0, hip + 0.5, 0.06], [W.head.x, W.head.y + 0.08, W.head.z], 0.1, 0.09, Tt.skin, 0.06);
    E('head', h(0, 0.15, 0.04), [0.2, 0.19, 0.22], Tt.skin, 0.06);
    C('head', h(0, 0.02, 0.18), h(0, -0.24, 0.2), 0.07, 0.008, Tt.beard, 0.04);
  },
  face: {
    eyeSep: 0.085, eyeY: 0.2, eyeZ: 0.17, eyeR: 0.05, iris: 0x2b1d17, lids: 0.6, lidColor: Tt.skin,
    browY: 0.28, browZ: 0.19, brow: Tt.beard, browW: 0.07, mouthY: 0.09, mouthZ: 0.235, mouthR: 0.035,
  },
  extras: (B) => {
    // Master's wooden staff with a jade knob
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.5, 10), new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.8 }));
    staff.position.set(0, -0.28, 0.08);
    staff.castShadow = true;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), new THREE.MeshPhysicalMaterial({ color: 0x5fd08a, roughness: 0.15, clearcoat: 1, transmission: 0.2 }));
    knob.position.y = 0.78;
    staff.add(knob);
    B.elbowR.add(staff);
  },
};

// ---------------------------------------------------------------- Papa Canard
const D = { white: 0xfaf7f0, beak: 0xf2a33a, apron: 0xe9e2d0, pants: 0x3b6fb0 };
const DUCK: CreatureDef = {
  name: 'duck', hip: 0.4, neck: [0, 0.66, 0.08], shoulder: [0.32, 0.42, 0],
  upperArm: 0.22, foreArm: 0.2, armR: [0.075, 0.07, 0.08],
  legX: 0.14, thigh: 0.14, legR: [0.06, 0.05], foot: [0.09, 0.03, 0.17], footColor: D.beak,
  armColor: D.white, pawColor: D.white, legColor: (p) => (p.y > 0.2 ? D.pants : D.beak),
  cloth: [D.apron, D.pants, D.beak], shells: 4, furLen: 0.015, sheen: 0.6,
  sculpt: ({ W, E, C, h }) => {
    const hip = W.hips.y;
    const torso = (p: THREE.Vector3) => {
      const y = p.y - hip;
      if (y < 0.06) return D.pants;
      if (Math.abs(ang(p)) < 0.8 && y < 0.42) return D.apron;
      return D.white;
    };
    E('body', [0, hip + 0.18, 0], [0.36, 0.36, 0.33], torso, 0.08);
    E('body', [0, hip + 0.48, 0.03], [0.25, 0.22, 0.23], torso, 0.12);
    C('body', [0, hip + 0.55, 0.05], [W.head.x, W.head.y + 0.1, W.head.z], 0.12, 0.1, D.white, 0.08);
    E('head', h(0, 0.22, 0.02), [0.2, 0.2, 0.2], D.white, 0.08);
    E('head', h(0, 0.16, 0.22), [0.1, 0.04, 0.15], D.beak, 0.03);
    E('head', h(0, 0.12, 0.2), [0.08, 0.03, 0.11], D.beak, 0.02);
  },
  face: { eyeSep: 0.09, eyeY: 0.27, eyeZ: 0.16, eyeR: 0.045, iris: 0x2b1d17, browY: 0.34, browZ: 0.17, brow: 0x9a9a9a, mouthY: 0.12, mouthZ: 0.2, mouthR: 0.01 },
  extras: (B) => {
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.22, 20), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
    hat.position.set(0, 0.48, 0.0);
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), hat.material);
    puff.position.y = 0.14;
    puff.scale.set(1, 0.6, 1);
    hat.add(puff);
    hat.castShadow = true;
    B.head.add(hat);
  },
};

// ---------------------------------------------------------------- villagers
const PIG: CreatureDef = {
  name: 'pig', hip: 0.42, neck: [0, 0.58, 0.04], shoulder: [0.35, 0.42, 0],
  upperArm: 0.22, foreArm: 0.2, armR: [0.09, 0.08, 0.09],
  legX: 0.16, thigh: 0.15, legR: [0.1, 0.09], foot: [0.09, 0.05, 0.12], footColor: 0x8a5a4a,
  armColor: 0xf2a8a0, pawColor: 0xf2a8a0, legColor: (p) => (p.y > 0.12 ? 0xc0892f : 0xf2a8a0),
  cloth: [0x6b9a4a, 0xc0892f, 0x8a5a4a], shells: 0, furLen: 0, sheen: 0.4,
  sculpt: ({ W, E, C, h }) => {
    const hip = W.hips.y;
    const torso = (p: THREE.Vector3) => (p.y - hip < 0.05 ? 0xc0892f : p.y - hip < 0.42 ? 0x6b9a4a : 0xf2a8a0);
    E('body', [0, hip + 0.2, 0], [0.4, 0.36, 0.36], torso, 0.08);
    E('head', h(0, 0.2, 0), [0.26, 0.24, 0.24], 0xf2a8a0, 0.12);
    E('head', h(0, 0.14, 0.23), [0.11, 0.09, 0.07], 0xe58f88, 0.04);
    for (const s of [-1, 1]) C('head', h(s * 0.15, 0.36, 0), h(s * 0.24, 0.48, 0.03), 0.07, 0.02, 0xf2a8a0, 0.04);
  },
  face: { eyeSep: 0.1, eyeY: 0.27, eyeZ: 0.19, eyeR: 0.045, iris: 0x2b1d17, browY: 0.34, browZ: 0.21, brow: 0x8a5a4a, mouthY: 0.05, mouthZ: 0.24 },
};
const BUNNY: CreatureDef = {
  name: 'bunny', hip: 0.38, neck: [0, 0.5, 0.03], shoulder: [0.27, 0.36, 0],
  upperArm: 0.19, foreArm: 0.17, armR: [0.07, 0.065, 0.075],
  legX: 0.13, thigh: 0.14, legR: [0.09, 0.08], foot: [0.08, 0.05, 0.16], footColor: 0xf0e6dc,
  armColor: 0xf0e6dc, pawColor: 0xffffff, legColor: (p) => (p.y > 0.12 ? 0x7a5aa0 : 0xf0e6dc),
  cloth: [0x7a5aa0, 0xd98a3a], shells: 6, furLen: 0.025,
  sculpt: ({ W, E, C, h }) => {
    const hip = W.hips.y;
    const torso = (p: THREE.Vector3) => (p.y - hip < 0.05 ? 0x7a5aa0 : p.y - hip < 0.36 ? 0xd98a3a : 0xf0e6dc);
    E('body', [0, hip + 0.17, 0], [0.29, 0.3, 0.26], torso, 0.08);
    E('head', h(0, 0.2, 0), [0.24, 0.22, 0.22], 0xf0e6dc, 0.1);
    E('head', h(0, 0.12, 0.17), [0.1, 0.07, 0.07], 0xffffff, 0.04);
    for (const s of [-1, 1]) C('head', h(s * 0.08, 0.35, -0.03), h(s * 0.13, 0.78, -0.06), 0.06, 0.045, (p) => (p.z - W.head.z > -0.02 ? 0xf5b6b6 : 0xf0e6dc), 0.04);
  },
  face: { eyeSep: 0.09, eyeY: 0.25, eyeZ: 0.17, eyeR: 0.055, iris: 0x5a3a2a, browY: 0.33, browZ: 0.19, brow: 0xb0a090, nose: { y: 0.17, z: 0.24, r: 0.025, color: 0xf08a9a }, mouthY: 0.09, mouthZ: 0.235, whiskers: 0.22 },
};

export type CharacterKind = 'chonk' | 'tiger' | 'wolf' | 'tortoise' | 'duck' | 'pig' | 'bunny';
const DEFS: Record<CharacterKind, CreatureDef> = { chonk: CHONK, tiger: TIGER, wolf: WOLF, tortoise: TORTOISE, duck: DUCK, pig: PIG, bunny: BUNNY };

export function buildCharacter(kind: CharacterKind): ChonkRig {
  return buildCreature(DEFS[kind]);
}
