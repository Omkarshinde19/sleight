"""Bakes the operating room's lighting (step 1.3). Run after build_theatre_room.py:

    blender -b assets/blender/theatre-room.blend --python scripts/blender/bake_theatre_room.py [-- --size N --samples N --exposure X --no-env]

- Lights the room for the bake only: an area light under every LED ceiling panel, a spotlight in each
  surgical light head, a dim world. Stand-ins for the operating table, the patient and the instrument
  stand cast their soft shadows onto the floor. None of these are saved.
- Joins every static, non-emissive mesh into Room_Baked, gives it lightmap UVs, and bakes diffuse light
  (direct + indirect, colour included) with Cycles. The result is exposed, tone-mapped and stored as an
  8-bit sRGB texture on one material, RoomBaked, which the site draws unlit.
- The LED panels, lamp LEDs, vitals screen, door glass and the painting stay separate: they glow or are
  lit live.
- Renders a 360° HDR from above the table to public/env/theatre-room.hdr: the reflections and image-based
  light for what moves (patient, instruments, hands).
"""

import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ENV_OUT = os.path.join(ROOT, "public/env/theatre-room.hdr")

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
SIZE = int(args[args.index("--size") + 1]) if "--size" in args else 4096
SAMPLES = int(args[args.index("--samples") + 1]) if "--samples" in args else 128
EXPOSURE = float(args[args.index("--exposure") + 1]) if "--exposure" in args else 0.1
ENV = "--no-env" not in args

LIVE = {"Room_LedPanel", "Room_LampLED", "Room_VitalsScreen", "Room_ControlLight", "Room_Painting", "Room_DoorGlass"}
FIELD = Vector((-0.1, 0.4, 1.05))

scene = bpy.context.scene
temporary = []


def use_cycles_gpu():
    try:
        scene.render.engine = "CYCLES"
    except TypeError as e:
        raise SystemExit(f"Cycles unavailable: {e}")
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("METAL", "OPTIX", "CUDA", "HIP"):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type != "CPU"]
        if gpus:
            for d in prefs.devices:
                d.use = True
            scene.cycles.device = "GPU"
            print(f"bake: {kind} GPU")
            return
    print("bake: CPU")


def add_light(name, kind, location, energy, rotation=None, **props):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    for k, v in props.items():
        setattr(data, k, v)
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    if rotation is not None:
        obj.rotation_euler = rotation
    scene.collection.objects.link(obj)
    temporary.append(obj)
    return obj


def bake_lights():
    """An area light just under each LED panel (one per connected piece), a spotlight per lamp head."""
    led = bpy.data.objects["Room_LedPanel"]
    bm = bmesh.new()
    bm.from_mesh(led.data)
    bm.verts.ensure_lookup_table()
    pieces = []
    seen = set()
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, island = [v], []
        seen.add(v.index)
        while stack:
            u = stack.pop()
            island.append(u.co.copy())
            for e in u.link_edges:
                w = e.other_vert(u)
                if w.index not in seen:
                    seen.add(w.index)
                    stack.append(w)
        pieces.append(island)
    bm.free()
    for i, island in enumerate(pieces):
        lo = Vector((min(p.x for p in island), min(p.y for p in island), min(p.z for p in island)))
        hi = Vector((max(p.x for p in island), max(p.y for p in island), max(p.z for p in island)))
        size = hi - lo
        add_light(f"bake_led_{i}", "AREA", ((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z - 0.01), 90 * size.x * size.y / 0.1, shape="RECTANGLE", size=size.x, size_y=size.y, color=(0.97, 0.98, 1.0))
    for name in ("A", "B"):
        at = bpy.data.objects[f"LIGHT_Surgical_{name}"].location
        aim = (FIELD - at).to_track_quat("-Z", "Y").to_euler()
        add_light(f"bake_lamp_{name}", "SPOT", at, 260, aim, spot_size=math.radians(40), spot_blend=0.6, shadow_soft_size=0.25, color=(1.0, 0.97, 0.92))
    world = bpy.data.worlds.new("bake_world")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.55, 0.6, 0.75, 1)
    bg.inputs["Strength"].default_value = 0.08
    scene.world = world


def stand_ins():
    """Shapes where the table, patient and instrument stand will be, so their shadows are baked in."""
    mat = bpy.data.materials.new("bake_stand_in")
    next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.2, 0.22, 0.26, 1)
    shapes = [
        ((-0.1, 0.4, 0.79), (2.0, 0.56, 0.06)),  # table top (three: top 0.82)
        ((-0.1, 0.4, 0.40), (0.24, 0.24, 0.76)),  # pedestal
        ((-0.1, 0.4, 0.04), (0.6, 0.36, 0.08)),  # base (the real one, in patient.glb, is a little bigger)
        ((-0.15, 0.4, 0.93), (1.75, 0.46, 0.2)),  # patient under the drape
        ((0.4, 0.1, 0.5), (0.05, 0.05, 1.0)),  # instrument stand post
        ((0.4, 0.1, 1.0), (0.5, 0.34, 0.02)),  # instrument tray
    ]
    for i, (c, s) in enumerate(shapes):
        mesh = bpy.data.meshes.new(f"bake_stand_in_{i}")
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(c) @ Matrix.Diagonal((*s, 1.0)))
        bm.to_mesh(mesh)
        bm.free()
        mesh.materials.append(mat)
        obj = bpy.data.objects.new(mesh.name, mesh)
        scene.collection.objects.link(obj)
        temporary.append(obj)


def join_static():
    static = [o for o in scene.objects if o.type == "MESH" and o.name.startswith("Room_") and o.name not in LIVE]
    bpy.ops.object.select_all(action="DESELECT")
    for o in static:
        o.select_set(True)
    bpy.context.view_layer.objects.active = static[0]
    bpy.ops.object.join()
    baked = bpy.context.view_layer.objects.active
    baked.name = baked.data.name = "Room_Baked"
    uv = baked.data.uv_layers.new(name="Bake")
    baked.data.uv_layers.active = uv
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=4 / SIZE, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    return baked


def bake(baked):
    image = bpy.data.images.new("theatre-room-bake-linear", SIZE, SIZE, float_buffer=True)
    for slot in baked.material_slots:
        nodes = slot.material.node_tree.nodes
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        for n in nodes:
            n.select = False
        tex.select = True
        nodes.active = tex
    scene.cycles.samples = SAMPLES
    scene.render.bake.margin = 8
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_diffuse = True
    scene.render.bake.use_pass_glossy = False
    scene.render.bake.use_pass_transmission = False
    scene.render.bake.use_pass_emit = True
    bpy.ops.object.select_all(action="DESELECT")
    baked.select_set(True)
    bpy.context.view_layer.objects.active = baked
    bpy.ops.object.bake(type="COMBINED")
    return image


def tone_map(linear):
    """Exposure, a soft shoulder instead of clipping, then sRGB into an 8-bit image."""
    px = np.empty(SIZE * SIZE * 4, dtype=np.float32)
    linear.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    rgb = px[:, :3] * EXPOSURE
    white = 3.0
    rgb = rgb * (1 + rgb / white**2) / (1 + rgb)
    rgb = np.clip(rgb, 0, 1)
    rgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    px[:, :3] = rgb
    px[:, 3] = 1
    out = bpy.data.images.new("theatre-room-bake", SIZE, SIZE)
    out.pixels.foreach_set(px.ravel())
    out.pack()
    stats = rgb[px[:, 0] > 0]
    print(f"bake: mean sRGB {stats.mean(axis=0) if len(stats) else 'n/a'}")
    return out


def bake_material(baked, image):
    mat = bpy.data.materials.new("RoomBaked")
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 1.0
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = "Bake"
    links.new(uv.outputs["UV"], tex.inputs["Vector"])
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    baked.data.materials.clear()
    baked.data.materials.append(mat)
    for poly in baked.data.polygons:
        poly.material_index = 0
    for layer in [l for l in baked.data.uv_layers if l.name != "Bake"]:
        baked.data.uv_layers.remove(layer)


def environment():
    """A 360° HDR from above the table: what shiny moving things reflect."""
    cam_data = bpy.data.cameras.new("bake_env")
    cam_data.type = "PANO"
    try:
        cam_data.panorama_type = "EQUIRECTANGULAR"
    except AttributeError:
        cam_data.cycles.panorama_type = "EQUIRECTANGULAR"
    cam = bpy.data.objects.new("bake_env", cam_data)
    cam.location = (-0.1, 0.4, 1.3)
    cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
    scene.collection.objects.link(cam)
    temporary.append(cam)
    scene.camera = cam
    for o in temporary:
        if o.name.startswith("bake_stand_in"):
            o.hide_render = True
    scene.render.resolution_x, scene.render.resolution_y = 1024, 512
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 256
    scene.cycles.use_denoising = True
    scene.render.image_settings.file_format = "HDR"
    scene.render.filepath = ENV_OUT
    os.makedirs(os.path.dirname(ENV_OUT), exist_ok=True)
    bpy.ops.render.render(write_still=True)


def main():
    use_cycles_gpu()
    bake_lights()
    stand_ins()
    baked = join_static()
    linear = bake(baked)
    bake_material(baked, tone_map(linear))
    bpy.data.images.remove(linear)
    if ENV:
        environment()
    for o in temporary:
        bpy.data.objects.remove(o, do_unlink=True)
    scene.camera = None
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, compress=True)
    print(f"bake: saved {bpy.data.filepath}, {ENV_OUT}")


main()
