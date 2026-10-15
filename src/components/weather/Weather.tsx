"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { weatherUniforms } from "@/lib/materials/chrome";
import { useWeather } from "@/state/weatherStore";

/** Seconds to soak through in rain, and to dry once it stops; snow settles and melts a bit slower. */
const SOAK = 5;
const DRY = 14;
const SETTLE = 8;
const MELT = 18;

const RAIN = 1400;
const SNOW = 1100;
const BOX = { w: 5, h: 3.2, d: 4 };

function softDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.7)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Rain drops as [x, y, z, speed], positions normalised to the weather box. */
function makeRain() {
  return Array.from({ length: RAIN }, () => [Math.random(), Math.random(), Math.random(), 0.75 + Math.random() * 0.5]);
}

function makeSnow() {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(SNOW * 3);
  for (let i = 0; i < SNOW; i++) pos.set([(Math.random() - 0.5) * BOX.w, Math.random() * BOX.h, (Math.random() - 0.5) * BOX.d], i * 3);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return g;
}

/**
 * Rain streaks or drifting snow around the camera, and the slow soak / dry / settle / melt of the
 * chrome. Wetness and snow live in shared shader uniforms (see lib/materials/chrome.ts).
 */
export function Weather() {
  const camera = useThree((s) => s.camera);
  const rain = useRef<THREE.InstancedMesh>(null);
  const snow = useRef<THREE.Points>(null);
  const lastPublish = useRef(0);

  const rainData = useMemo(() => makeRain(), []);
  const snowGeo = useMemo(() => makeSnow(), []);
  const dot = useMemo(() => softDot(), []);
  const m = useMemo(() => new THREE.Matrix4(), []);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const { kind } = useWeather.getState();
    const u = weatherUniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uRaining.value += ((kind === "rain" ? 1 : 0) - u.uRaining.value) * Math.min(1, dt * 2);
    u.uWet.value = kind === "rain" ? Math.min(1, u.uWet.value + dt / SOAK) : Math.max(0, u.uWet.value - dt / DRY);
    u.uSnow.value = kind === "snow" ? Math.min(1, u.uSnow.value + dt / SETTLE) : Math.max(0, u.uSnow.value - dt / MELT);
    // snow melting leaves the hands wet
    if (kind !== "snow" && u.uSnow.value > 0) u.uWet.value = Math.max(u.uWet.value, u.uSnow.value * 0.6);

    const now = performance.now();
    if (now - lastPublish.current > 250) {
      lastPublish.current = now;
      useWeather.setState({ wetness: u.uWet.value, snow: u.uSnow.value });
    }

    const cx = camera.position.x;
    const cz = camera.position.z - BOX.d / 2;
    if (rain.current) {
      rain.current.visible = kind === "rain";
      if (kind === "rain") {
        rainData.forEach((r, i) => {
          r[1] -= (dt * 7 * r[3]) / BOX.h;
          if (r[1] < 0) {
            r[1] += 1;
            r[0] = Math.random();
            r[2] = Math.random();
          }
          m.makeTranslation(cx + (r[0] - 0.5) * BOX.w, r[1] * BOX.h, cz + (r[2] - 0.5) * BOX.d);
          rain.current!.setMatrixAt(i, m);
        });
        rain.current.instanceMatrix.needsUpdate = true;
      }
    }
    if (snow.current) {
      snow.current.visible = kind === "snow";
      if (kind === "snow") {
        const pos = snowGeo.getAttribute("position") as THREE.BufferAttribute;
        const t = state.clock.elapsedTime;
        for (let i = 0; i < SNOW; i++) {
          let y = pos.getY(i) - dt * (0.25 + (i % 7) * 0.03);
          if (y < 0) y += BOX.h;
          pos.setXYZ(i, pos.getX(i) + Math.sin(t * 0.8 + i) * dt * 0.08, y, pos.getZ(i));
        }
        pos.needsUpdate = true;
        snow.current.position.set(cx, 0, cz);
      }
    }
  });

  return (
    <>
      <instancedMesh ref={rain} args={[undefined, undefined, RAIN]} visible={false} frustumCulled={false}>
        <boxGeometry args={[0.0018, 0.09, 0.0018]} />
        <meshBasicMaterial color="#bfe9ff" transparent opacity={0.35} depthWrite={false} />
      </instancedMesh>
      <points ref={snow} geometry={snowGeo} visible={false} frustumCulled={false}>
        <pointsMaterial map={dot} size={0.022} transparent depthWrite={false} color="#ffffff" sizeAttenuation />
      </points>
    </>
  );
}
