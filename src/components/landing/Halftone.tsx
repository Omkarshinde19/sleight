"use client";

import { useFBO } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";

/*
 * The poster's black-and-white photo, live: the scene renders off screen, then a full-screen pass
 * draws it in grey through a 45° grid of dots whose size follows the brightness underneath.
 * Transparent where nothing was drawn, so the headline and blobs show around the hand.
 */

const vertex = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec3 screen; // drawing-buffer width, height, and the dot cell in pixels
  uniform vec3 ink;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  // Narkowicz's ACES fit: the scenes' tone mapping, which three skips when rendering off screen
  vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

  void main() {
    vec2 resolution = screen.xy;
    float cell = screen.z;
    vec2 px = gl_FragCoord.xy;
    // a dot grid turned 45°, like a printed screen
    const float A = 0.7853982;
    mat2 R = mat2(cos(A), sin(A), -sin(A), cos(A));
    vec2 p = R * px;
    vec2 centre = (floor(p / cell) + 0.5) * cell;
    vec4 sampled = texture2D(tScene, (transpose(R) * centre) / resolution);
    vec4 here = texture2D(tScene, px / resolution);

    // tone map the sampled colour like the screen would, then grey it with some extra contrast
    vec3 c = aces(sampled.rgb);
    float l = clamp((luma(c) - 0.5) * 1.35 + 0.55, 0.0, 1.0);
    float r = cell * 0.62 * sqrt(l);
    float d = length(p - centre);
    float dotMask = 1.0 - smoothstep(r - 0.75, r + 0.75, d);

    // mostly dots, with a little of the continuous grey underneath so edges stay legible
    float grey = clamp((luma(aces(here.rgb)) - 0.5) * 1.35 + 0.55, 0.0, 1.0);
    float v = max(dotMask, grey * 0.28);
    float a = max(sampled.a * dotMask, here.a * 0.85);
    gl_FragColor = vec4(ink * v * a, a);
    #include <colorspace_fragment>
  }
`;

export function Halftone({ cell = 4 }: { cell?: number }) {
  const { gl, size, viewport } = useThree();
  const target = useFBO({ samples: 4 });
  const pass = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        tScene: { value: target.texture },
        screen: { value: new THREE.Vector3() },
        ink: { value: new THREE.Color("#f2f2f2") },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    return { scene, material, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }, [target]);

  // priority 1: R3F stops drawing the scene itself; this draws it, twice
  useFrame(({ scene, camera }) => {
    const dpr = viewport.dpr;
    pass.material.uniforms.screen.value.set(size.width * dpr, size.height * dpr, cell * dpr);
    gl.setRenderTarget(target);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    gl.clear();
    gl.render(pass.scene, pass.camera);
  }, 1);

  return null;
}
