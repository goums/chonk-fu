// Comic-book hit effects: starburst flashes, onomatopoeia ("POW!", "BOING!"), damage numbers, dust puffs,
// and sparkles for pickups. All sprites from canvas textures, pooled.
import * as THREE from 'three';
import { excludeFromAO } from './highlight';
import { t } from '../i18n';

interface Fx { obj: THREE.Sprite; t: number; life: number; vy: number; grow: number; fade: boolean }

const texCache = new Map<string, THREE.Texture>();
function textTexture(text: string, fill: string, stroke = '#2b1d17', size = 64) {
  const k = `${text}|${fill}|${size}`;
  let t = texCache.get(k);
  if (t) return t;
  const cv = document.createElement('canvas');
  const g = cv.getContext('2d')!;
  g.font = `700 ${size}px Fredoka, system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + size * 0.5;
  cv.width = w;
  cv.height = size * 1.5;
  g.font = `700 ${size}px Fredoka, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.16;
  g.strokeStyle = stroke;
  g.strokeText(text, w / 2, cv.height / 2);
  g.fillStyle = fill;
  g.fillText(text, w / 2, cv.height / 2);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(k, t);
  return t;
}

function burstTexture(color: string) {
  const k = `burst|${color}`;
  let t = texCache.get(k);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  g.translate(64, 64);
  g.beginPath();
  const n = 12;
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? 26 : 58 - (i % 4) * 6;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#2b1d17';
  g.stroke();
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(k, t);
  return t;
}

function puffTexture() {
  let t = texCache.get('puff');
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  gr.addColorStop(0, 'rgba(240,226,196,0.95)');
  gr.addColorStop(1, 'rgba(240,226,196,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  t = new THREE.CanvasTexture(cv);
  texCache.set('puff', t);
  return t;
}

const WORDS: Record<string, string[]> = {
  jab: ['PAF!', 'POK!', 'TAP!'],
  cross: ['POW!', 'BAM!', 'WHAM!'],
  kick: ['KAPOW!', 'WHACK!', 'BOOM!'],
  belly: ['BOING!', 'BOUNCE!', 'FLUMP!'],
  slam: ['KRAKOOM!', 'THOOM!'],
};

export class Effects {
  private list: Fx[] = [];
  private n = 0;
  constructor(private scene: THREE.Scene) {}

  private spawn(map: THREE.Texture, x: number, y: number, z: number, w: number, h: number, life: number, vy = 0, grow = 0, fade = true) {
    const m = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, depthTest: false, fog: false });
    const s = excludeFromAO(new THREE.Sprite(m));
    s.position.set(x, y, z);
    s.scale.set(w, h, 1);
    s.renderOrder = 10;
    this.scene.add(s);
    this.list.push({ obj: s, t: 0, life, vy, grow, fade });
  }

  hit(x: number, y: number, z: number, move: string, damage: number, byPlayer: boolean) {
    const words = WORDS[move] ?? WORDS.jab;
    // (the game picks the English word; it is translated for display only)
    const word = t(words[this.n++ % words.length]);
    const big = move === 'kick' || move === 'belly' || move === 'slam';
    this.spawn(burstTexture(byPlayer ? '#ffd23a' : '#ff6a4a'), x, y, z, big ? 2.2 : 1.5, big ? 2.2 : 1.5, 0.22, 0, 6);
    if (byPlayer) this.spawn(textTexture(word, big ? '#ff5a3a' : '#ffe14a'), x + (this.n % 2 ? 0.6 : -0.6), y + 0.9, z, big ? 3.2 : 2.3, big ? 1.2 : 0.9, 0.7, 1.4, 0.6);
    this.spawn(textTexture(`${damage}`, byPlayer ? '#ffffff' : '#ff4a3a', '#2b1d17', 48), x, y + 0.3, z, 0.8, 0.6, 0.8, 2.2, 0);
  }

  text(text: string, x: number, y: number, z: number, color = '#ffe14a', scale = 1) {
    const tex = textTexture(t(text), color);
    const img = tex.image as HTMLCanvasElement;
    const h = 0.9 * scale;
    this.spawn(tex, x, y, z, (h * img.width) / img.height, h, 1.4, 1.0, 0);
  }

  dust(x: number, y: number, z: number, n = 6, size = 1) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawn(puffTexture(), x + Math.cos(a) * 0.5 * size, y + 0.2, z + Math.sin(a) * 0.5 * size, 1.2 * size, 1.2 * size, 0.6, 0.6, 1.5);
    }
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      const u = f.t / f.life;
      f.obj.position.y += f.vy * dt;
      if (f.grow) f.obj.scale.multiplyScalar(1 + f.grow * dt * (1 - u));
      if (f.fade) (f.obj.material as THREE.SpriteMaterial).opacity = Math.min(1, (1 - u) * 2.5);
      if (u >= 1) {
        this.scene.remove(f.obj);
        f.obj.material.dispose();
        this.list.splice(i, 1);
      }
    }
  }
}
