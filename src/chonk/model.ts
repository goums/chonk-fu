// Le Chonk in 3D: a big round orange tabby, kung-fu master. Built from primitives in code and rigged
// as a hierarchy of joints (Object3D) that the procedural animator rotates.
import * as THREE from 'three';
import { addOutlines, toon } from './toon';

export const FUR = {
  orange: 0xf3922a,
  orangeDark: 0xd8691b,
  stripe: 0xb94f14,
  cream: 0xfde3b8,
  pink: 0xf59a9a,
  pants: 0x3d3047,
  pantsLight: 0x564463,
  sash: 0xf2c23a,
  collar: 0xd9362b,
  bell: 0xf7c843,
  eye: 0xf6c522,
  pupil: 0x231a17,
  brow: 0x7a3610,
};

export interface ChonkRig {
  root: THREE.Group; // feet on the ground, faces +z
  hips: THREE.Group;
  body: THREE.Group; // belly + chest; rotates around the hips
  head: THREE.Group;
  browL: THREE.Mesh;
  browR: THREE.Mesh;
  mouth: THREE.Mesh;
  shoulderL: THREE.Group;
  shoulderR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  tail: THREE.Group[];
  belly: THREE.Mesh;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Body fur: u = around (0/1 = front), v = height. Cream belly in front, tabby stripes on the back. */
function bodyTexture() {
  return canvasTex(512, 256, (g) => {
    g.fillStyle = hex(FUR.orange);
    g.fillRect(0, 0, 512, 256);
    // tabby stripes on the back half (wavy horizontal bands)
    g.fillStyle = hex(FUR.stripe);
    for (let k = 0; k < 7; k++) {
      const y = 30 + k * 30;
      g.beginPath();
      for (let x = 120; x <= 392; x += 4) {
        const w = 6 + 5 * Math.sin(((x - 120) / 272) * Math.PI);
        const yy = y + Math.sin(x * 0.05 + k) * 5;
        if (x === 120) g.moveTo(x, yy - w / 2);
        g.lineTo(x, yy - w / 2);
      }
      for (let x = 392; x >= 120; x -= 4) {
        const w = 6 + 5 * Math.sin(((x - 120) / 272) * Math.PI);
        g.lineTo(x, y + Math.sin(x * 0.05 + k) * 5 + w / 2);
      }
      g.fill();
    }
    // the cream belly (front = both horizontal edges)
    const belly = (cx: number) => {
      const gr = g.createRadialGradient(cx, 140, 10, cx, 140, 110);
      gr.addColorStop(0, hex(FUR.cream));
      gr.addColorStop(0.82, hex(FUR.cream));
      gr.addColorStop(1, 'rgba(253,227,184,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(cx, 140, 105, 125, 0, 0, Math.PI * 2);
      g.fill();
    };
    belly(0);
    belly(512);
  });
}

/** Head fur on a sphere: u = 0.25 is the face. Tabby "M" on the forehead, cheek stripes, cream muzzle. */
function headTexture() {
  return canvasTex(512, 256, (g) => {
    g.fillStyle = hex(FUR.orange);
    g.fillRect(0, 0, 512, 256);
    const fx = 128; // face center
    g.strokeStyle = hex(FUR.stripe);
    g.lineCap = 'round';
    // forehead stripes
    g.lineWidth = 9;
    for (const dx of [-26, 0, 26]) {
      g.beginPath();
      g.moveTo(fx + dx, 34);
      g.quadraticCurveTo(fx + dx * 1.15, 60, fx + dx * 0.8, 84);
      g.stroke();
    }
    // back of the head stripes
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      g.moveTo(300 + k * 40, 30);
      g.quadraticCurveTo(310 + k * 40, 80, 296 + k * 40, 130);
      g.stroke();
    }
    // cheek stripes (both sides of the face)
    g.lineWidth = 7;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        g.beginPath();
        g.moveTo(fx + side * 70, 118 + k * 16);
        g.lineTo(fx + side * 104, 112 + k * 18);
        g.stroke();
      }
    }
    // cream muzzle and chin
    g.fillStyle = hex(FUR.cream);
    g.beginPath();
    g.ellipse(fx, 170, 62, 58, 0, 0, Math.PI * 2);
    g.fill();
  });
}

const sphere = (r: number, w = 24, h = 16) => new THREE.SphereGeometry(r, w, h);
const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 6, 14);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function joint(parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

export function buildChonk(): ChonkRig {
  const fur = toon(0xffffff, { map: bodyTexture() });
  const headFur = toon(0xffffff, { map: headTexture() });
  const orange = toon(FUR.orange);
  const cream = toon(FUR.cream);
  const pink = toon(FUR.pink);
  const pants = toon(FUR.pants);
  const pantsLight = toon(FUR.pantsLight);
  const sash = toon(FUR.sash);
  const collar = toon(FUR.collar);
  const bell = toon(FUR.bell, { emissive: 0x3a2400 });
  const white = toon(0xffffff);
  const eyeMat = toon(FUR.eye, { emissive: 0x2a1c00 });
  const pupil = new THREE.MeshBasicMaterial({ color: FUR.pupil });
  const brow = new THREE.MeshBasicMaterial({ color: FUR.brow });
  const stripe = toon(FUR.stripe);

  const root = new THREE.Group();
  root.name = 'chonk';
  const hips = joint(root, 0, 0.5, 0);
  const body = joint(hips, 0, 0, 0);

  // the big round body: a pear-shaped lathe from the seat to the neck
  const profile = [
    [0.0, -0.22], [0.22, -0.2], [0.42, -0.1], [0.54, 0.06], [0.57, 0.22], [0.53, 0.42], [0.44, 0.58], [0.32, 0.68], [0.0, 0.72],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const bodyGeo = new THREE.LatheGeometry(new THREE.SplineCurve(profile).getPoints(28), 40);
  const belly = mesh(bodyGeo, fur, body);
  belly.scale.set(1, 1, 0.92);

  // kung-fu pants: a wider lathe around the seat, then the sash
  const pantsProfile = [[0.0, -0.25], [0.25, -0.235], [0.45, -0.13], [0.565, 0.02], [0.585, 0.1], [0.0, 0.1]].map(([r, y]) => new THREE.Vector2(r, y));
  const pantsMesh = mesh(new THREE.LatheGeometry(pantsProfile, 40), pants, body);
  pantsMesh.scale.set(1, 1, 0.93);
  const sashRing = mesh(new THREE.TorusGeometry(0.565, 0.06, 10, 48), sash, body, 0, 0.1, 0);
  sashRing.rotation.x = Math.PI / 2;
  sashRing.scale.set(1, 0.93, 1);
  const knot = mesh(sphere(0.08, 12, 10), sash, body, 0.24, 0.1, 0.5);
  knot.scale.set(1, 0.8, 0.7);
  for (const [dx, rz] of [[0.2, 0.25], [0.29, -0.1]]) {
    const tailCloth = mesh(new THREE.BoxGeometry(0.08, 0.28, 0.03), sash, body, dx, -0.04, 0.5);
    tailCloth.rotation.set(-0.25, 0, rz);
  }

  // head
  const head = joint(body, 0, 0.7, 0.02);
  const skull = mesh(sphere(0.38, 32, 20), headFur, head, 0, 0.3, 0);
  skull.scale.set(1.15, 0.95, 1.0);
  skull.rotation.y = 0; // u = 0.25 faces +z
  // fluffy cheeks
  for (const s of [-1, 1]) {
    const cheek = mesh(new THREE.ConeGeometry(0.11, 0.22, 10), orange, head, s * 0.42, 0.18, 0.04);
    cheek.rotation.z = s * 1.9;
    cheek.scale.set(1, 1, 0.6);
    const cheek2 = mesh(new THREE.ConeGeometry(0.08, 0.18, 10), orange, head, s * 0.4, 0.08, 0.06);
    cheek2.rotation.z = s * 2.3;
    cheek2.scale.set(1, 1, 0.6);
  }
  // ears
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.15, 0.28, 4), orange, head, s * 0.27, 0.6, -0.02);
    ear.rotation.set(-0.1, Math.PI / 4, s * -0.32);
    ear.scale.set(1, 1, 0.55);
    const inner = mesh(new THREE.ConeGeometry(0.095, 0.19, 4), pink, ear, 0, -0.02, 0.05);
    inner.scale.set(1, 1, 0.5);
    inner.userData.noOutline = true;
  }
  // muzzle: two cream puffs, a pink nose, a mouth
  for (const s of [-1, 1]) {
    const puff = mesh(sphere(0.11, 16, 12), cream, head, s * 0.085, 0.15, 0.33);
    puff.scale.set(1, 0.8, 0.75);
  }
  const chin = mesh(sphere(0.08, 14, 10), cream, head, 0, 0.07, 0.31);
  chin.scale.set(1.1, 0.7, 0.8);
  const nose = mesh(sphere(0.055, 12, 8), pink, head, 0, 0.23, 0.4);
  nose.scale.set(1.2, 0.75, 0.8);
  const mouth = mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 16, Math.PI), pupil, head, 0, 0.1, 0.395);
  mouth.rotation.z = Math.PI;
  mouth.userData.noOutline = true;
  // eyes: white, golden iris, slit-ish pupil, highlight
  for (const s of [-1, 1]) {
    const eye = joint(head, s * 0.155, 0.36, 0.3);
    eye.rotation.y = s * 0.32;
    const w = mesh(sphere(0.095, 18, 14), white, eye);
    w.scale.set(1, 1.1, 0.55);
    const iris = mesh(sphere(0.07, 16, 12), eyeMat, eye, 0, -0.005, 0.035);
    iris.scale.set(1, 1.1, 0.5);
    iris.userData.noOutline = true;
    const p = mesh(sphere(0.04, 12, 10), pupil, eye, 0, -0.005, 0.06);
    p.scale.set(0.7, 1.25, 0.4);
    p.userData.noOutline = true;
    const hl = mesh(sphere(0.016, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), eye, s * -0.02, 0.03, 0.075);
    hl.userData.noOutline = true;
  }
  const browGeo = new THREE.BoxGeometry(0.15, 0.035, 0.05);
  const browL = mesh(browGeo, brow, head, -0.16, 0.48, 0.33);
  const browR = mesh(browGeo, brow, head, 0.16, 0.48, 0.33);
  browL.userData.noOutline = browR.userData.noOutline = true;
  // whiskers
  const wpts: number[] = [];
  for (const s of [-1, 1])
    for (let k = 0; k < 3; k++) wpts.push(s * 0.15, 0.16 + k * 0.03, 0.38, s * 0.52, 0.12 + k * 0.07, 0.32);
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wpts, 3));
  head.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x4a2a1a })));

  // the red collar and its golden bell (Le Chonk's signature)
  const collarRing = mesh(new THREE.TorusGeometry(0.31, 0.05, 10, 32), collar, body, 0, 0.66, 0.02);
  collarRing.rotation.x = Math.PI / 2 - 0.15;
  const bellMesh = mesh(sphere(0.07, 14, 10), bell, body, 0, 0.6, 0.34);
  void bellMesh;

  // arms: shoulder -> upper arm -> elbow -> forearm -> paw
  const arm = (s: number) => {
    const sh = joint(body, s * 0.47, 0.42, 0.02);
    const upper = mesh(capsule(0.115, 0.2), orange, sh, 0, -0.16, 0);
    void upper;
    const el = joint(sh, 0, -0.33, 0);
    mesh(capsule(0.105, 0.17), orange, el, 0, -0.13, 0);
    // stripes on the forearm
    const band = mesh(new THREE.TorusGeometry(0.108, 0.02, 6, 16), stripe, el, 0, -0.08, 0);
    band.rotation.x = Math.PI / 2;
    band.userData.noOutline = true;
    const paw = mesh(sphere(0.13, 16, 12), cream, el, 0, -0.3, 0.01);
    paw.scale.set(1, 0.9, 1);
    return { sh, el };
  };
  const L = arm(1), R = arm(-1);

  // legs: short and stout, pants down to the shin, big fluffy feet
  const leg = (s: number) => {
    const hip = joint(hips, s * 0.25, -0.12, 0);
    const thigh = mesh(capsule(0.15, 0.12), pants, hip, 0, -0.1, 0);
    void thigh;
    const knee = joint(hip, 0, -0.2, 0);
    const shin = mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.12, 14), pantsLight, knee, 0, -0.04, 0);
    void shin;
    mesh(capsule(0.1, 0.04), orange, knee, 0, -0.12, 0);
    const foot = mesh(sphere(0.14, 16, 12), orange, knee, 0, -0.2, 0.06);
    foot.scale.set(1, 0.6, 1.35);
    for (const t of [-1, 0, 1]) {
      const toe = mesh(sphere(0.045, 8, 6), cream, knee, t * 0.06, -0.22, 0.22);
      toe.userData.noOutline = true;
    }
    return { hip, knee };
  };
  const LL = leg(1), LR = leg(-1);

  // striped tail: a chain of segments
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = joint(body, 0, -0.08, -0.5);
  for (let i = 0; i < 6; i++) {
    const seg = joint(parent, 0, i === 0 ? 0 : 0.14, 0);
    const r = 0.075 - i * 0.004;
    mesh(capsule(r, 0.1), i % 2 ? toon(FUR.stripe) : orange, seg, 0, 0.07, 0);
    tail.push(seg);
    parent = seg;
  }
  tail[0].rotation.x = -1.1;

  addOutlines(root, 0.018);
  return {
    root, hips, body, head, browL, browR, mouth,
    shoulderL: L.sh, shoulderR: R.sh, elbowL: L.el, elbowR: R.el,
    legL: LL.hip, legR: LR.hip, kneeL: LL.knee, kneeR: LR.knee,
    tail, belly,
  };
}
