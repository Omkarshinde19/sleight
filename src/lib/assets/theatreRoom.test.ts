import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Box3, Mesh, MeshStandardMaterial, Texture, Vector3 } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { describe, expect, it } from "vitest";

/** public/models/theatre-room.glb comes from scripts/blender/build_theatre_room.py via `npm run assets -- theatre-room`. */
async function loadRoom(): Promise<GLTF> {
  const file = readFileSync(fileURLToPath(new URL("../../../public/models/theatre-room.glb", import.meta.url)));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // Node can't decode images: stand in a blank texture for each one, ahead of the built-in WebP plugin.
  (loader as unknown as { pluginCallbacks: (() => object)[] }).pluginCallbacks.unshift(() => ({
    name: "TEST_blank_textures",
    loadTexture: () => Promise.resolve(new Texture()),
  }));
  return loader.parseAsync(buffer, "");
}

describe("theatre-room.glb", () => {
  it("is a 7 × 7 m room with a 3 m ceiling, centred on the operating table", async () => {
    const { scene } = await loadRoom();
    scene.updateMatrixWorld(true);
    const walls = new Box3().setFromObject(scene.getObjectByName("Room_Seam")!);
    const size = walls.getSize(new Vector3());
    const centre = walls.getCenter(new Vector3());
    expect(size.x).toBeCloseTo(7.2, 2); // 7 m inside, plus the 0.1 m wall backing on each side
    expect(size.z).toBeCloseTo(7.2, 2);
    expect(size.y).toBeCloseTo(3, 3);
    expect(centre.x).toBeCloseTo(-0.1, 3);
    expect(centre.z).toBeCloseTo(-0.4, 3);
  });

  it("puts the floor's top at y 0, where the code's ground collider is", async () => {
    const { scene } = await loadRoom();
    scene.updateMatrixWorld(true);
    expect(new Box3().setFromObject(scene.getObjectByName("Room_Floor")!).max.y).toBeCloseTo(0, 3); // meshopt quantisation moves it ~0.2 mm
  });

  it("has one mesh per material, named for the code to find", async () => {
    const { scene } = await loadRoom();
    for (const name of ["Room_Floor", "Room_Inlay", "Room_InlayRing", "Room_Wall", "Room_LedPanel", "Room_Painting"]) {
      expect(scene.getObjectByName(name), name).toBeInstanceOf(Mesh);
    }
    const painting = scene.getObjectByName("Room_Painting") as Mesh;
    expect(painting.geometry.getAttribute("uv")).toBeDefined();
    expect((painting.material as MeshStandardMaterial).map).not.toBeNull();
  });
});
