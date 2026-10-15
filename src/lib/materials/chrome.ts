import * as THREE from "three";

/**
 * Shared weather uniforms. The Weather component eases these toward the current conditions; every
 * chrome material reads them, so hands get wet in the rain, dry off afterwards, and gather snow.
 */
export const weatherUniforms = {
  uWet: { value: 0 },
  uSnow: { value: 0 },
  /** 1 while it's raining, so droplets run down; 0 once it stops and they just sit and dry. */
  uRaining: { value: 0 },
  uTime: { value: 0 },
};

const VERTEX_HEAD = /* glsl */ `
varying vec3 vSleightWorld;
`;
const VERTEX_BODY = /* glsl */ `
#include <project_vertex>
vSleightWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform float uWet;
uniform float uSnow;
uniform float uRaining;
uniform float uTime;
varying vec3 vSleightWorld;
vec3 sleightHash3(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.xxy + p.yzz) * p.zyx);
}
`;

// After the normal is known: snow on up-facing surfaces, beaded droplets everywhere when wet.
const FRAGMENT_BODY = /* glsl */ `
#include <normal_fragment_maps>
{
  vec3 viewUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);

  // Droplets: one per 7 mm cell at a random spot, sliding down while it rains.
  float cell = 0.007;
  vec3 p = vSleightWorld + vec3(0.0, uTime * 0.02 * uRaining, 0.0);
  vec3 id = floor(p / cell);
  vec3 h = sleightHash3(id);
  vec3 centre = (id + 0.2 + 0.6 * h) * cell;
  float r = cell * (0.18 + 0.22 * h.z) * smoothstep(0.0, 0.35, uWet);
  vec3 d = p - centre;
  float present = step(h.y, uWet * 0.85);
  float drop = present * (1.0 - smoothstep(r * 0.75, r, length(d)));
  vec3 bump = (viewMatrix * vec4(d / max(r, 1e-5), 0.0)).xyz;
  normal = normalize(normal + bump * drop * 0.9);
  roughnessFactor = mix(roughnessFactor, 0.02, drop);
  // a thin film darkens and smooths wet chrome slightly
  roughnessFactor *= 1.0 - 0.5 * uWet;
  diffuseColor.rgb *= 1.0 - 0.18 * uWet;

  // Snow settles on surfaces facing up.
  float up = dot(normal, viewUp);
  float snow = uSnow * smoothstep(0.2, 0.6, up);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.97, 1.0), snow);
  metalnessFactor = mix(metalnessFactor, 0.0, snow);
  roughnessFactor = mix(roughnessFactor, 0.85, snow);
}
`;

/** Patch a physical material so it responds to the weather. */
export function weatherproof<M extends THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial>(m: M): M {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, weatherUniforms);
    shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace("#include <project_vertex>", VERTEX_BODY);
    shader.fragmentShader = FRAGMENT_HEAD + shader.fragmentShader.replace("#include <normal_fragment_maps>", FRAGMENT_BODY);
  };
  m.customProgramCacheKey = () => "sleight-weather";
  return m;
}

export function makeChromeMaterial(tint = "#eef1f7") {
  return weatherproof(
    new THREE.MeshPhysicalMaterial({
      color: tint,
      metalness: 1,
      roughness: 0.09,
      iridescence: 0.9,
      iridescenceIOR: 1.7,
      iridescenceThicknessRange: [180, 620],
      clearcoat: 0.5,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.6,
    }),
  );
}
