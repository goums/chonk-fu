import * as THREE from 'three';
import { Input } from './core/input';
import { FollowCamera } from './game/camera';
import { Player } from './game/player';
import { VILLAGE } from './world/layout';
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

const player = new Player(VILLAGE.x, VILLAGE.z);
scene.add(player.object);

const input = new Input(canvas);
const follow = new FollowCamera(camera);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
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
    time += DT;
    acc -= DT;
  }
  const moving = Math.hypot(player.vel.x, player.vel.z) > 1;
  follow.update(1 / 60, player.pos, player.heading, moving, input.look);
  sun.position.copy(player.pos).add(new THREE.Vector3(0.45, 0.62, 0.35).normalize().multiplyScalar(120));
  sun.target.position.copy(player.pos);
  water.update(time);
  grass.update(time);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debug handle for the harness and for development
Object.assign(window, { chonk: { player, follow, scene, camera, renderer, THREE } });
