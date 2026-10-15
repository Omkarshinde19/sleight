"use client";

import { useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useEffect } from "react";

/** Puts the three.js and Rapier state on window.__sleight for automated browser checks. */
export function ExposeThree() {
  const three = useThree();
  const rapier = useRapier();
  useEffect(() => {
    const w = window as unknown as { __sleight?: Record<string, unknown> };
    w.__sleight = { ...(w.__sleight ?? {}), three, rapier };
    console.log("expose three", Object.keys(w.__sleight));
  }, [three, rapier]);
  return null;
}
