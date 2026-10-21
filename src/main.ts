import * as THREE from 'three';
import { Input, emptyIntent, type Intent } from './core/input';
import { createPost } from './core/post';
import { FollowCamera } from './game/camera';
import { Game } from './game/game';
import { buildCharacter, type CharacterKind } from './chonk/characters';
import { preloadModels, rigFromModel } from './chonk/gltfRig';
import { initMotionLibrary, makeAnimator } from './chonk/motion';
import { groundAt } from './world/world';
import { Hud } from './ui/hud';
import { GameAudio } from './audio';
import { buildSky } from './world/sky';
import { buildWorld } from './world/world';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 2400);
const { sun, water, grass } = buildWorld(scene);
// image-based lighting from the sky, so PBR materials pick up the warm valley ambience
{
  const envScene = new THREE.Scene();
  envScene.add(buildSky());
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0.6;
}

const COMPARE = new URLSearchParams(location.search).has('compare');
await preloadModels(['chonk', 'tiger', 'wolf', 'tortoise', 'duck', 'pig', 'bunny', ...(COMPARE ? ['chonk-tripo', 'chonk-meshy', 'chonk-open', 'chonk-hunyuan'] : [])]);
await initMotionLibrary();
const game = new Game(scene);
const hud = new Hud(document.getElementById('hud')!, game);
const audio = new GameAudio(); // starts on the first key / pointer press, M mutes
const lineup: (() => void)[] = [];
// ?compare: the three Le Chonk candidates side by side; keys 1/2/3 swap the playable one
if (COMPARE) {
  const variants = ['chonk-tripo', 'chonk-meshy', 'chonk-open', 'chonk-hunyuan'];
  const labels = ['TRIPO', 'MESHY', 'OPEN', 'HUNYUAN'];
  variants.forEach((v, i) => {
    const rig = rigFromModel(v);
    if (!rig) return;
    const x = game.player.pos.x + (i - 1.5) * 2.4, z = game.player.pos.z - 3;
    rig.root.position.set(x, groundAt(x, z), z);
    scene.add(rig.root);
    const a = makeAnimator(rig);
    lineup.push(() => a.update({ t: performance.now() / 1000, speed: 0, grounded: true, vy: 0, move: null, moveT: 0, hurtT: Infinity, ko: false, angry: false }, 1 / 60));
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const g = cv.getContext('2d')!;
    g.fillStyle = 'rgba(43,29,23,0.8)'; g.fillRect(0, 0, 256, 64);
    g.font = '700 40px Fredoka, sans-serif'; g.fillStyle = '#ffe14a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${i + 1} · ${labels[i]}`, 128, 34);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
    tag.scale.set(1.2, 0.3, 1);
    tag.position.y = 2.3;
    rig.root.add(tag);
  });
  addEventListener('keydown', (e) => {
    const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (i < 0) return;
    const rig = rigFromModel(variants[i]);
    if (rig) game.player.swapRig(rig);
  });
}
// ?lineup: the whole cast next to Le Chonk (art check)
if (new URLSearchParams(location.search).has('lineup')) {
  (['tortoise', 'wolf', 'tiger', 'duck', 'pig', 'bunny'] as CharacterKind[]).forEach((k, i) => {
    const rig = buildCharacter(k);
    const x = game.player.pos.x + (i < 3 ? -1 : 1) * (1.8 + (i % 3) * 1.6), z = game.player.pos.z;
    rig.root.position.set(x, game.player.pos.y, z);
    scene.add(rig.root);
    const a = makeAnimator(rig);
    lineup.push(() => a.update({ t: performance.now() / 1000, speed: 0, grounded: true, vy: 0, move: null, moveT: 0, hurtT: Infinity, ko: false, angry: false }, 1 / 60));
  });
}
const post = new URLSearchParams(location.search).has('nopost') ? null : createPost(renderer, scene, camera);
const input = new Input(canvas);
const follow = new FollowCamera(camera);
follow.yaw = 0;

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  post?.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

/** external control (tests, AI harness): when active, the sim only advances through tick() */
const external = { active: false };
function tick(n: number, intent: Partial<Intent> = {}) {
  for (let i = 0; i < n; i++) {
    game.step(DT, { ...emptyIntent(), ...(i === 0 ? intent : { ...intent, jump: false, punch: false, kick: false, belly: false, interact: false }) }, follow.yaw);
    time += DT;
  }
  follow.update(DT * n, game.player.pos, game.player.heading, false, input.look);
}
const SUN_DIR = new THREE.Vector3(0.45, 0.62, 0.35).normalize();
const DT = 1 / 60;
let acc = 0, last = performance.now(), time = 0;
function frame(now: number) {
  const real = Math.min((now - last) / 1000, 0.25);
  acc += real;
  last = now;
  while (acc >= DT && !external.active) {
    const intent = input.intent();
    input.endFrame();
    game.step(DT, intent, follow.yaw);
    time += DT;
    acc -= DT;
  }
  const P = game.player;
  const moving = Math.hypot(P.vel.x, P.vel.z) > 1 && !game.dialog;
  follow.update(real, P.pos, P.heading, moving, input.look, P.vel);
  if (game.shake > 0) {
    const s = game.shake * 0.25;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
  }
  sun.position.copy(P.pos).addScaledVector(SUN_DIR, 120);
  sun.target.position.copy(P.pos);
  water.update(time);
  grass.update(time);
  for (const f of lineup) f();
  audio.update(game, real, follow.yaw); // reads this frame's game.events before they are cleared
  hud.update(real, follow.yaw);
  game.events.length = 0;
  if (post) post.render();
  else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debug handle for development and the agent harness
Object.assign(window, { chonk: { game, player: game.player, follow, scene, camera, renderer, THREE, post, tick, external } });
