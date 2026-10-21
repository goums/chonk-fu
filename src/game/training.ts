// The Training Arena: wooden dummies that wobble on a spring and count the hits on a little plaque, and
// Gong, a friendly sparring partner (a pig in a training sash) who strikes lightly, blocks now and then,
// cheers you on, and never knocks Le Chonk out.
import * as THREE from 'three';
import { buildCharacter } from '../chonk/characters';
import { angleDelta, clamp, rng, type Rng } from '../core/math';
import { trainingDummy } from '../world/buildings';
import { kitMaterial } from '../world/kit';
import { groundAt } from '../world/world';
import { addCircle } from './colliders';
import { Fighter } from './fighter';
import { excludeFromAO } from './highlight';

// ------------------------------------------------------------------ dummies
let DUMMY_GEO: THREE.BufferGeometry | null = null;

export class Dummy {
  obj = new THREE.Group();
  private pivot = new THREE.Group();
  radius = 0.6;
  hits = 0;
  private idle = 99;
  private rx = 0;
  private rz = 0;
  private vx = 0;
  private vz = 0;
  private pop = 0;
  private plaque: THREE.Sprite;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  constructor(public id: string, public x: number, public z: number, ry = 0) {
    const y = groundAt(x, z);
    this.obj.position.set(x, y, z);
    this.obj.rotation.y = ry;
    DUMMY_GEO ??= trainingDummy();
    const m = new THREE.Mesh(DUMMY_GEO, kitMaterial());
    m.castShadow = true;
    m.receiveShadow = true;
    // a heavy stone base that does not wobble
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.22, 12), new THREE.MeshStandardMaterial({ color: 0x8f8472, roughness: 0.9 }));
    base.position.y = 0.11;
    base.receiveShadow = true;
    this.pivot.add(m);
    this.obj.add(base, this.pivot);
    addCircle(x, z, 0.5, -100, y + 2.6);
    // the hit counter: a little wooden plaque with a number
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 96;
    this.ctx = cv.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.plaque = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.plaque.scale.set(0.9, 0.675, 1);
    this.plaque.position.y = 3.3;
    this.plaque.renderOrder = 9;
    this.plaque.visible = false;
    excludeFromAO(this.plaque);
    this.obj.add(this.plaque);
  }

  /** a hit from (fx, fz) with a move: wobble away from it, count it */
  hit(move: string, fx: number, fz: number) {
    const dx = this.x - fx, dz = this.z - fz, d = Math.hypot(dx, dz) || 1;
    const imp = move === 'belly' || move === 'slam' ? 6 : move === 'kick' ? 4 : 2.6;
    // world push direction -> local tilt (the dummy may be rotated)
    const c = Math.cos(-this.obj.rotation.y), s = Math.sin(-this.obj.rotation.y);
    const ux = (dx / d) * c + (dz / d) * s, uz = -(dx / d) * s + (dz / d) * c;
    this.vx += uz * imp;
    this.vz -= ux * imp;
    this.hits++;
    this.idle = 0;
    this.pop = 1;
    this.draw();
  }

  private draw() {
    const g = this.ctx;
    g.clearRect(0, 0, 128, 96);
    g.fillStyle = '#5a3324';
    g.strokeStyle = '#e8b83a';
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(8, 8, 112, 80, 14);
    g.fill();
    g.stroke();
    g.font = '700 54px Fredoka, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffe9a8';
    g.fillText(String(this.hits), 64, 52);
    this.tex.needsUpdate = true;
  }

  update(dt: number) {
    // damped spring back to upright
    const k = 70, c = 5.5;
    this.vx += (-k * this.rx - c * this.vx) * dt;
    this.vz += (-k * this.rz - c * this.vz) * dt;
    this.rx = clamp(this.rx + this.vx * dt, -0.6, 0.6);
    this.rz = clamp(this.rz + this.vz * dt, -0.6, 0.6);
    this.pivot.rotation.set(this.rx, 0, this.rz);
    // the counter shows while you train, fades after 3 s, then resets
    this.idle += dt;
    if (this.idle > 4 && this.hits) this.hits = 0;
    const a = this.hits ? clamp((4 - this.idle) / 1, 0, 1) : 0;
    const mat = this.plaque.material;
    mat.opacity += (a - mat.opacity) * (1 - Math.exp(-10 * dt));
    this.plaque.visible = mat.opacity > 0.01;
    this.pop = Math.max(0, this.pop - dt * 4);
    const s = 1 + this.pop * 0.35;
    this.plaque.scale.set(0.9 * s, 0.675 * s, 1);
  }
}

// ------------------------------------------------------------------ the sparring partner
const CHEERS = ['Good!', 'Nice!', 'Yes!', 'Strong!', 'Again!', 'Wow!'];

export class SparPartner extends Fighter {
  mode: 'idle' | 'spar' = 'idle';
  home: { x: number; z: number };
  private R: Rng;
  private cooldown = 1.5;
  private turn = 0;
  private cheer = 0;
  constructor(x: number, z: number, private restHeading: number) {
    super(buildCharacter('pig'), x, z, 999, 0.55, 1.5);
    this.home = { x, z };
    this.heading = restHeading;
    this.power = 0.25;
    this.R = rng(321);
  }

  /** every third hit is blocked */
  block() {
    return ++this.turn % 3 === 0;
  }
  cheerLine() {
    return CHEERS[this.cheer++ % CHEERS.length];
  }

  step(dt: number, target: Fighter) {
    const dx = target.pos.x - this.pos.x, dz = target.pos.z - this.pos.z, dist = Math.hypot(dx, dz) || 1;
    const toTarget = Math.atan2(dx, dz);
    const targetHome = Math.hypot(target.pos.x - this.home.x, target.pos.z - this.home.z);
    let wx = 0, wz = 0, speed = 1.8, face: number | null = null;
    this.cooldown -= dt;
    const sparring = this.mode === 'spar' && target.alive && targetHome < 16;
    this.fighting = sparring;
    if (sparring) {
      face = toTarget;
      if (dist > 2.3) {
        [wx, wz] = [dx / dist, dz / dist];
        speed = dist > 5 ? 4.2 : 2.6;
      } else if (dist < 1.3) {
        [wx, wz] = [-dx / dist, -dz / dist];
        speed = 1.5;
      }
      // light strikes, never while Le Chonk is low
      if (this.cooldown <= 0 && !this.move && this.canAct() && dist < 2.3 && target.hp > 25 && Math.abs(angleDelta(this.heading, toTarget)) < 0.6) {
        this.startMove(this.R() < 0.7 ? 'jab' : 'cross');
        this.cooldown = 1.5 + this.R() * 1.2;
      }
    } else {
      // back to his spot, then watch Le Chonk (or rest)
      const hx = this.home.x - this.pos.x, hz = this.home.z - this.pos.z, hd = Math.hypot(hx, hz);
      if (hd > 0.6) [wx, wz] = [hx / hd, hz / hd];
      face = hd > 0.6 ? null : dist < 9 ? toTarget : this.restHeading;
    }
    this.tickMove(dt);
    this.physics(dt, wx, wz, speed, face);
    this.hp = this.maxHp;
  }
}
