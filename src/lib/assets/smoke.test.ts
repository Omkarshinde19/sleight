import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { describe, expect, it } from "vitest";

/** public/models/smoke.glb comes from scripts/blender/build_smoke.py via `npm run assets -- smoke`. */
async function loadSmoke(): Promise<GLTF> {
  const file = readFileSync(fileURLToPath(new URL("../../../public/models/smoke.glb", import.meta.url)));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(buffer, "");
}

describe("Blender → glTF pipeline", () => {
  it("keeps names, metre scale and +Y up", async () => {
    const gltf = await loadSmoke();
    const box = gltf.scene.getObjectByName("SmokeBox");
    expect(box).toBeInstanceOf(Mesh);

    gltf.scene.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(box!);
    const size = bounds.getSize(new Vector3());
    const centre = bounds.getCenter(new Vector3());
    // Blender X/Y/Z = 0.20/0.10/0.05 m → three X/Y(up)/Z = 0.20/0.05/0.10 m
    expect(size.x).toBeCloseTo(0.2, 3);
    expect(size.y).toBeCloseTo(0.05, 3);
    expect(size.z).toBeCloseTo(0.1, 3);
    // Blender (0, 0.3, 0.5) → three (0, 0.5, -0.3)
    expect(centre.x).toBeCloseTo(0, 3);
    expect(centre.y).toBeCloseTo(0.5, 3);
    expect(centre.z).toBeCloseTo(-0.3, 3);
  });

  it("keeps PBR material values", async () => {
    const gltf = await loadSmoke();
    const material = (gltf.scene.getObjectByName("SmokeBox") as Mesh).material as MeshStandardMaterial;
    expect(material.name).toBe("SmokeMat");
    expect(material.metalness).toBeCloseTo(1, 3);
    expect(material.roughness).toBeCloseTo(0.25, 3);
  });
});
