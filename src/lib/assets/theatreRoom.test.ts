import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Box3, Mesh, MeshStandardMaterial, Texture, Vector3 } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { describe, expect, it } from "vitest";

/**
 * public/models/theatre-room.glb comes from scripts/blender/build_theatre_room.py, lit by
 * bake_theatre_room.py, via `npm run assets -- theatre-room`.
 */
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
    const room = new Box3().setFromObject(scene.getObjectByName("Room_Baked")!);
    const size = room.getSize(new Vector3());
    const centre = room.getCenter(new Vector3());
    expect(size.x).toBeCloseTo(7.2, 2); // 7 m inside, plus the 0.1 m wall backing on each side
    expect(size.z).toBeCloseTo(7.2, 2);
    // 3 m ceiling, plus the floor and ceiling slabs (5 cm each); the light boom's hub pokes up through it
    expect(size.y).toBeGreaterThan(3.09);
    expect(size.y).toBeLessThan(3.15);
    expect(centre.x).toBeCloseTo(-0.1, 3);
    expect(centre.z).toBeCloseTo(-0.4, 3);
  });

  it("puts the floor's top at y 0, where the code's ground collider is", async () => {
    const { scene } = await loadRoom();
    scene.updateMatrixWorld(true);
    expect(new Box3().setFromObject(scene.getObjectByName("Room_Baked")!).min.y).toBeCloseTo(-0.05, 3); // a 5 cm slab under y 0
  });

  it("bakes the static room into one textured mesh; the glowing parts and the painting stay apart", async () => {
    const { scene } = await loadRoom();
    for (const name of ["Room_Baked", "Room_LedPanel", "Room_LampLED", "Room_VitalsScreen", "Room_Painting"]) {
      expect(scene.getObjectByName(name), name).toBeInstanceOf(Mesh);
    }
    expect(((scene.getObjectByName("Room_Baked") as Mesh).material as MeshStandardMaterial).map).not.toBeNull();
    const painting = scene.getObjectByName("Room_Painting") as Mesh;
    expect(painting.geometry.getAttribute("uv")).toBeDefined();
    expect((painting.material as MeshStandardMaterial).map).not.toBeNull();
  });

  it("marks where the surgical lights hang and aim", async () => {
    const { scene } = await loadRoom();
    for (const name of ["A", "B"]) {
      const at = scene.getObjectByName(`LIGHT_Surgical_${name}`)!.position;
      const aim = scene.getObjectByName(`LIGHT_Surgical_${name}_TARGET`)!.position;
      expect(at.y).toBeGreaterThan(2.2);
      expect(aim.y).toBeCloseTo(1.05, 2);
    }
  });
});
