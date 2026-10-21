// Builds public/anims/human.glb: the humanoid mocap clips we retarget onto our rigs (src/chonk/retarget.ts).
// Source: Mesh2Motion's CC0 human animation libraries (Quaternius Universal Animation Library, UE-mannequin
// skeleton). We keep the base library's skeleton (no mesh, no skin, no finger bones), only the clips we use,
// rotation tracks for every kept bone and translation tracks for root + pelvis.
//
//   node tools/build-anims.mjs <dir with human-{base,addon,mocap}-animations.glb>
//
// The three .glb files come from
// https://github.com/scottpetrovic/mesh2motion-app/tree/main/static/animations
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, resample } from '@gltf-transform/functions';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node tools/build-anims.mjs <source dir>');
const OUT = path.resolve('public/anims/human.glb');

// clips to keep, per source library
const KEEP = {
  base: [
    'Idle_A', 'Idle_FoldArms', 'Idle_Talking', 'Yes',
    'Walk', 'Jog', 'Sprint',
    'Jump_Start', 'Jump_air', 'Jump_Land', 'Roll',
    'Punch_Jab', 'Punch_Cross', 'Melee_Hook',
    'Hit_Chest', 'Hit_Head', 'Hit_Knockback',
    'Death_D', 'LayToIdle', 'Dance_Simple',
  ],
  addon: [
    'Idle_Subtle', 'Fighting Idle', 'Fighting Left Jab', 'Fighting Right Jab', 'Defend', 'Dodge_back',
    'Attack_Ground_Pound', 'Death_A', 'Death_B', 'Zombie_Rise', 'Idle Hurt', 'Dizzy', 'Angry',
    'Victory', 'Victory Fist Pump', 'Greeting', 'Head Nod', 'Power Up', 'Walk_Backwards',
  ],
  mocap: ['Kick_Breach', 'Cheer_One_arm', 'Cheering_Two_Hands', 'Insult'],
};

const DROP_NODE = /(index|middle|pinky|ring|thumb)_\d|_leaf/;
const TRANSLATE = new Set(['root', 'pelvis']);

const io = new NodeIO();
const doc = await io.read(path.join(dir, 'human-base-animations.glb'));
const root = doc.getRoot();
const buffer = root.listBuffers()[0];

// skeleton only
for (const n of root.listNodes()) {
  n.setMesh(null);
  n.setSkin(null);
}
for (const m of root.listMeshes()) m.dispose();
for (const s of root.listSkins()) s.dispose();
for (const t of root.listTextures()) t.dispose();
for (const m of root.listMaterials()) m.dispose();
for (const n of root.listNodes()) if (DROP_NODE.test(n.getName())) n.dispose();
const nodeByName = new Map(root.listNodes().map((n) => [n.getName(), n]));

const seen = new Set();
const kept = [];
function copyClip(src, name) {
  if (seen.has(name)) return; // the base library wins on name clashes
  seen.add(name);
  const anim = doc.createAnimation(name);
  for (const ch of src.listChannels()) {
    const target = ch.getTargetNode();
    const path = ch.getTargetPath();
    const node = target && nodeByName.get(target.getName());
    if (!node || path === 'scale' || path === 'weights') continue;
    if (path === 'translation' && !TRANSLATE.has(node.getName())) continue;
    const s = ch.getSampler();
    const input = doc.createAccessor().setArray(s.getInput().getArray().slice()).setType('SCALAR').setBuffer(buffer);
    const output = doc.createAccessor().setArray(s.getOutput().getArray().slice()).setType(s.getOutput().getType()).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation());
    anim.addSampler(sampler);
    anim.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
  }
  const dur = Math.max(...anim.listSamplers().map((s) => s.getInput().getMax([])[0]));
  kept.push([name, dur]);
}

const original = root.listAnimations();
const byName = new Map(original.map((a) => [a.getName(), a]));
for (const name of KEEP.base) if (byName.has(name)) copyClip(byName.get(name), name);
for (const lib of ['addon', 'mocap']) {
  const other = await io.read(path.join(dir, `human-${lib}-animations.glb`));
  const anims = new Map(other.getRoot().listAnimations().map((a) => [a.getName(), a]));
  for (const name of KEEP[lib]) {
    if (anims.has(name)) copyClip(anims.get(name), name);
    else console.warn(`missing ${lib}:${name}`);
  }
}
for (const a of original) {
  for (const s of a.listSamplers()) s.dispose();
  for (const c of a.listChannels()) c.dispose();
  a.dispose();
}

await doc.transform(resample({ tolerance: 1e-4 }), dedup());
// drop accessors left behind by the disposed clips / mesh (prune keeps some of them)
for (const a of root.listAccessors()) if (!a.listParents().some((p) => p.propertyType !== 'Root')) a.dispose();
await doc.transform(prune({ keepLeaves: true }));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
console.log(`${OUT}: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, ${kept.length} clips`);
for (const [n, d] of kept) console.log(`  ${n.padEnd(22)} ${d.toFixed(2)} s`);
