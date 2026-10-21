// Stylized water: a flat sheet at WATER_LEVEL with soft moving ripples and foam where it is shallow.
import * as THREE from 'three';
import { WATER_LEVEL, WORLD_SIZE } from './layout';

export function buildWater() {
  const mat = new THREE.MeshLambertMaterial({ color: 0x4fb3c4, transparent: true, opacity: 0.82 });
  const uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;\nuniform float uTime;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float w = sin(vWorld.x * 0.35 + uTime * 1.3) * sin(vWorld.z * 0.31 - uTime * 1.1)
                + 0.5 * sin(vWorld.x * 0.9 - vWorld.z * 0.7 + uTime * 2.1);
        diffuseColor.rgb += smoothstep(0.9, 1.4, w) * 0.22;`,
      );
  };
  const m = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = WATER_LEVEL;
  m.name = 'water';
  return { mesh: m, update: (t: number) => (uniforms.uTime.value = t) };
}
