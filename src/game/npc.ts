// Friendly characters. They feel alive: heads follow Le Chonk when he comes close, they wave hello, nod
// along and gesture while they speak, villagers stroll small loops around their homes (pausing to look
// around), everyone fidgets with a small gesture every 6-12 s, and the whole Valley cheers at the end.
// A marker ("!" new quest, "?" ready to turn in) floats above quest givers.
// Body language goes to the animator through AnimInput.lookAt / AnimInput.gesture (motion.ts plays them).
import * as THREE from 'three';
import type { AnimInput } from '../chonk/animator';
import { buildCharacter, type CharacterKind } from '../chonk/characters';
import type { ChonkRig } from '../chonk/model';
import { makeAnimator, type CharacterAnimator } from '../chonk/motion';
import { angleDelta, clamp, damp, dampAngle, rng, type Rng } from '../core/math';
import { WATER_LEVEL } from '../world/layout';
import { groundAt } from '../world/world';
import { addCircle, pointBlocked, removeCollider, resolve, type Collider } from './colliders';
import { excludeFromAO } from './highlight';

export type Gesture = NonNullable<AnimInput['gesture']>;

/** what the NPCs see of the world each step */
export interface NpcContext {
  /** Le Chonk's feet */
  px: number;
  py: number;
  pz: number;
  /** the dialog on screen: who it is with (NPC id) and the current line */
  dialog: { with: string | null; i: number; who: string; text: string } | null;
  /** the Valley celebrates (ending) */
  cheer: boolean;
}

// ------------------------------------------------------------------ quest marker
// Premultiplied-alpha canvas textures (no dark fringes in the mipmaps), drawn in the HUD's gold/jade style.
function markerTexture(ch: '!' | '?') {
  const S = 256, c = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const jade = ch === '?';
  const hi = jade ? '#c8ffe4' : '#fff1c4', mid = jade ? '#4fd39a' : '#f2c75c', lo = jade ? '#1f7a55' : '#9c7a3c';
  // a diamond medallion: lacquered ink face, bright gold (or jade) bevel
  const diamond = (r: number) => {
    g.beginPath();
    g.moveTo(c, c - r);
    g.lineTo(c + r, c);
    g.lineTo(c, c + r);
    g.lineTo(c - r, c);
    g.closePath();
  };
  g.save();
  g.shadowColor = jade ? 'rgba(79,211,154,0.95)' : 'rgba(255,200,90,0.95)';
  g.shadowBlur = 26;
  diamond(92);
  const bevel = g.createLinearGradient(c - 92, c - 92, c + 92, c + 92);
  bevel.addColorStop(0, hi);
  bevel.addColorStop(0.5, mid);
  bevel.addColorStop(1, lo);
  g.fillStyle = bevel;
  g.fill();
  g.restore();
  diamond(78);
  const face = g.createRadialGradient(c, c - 20, 4, c, c, 80);
  face.addColorStop(0, '#24352d');
  face.addColorStop(1, '#0c1511');
  g.fillStyle = face;
  g.fill();
  diamond(70);
  g.lineWidth = 2;
  g.strokeStyle = jade ? 'rgba(166,245,207,0.55)' : 'rgba(244,220,156,0.55)';
  g.stroke();
  // the glyph, glowing
  g.save();
  g.shadowColor = jade ? 'rgba(120,255,190,1)' : 'rgba(255,214,120,1)';
  g.shadowBlur = 16;
  const ink = g.createLinearGradient(0, c - 50, 0, c + 50);
  ink.addColorStop(0, hi);
  ink.addColorStop(1, mid);
  g.fillStyle = ink;
  if (ch === '!') {
    // vector "!" (font independent): a tapered bar and a dot
    g.beginPath();
    g.moveTo(c - 13, c - 50);
    g.lineTo(c + 13, c - 50);
    g.lineTo(c + 7, c + 14);
    g.lineTo(c - 7, c + 14);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(c, c + 36, 11, 0, Math.PI * 2);
    g.fill();
  } else {
    g.font = '700 118px Georgia, "Times New Roman", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('?', c, c + 6);
  }
  g.restore();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.premultiplyAlpha = true;
  t.anisotropy = 4;
  return t;
}
function haloTexture() {
  const S = 128, c = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const r = g.createRadialGradient(c, c, 0, c, c, c);
  r.addColorStop(0, 'rgba(255,255,255,0.9)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let MARKERS: Record<'!' | '?', THREE.Texture> | null = null;
let HALO: THREE.Texture | null = null;
const MARKER_GLOW = { '!': new THREE.Color(0xffc45a), '?': new THREE.Color(0x4fd39a) };

function makeMarker() {
  MARKERS ??= { '!': markerTexture('!'), '?': markerTexture('?') };
  HALO ??= haloTexture();
  const group = new THREE.Group();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: HALO, color: MARKER_GLOW['!'], transparent: true, depthTest: false, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0.7 }));
  halo.scale.setScalar(1.9);
  halo.renderOrder = 5;
  const icon = new THREE.Sprite(new THREE.SpriteMaterial({
    map: MARKERS['!'], transparent: true, depthTest: false, depthWrite: false, fog: false,
    // the texture is premultiplied: blend ONE / ONE_MINUS_SRC_ALPHA
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  }));
  icon.renderOrder = 6;
  group.add(halo, icon);
  excludeFromAO(group);
  return { group, halo, icon };
}

// ------------------------------------------------------------------ NPC
const GESTURE_TIME: Record<Gesture, number> = { wave: 1.8, nod: 1.1, yes: 1.3, talk: 1, cheer: 2.4, angry: 1.5 };
const WALK_SPEED = 1.05;
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export class NPC {
  rig: ChonkRig;
  anim: CharacterAnimator;
  heading: number;
  t = 0;
  marker: THREE.Group;
  markerKind: '!' | '?' | null = null;
  talkRadius = 3.2;
  /** villagers stroll a small loop around their home */
  wanders = false;
  /** current walking speed (m/s) */
  speed = 0;

  private markerIcon: THREE.Sprite;
  private markerHalo: THREE.Sprite;
  private R: Rng;
  private phase: number;
  private collider: Collider;
  private homeX: number;
  private homeZ: number;
  private route: [number, number][] | null = null;
  private leg = 1;
  private pause = 0;
  private stuck = 0;
  // body language
  private gesture: Gesture | null = null;
  private gestureLeft = 0;
  private pending: { g: Gesture; dur: number } | null = null;
  private nextIdle: number;
  private lookPt = new THREE.Vector3();
  private lookLeft = 0;
  private lookV = new THREE.Vector3();
  private near = false;
  private lastGreet = -99;
  private lineKey = '';
  private talkLeft = 0;
  private talkDur = 0;
  private nodIn = -1;
  private wasPartner = false;
  private cheerIn = 0;

  constructor(public id: string, public name: string, public kind: CharacterKind, public x: number, public z: number, heading: number, public height: number) {
    this.rig = buildCharacter(kind);
    this.anim = makeAnimator(this.rig);
    this.heading = heading;
    this.homeX = x;
    this.homeZ = z;
    this.R = rng(hash(id));
    this.phase = this.R() * 10;
    this.nextIdle = 3 + this.R() * 8;
    this.cheerIn = this.R() * 1.5;
    this.rig.root.position.set(x, groundAt(x, z), z);
    this.rig.root.rotation.y = heading;
    const m = makeMarker();
    this.marker = m.group;
    this.markerIcon = m.icon;
    this.markerHalo = m.halo;
    this.marker.position.y = height + 0.75;
    this.rig.root.add(this.marker);
    this.collider = addCircle(x, z, 0.6, -100, groundAt(x, z) + height);
  }
  get object() {
    return this.rig.root;
  }
  setMarker(k: '!' | '?' | null) {
    this.markerKind = k;
    this.marker.visible = !!k;
    if (!k) return;
    this.markerIcon.material.map = MARKERS![k];
    this.markerIcon.material.needsUpdate = true;
    this.markerHalo.material.color.copy(MARKER_GLOW[k]);
  }

  /** start a gesture; a one-frame gap between gestures so the animator always sees a fresh start */
  play(g: Gesture, dur = GESTURE_TIME[g]) {
    if (this.gesture) {
      this.gesture = null;
      this.pending = { g, dur };
    } else {
      this.gesture = g;
      this.gestureLeft = dur;
    }
  }

  update(dt: number, ctx: NpcContext) {
    this.t += dt;
    const dx = ctx.px - this.x, dz = ctx.pz - this.z, d = Math.hypot(dx, dz);
    const dlg = ctx.dialog;
    const partner = !!dlg && dlg.with === this.id;
    const frozen = !!dlg; // the world waits while a dialog is open

    // ---- gesture clock
    if (this.gesture && (this.gestureLeft -= dt) <= 0) this.gesture = null;
    else if (!this.gesture && this.pending) {
      this.gesture = this.pending.g;
      this.gestureLeft = this.pending.dur;
      this.pending = null;
    }

    // ---- conversation: talk while my line types out, nod along to Le Chonk's lines, a "yes" at the end
    if (partner) {
      const key = `${dlg.i}|${dlg.who}|${dlg.text.length}`;
      if (key !== this.lineKey) {
        this.lineKey = key;
        if (dlg.who === this.name) {
          this.talkDur = this.talkLeft = dlg.text.length / 55 + 0.5;
          this.nodIn = -1;
          this.play('talk', this.talkLeft);
        } else {
          this.talkLeft = 0;
          if (this.gesture === 'talk') this.gesture = null;
          if (this.pending?.g === 'talk') this.pending = null;
          this.nodIn = 0.5;
        }
      }
    } else this.lineKey = '';
    if (this.wasPartner && !partner) {
      this.talkLeft = 0;
      this.nodIn = -1;
      this.play('yes');
    }
    this.wasPartner = partner;
    this.talkLeft = Math.max(0, this.talkLeft - dt);
    if (this.nodIn >= 0 && (this.nodIn -= dt) < 0) this.play('nod');

    // ---- the ending: everybody cheers, on and off
    if (ctx.cheer && !partner && (this.cheerIn -= dt) <= 0) {
      this.play('cheer');
      this.cheerIn = GESTURE_TIME.cheer + 1.2 + this.R() * 3;
    }

    // ---- greet Le Chonk when he walks up (once, then not again for a while)
    if (!frozen && d < 6 && !this.near) {
      this.near = true;
      if (this.t - this.lastGreet > 25 && !this.gesture && !ctx.cheer) {
        this.play('wave');
        this.lastGreet = this.t;
      }
    } else if (d > 9) this.near = false;

    // ---- idle variety: a small gesture or a look around every 6-12 s
    if (!frozen && !this.gesture && !this.pending && this.speed < 0.1 && this.t > this.nextIdle) {
      this.nextIdle = this.t + 6 + this.R() * 6;
      const r = this.R();
      if (this.markerKind === '!' && d > 5 && d < 28) this.play('wave'); // beckon: "over here!"
      else if (r < 0.4) this.lookAround(2.6);
      else if (r < 0.7) this.play('nod');
      else this.play('yes');
    }
    this.lookLeft = Math.max(0, this.lookLeft - dt);

    // ---- strolling
    let want = 0;
    const cur = this.object.rotation.y;
    if (this.wanders && !frozen) {
      if (!this.route) this.buildRoute();
      const route = this.route!;
      // stop to watch Le Chonk (and to be talked to), and while gesturing
      if (d < 6 || this.gesture || ctx.cheer) this.pause = Math.max(this.pause, 0.8);
      if (this.pause > 0) this.pause -= dt;
      else if (route.length > 1) {
        const [tx, tz] = route[this.leg];
        const ex = tx - this.x, ez = tz - this.z, dist = Math.hypot(ex, ez);
        if (dist < 0.4 || this.stuck > 1.5) {
          this.leg = (this.leg + 1) % route.length;
          this.pause = 2 + this.R() * 4;
          this.stuck = 0;
          if (this.R() < 0.6) this.lookAround(Math.min(this.pause, 2.5));
        } else {
          const turn = Math.abs(angleDelta(cur, Math.atan2(ex, ez)));
          want = WALK_SPEED * clamp(dist / 0.9, 0.4, 1) * clamp(Math.cos(turn), 0.15, 1);
        }
      }
    }
    this.speed = damp(this.speed, want, frozen ? 12 : 5, dt);
    if (this.speed > 0.02 && !frozen) this.walk(dt);

    // ---- facing: walking direction, else Le Chonk when close, else the rest heading
    let face: number | null = null;
    if (this.wanders && this.route && this.speed > 0.05 && want > 0) {
      const [tx, tz] = this.route[this.leg];
      face = Math.atan2(tx - this.x, tz - this.z);
    } else if (partner || d < 7) face = Math.atan2(dx, dz);
    else if (!this.wanders) face = this.heading;
    if (face !== null && Math.abs(angleDelta(cur, face)) > 0.02) this.object.rotation.y = dampAngle(cur, face, this.speed > 0.05 ? 4 : 5, dt);

    // ---- head look-at
    let look: THREE.Vector3 | null = null;
    if (partner || d < 8) look = this.lookV.set(ctx.px, ctx.py + 1.0, ctx.pz);
    else if (this.lookLeft > 0) look = this.lookPt;

    // ---- marker: gentle bob, scaled up with distance so it reads from afar
    this.marker.visible = !!this.markerKind && !partner;
    if (this.marker.visible) {
      const w = Math.sin(this.t * 3.1 + this.phase);
      this.marker.position.y = this.height + 0.75 + Math.sin(this.t * 2.2 + this.phase) * 0.1;
      const s = clamp(d / 11, 1, 3.2);
      this.markerIcon.scale.setScalar(0.62 * s * (1 + w * 0.04));
      this.markerHalo.scale.setScalar(1.5 * s * (1 + w * 0.12));
      this.markerHalo.material.opacity = 0.42 + w * 0.14;
    }

    this.anim.update(
      {
        t: this.t + this.phase, speed: this.speed, grounded: true, vy: 0,
        move: null, moveT: 0, hurtT: Infinity, ko: false, angry: false,
        talking: partner, lookAt: look, gesture: this.gesture,
      },
      dt,
    );

    // ---- faces are baked in the textures: sell the speech with a small head bob while the line types
    if (this.talkLeft > 0) {
      const env = Math.min(1, this.talkLeft * 3, (this.talkDur - this.talkLeft) * 5);
      const h = this.rig.head;
      h.rotateX((Math.sin(this.t * 10.5) * 0.045 + Math.sin(this.t * 3.7) * 0.025) * env);
      h.rotateZ(Math.sin(this.t * 2.9) * 0.03 * env);
    }
  }

  private lookAround(dur: number) {
    const a = this.object.rotation.y + (this.R() - 0.5) * 2.4;
    this.lookPt.set(this.x + Math.sin(a) * 5, groundAt(this.x, this.z) + this.height * (0.6 + this.R() * 0.6), this.z + Math.cos(a) * 5);
    this.lookLeft = dur;
  }

  /** advance along the current heading, sliding around obstacles */
  private walk(dt: number) {
    const h = this.object.rotation.y;
    const nx = this.x + Math.sin(h) * this.speed * dt, nz = this.z + Math.cos(h) * this.speed * dt;
    removeCollider(this.collider);
    const y = groundAt(this.x, this.z);
    const r = resolve(nx, nz, 0.45, y + 0.25, this.height);
    const moved = Math.hypot(r.x - this.x, r.z - this.z);
    this.stuck = moved < this.speed * dt * 0.3 ? this.stuck + dt : Math.max(0, this.stuck - dt);
    this.x = r.x;
    this.z = r.z;
    const gy = groundAt(this.x, this.z);
    this.collider = addCircle(this.x, this.z, 0.6, -100, gy + this.height);
    this.object.position.set(this.x, gy, this.z);
  }

  /** a few reachable points around home (clear of buildings and water, roughly level), as a loop */
  private buildRoute() {
    removeCollider(this.collider);
    const y0 = groundAt(this.homeX, this.homeZ);
    const ok = (x: number, z: number) => {
      const y = groundAt(x, z);
      return y > WATER_LEVEL + 0.4 && Math.abs(y - y0) < 1.2 && !pointBlocked(x, y + 0.6, z, 0.6);
    };
    const clear = (ax: number, az: number, bx: number, bz: number) => {
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
      for (let k = 1; k <= n; k++) if (!ok(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n)) return false;
      return true;
    };
    const pts: [number, number][] = [[this.homeX, this.homeZ]];
    for (let k = 0; k < 3; k++) {
      for (let tries = 0; tries < 10; tries++) {
        const a = this.R() * Math.PI * 2, r = 2.5 + this.R() * 3.5;
        const x = this.homeX + Math.sin(a) * r, z = this.homeZ + Math.cos(a) * r;
        const [lx, lz] = pts[pts.length - 1];
        if (ok(x, z) && clear(lx, lz, x, z)) {
          pts.push([x, z]);
          break;
        }
      }
    }
    while (pts.length > 1 && !clear(pts[pts.length - 1][0], pts[pts.length - 1][1], this.homeX, this.homeZ)) pts.pop();
    this.route = pts;
    this.leg = pts.length > 1 ? 1 : 0;
    this.pause = 1 + this.R() * 3;
    this.collider = addCircle(this.x, this.z, 0.6, -100, groundAt(this.x, this.z) + this.height);
  }
}
