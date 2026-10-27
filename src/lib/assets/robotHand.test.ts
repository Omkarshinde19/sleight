import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Bone, Mesh, MeshPhysicalMaterial, SkinnedMesh, Vector3 } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { describe, expect, it } from "vitest";

/** public/models/robot-hand.glb comes from scripts/blender/build_hand.py via `npm run assets -- robot-hand`. */
async function loadHand(): Promise<GLTF> {
  const file = readFileSync(fileURLToPath(new URL("../../../public/models/robot-hand.glb", import.meta.url)));
  await MeshoptDecoder.ready;
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), "");
}

/** MediaPipe's landmark names, in index order: the contract between Blender and the code. */
const LANDMARKS = [
  "WRIST",
  ...["CMC", "MCP", "IP", "TIP"].map((j) => `THUMB_${j}`),
  ...["INDEX_FINGER", "MIDDLE_FINGER", "RING_FINGER", "PINKY"].flatMap((f) => ["MCP", "PIP", "DIP", "TIP"].map((j) => `${f}_${j}`)),
];

const worldPos = (o: { getWorldPosition: (v: Vector3) => Vector3 }) => o.getWorldPosition(new Vector3());

describe("robot hand model", () => {
  it("has one bone per landmark plus the forearm, parented wrist-outwards", async () => {
    const { scene } = await loadHand();
    const bone = (n: string) => scene.getObjectByName(n);
    expect(LANDMARKS).toHaveLength(21);
    for (const name of [...LANDMARKS, "FOREARM"]) expect(bone(name), name).toBeInstanceOf(Bone);
    expect(bone("WRIST")!.parent!.name).toBe("FOREARM");
    for (const root of ["THUMB_CMC", "INDEX_FINGER_MCP", "MIDDLE_FINGER_MCP", "RING_FINGER_MCP", "PINKY_MCP"]) expect(bone(root)!.parent!.name).toBe("WRIST");
    expect(bone("INDEX_FINGER_TIP")!.parent!.name).toBe("INDEX_FINGER_DIP");
  });

  it("rests as an open right hand: fingers +Y, back of the hand +Z, thumb on -X", async () => {
    const { scene } = await loadHand();
    scene.updateMatrixWorld(true);
    const at = (n: string) => worldPos(scene.getObjectByName(n)!);
    const wrist = at("WRIST");
    expect(wrist.length()).toBeLessThan(1e-4);
    expect(at("MIDDLE_FINGER_TIP").y).toBeGreaterThan(0.17);
    expect(at("THUMB_TIP").x).toBeLessThan(at("INDEX_FINGER_TIP").x);
    expect(at("PINKY_MCP").x).toBeGreaterThan(at("INDEX_FINGER_MCP").x);
    expect(at("FOREARM").y).toBeCloseTo(-0.27, 2);

    // each bone's local +Y points at its child landmark; local +Z leans to the back of the hand
    const pip = scene.getObjectByName("INDEX_FINGER_PIP")!;
    const along = at("INDEX_FINGER_DIP").sub(at("INDEX_FINGER_PIP")).normalize();
    const y = new Vector3(0, 1, 0).transformDirection(pip.matrixWorld);
    const z = new Vector3(0, 0, 1).transformDirection(pip.matrixWorld);
    expect(y.dot(along)).toBeGreaterThan(0.999);
    expect(z.z).toBeGreaterThan(0.99);
  });

  it("is one skinned mesh under the triangle budget with the four materials", async () => {
    const { scene } = await loadHand();
    const meshes: Mesh[] = [];
    scene.traverse((o) => o instanceof Mesh && meshes.push(o));
    expect(meshes.every((m) => m instanceof SkinnedMesh)).toBe(true);
    const tris = meshes.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
    expect(tris).toBeLessThan(15000);
    const names = new Set(meshes.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material]).map((x) => x.name)));
    expect([...names].sort()).toEqual(["Chrome", "Copper", "Gunmetal", "Muscle"]);
    expect((meshes[0] as SkinnedMesh).skeleton.bones).toHaveLength(22);
    const chrome = meshes.flatMap((m) => m.material).find((x) => x.name === "Chrome") as MeshPhysicalMaterial;
    expect(chrome.metalness).toBe(1);
    expect(chrome.iridescence).toBeCloseTo(0.9, 3);
    expect(chrome.clearcoat).toBeCloseTo(0.5, 3);
  });
});
