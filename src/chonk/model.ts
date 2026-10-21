// Shared character types and Le Chonk's palette. Characters are sculpted in creature.ts / characters.ts.
import * as THREE from 'three';

export const FUR = {
  orange: 0xf3922a,
  orangeDark: 0xd8691b,
  stripe: 0xb94f14,
  cream: 0xfde3b8,
  pink: 0xf59a9a,
  pants: 0x3d3047,
  pantsLight: 0x564463,
  sash: 0xf2c23a,
  collar: 0xd9362b,
  bell: 0xf7c843,
  eye: 0xf6c522,
  pupil: 0x231a17,
  brow: 0x7a3610,
};

export interface ChonkRig {
  root: THREE.Group; // feet on the ground, faces +z
  hipBase: number; // rest height of the hips joint
  hips: THREE.Group;
  body: THREE.Group; // belly + chest; rotates around the hips
  head: THREE.Group;
  browL: THREE.Mesh;
  browR: THREE.Mesh;
  mouth: THREE.Mesh;
  shoulderL: THREE.Group;
  shoulderR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  tail: THREE.Group[];
  belly: THREE.Mesh;
}

