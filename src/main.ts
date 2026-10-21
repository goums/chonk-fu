import * as THREE from 'three';
import { Input, emptyIntent, type Intent } from './core/input';
import { createPost } from './core/post';
import { FollowCamera } from './game/camera';
import { Game } from './game/game';
import { preloadModels } from './chonk/gltfRig';
import { Hud } from './ui/hud';
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
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3000);
const { sun, water, grass } = buildWorld(scene);
// image-based lighting from the sky, so PBR materials pick up the warm valley ambience
{
  const envScene = new THREE.Scene();
  envScene.add(buildSky());
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0.6;
}

await preloadModels(['chonk', 'tiger', 'wolf', 'tortoise', 'duck', 'pig', 'bunny']);
const game = new Game(scene);
const hud = new Hud(document.getElementById('hud')!, game);
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
  follow.update(real, P.pos, P.heading, moving, input.look);
  if (game.shake > 0) {
    const s = game.shake * 0.25;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
  }
  sun.position.copy(P.pos).addScaledVector(SUN_DIR, 120);
  sun.target.position.copy(P.pos);
  water.update(time);
  grass.update(time);
  hud.update(real, follow.yaw);
  game.events.length = 0;
  if (post) post.render();
  else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debug handle for development and the agent harness
Object.assign(window, { chonk: { game, player: game.player, follow, scene, camera, renderer, THREE, post, tick, external } });
