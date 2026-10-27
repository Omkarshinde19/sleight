import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { beforeAll, describe, expect, it } from "vitest";
import { cameraToScene } from "./mapping";
import { HandRig, LANDMARK_BONES } from "./rig";
import { localRightHand, POSES } from "./synth";
import { LM, type Point } from "./types";

let model: THREE.Object3D;
beforeAll(async () => {
  const f = readFileSync(fileURLToPath(new URL("../../../public/models/robot-hand.glb", import.meta.url)));
  await MeshoptDecoder.ready;
  model = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength), "")).scene;
});

const SCALE = 1.5;
const AT = { x: 0.3, y: 1.2, z: -0.2 };
/** A synthesised right hand in scene space, as the processor would place it. */
function sceneHand(pose: keyof typeof POSES, mirror = false): Point[] {
  return localRightHand(POSES[pose]).map((p) => {
    const s = cameraToScene(p);
    return { x: AT.x + s.x * SCALE * (mirror ? -1 : 1), y: AT.y + s.y * SCALE, z: AT.z + s.z * SCALE };
  });
}

const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
const axis = (o: THREE.Object3D, a: THREE.Vector3) => a.clone().transformDirection(o.matrixWorld);
const NEXT: Record<number, number> = {};
for (const chain of [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]) chain.slice(0, 3).forEach((j, k) => (NEXT[j] = chain[k + 1]));
NEXT[LM.WRIST] = LM.MIDDLE_MCP;

/** Bone length in the model's rest pose: head to the next joint's head. */
function restLength(j: number) {
  model.updateMatrixWorld(true);
  const at = (k: number) => world(model.getObjectByName(LANDMARK_BONES[k])!);
  return at(j).distanceTo(at(NEXT[j]));
}

function pose(joints: Point[], hand: "Left" | "Right") {
  const rig = new HandRig(clone(model));
  rig.update(joints, hand, { x: 0, y: -0.8, z: 0.6 }, 0.6, SCALE);
  const bone = (j: number) => rig.root.getObjectByName(LANDMARK_BONES[j])!;
  return { rig, bone };
}

describe("HandRig", () => {
  for (const g of ["open", "fist", "pinch"] as const)
    it(`puts every bone on its joint, pointing at the next, stretched to fit (${g})`, () => {
      const J = sceneHand(g);
      const { bone } = pose(J, "Right");
      for (let j = 0; j < 21; j++) {
        const b = bone(j);
        expect(world(b).distanceTo(new THREE.Vector3(J[j].x, J[j].y, J[j].z)), LANDMARK_BONES[j]).toBeLessThan(1e-4);
        const n = NEXT[j];
        if (n === undefined) continue;
        const want = new THREE.Vector3(J[n].x - J[j].x, J[n].y - J[j].y, J[n].z - J[j].z);
        expect(axis(b, new THREE.Vector3(0, 1, 0)).dot(want.clone().normalize()), LANDMARK_BONES[j]).toBeGreaterThan(0.9999);
        // stretched along its length to the tracked bone; as thick as the hand scale
        expect(restLength(j) * b.scale.y, LANDMARK_BONES[j]).toBeCloseTo(want.length(), 5);
        expect(b.scale.x).toBeCloseTo(SCALE, 6);
      }
    });

  it("doesn't twist curled fingers: each phalanx keeps its knuckle's back-of-hand side", () => {
    const { bone } = pose(sceneHand("fist"), "Right");
    for (const [mcp, pip, dip] of [[5, 6, 7], [9, 10, 11], [13, 14, 15], [17, 18, 19]]) {
      const x0 = axis(bone(mcp), new THREE.Vector3(1, 0, 0));
      for (const j of [pip, dip]) expect(x0.dot(axis(bone(j), new THREE.Vector3(1, 0, 0))), LANDMARK_BONES[j]).toBeGreaterThan(0.97);
    }
  });

  it("faces the back of an upright right hand, palm to the camera, toward the viewer", () => {
    const { bone } = pose(sceneHand("open"), "Right");
    expect(axis(bone(LM.WRIST), new THREE.Vector3(0, 0, 1)).z).toBeGreaterThan(0.9);
  });

  it("draws a left hand mirrored, with each bone on the left hand's joints", () => {
    const J = sceneHand("fist", true);
    const { rig, bone } = pose(J, "Left");
    for (let j = 0; j < 21; j++) expect(world(bone(j)).distanceTo(new THREE.Vector3(J[j].x, J[j].y, J[j].z))).toBeLessThan(1e-4);
    expect(rig.meshes.length).toBe(4);
    expect(rig.meshes[0].matrixWorld.determinant()).toBeLessThan(0); // three flips the winding
    // thumb on the outside: a left hand seen from behind has its thumb on +x of the index
    expect(world(bone(LM.THUMB_TIP)).x).toBeGreaterThan(world(bone(LM.PINKY_MCP)).x - 1);
  });

  it("puts the forearm between the elbow and the wrist", () => {
    const J = sceneHand("open");
    const { rig } = pose(J, "Right");
    const f = rig.root.getObjectByName("FOREARM")!;
    const w = new THREE.Vector3(J[0].x, J[0].y, J[0].z);
    const elbow = w.clone().add(new THREE.Vector3(0, -0.8, 0.6).multiplyScalar(0.6));
    expect(world(f).distanceTo(elbow)).toBeLessThan(1e-4);
    expect(axis(f, new THREE.Vector3(0, 1, 0)).dot(w.clone().sub(elbow).normalize())).toBeGreaterThan(0.9999);
  });
});
