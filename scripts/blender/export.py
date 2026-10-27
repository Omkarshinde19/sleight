"""Headless Blender -> glTF export.

    blender -b assets/blender/hand.blend --python scripts/blender/export.py -- public/models/robot-hand.glb

Exports every renderable object in the open .blend as one binary glTF, +Y up, metre scale (one Blender
unit = one metre = one three.js unit), modifiers applied, skins and actions kept. Cameras and lights stay
in Blender: the site lights its own scenes. Hide an object from renders (camera icon) to leave it out.
Same flags every run so exports are reproducible; compression happens afterwards in scripts/assets.mjs.
"""

import os
import sys

import bpy


def output_path() -> str:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) != 1:
        raise SystemExit("usage: blender -b <file.blend> --python export.py -- <out.glb>")
    return os.path.abspath(argv[0])


def main() -> None:
    out = output_path()
    os.makedirs(os.path.dirname(out), exist_ok=True)

    scene = bpy.context.scene
    if scene.unit_settings.system != "METRIC" or abs(scene.unit_settings.scale_length - 1.0) > 1e-6:
        raise SystemExit(f"{bpy.data.filepath}: scene units must be metric with unit scale 1.0")

    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        use_renderable=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_skins=True,
        export_def_bones=False,
        export_leaf_bone=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_morph=True,
        export_loglevel=-1,
    )
    print(f"exported {bpy.data.filepath} -> {out}")


main()
