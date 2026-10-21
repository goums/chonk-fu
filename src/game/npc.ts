// Friendly characters: they idle, turn to face Le Chonk when he comes close, and show a marker
// ("!" new quest, "?" waiting for you) above their head.
import * as THREE from 'three';
import { Animator } from '../chonk/animator';
import { buildCharacter, type CharacterKind } from '../chonk/characters';
import type { ChonkRig } from '../chonk/model';
import { angleDelta, dampAngle } from '../core/math';
import { groundAt } from '../world/world';
import { addCircle } from './colliders';

function markerTexture(ch: string, color: string) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#2b1d17';
  g.stroke();
  g.font = '700 80px Fredoka, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#2b1d17';
  g.fillText(ch, 64, 70);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const MARKERS = { '!': markerTexture('!', '#ffd23a'), '?': markerTexture('?', '#7fe0a0') };

export class NPC {
  rig: ChonkRig;
  anim: Animator;
  heading: number;
  t = 0;
  marker: THREE.Sprite;
  markerKind: '!' | '?' | null = null;
  talkRadius = 3.2;
  constructor(public id: string, public name: string, kind: CharacterKind, public x: number, public z: number, heading: number, public height: number) {
    this.rig = buildCharacter(kind);
    this.anim = new Animator(this.rig);
    this.heading = heading;
    this.rig.root.position.set(x, groundAt(x, z), z);
    this.rig.root.rotation.y = heading;
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: MARKERS['!'], depthTest: false, fog: false }));
    this.marker.scale.set(0.7, 0.7, 1);
    this.marker.position.y = height + 0.6;
    this.marker.renderOrder = 5;
    this.rig.root.add(this.marker);
    addCircle(x, z, 0.6, -100, groundAt(x, z) + height);
  }
  get object() {
    return this.rig.root;
  }
  setMarker(k: '!' | '?' | null) {
    this.markerKind = k;
    this.marker.visible = !!k;
    if (k) this.marker.material.map = MARKERS[k];
  }
  update(dt: number, px: number, pz: number, talking: boolean) {
    this.t += dt;
    const d = Math.hypot(px - this.x, pz - this.z);
    const target = d < 7 ? Math.atan2(px - this.x, pz - this.z) : this.heading;
    const cur = this.rig.root.rotation.y;
    if (Math.abs(angleDelta(cur, target)) > 0.02) this.rig.root.rotation.y = dampAngle(cur, target, 5, dt);
    this.marker.position.y = this.height + 0.6 + Math.sin(this.t * 3) * 0.08;
    this.anim.update(
      {
        t: this.t + this.x, speed: 0, grounded: true, vy: 0,
        // a little "talking" bob: reuse the jab with a tiny amplitude would look odd, so just breathe
        move: null, moveT: 0, hurtT: talking ? 0.5 : Infinity, ko: false, angry: false,
      },
      dt,
    );
  }
}
