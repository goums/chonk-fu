// Sky dome, sun, fog, and painterly layers of misty distant mountains (the Valley's signature look).
import * as THREE from 'three';
import { fbm, rng } from '../core/math';

export const SKY = {
  zenith: new THREE.Color(0x6fa8d8),
  horizon: new THREE.Color(0xf6e3c0),
  fog: new THREE.Color(0xe9dcc0),
  sunDir: new THREE.Vector3(0.45, 0.62, 0.35).normalize(),
};

export function buildSky(): THREE.Group {
  const group = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1800, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: SKY.zenith },
        horizon: { value: SKY.horizon },
        sunDir: { value: SKY.sunDir },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 zenith, horizon, sunDir;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 c = mix(horizon, zenith, pow(smoothstep(-0.02, 0.75, h), 0.7));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          c += vec3(1.0, 0.85, 0.55) * (pow(s, 600.0) * 1.2 + pow(s, 12.0) * 0.18);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);

  // Distant mountain ridges: open cylinders with a ridge-shaped alpha, lighter and bluer with distance.
  const layers = [
    { r: 520, h: 230, tint: 0x9db7a8, seed: 1, peaks: 9 },
    { r: 720, h: 330, tint: 0xb4c6bf, seed: 2, peaks: 7 },
    { r: 980, h: 420, tint: 0xcdd6cf, seed: 3, peaks: 6 },
  ];
  for (const L of layers) group.add(ridge(L.r, L.h, L.tint, L.seed, L.peaks));

  // a few soft clouds
  const R = rng(7);
  const cloudTex = cloudTexture();
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.75, fog: false, depthWrite: false }));
    const a = R() * Math.PI * 2, d = 600 + R() * 500;
    s.position.set(Math.cos(a) * d, 180 + R() * 160, Math.sin(a) * d);
    s.scale.set(260 + R() * 220, 70 + R() * 40, 1);
    group.add(s);
  }
  return group;
}

function ridge(radius: number, height: number, tint: number, seed: number, peaks: number) {
  const W = 2048, Hh = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = Hh;
  const g = cv.getContext('2d')!;
  const col = new THREE.Color(tint);
  const top = col.clone().offsetHSL(0, -0.05, -0.08);
  const grad = g.createLinearGradient(0, 0, 0, Hh);
  grad.addColorStop(0, `#${top.getHexString()}`);
  grad.addColorStop(1, `#${col.clone().lerp(SKY.fog, 0.6).getHexString()}`);
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, Hh);
  const R = rng(seed * 31);
  const centers = Array.from({ length: peaks }, () => ({ c: R(), w: 0.02 + R() * 0.05, h: 0.45 + R() * 0.5 }));
  for (let x = 0; x <= W; x += 4) {
    const u = x / W;
    let y = 0.25 + fbm(u * 12, seed, 4, seed) * 0.12;
    // tall rounded karst peaks
    for (const p of centers) {
      let du = Math.abs(u - p.c);
      du = Math.min(du, 1 - du);
      y = Math.max(y, p.h * Math.exp(-((du / p.w) ** 2) * 1.5));
    }
    g.lineTo(x, Hh - y * Hh * 0.95);
  }
  g.lineTo(W, Hh);
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 96, 1, true),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  m.position.y = height / 2 - 30;
  m.renderOrder = -9;
  return m;
}

function cloudTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 96;
  const g = cv.getContext('2d')!;
  const R = rng(3);
  for (let i = 0; i < 22; i++) {
    const x = 30 + R() * 196, y = 40 + R() * 30, r = 18 + R() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildLights(scene: THREE.Scene) {
  scene.fog = new THREE.Fog(SKY.fog, 90, 520);
  const hemi = new THREE.HemisphereLight(0xdfeeff, 0x6b7a45, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
  sun.position.copy(SKY.sunDir).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -45; s.right = 45; s.top = 45; s.bottom = -45; s.near = 1; s.far = 300;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  return { sun, hemi };
}
