import * as THREE from 'three';
import { Input } from './core/input';
import { createPost } from './core/post';
import { FollowCamera } from './game/camera';
import { Player } from './game/player';
import { buildCharacter, type CharacterKind } from './chonk/characters';
import { Animator } from './chonk/animator';
import { VILLAGE } from './world/layout';
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

const player = new Player(VILLAGE.x, VILLAGE.z);
scene.add(player.object);

// ?lineup: show the whole cast next to Le Chonk (art check)
const lineup: Animator[] = [];
if (new URLSearchParams(location.search).has('lineup')) {
  (['tiger', 'wolf', 'tortoise', 'duck', 'pig', 'bunny'] as CharacterKind[]).forEach((k, i) => {
    const rig = buildCharacter(k);
    const x = VILLAGE.x + (i < 3 ? -1 : 1) * (1.6 + (i % 3) * 1.5), z = VILLAGE.z;
    rig.root.position.set(x, player.pos.y, z);
    scene.add(rig.root);
    lineup.push(new Animator(rig));
  });
}
const post = new URLSearchParams(location.search).has('nopost') ? null : createPost(renderer, scene, camera);
const input = new Input(canvas);
const follow = new FollowCamera(camera);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  post?.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const DT = 1 / 60;
let acc = 0, last = performance.now(), time = 0;
function frame(now: number) {
  acc = Math.min(acc + (now - last) / 1000, 0.25);
  last = now;
  while (acc >= DT) {
    const intent = input.intent();
    input.endFrame();
    player.step(DT, intent, follow.yaw);
    for (const a of lineup) a.update({ t: time, speed: 0, grounded: true, vy: 0, move: null, moveT: 0, hurtT: Infinity, ko: false, angry: false }, DT);
    time += DT;
    acc -= DT;
  }
  const moving = Math.hypot(player.vel.x, player.vel.z) > 1;
  follow.update(1 / 60, player.pos, player.heading, moving, input.look);
  sun.position.copy(player.pos).add(new THREE.Vector3(0.45, 0.62, 0.35).normalize().multiplyScalar(120));
  sun.target.position.copy(player.pos);
  water.update(time);
  grass.update(time);
  if (post) post.render();
  else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debug handle for the harness and for development
Object.assign(window, { chonk: { player, follow, scene, camera, renderer, THREE, post } });
