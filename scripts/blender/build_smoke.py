"""Builds assets/blender/smoke.blend: the pipeline's reference asset.

    blender -b --factory-startup --python scripts/blender/build_smoke.py

One box with distinct sides so axes can't hide: 0.20 m along Blender X, 0.10 m along Blender Y (depth),
0.05 m along Blender Z (up), centred at Blender (0, 0.3, 0.5). After a +Y-up export three.js should see
size (0.20, 0.05, 0.10) at (0, 0.5, -0.3). src/lib/assets/smoke.test.ts checks exactly that.
"""

import os

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.3, 0.5))
box = bpy.context.active_object
box.name = box.data.name = "SmokeBox"
box.scale = (0.20, 0.10, 0.05)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

mat = bpy.data.materials.new("SmokeMat")
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (1.0, 0.03, 0.4, 1.0)
bsdf.inputs["Metallic"].default_value = 1.0
bsdf.inputs["Roughness"].default_value = 0.25
box.data.materials.append(mat)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "assets/blender/smoke.blend"), compress=True)
