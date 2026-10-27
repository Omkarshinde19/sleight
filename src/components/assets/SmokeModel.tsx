"use client";

import { useGLTF } from "@react-three/drei";

const MODEL_URL = "/models/smoke.glb";

/** The Blender pipeline's reference box, drawn exactly as exported (no offset, no scale). */
export function SmokeModel() {
  const { scene } = useGLTF(MODEL_URL);
  return <primitive object={scene} />;
}

useGLTF.preload(MODEL_URL);
