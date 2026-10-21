// Hand-drawn item icons shared by the HUD (inline SVG) and the 3D world (floating icon sprites over the
// things a quest asks for, so they read from ~25 m: a bamboo shoot hidden between the stalks, a peach
// tree that still has fruit, a mossy rock with a mushroom under it).
import * as THREE from 'three';
import { clamp } from '../core/math';
import { excludeFromAO } from './highlight';

export type Icon = 'jade' | 'peach' | 'shoot' | 'mushroom' | 'dumpling' | 'scroll';
// (no gradient ids: they get removed)
export const ICONS: Record<Icon, string> = {
  jade: `<path d="M12 2.2 19.6 8 16.8 20.6H7.2L4.4 8Z" fill="#2c9a68"/><path d="M12 2.2 19.6 8 12 10.4 4.4 8Z" fill="#8af2c0"/><path d="M12 10.4 16.8 20.6H7.2Z" fill="#1d6e4a"/><path d="M4.4 8 12 10.4 7.2 20.6Z" fill="#3fc488"/><path d="M12 2.2 19.6 8 16.8 20.6H7.2L4.4 8Z" fill="none" stroke="#d8ffe9" stroke-opacity=".55" stroke-width=".7" stroke-linejoin="round"/>`,
  peach: `<path d="M12 7.2c-4.6 0-7.6 3.2-7.6 7.2 0 4.2 3.4 7.4 7.6 7.4s7.6-3.2 7.6-7.4c0-4-3-7.2-7.6-7.2z" fill="#f28f74"/><path d="M12 7.2c4.6 0 7.6 3.2 7.6 7.2 0 2-1 4-2.6 5.4 1-5.8-2.2-10.4-5-12.6z" fill="#e0605a" opacity=".8"/><ellipse cx="8.6" cy="12" rx="2.2" ry="3" fill="#ffd9bc" opacity=".75"/><path d="M12 7.6c-1.4 3.6-1.2 9.4.4 13.8" stroke="#c84b4b" stroke-width=".8" fill="none"/><path d="M12.2 7.4c.8-3.2 3.8-4.8 7-4.2-.7 3-3.6 4.8-7 4.2z" fill="#5fae5a"/><path d="M12.2 7.4c2-1.6 3.8-2.6 6-3.4" stroke="#2f6e33" stroke-width=".6" fill="none"/>`,
  shoot: `<path d="M12 1.8c2.6 4.6 5.6 9.6 5.6 14.6 0 3.4-2.6 5.6-5.6 5.6s-5.6-2.2-5.6-5.6c0-5 3-10 5.6-14.6z" fill="#d6b864"/><path d="M12 1.8c1.6 3 2.8 5.6 3.4 8-1.4-.6-2.4-.6-3.4 0z" fill="#8fc45a"/><path d="M6.6 16.6c2.2-1.8 8.6-1.8 10.8 0M7.8 12.2c1.6-1.4 6.8-1.4 8.4 0M9.4 8.2c1-.9 4.2-.9 5.2 0" stroke="#7a6326" stroke-width=".9" fill="none" stroke-linecap="round"/><path d="M12 22c-1.8-2.8-2.2-9.2 0-17" stroke="#fff3c4" stroke-opacity=".45" stroke-width=".8" fill="none"/>`,
  mushroom: `<path d="M9.4 12.4h5.2l.8 7.6c-1.6 1.2-5.2 1.2-6.8 0z" fill="#f1e3c6"/><path d="M2.6 12.6C2.6 6.4 7 3.4 12 3.4s9.4 3 9.4 9.2c-3 1.4-15.8 1.4-18.8 0z" fill="#a85a34"/><path d="M5 9.6c1-3 3.8-4.6 7-4.6" stroke="#e7a77a" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".8"/><circle cx="9" cy="8.6" r="1.1" fill="#f6dcc0"/><circle cx="14.6" cy="7.4" r=".9" fill="#f6dcc0"/><circle cx="16.8" cy="10.4" r="1" fill="#f6dcc0"/>`,
  dumpling: `<path d="M2.6 15.4C4 8.6 8 5.6 12 5.6s8 3 9.4 9.8c-3 2.6-15.8 2.6-18.8 0z" fill="#f6ecd4"/><path d="M7 7.8l1.4 3M10 6.2l.6 3.2M14 6.2l-.6 3.2M17 7.8l-1.4 3" stroke="#c9b48a" stroke-width=".9" stroke-linecap="round"/><path d="M4 15.6c3 1.6 13 1.6 16 0" stroke="#d8c6a0" stroke-width=".8" fill="none"/>`,
  scroll: `<rect x="5" y="4" width="14" height="16" rx="1.5" fill="#efe0b8"/><rect x="3.6" y="2.6" width="16.8" height="3" rx="1.5" fill="#b0462f"/><rect x="3.6" y="18.4" width="16.8" height="3" rx="1.5" fill="#b0462f"/><path d="M8 9h8M8 12h8M8 15h5" stroke="#8a7650" stroke-width=".9"/>`,
};

// ------------------------------------------------------------------ textures
let GLOW: THREE.Texture | null = null;
/** a soft white radial glow (tint it with the material color, draw it additively) */
export function glowTexture() {
  if (GLOW) return GLOW;
  const S = 128, c = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const r = g.createRadialGradient(c, c, 0, c, c, c);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.22, 'rgba(255,255,255,0.45)');
  r.addColorStop(0.55, 'rgba(255,255,255,0.12)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, S, S);
  GLOW = new THREE.CanvasTexture(cv);
  GLOW.colorSpace = THREE.SRGBColorSpace;
  return GLOW;
}

const iconTex = new Map<Icon, THREE.Texture>();
/** a round ink medallion with a gold rim and the item drawn inside (the SVG loads asynchronously) */
export function iconTexture(k: Icon) {
  let t = iconTex.get(k);
  if (t) return t;
  const S = 128, c = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const base = () => {
    g.clearRect(0, 0, S, S);
    g.save();
    g.shadowColor = 'rgba(255,205,100,0.95)';
    g.shadowBlur = 14;
    g.beginPath();
    g.arc(c, c, 50, 0, Math.PI * 2);
    const face = g.createRadialGradient(c, c - 14, 4, c, c, 52);
    face.addColorStop(0, '#2a3a30');
    face.addColorStop(1, '#0c1511');
    g.fillStyle = face;
    g.fill();
    g.restore();
    g.lineWidth = 6;
    g.strokeStyle = '#f2c75c';
    g.beginPath();
    g.arc(c, c, 50, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(255,241,196,0.6)';
    g.beginPath();
    g.arc(c, c, 43, 0, Math.PI * 2);
    g.stroke();
  };
  base();
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  iconTex.set(k, t);
  const img = new Image();
  img.onload = () => {
    base();
    g.drawImage(img, c - 34, c - 34, 68, 68);
    t!.needsUpdate = true;
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="136" height="136">${ICONS[k]}</svg>`)}`;
  return t;
}

// ------------------------------------------------------------------ the floating cue
/**
 * A floating item icon with a warm halo over something a quest needs. It shows from ~40 m (full from
 * ~32 m), grows with distance so it stays readable, draws through foliage, and fades out when Le Chonk
 * is right next to it (the rim highlight takes over there).
 */
export class ItemCue {
  group = new THREE.Group();
  private icon: THREE.Sprite;
  private halo: THREE.Sprite;
  private level = 0;
  private phase: number;
  constructor(kind: Icon, private y: number, seed = 0) {
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffcf6a, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false, blending: THREE.AdditiveBlending }));
    this.icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(kind), transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false }));
    this.halo.renderOrder = 7;
    this.icon.renderOrder = 8;
    this.group.add(this.halo, this.icon);
    this.group.position.y = y;
    this.group.visible = false;
    this.group.userData.fx = true;
    this.phase = (seed % 100) * 0.37;
    excludeFromAO(this.group);
  }
  /** dist: from Le Chonk (m); want: the quest still needs this */
  update(dt: number, t: number, dist: number, want: boolean) {
    const target = want ? clamp((42 - dist) / 10, 0, 1) * clamp((dist - 2.2) / 2.5, 0, 1) : 0;
    this.level += (target - this.level) * (1 - Math.exp(-5 * dt));
    this.group.visible = this.level > 0.01;
    if (!this.group.visible) return;
    const s = clamp(dist / 11, 0.8, 3.2);
    const w = Math.sin(t * 3 + this.phase);
    this.group.position.y = this.y + Math.sin(t * 2 + this.phase) * 0.12 + (s - 1) * 0.5;
    this.icon.scale.setScalar(1.2 * s * (1 + w * 0.04));
    this.halo.scale.setScalar(2.8 * s * (1 + w * 0.12));
    this.icon.material.opacity = this.level;
    this.halo.material.opacity = this.level * (0.5 + w * 0.15);
  }
}
