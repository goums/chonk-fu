// Offline check of src/chonk/retarget.ts (no browser): retargets the humanoid clips onto a GLB character
// rig, built exactly like gltfRig.ts does, prints per-clip stats and dumps sampled poses (joints, paw /
// sole ends, skinned mesh points, source skeleton) to JSON for tools/retarget-plot.py.
//
//   node tools/retarget-test.mjs [model=chonk] [out.json] [clip,clip,...]
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { NodeIO } from '@gltf-transform/core';
import { animLibraryFromGLTF, retargetClips, describeRig, clipGroundSpeed, sampleClip } from '../src/chonk/retarget.ts';

const model = process.argv[2] ?? 'chonk';
const outPath = process.argv[3] ?? 'retarget-poses.json';
const CLIPS = (process.argv[4] ?? 'Walk,Punch_Jab,Victory,Kick_Breach,Jump_Start,Death_D,Attack_Ground_Pound,Sprint').split(',');

const parse = (buf) => new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));

// --- source library
const lib = animLibraryFromGLTF(await parse(fs.readFileSync('public/anims/human.glb')));
console.log(`library: ${lib.names.length} clips, pelvis height ${lib.hipHeight.toFixed(3)}`);
for (const [b, h] of Object.entries(lib.hinge)) console.log(`  hinge ${b.padEnd(11)} (local) ${h.toArray().map((v) => v.toFixed(2)).join(' ')}`);

// --- target rig (gltfRig.ts rigFromModel without materials; textures stripped for Node)
const io = new NodeIO();
const doc = await io.read(`public/models/${model}.glb`);
for (const t of doc.getRoot().listTextures()) t.dispose();
const gltf = await parse(Buffer.from(await io.writeBinary(doc)));
const PARENT = { hips: null, body: 'hips', head: 'body', shoulderL: 'body', elbowL: 'shoulderL', shoulderR: 'body', elbowR: 'shoulderR', legL: 'hips', kneeL: 'legL', legR: 'hips', kneeR: 'legR', tail0: 'body' };
const ORDER = ['hips', 'body', 'head', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'legL', 'kneeL', 'legR', 'kneeR', 'tail0'];
function hangRotation(dir) {
  const d = dir.clone().normalize();
  return new THREE.Euler(Math.atan2(-d.z, -d.y), 0, Math.asin(THREE.MathUtils.clamp(d.x, -1, 1)), 'XYZ');
}
const scene = gltf.scene;
scene.updateMatrixWorld(true);
let mesh;
scene.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
const W = {};
const jointName = (n) => n.replace(/_\d+$/, '');
for (const b of mesh.skeleton.bones) W[jointName(b.name)] = b.getWorldPosition(new THREE.Vector3());
W.tail0 ??= W.hips.clone().add(new THREE.Vector3(0, -0.05, -0.4));
const root = new THREE.Group();
const B = {};
for (const n of ORDER) { B[n] = new THREE.Bone(); B[n].name = n; }
B.shoulderL.rotation.copy(hangRotation(W.elbowL.clone().sub(W.shoulderL)));
B.shoulderR.rotation.copy(hangRotation(W.elbowR.clone().sub(W.shoulderR)));
B.legL.rotation.copy(hangRotation(W.kneeL.clone().sub(W.legL)));
B.legR.rotation.copy(hangRotation(W.kneeR.clone().sub(W.legR)));
root.add(B.hips);
B.hips.position.copy(W.hips);
root.updateMatrixWorld(true);
for (const n of ORDER) {
  const p = PARENT[n];
  if (!p) continue;
  B[p].add(B[n]);
  B[n].position.copy(B[p].worldToLocal(W[n].clone()));
  B[n].updateMatrixWorld(true);
}
root.attach(mesh);
root.updateMatrixWorld(true);
mesh.bind(new THREE.Skeleton(mesh.skeleton.bones.map((b) => B[jointName(b.name)] ?? B.hips)), mesh.matrixWorld.clone());
const rig = { root, hipBase: W.hips.y, ...B, tail: [B.tail0], belly: mesh };

const T = describeRig(rig);

// --- retarget everything (timing), check the tracks are finite, print durations and ground speeds
const t0 = performance.now();
const clips = retargetClips(lib, rig);
console.log(`retargeted ${clips.size} clips in ${(performance.now() - t0).toFixed(0)} ms`);
console.log('clip                   dur   speed(src m/s) speed(rig m/s)');
for (const [name, clip] of clips) {
  for (const t of clip.tracks) for (const v of t.values) if (!Number.isFinite(v)) throw new Error(`${name}: non-finite ${t.name}`);
  console.log(`${name.padEnd(22)} ${clip.duration.toFixed(2).padStart(5)}  ${clipGroundSpeed(lib, name).toFixed(2).padStart(9)} ${clipGroundSpeed(lib, name, T).toFixed(2).padStart(13)}`);
}

// --- pose dump
const mixer = new THREE.AnimationMixer(root);
const SAMPLES = [0, 0.25, 0.5, 0.75];
const SRC_LINES = [['pelvis', 'spine_03'], ['spine_03', 'head'], ['upperarm_l', 'lowerarm_l'], ['lowerarm_l', 'hand_l'], ['upperarm_r', 'lowerarm_r'], ['lowerarm_r', 'hand_r'], ['thigh_l', 'calf_l'], ['calf_l', 'foot_l'], ['foot_l', 'ball_l'], ['thigh_r', 'calf_r'], ['calf_r', 'foot_r'], ['foot_r', 'ball_r'], ['spine_03', 'upperarm_l'], ['spine_03', 'upperarm_r'], ['pelvis', 'thigh_l'], ['pelvis', 'thigh_r']];
const step = Math.max(1, Math.floor(mesh.geometry.attributes.position.count / 2500));
const out = { model, clips: [] };
const boneOf = [];
{
  const SI = mesh.geometry.attributes.skinIndex, SW = mesh.geometry.attributes.skinWeight;
  for (let i = 0; i < mesh.geometry.attributes.position.count; i += step) {
    let best = 0, bw = 0;
    for (let c = 0; c < 4; c++) if (SW.getComponent(i, c) > bw) { bw = SW.getComponent(i, c); best = SI.getComponent(i, c); }
    boneOf.push(mesh.skeleton.bones[best].name);
  }
}
out.boneOf = boneOf;
const v = new THREE.Vector3(), wq = new THREE.Quaternion();
for (const name of ['REST', ...CLIPS]) {
  const clip = name === 'REST' ? new THREE.AnimationClip('REST', 1, []) : clips.get(name);
  if (!clip) { console.warn(`no clip ${name}`); continue; }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  const action = mixer.clipAction(clip);
  action.play();
  const src = sampleClip(lib, name === 'REST' ? 'Idle_A' : name);
  const entry = { name, duration: clip.duration, poses: [] };
  for (const u of SAMPLES) {
    const t = u * clip.duration;
    // REST comes first: the freshly built rig is still in its bind pose
    if (name !== 'REST') mixer.setTime(t);
    root.updateMatrixWorld(true);
    const J = {};
    for (const n of ORDER) J[n] = B[n].getWorldPosition(new THREE.Vector3()).toArray();
    // paw tips / soles: the lower segment carried by the elbow / knee
    for (const [low, key] of [['elbowL', 'pawL'], ['elbowR', 'pawR'], ['kneeL', 'footL'], ['kneeR', 'footR']]) {
      const s = T.seg[low];
      const local = s.dir.clone().applyQuaternion(T.restQuat[low].clone().invert());
      B[low].getWorldQuaternion(wq);
      J[key] = B[low].getWorldPosition(new THREE.Vector3()).add(local.applyQuaternion(wq).multiplyScalar(s.len)).toArray();
    }
    const pts = [];
    for (let i = 0; i < mesh.geometry.attributes.position.count; i += step) {
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      pts.push(+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3));
    }
    // the source skeleton at the same time, scaled to the rig's hip height
    const fi = Math.min(src.frames - 1, Math.round(t * 30));
    const k = T.hipHeight / lib.hipHeight;
    const S = {};
    for (const b of Object.keys(src.pos)) S[b] = Array.from(src.pos[b].slice(fi * 3, fi * 3 + 3), (x) => x * k);
    entry.poses.push({ t, J, pts, S, srcLines: SRC_LINES });
  }
  out.clips.push(entry);
}
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`wrote ${outPath}`);
