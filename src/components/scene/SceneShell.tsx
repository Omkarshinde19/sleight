"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_WORKSPACE, type Workspace } from "@/lib/hand/mapping";
import { useHandStore } from "@/state/handStore";
import { ChromeHand } from "../hands/ChromeHand";
import { DebugOverlay } from "../hud/DebugOverlay";
import { SourceChooser } from "../hud/SourceChooser";
import { SceneControls } from "../hud/SceneControls";
import styles from "../hud/hud.module.css";
import { HandTrackingProvider, isTouchDevice, useTracking } from "../tracking/HandTrackingProvider";
import { ExposeThree } from "./ExposeThree";
import { Studio } from "./Studio";

export interface SceneShellProps {
  title: string;
  /** Short line under the title: what to do here. */
  brief: string;
  /** Everything inside the physics world (except the hands, which the shell renders). */
  children: ReactNode;
  /** 2D overlay specific to the scene (score, machine state…). */
  hud?: ReactNode;
  workspace?: Workspace;
  camera?: { position: [number, number, number]; fov?: number; lookAt?: [number, number, number] };
  /** Recording that plays in demo mode. */
  demo: string;
}

export function SceneShell(props: SceneShellProps) {
  const surface = useRef<HTMLDivElement>(null);
  return (
    <HandTrackingProvider workspace={props.workspace} surface={surface}>
      <SceneInner {...props} surface={surface} />
    </HandTrackingProvider>
  );
}

function SceneInner({ title, brief, children, hud, workspace = DEFAULT_WORKSPACE, camera, demo, surface }: SceneShellProps & { surface: React.RefObject<HTMLDivElement | null> }) {
  const [dpr, setDpr] = useState(1.5);
  const tracking = useTracking();
  const source = useHandStore((s) => s.source);
  const status = useHandStore((s) => s.status);

  // ?source=sim|camera|demo starts straight away (used for demos and automated checks).
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("source");
    if (want === "sim") tracking.startSim();
    else if (want === "demo") tracking.startPlayback(demo);
    else if (want === "camera") tracking.startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "`" || e.key === "~") useHandStore.setState((s) => ({ debug: !s.debug }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cam = camera ?? { position: [0, 1.4, 1.75] as [number, number, number], fov: 50, lookAt: [0, 1.0, -0.6] as [number, number, number] };

  return (
    <div ref={surface} className={styles.sceneRoot} data-source={source ?? "none"}>
      <Canvas
        shadows
        dpr={[1, dpr]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ position: cam.position, fov: cam.fov ?? 50, near: 0.05, far: 60 }}
        onCreated={({ camera }) => cam.lookAt && camera.lookAt(...cam.lookAt)}
      >
        <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(isTouchDevice() ? 1.5 : 2)} />
        <Studio />
        <Suspense fallback={null}>
          <Physics gravity={[0, -9.81, 0]} timeStep={1 / 90} interpolate>
            {children}
            <ExposeThree />
          </Physics>
        </Suspense>
        <ChromeHand hand="Right" scale={workspace.handScale} />
        <ChromeHand hand="Left" scale={workspace.handScale} />
      </Canvas>

      <header className={styles.topBar}>
        <Link href="/" className={`${styles.pill} glass`} aria-label="Back to Sleight home">
          <span className={styles.wordmark}>Sleight</span>
          <span className={`${styles.dim} mono`}>/ {title}</span>
        </Link>
        <SceneControls demo={demo} />
      </header>

      <p className={`${styles.privacy} mono`}>
        <span className={styles.dot} /> On-device · camera frames never leave this browser
      </p>

      {hud}
      <DebugOverlay />
      {(!source || status === "denied" || status === "error") && <SourceChooser title={title} brief={brief} demo={demo} />}
    </div>
  );
}
