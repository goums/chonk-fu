// Cartoon materials: 3-band toon shading plus inverted-hull ink outlines.
import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;
export function toonGradient() {
  if (gradient) return gradient;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export function toon(color: THREE.ColorRepresentation, extra: Partial<THREE.MeshToonMaterialParameters> = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
}

const INK = new THREE.Color(0x2b1d17);
const outlineMats = new Map<number, THREE.ShaderMaterial>();
/** back-face hull pushed along the normals: a clean ink outline that follows skinning-free rigs */
export function outlineMaterial(thickness = 0.022) {
  const key = Math.round(thickness * 1e4);
  let m = outlineMats.get(key);
  if (m) return m;
  m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { ink: { value: INK }, thickness: { value: thickness }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 2 } },
    fog: true,
    vertexShader: /* glsl */ `
      uniform float thickness;
      #include <fog_pars_vertex>
      void main() {
        vec3 n = normalize(normal);
        vec4 mvPosition = modelViewMatrix * vec4(position + n * thickness, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 ink;
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(ink, 1.0);
        #include <fog_fragment>
      }`,
  });
  outlineMats.set(key, m);
  return m;
}

/** add an ink hull to every mesh under `root` (meshes flagged userData.noOutline are skipped) */
export function addOutlines(root: THREE.Object3D, thickness = 0.022) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData.noOutline && !o.userData.isOutline) meshes.push(o as THREE.Mesh);
  });
  for (const m of meshes) {
    // the hull is offset in object space: compensate non-uniform scales so the line stays even
    const s = m.scale;
    const avg = (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3 || 1;
    const hull = new THREE.Mesh(m.geometry, outlineMaterial((m.userData.outline ?? thickness) / avg));
    hull.userData.isOutline = true;
    hull.castShadow = false;
    hull.raycast = () => {};
    m.add(hull);
  }
}
