// Gameplay props: floating GPUs (the quest items), dumplings and peaches (healing), the Oracle shrine,
// and the wolf bandit camps.
import * as THREE from 'three';
import { toon } from '../chonk/toon';
import { rng } from '../core/math';
import { Batch, box, cyl, kitMaterial, roofGeometry } from '../world/kit';
import { groundAt } from '../world/world';
import { addCircle } from './colliders';

/** a graphics card: green PCB, black shroud, two fans, gold edge connector, glowing LED strip */
export function gpuModel() {
  const g = new THREE.Group();
  const b = new Batch();
  b.add(box(1.1, 0.06, 0.5), 0x1f6b3a, 0, 0, 0);
  b.add(box(1.0, 0.18, 0.46), 0x2a2a30, 0, 0.12, 0);
  b.add(box(0.5, 0.04, 0.06), 0xe8b83a, 0.15, -0.03, 0.27);
  for (const x of [-0.25, 0.25]) {
    b.add(cyl(0.19, 0.19, 0.05, 16), 0x55555e, x, 0.22, 0);
    for (let k = 0; k < 5; k++) b.add(box(0.03, 0.02, 0.17), 0x8a8a96, x, 0.25, 0, (k / 5) * Math.PI);
    b.add(cyl(0.05, 0.05, 0.06, 8), 0xe8b83a, x, 0.25, 0);
  }
  const body = b.mesh(kitMaterial());
  body.castShadow = true;
  g.add(body);
  const led = new THREE.Mesh(box(0.95, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0x5dff8a }));
  led.position.set(0, 0.16, 0.24);
  g.add(led);
  return g;
}

/** a vertical beam of light so items can be spotted from afar */
export function beam(color: number, h = 18) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.6, h, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  m.position.y = h / 2;
  return m;
}

export function dumplingModel() {
  const g = new THREE.Group();
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), toon(0xfff6e6));
  bun.scale.set(1, 0.75, 1);
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.14, 8), toon(0xfff6e6));
  top.position.y = 0.22;
  g.add(bun, top);
  // little steam basket
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.38, 0.16, 14), toon(0xc9a36a));
  basket.position.y = -0.2;
  g.add(basket);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export function peachModel() {
  const g = new THREE.Group();
  const p = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 10), toon(0xffa0a8));
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 4), toon(0x5c9a3e));
  leaf.position.set(0.06, 0.25, 0);
  leaf.rotation.z = -0.8;
  g.add(p, leaf);
  return g;
}

/** the Oracle: a jade monolith with a screen face and five GPU slots */
export class Oracle {
  group = new THREE.Group();
  private screen: THREE.Mesh;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  slots: THREE.Group[] = [];
  awake = false;
  constructor(public x: number, public z: number, public ry = 0) {
    const y = groundAt(x, z);
    this.group.position.set(x, y, z);
    this.group.rotation.y = ry;
    const b = new Batch();
    b.add(box(4.4, 0.6, 3), 0x8f8472, 0, 0.3, 0);
    b.add(box(3.2, 4.6, 1.2), 0x2f8f6e, 0, 2.9, 0);
    b.add(box(3.5, 0.4, 1.5), 0xe8b83a, 0, 5.3, 0);
    b.add(roofGeometry(4.6, 2.6, 0.8, 0.6, 0x2f8f6e, 0x267559, 0x8a2d22), null, 0, 5.5, 0);
    for (let i = 0; i < 5; i++) b.add(box(0.5, 0.25, 0.4), 0x2b2b30, -1.2 + i * 0.6, 1.0, 0.75);
    const m = b.mesh(kitMaterial());
    this.group.add(m);
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 192;
    this.ctx = cv.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), new THREE.MeshBasicMaterial({ map: this.tex }));
    this.screen.position.set(0, 3.2, 0.61);
    this.group.add(this.screen);
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Group();
      s.position.set(-1.2 + i * 0.6, 1.25, 0.75);
      s.scale.setScalar(0.45);
      s.rotation.y = Math.PI / 2;
      s.visible = false;
      s.add(gpuModel());
      this.slots.push(s);
      this.group.add(s);
    }
    addCircle(x, z, 2.2);
    this.draw(0);
  }
  setGpus(n: number) {
    this.slots.forEach((s, i) => (s.visible = i < n));
  }
  draw(t: number) {
    const g = this.ctx;
    g.fillStyle = this.awake ? '#0f2a20' : '#101418';
    g.fillRect(0, 0, 256, 192);
    g.strokeStyle = this.awake ? '#5dff8a' : '#3a4450';
    g.fillStyle = g.strokeStyle;
    g.lineWidth = 8;
    g.lineCap = 'round';
    if (this.awake) {
      // a friendly face that blinks
      const blink = Math.sin(t * 1.3) > 0.97;
      for (const x of [88, 168]) {
        g.beginPath();
        if (blink) { g.moveTo(x - 14, 78); g.lineTo(x + 14, 78); }
        else g.arc(x, 78, 14, 0, Math.PI * 2);
        blink ? g.stroke() : g.fill();
      }
      g.beginPath();
      g.arc(128, 110, 40, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
    } else {
      // asleep: "zzz" and a low-battery bar
      g.font = '700 40px Fredoka, sans-serif';
      g.fillText('z z z', 80 + Math.sin(t) * 4, 90);
      g.strokeRect(70, 120, 116, 34);
      g.fillStyle = '#d9362b';
      g.fillRect(76, 126, 14, 22);
    }
    this.tex.needsUpdate = true;
  }
}

/** a wolf bandit camp: tents, a campfire, crates and a banner */
export function buildCamp(x: number, z: number, seed: number) {
  const R = rng(seed);
  const b = new Batch();
  const y0 = groundAt(x, z);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + R();
    const tx = x + Math.cos(a) * 6, tz = z + Math.sin(a) * 6;
    b.add(new THREE.ConeGeometry(2, 2.6, 6), i % 2 ? 0x7a5a3a : 0x8a6a48, tx, groundAt(tx, tz) + 1.2, tz, R() * 3);
    b.add(cyl(0.05, 0.05, 3, 4), 0x4a3626, tx, groundAt(tx, tz) + 1.5, tz);
    addCircle(tx, tz, 1.8, -100, groundAt(tx, tz) + 2.6);
  }
  // campfire stones and logs
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.add(new THREE.DodecahedronGeometry(0.25), 0x7a7468, x + Math.cos(a) * 0.9, y0 + 0.1, z + Math.sin(a) * 0.9);
  }
  for (let k = 0; k < 3; k++) b.add(cyl(0.1, 0.1, 1.3, 6), 0x5a3a26, x, y0 + 0.2, z, (k / 3) * Math.PI, 1, 1, 1, Math.PI / 2 - 0.3);
  // crates and a banner
  for (let k = 0; k < 3; k++) {
    const cx = x + 3 + k * 0.9, cz = z - 3 + (k % 2) * 0.9;
    b.add(box(0.8, 0.8, 0.8), 0x9a6a3e, cx, groundAt(cx, cz) + 0.4, cz, R());
  }
  b.add(cyl(0.08, 0.08, 4.5, 6), 0x4a3626, x - 3, y0 + 2.2, z + 3);
  b.add(box(1.4, 1.0, 0.05), 0xc0392b, x - 2.3, y0 + 3.9, z + 3);
  const group = new THREE.Group();
  group.add(b.mesh(kitMaterial()));
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 7), new THREE.MeshBasicMaterial({ color: 0xffa53a }));
  fire.position.set(x, y0 + 0.65, z);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 7), new THREE.MeshBasicMaterial({ color: 0xfff07a }));
  inner.position.set(x, y0 + 0.5, z);
  group.add(fire, inner);
  const light = new THREE.PointLight(0xff9a3a, 8, 12, 2);
  light.position.set(x, y0 + 1.5, z);
  group.add(light);
  addCircle(x, z, 1.0, -100, y0 + 1);
  return { group, fire, inner };
}
