// Characters made with the asset pipeline (concept art -> TRELLIS.2 mesh -> Blender bone-heat skin,
// see tools/). The GLB carries the textured mesh, its skin weights and the joint positions. Here we
// rebuild the game's own skeleton on those joints (identity rest axes, A-pose arms) so the procedural
// Animator drives these detailed characters exactly like the sculpted ones.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ChonkRig } from './model';

const PARENT: Record<string, string | null> = {
  hips: null, body: 'hips', head: 'body', shoulderL: 'body', elbowL: 'shoulderL', shoulderR: 'body', elbowR: 'shoulderR',
  legL: 'hips', kneeL: 'legL', legR: 'hips', kneeR: 'legR', tail0: 'body',
};
const ORDER = ['hips', 'body', 'head', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'legL', 'kneeL', 'legR', 'kneeR', 'tail0'];

const loaded = new Map<string, GLTF>();

export interface ModelInfo { tail?: { colors: number[]; r: number; segments: number } }
const INFO: Record<string, ModelInfo> = {
  chonk: { tail: { colors: [0xe8893a, 0xb85a1c], r: 0.085, segments: 7 } },
};

export async function preloadModels(names: string[]) {
  const loader = new GLTFLoader();
  await Promise.all(
    names.map(async (n) => {
      try {
        loaded.set(n, await loader.loadAsync(`${import.meta.env.BASE_URL}models/${n}.glb`));
      } catch (e) {
        console.warn(`model ${n} not available, using the sculpted fallback`, e);
      }
    }),
  );
}
export const hasModel = (n: string) => loaded.has(n);

/** Euler (XYZ) that turns the rest direction (0,-1,0) into `dir`, with no twist */
function hangRotation(dir: THREE.Vector3) {
  const d = dir.clone().normalize();
  const z = Math.asin(THREE.MathUtils.clamp(d.x, -1, 1));
  const x = Math.atan2(-d.z, -d.y);
  return new THREE.Euler(x, 0, z, 'XYZ');
}

export function rigFromModel(name: string): ChonkRig | null {
  const gltf = loaded.get(name);
  if (!gltf) return null;
  const scene = cloneSkinned(gltf.scene) as THREE.Group;
  scene.updateMatrixWorld(true);
  let skinned: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && !skinned) skinned = o as THREE.SkinnedMesh;
  });
  if (!skinned) return null;
  const mesh = skinned as THREE.SkinnedMesh;
  // joint world positions from the exported (rest-pose) skeleton
  const W: Record<string, THREE.Vector3> = {};
  // (three.js de-duplicates clashing node names with a _N suffix)
  const jointName = (n: string) => n.replace(/_\d+$/, '');
  for (const b of mesh.skeleton.bones) W[jointName(b.name)] = b.getWorldPosition(new THREE.Vector3());
  // the tail stump is not a deforming bone, it may be missing from the skin: place it behind the hips
  W.tail0 ??= W.hips.clone().add(new THREE.Vector3(0, -0.05, -0.4));

  const root = new THREE.Group();
  root.name = name;
  const B: Record<string, THREE.Bone> = {};
  for (const n of ORDER) {
    B[n] = new THREE.Bone();
    B[n].name = n;
  }
  // rest rotations: arms and legs hang along their sculpted direction (absolute animator angles then
  // mean the same thing as on the procedural rig)
  B.shoulderL.rotation.copy(hangRotation(W.elbowL.clone().sub(W.shoulderL)));
  B.shoulderR.rotation.copy(hangRotation(W.elbowR.clone().sub(W.shoulderR)));
  B.legL.rotation.copy(hangRotation(W.kneeL.clone().sub(W.legL)));
  B.legR.rotation.copy(hangRotation(W.kneeR.clone().sub(W.legR)));
  // assemble top-down, converting world joint positions into each parent's frame
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
  // re-bind the mesh to our skeleton, keeping the exported skin indices (same joint names)
  root.attach(mesh);
  root.updateMatrixWorld(true);
  // Blender adds a "neutral_bone" for unweighted vertices: pin those to the hips
  const bones = mesh.skeleton.bones.map((b) => B[jointName(b.name)] ?? B.hips);
  mesh.bind(new THREE.Skeleton(bones), mesh.matrixWorld.clone());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.roughness = Math.max(mat.roughness, 0.75);
  mat.metalness = 0;

  // face pieces the animator expects (expressions are baked in the texture: these stay invisible)
  const dummy = () => {
    const m = new THREE.Mesh();
    m.visible = false;
    B.head.add(m);
    return m;
  };
  // an animated tail (the generated one is removed in tools/rig.py)
  const info = INFO[name] ?? {};
  const tail: THREE.Object3D[] = [B.tail0];
  if (info.tail) {
    B.tail0.rotation.x = -1.1;
    let parent: THREE.Object3D = B.tail0;
    const segLen = info.tail.r * 1.9;
    const mats = info.tail.colors.map((c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.8, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffe2b8) }));
    for (let i = 0; i < info.tail.segments; i++) {
      const seg = new THREE.Group();
      seg.position.y = i === 0 ? 0 : segLen;
      const r = info.tail.r * (1 - (i / info.tail.segments) * 0.35);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, segLen * 0.75, 6, 12), mats[i % mats.length]);
      m.position.y = segLen / 2;
      m.castShadow = true;
      seg.add(m);
      parent.add(seg);
      tail.push(seg);
      parent = seg;
    }
  }
  const G = (b: THREE.Bone) => b as unknown as THREE.Group;
  return {
    root, hipBase: W.hips.y, hips: G(B.hips), body: G(B.body), head: G(B.head),
    browL: dummy(), browR: dummy(), mouth: dummy(),
    shoulderL: G(B.shoulderL), shoulderR: G(B.shoulderR), elbowL: G(B.elbowL), elbowR: G(B.elbowR),
    legL: G(B.legL), legR: G(B.legR), kneeL: G(B.kneeL), kneeR: G(B.kneeR),
    tail: tail as THREE.Group[], belly: mesh as unknown as THREE.Mesh,
  };
}
