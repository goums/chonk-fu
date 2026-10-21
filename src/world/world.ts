// Assembles the Valley and exposes the walkable ground height.
import * as THREE from 'three';
import { bridgeDeckAt, buildArchitecture, platformAt, reserved, stepTreadAt } from './buildings';
import { buildGrass } from './grass';
import { buildLights, buildSky } from './sky';
import { buildTerrain, heightAt } from './terrain';
import { buildVegetation } from './vegetation';
import { buildWater } from './water';

/** height of whatever Le Chonk stands on: terrain or a bridge deck */
export const groundAt = (x: number, z: number) => Math.max(heightAt(x, z), bridgeDeckAt(x, z), platformAt(x, z), stepTreadAt(x, z));

export function buildWorld(scene: THREE.Scene) {
  scene.add(buildSky());
  const lights = buildLights(scene);
  scene.add(buildTerrain());
  const water = buildWater();
  scene.add(water.mesh);
  scene.add(buildArchitecture()); // registers footprints first...
  scene.add(buildVegetation(reserved)); // ...so trees avoid them
  const grass = buildGrass(reserved);
  scene.add(grass.group);
  return { ...lights, water, grass };
}
