"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { hero } from "./hero";

/*
 * The poster's liquid shapes: metaballs in hot pink and chartreuse, with a halftone fringe at their
 * edges. They drift on springs around their homes; the hero hand stirs them. An open hand pushes the
 * paint away, a closed one squeezes it: nearby blobs are pulled in and shrink, then spring back.
 */

const PINK = 0;
const LIME = 1;
/** Homes as fractions of the hero (x, y from the top-left), radius as a fraction of its height (landscape). */
const HOMES: [number, number, number, number][] = [
  // a pink stream from the lower left up behind the hand to the top right
  [0.24, 0.8, 0.15, PINK],
  [0.36, 0.62, 0.13, PINK],
  [0.56, 0.36, 0.12, PINK],
  [0.68, 0.16, 0.12, PINK],
  // a chartreuse one crossing it
  [0.47, 0.5, 0.14, LIME],
  [0.62, 0.66, 0.12, LIME],
  [0.34, 0.22, 0.1, LIME],
  [0.7, 0.9, 0.12, LIME],
];
const N = HOMES.length;

/** Spring back to the drifting home (1/s²), damping (1/s), hand reach (fraction of hero height). */
const SPRING = 7;
const DAMP = 3.2;
const REACH = 0.3;

const vertex = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragment = /* glsl */ `
  #define N ${N}
  uniform vec4 blobs[N]; // x, y (px, y up), radius (px), colour (0 pink, 1 lime)
  uniform vec2 scale; // x: device pixels per CSS pixel
  const vec3 PINK = vec3(1.0, 0.176, 0.659);
  const vec3 LIME = vec3(0.831, 1.0, 0.247);

  void main() {
    float dpr = scale.x;
    vec2 p = gl_FragCoord.xy / dpr;
    float pink = 0.0;
    float lime = 0.0;
    for (int i = 0; i < N; i++) {
      vec2 d = p - blobs[i].xy;
      float f = blobs[i].z * blobs[i].z / max(dot(d, d), 1.0);
      if (blobs[i].w < 0.5) pink += f; else lime += f;
    }
    // a halftone fringe just outside each shape: dots that shrink with the field
    vec2 cellP = mat2(0.7071, 0.7071, -0.7071, 0.7071) * p;
    float cell = 7.0;
    float d = length(cellP - (floor(cellP / cell) + 0.5) * cell);
    float aa = 1.0 / dpr;
    float pinkDot = 1.0 - smoothstep(0.0, aa * 2.0, d - cell * 0.5 * smoothstep(0.55, 1.0, pink));
    float limeDot = 1.0 - smoothstep(0.0, aa * 2.0, d - cell * 0.5 * smoothstep(0.55, 1.0, lime));
    float pinkA = max(smoothstep(1.0 - 0.02, 1.0 + 0.02, pink), pinkDot * step(0.55, pink) * step(pink, 1.0) * 0.9);
    float limeA = max(smoothstep(1.0 - 0.02, 1.0 + 0.02, lime), limeDot * step(0.55, lime) * step(lime, 1.0) * 0.9);
    // lime lies over pink where they meet
    vec3 colour = mix(PINK, LIME, limeA);
    float a = max(pinkA, limeA);
    gl_FragColor = vec4(colour * a, a);
  }
`;

interface Blob {
  pos: THREE.Vector2;
  vel: THREE.Vector2;
  squeeze: number;
}

function Field() {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const { material, blobs } = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { blobs: { value: HOMES.map(() => new THREE.Vector4()) }, scale: { value: new THREE.Vector2(1, 1) } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const blobs: Blob[] = HOMES.map(() => ({ pos: new THREE.Vector2(NaN, NaN), vel: new THREE.Vector2(), squeeze: 0 }));
    return { material, blobs };
  }, []);
  const still = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime * (still ? 0.15 : 1);
    const H = size.height;
    // portrait phones: smaller paint, kept to the band around the hand, clear of the type above and below
    const portrait = size.width < H;
    const R = portrait ? size.width * 0.8 : H;
    const hand = hero.hand;
    const uniforms = material.uniforms.blobs.value as THREE.Vector4[];
    material.uniforms.scale.value.set(dpr, 1);

    blobs.forEach((b, i) => {
      const [hx, hy, r] = HOMES[i];
      // home drifts on a slow loop of its own
      const tx = hx * size.width + Math.sin(t * 0.23 + i * 1.7) * R * 0.05;
      const ty = (portrait ? 0.32 + hy * 0.26 : hy) * H + Math.cos(t * 0.19 + i * 2.3) * R * 0.04;
      if (Number.isNaN(b.pos.x)) b.pos.set(tx, ty);
      let ax = (tx - b.pos.x) * SPRING;
      let ay = (ty - b.pos.y) * SPRING;

      let squeeze = 0;
      if (hand.visible) {
        const dx = b.pos.x - hand.x;
        const dy = b.pos.y - hand.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const near = Math.max(0, 1 - d / (REACH * R + r * R));
        if (hand.closed) {
          // squeeze: pulled toward the fist, and smaller
          ax -= (dx / d) * near * R * 9;
          ay -= (dy / d) * near * R * 9;
          squeeze = near;
        } else {
          // stir: pushed out of the way
          ax += (dx / d) * near * near * R * 26;
          ay += (dy / d) * near * near * R * 26;
        }
      }
      b.vel.x += (ax - b.vel.x * DAMP) * dt;
      b.vel.y += (ay - b.vel.y * DAMP) * dt;
      b.pos.x += b.vel.x * dt;
      b.pos.y += b.vel.y * dt;
      b.squeeze += (squeeze - b.squeeze) * (1 - Math.exp(-dt / 0.12));
      // shaders count y up from the bottom
      uniforms[i].set(b.pos.x, H - b.pos.y, r * R * (1 - 0.4 * b.squeeze) * (1 + 0.04 * Math.sin(t * 1.1 + i)), HOMES[i][3]);
    });
  });

  return (
    <mesh frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

export default function Blobs({ active }: { active: boolean }) {
  return (
    <Canvas dpr={[1, 1.5]} frameloop={active ? "always" : "never"} gl={{ antialias: false, alpha: true }} orthographic>
      <Field />
    </Canvas>
  );
}
