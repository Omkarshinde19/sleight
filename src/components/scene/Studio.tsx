"use client";

import { Environment, Lightformer } from "@react-three/drei";

/**
 * Procedural studio lighting. Chrome is only as good as what it reflects, so the environment is a set
 * of soft light strips in the brand colours (no HDR download). These strips are the white streaks and
 * the indigo/ember rims you see along the robot fingers.
 */
export function Studio({ intensity = 1 }: { intensity?: number }) {
  return (
    <>
      <Environment resolution={256} frames={1} environmentIntensity={intensity}>
        <color attach="background" args={["#05060a"]} />
        {/* key strips overhead */}
        <Lightformer form="rect" intensity={4} color="#ffffff" position={[0, 5, -2]} rotation-x={Math.PI / 2} scale={[10, 0.6, 1]} />
        <Lightformer form="rect" intensity={2.5} color="#ffffff" position={[0, 4, 3]} rotation-x={Math.PI / 2} scale={[8, 0.4, 1]} />
        {/* coloured rims */}
        <Lightformer form="rect" intensity={3} color="#5a5ff0" position={[-6, 1.5, 0]} rotation-y={Math.PI / 2} scale={[6, 2.5, 1]} />
        <Lightformer form="rect" intensity={2.6} color="#ff6a45" position={[6, 1, -1]} rotation-y={-Math.PI / 2} scale={[6, 1.6, 1]} />
        <Lightformer form="ring" intensity={2} color="#9b7cff" position={[2, 3, 6]} scale={3} />
        <Lightformer form="rect" intensity={1.2} color="#7fe3f0" position={[0, -3, 0]} rotation-x={-Math.PI / 2} scale={[10, 10, 1]} />
        {/* big soft panel behind the viewer: gives palms and backs of hands something bright to mirror */}
        <Lightformer form="rect" intensity={1.6} color="#c9ccff" position={[0, 1.5, 7]} scale={[12, 4, 1]} />
        <Lightformer form="rect" intensity={2} color="#ffffff" position={[-3, 2, 4]} rotation-y={Math.PI / 4} scale={[1.2, 5, 1]} />
        <Lightformer form="rect" intensity={2} color="#ffffff" position={[3, 2, 4]} rotation-y={-Math.PI / 4} scale={[1.2, 5, 1]} />
      </Environment>
      <ambientLight intensity={0.15} />
      <directionalLight position={[2.5, 5, 3]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004}>
        <orthographicCamera attach="shadow-camera" args={[-4, 4, 4, -4, 0.5, 15]} />
      </directionalLight>
    </>
  );
}
