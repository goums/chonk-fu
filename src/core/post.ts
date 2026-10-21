// Film-style post-processing: ambient occlusion (contact shadows), soft bloom on bright highlights,
// and a warm color grade with a gentle vignette, like an animated-feature frame.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uWarm: { value: 0.06 }, uSat: { value: 1.12 }, uVignette: { value: 0.32 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uWarm, uSat, uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      // warm highlights, slightly teal shadows (feature-animation look)
      c.rgb += vec3(uWarm, uWarm * 0.45, -uWarm * 0.4) * smoothstep(0.35, 1.0, l);
      c.rgb += vec3(-0.015, 0.005, 0.03) * (1.0 - smoothstep(0.0, 0.4, l));
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = c;
    }`,
};

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, size.x, size.y);
  ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, samples: 12 });
  ao.blendIntensity = 0.85;
  composer.addPass(ao);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.6, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(GradeShader));
  return {
    composer,
    ao,
    setSize(w: number, h: number) {
      composer.setSize(w, h);
      ao.setSize(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    },
    render() {
      composer.render();
    },
  };
}
