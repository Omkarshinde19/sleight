"""Builds assets/blender/instruments.blend: the instrument set on a Mayo tray, and the kidney dish.

    blender -b --factory-startup --python scripts/blender/build_instruments.py

Contract with the code (see docs/BLENDER.md and src/scenes/theatre/tools.ts):
- Each tool is one root object named after it (Scalpel, Forceps, Scissors, NeedleDriver, Stapler,
  Balfour), placed where it rests on the tray. In its own frame the tip points along three.js -z
  (Blender +y) and the top faces +y (Blender +z); the origin is where the hand holds it.
- Moving parts are empties at their hinge (their mesh is a child, <name>_mesh), turned about the
  hinge's three.js y (Blender z) axis: Forceps_JAW_L/R, Scissors_JAW_L/R, NeedleDriver_JAW_L/R.
  Stapler_TRIGGER turns about x. (Mesh nodes can't be the hinge: compression moves their transforms.)
- Working points are empties: Scalpel_EDGE (the belly of the blade), Forceps_TIP, Scissors_TIP,
  NeedleDriver_TIP (the needle's point), Stapler_TIP (where staples come out), Balfour_SEAT.
- Staple: one staple, the model the code copies onto the skin. MayoTray and KidneyDish are fixed.
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TRAY_TOP = 1.0


def B(x, y, z):
    """three.js (x, y up, z toward the viewer) -> Blender (x, y away, z up)."""
    return Vector((x, -z, y))


def linear(hex_colour):
    rgb = [int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb) + (1.0,)


MATERIALS = {
    # name: (base colour, roughness, metallic)
    "Steel": ("#C9D0DA", 0.3, 1.0),
    "BladeSteel": ("#E5E9EF", 0.18, 1.0),
    "DarkSteel": ("#6C737E", 0.35, 1.0),
    "Gold": ("#D8B25A", 0.3, 1.0),
    "StaplerBody": ("#E9ECEF", 0.5, 0.0),
    "StaplerAccent": ("#2F7FD8", 0.45, 0.0),
    "Thread": ("#6B4FBF", 0.6, 0.0),
    "TrayMetal": ("#B9C0CA", 0.35, 0.8),
    "Dish": ("#D5DAE2", 0.25, 0.9),
}
MATS = {}


def mat(name):
    if name not in MATS:
        base, rough, metal = MATERIALS[name]
        m = bpy.data.materials.new(name)
        bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = linear(base)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        MATS[name] = m
    return MATS[name]


class Mesh:
    """Collects parts per material into one bmesh, then becomes an object."""

    def __init__(self, materials):
        self.bm = bmesh.new()
        self.materials = materials

    def _tag(self, verts, material):
        idx = self.materials.index(material)
        for v in verts:
            for f in v.link_faces:
                f.material_index = idx

    def box(self, centre, size, material, rotation=Matrix.Identity(4)):
        res = bmesh.ops.create_cube(self.bm, size=1.0, matrix=Matrix.Translation(centre) @ rotation @ Matrix.Diagonal((*size, 1.0)))
        self._tag(res["verts"], material)

    def cylinder(self, p0, p1, r, material, r1=None, segments=16):
        d = p1 - p0
        m = Matrix.Translation((p0 + p1) / 2) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4()
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=segments, radius1=r, radius2=r if r1 is None else r1, depth=d.length, matrix=m)
        self._tag(res["verts"], material)

    def sphere(self, centre, r, material):
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=12, v_segments=8, radius=r, matrix=Matrix.Translation(centre))
        self._tag(res["verts"], material)

    def ring(self, centre, axis, R, r, material, segments=20, arc=(0, 2 * math.pi)):
        """A torus round `axis`, or an arc of one, built as short cylinders."""
        axis = axis.normalized()
        u = axis.orthogonal().normalized()
        v = axis.cross(u)
        pts = [centre + (u * math.cos(a) + v * math.sin(a)) * R for a in [arc[0] + (arc[1] - arc[0]) * k / segments for k in range(segments + 1)]]
        for p, q in zip(pts, pts[1:]):
            self.cylinder(p, q, r, material, segments=8)

    def prism(self, outline, thickness, material, axis="x"):
        """An outline in the tool's (y, z) plane, extruded across x (or (x, y) across z)."""
        if axis == "x":
            verts = [self.bm.verts.new((-thickness / 2, y, z)) for y, z in outline]
            offset = Vector((thickness, 0, 0))
        else:
            verts = [self.bm.verts.new((x, y, -thickness / 2)) for x, y in outline]
            offset = Vector((0, 0, thickness))
        f = self.bm.faces.new(verts)
        res = bmesh.ops.extrude_face_region(self.bm, geom=[f])
        bmesh.ops.translate(self.bm, verts=[e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)], vec=offset)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self._tag(verts, material)

    def make_part(self, name, parent, hinge):
        """A moving part: an empty at the hinge, this mesh under it."""
        pivot = bpy.data.objects.new(name, None)
        pivot.empty_display_size = 0.005
        bpy.context.scene.collection.objects.link(pivot)
        pivot.parent = parent
        pivot.location = hinge
        self.make(f"{name}_mesh", pivot)
        return pivot

    def make(self, name, parent=None, location=(0, 0, 0)):
        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for m in self.materials:
            mesh.materials.append(mat(m))
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = location
        if parent:
            obj.parent = parent
        return obj


def marker(name, parent, at):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.005
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = at
    return e


# Every tool is modelled at the origin in Blender axes: tip toward +y, top toward +z.


def scalpel(at):
    m = Mesh(["Steel", "BladeSteel"])
    m.box(Vector((0, -0.01, 0)), (0.011, 0.12, 0.004), "Steel")  # #3 handle
    for k in range(9):  # knurled grip
        m.box(Vector((0, -0.045 + k * 0.006, 0.0022)), (0.009, 0.002, 0.001), "Steel")
    m.box(Vector((0, 0.054, 0)), (0.006, 0.012, 0.003), "Steel")  # blade fitting
    outline = [(0.052, 0.0015), (0.085, 0.001), (0.094, -0.002), (0.088, -0.0075), (0.074, -0.0095), (0.06, -0.0075), (0.052, -0.004)]
    m.prism(outline, 0.0008, "BladeSteel")  # #10 blade, curved belly down
    obj = m.make("Scalpel", location=at)
    marker("Scalpel_EDGE", obj, (0, 0.074, -0.0095))
    return obj


def forceps(at):
    body = Mesh(["Steel"])
    body.box(Vector((0, -0.058, 0)), (0.008, 0.008, 0.004), "Steel")
    obj = body.make("Forceps", location=at)
    for name, side in (("Forceps_JAW_L", -1), ("Forceps_JAW_R", 1)):
        arm = Mesh(["Steel"])
        # an arm from the hinge at the back to a fine tip, bowed out a little in the middle
        pts = [Vector((side * (0.0012 + 0.003 * math.sin(math.pi * t) * (1 - t)), 0.118 * t, 0)) for t in [k / 12 for k in range(13)]]
        for k, (p, q) in enumerate(zip(pts, pts[1:])):
            w = 0.006 - 0.0045 * (k / 12)
            arm.box((p + q) / 2, (w, (q - p).length + 0.0005, 0.002), "Steel", (q - p).to_track_quat("Y", "Z").to_matrix().to_4x4())
        for k in range(6):  # serrated grip
            arm.box(Vector((side * 0.004, 0.04 + k * 0.005, 0.0012)), (0.004, 0.0012, 0.0006), "Steel")
        arm.make_part(name, obj, (0, -0.058, 0))
    marker("Forceps_TIP", obj, (0, 0.06, 0))
    return obj


def scissor_half(name, parent, side, jaw, hinge, material="Steel", blade=True):
    """One half of a scissor-like tool, hinged at the box lock: jaw ahead of it, shank and ring behind."""
    m = Mesh([material, "Gold"])
    length, curve, width = jaw
    pts = [Vector((-side * curve * t * t, length * t, 0)) for t in [k / 8 for k in range(9)]]
    for k, (p, q) in enumerate(zip(pts, pts[1:])):
        w = width * (1 - 0.6 * k / 8) if blade else width
        m.box((p + q) / 2 + Vector((side * w / 4, 0, 0)), (w / 2, (q - p).length + 0.0005, 0.0025), material, (q - p).to_track_quat("Y", "Z").to_matrix().to_4x4())
    m.cylinder(Vector((0, 0, -0.002)), Vector((0, 0, 0.002)), 0.0035, material)  # box lock
    shank_end = Vector((side * 0.012, -0.06, 0))
    m.cylinder(Vector((0, 0, 0)), shank_end, 0.0022, material, segments=10)
    m.ring(shank_end + Vector((side * 0.004, -0.009, 0)), Vector((0, 0, 1)), 0.009, 0.0018, "Gold" if not blade else material)
    return m.make_part(name, parent, hinge)


def scissors(at):
    body = Mesh(["Steel"])
    body.sphere(Vector((0, 0.03, 0.0026)), 0.0015, "Steel")  # the screw
    obj = body.make("Scissors", location=at)
    for side in (-1, 1):
        scissor_half(f"Scissors_JAW_{'L' if side < 0 else 'R'}", obj, side, (0.05, 0.004, 0.006), (0, 0.03, 0))
    marker("Scissors_TIP", obj, (0, 0.078, 0))
    return obj


def needle_driver(at):
    body = Mesh(["Steel", "Thread", "DarkSteel"])
    # a curved needle held across the jaw tip, its point toward the viewer's left, and a thread tail
    centre = Vector((0.0, 0.058, -0.004))
    pts = [centre + Vector((0.008 * math.cos(a), 0, 0.008 * math.sin(a))) for a in [math.radians(200 - 22 * k) for k in range(10)]]
    for p, q in zip(pts, pts[1:]):
        body.cylinder(p, q, 0.0005, "DarkSteel", segments=6)
    tail = [pts[-1] + Vector((0.004 * k, -0.006 * k, -0.002 * k * k)) for k in range(8)]
    for p, q in zip(tail, tail[1:]):
        body.cylinder(p, q, 0.0004, "Thread", segments=6)
    obj = body.make("NeedleDriver", location=at)
    for side in (-1, 1):
        scissor_half(f"NeedleDriver_JAW_{'L' if side < 0 else 'R'}", obj, side, (0.026, 0.0, 0.007), (0, 0.032, 0), blade=False)
    marker("NeedleDriver_TIP", obj, tuple(pts[0]))
    return obj


def stapler(at):
    body = Mesh(["StaplerBody", "StaplerAccent", "Steel"])
    body.box(Vector((0, 0.0, 0.0)), (0.026, 0.1, 0.022), "StaplerBody")  # barrel
    body.box(Vector((0, 0.056, -0.006)), (0.022, 0.016, 0.03), "StaplerAccent")  # head
    body.box(Vector((0, 0.064, -0.02)), (0.012, 0.004, 0.004), "Steel")  # outlet
    body.box(Vector((0, -0.035, -0.035)), (0.024, 0.026, 0.06), "StaplerBody", Matrix.Rotation(math.radians(-20), 4, "X"))  # grip
    obj = body.make("Stapler", location=at)
    bevel = obj.modifiers.new("round", "BEVEL")
    bevel.width, bevel.segments = 0.003, 3
    trig = Mesh(["StaplerAccent"])
    trig.box(Vector((0, 0.004, -0.022)), (0.012, 0.01, 0.04), "StaplerAccent", Matrix.Rotation(math.radians(-15), 4, "X"))
    trig.make_part("Stapler_TRIGGER", obj, (0, 0.012, -0.012))
    marker("Stapler_TIP", obj, (0, 0.064, -0.023))
    staple = Mesh(["Steel"])
    for p, q in (((-0.003, 0, 0), (0.003, 0, 0)), ((-0.003, 0, 0), (-0.003, 0, -0.002)), ((0.003, 0, 0), (0.003, 0, -0.002))):
        staple.cylinder(Vector(p), Vector(q), 0.00045, "Steel", segments=6)
    staple.make("Staple", location=B(0.42, TRAY_TOP + 0.002, 0.04))
    return obj


def balfour(at):
    """A self-retaining frame: two side bars along the wound, cross bars, and two lateral blades that
    hook the wound's edges. Across the wound is Blender y (three z); the blades sit at ±6 cm."""
    m = Mesh(["Steel", "DarkSteel"])
    for y in (-0.075, 0.075):
        m.cylinder(Vector((-0.1, y, 0)), Vector((0.1, y, 0)), 0.003, "Steel")
    for x in (-0.1, 0.1):
        m.cylinder(Vector((x, -0.075, 0)), Vector((x, 0.075, 0)), 0.003, "Steel")
        m.box(Vector((x, 0.03, 0)), (0.012, 0.016, 0.008), "DarkSteel")  # ratchet slider
    for sign in (-1, 1):
        blade_y = sign * 0.06
        # a curved plate 5 cm wide: down from the bar, then a lip curling out under the wound's edge
        prof = [(blade_y + sign * 0.012 * (1 - t) ** 2, -0.048 * t) for t in [k / 8 for k in range(9)]]
        prof += [(blade_y + sign * 0.004 * k, -0.048 - 0.002 * k) for k in (1, 2)]
        strip = [(m.bm.verts.new((-0.025, y, z)), m.bm.verts.new((0.025, y, z))) for y, z in prof]
        for (a0, a1), (b0, b1) in zip(strip, strip[1:]):
            f = m.bm.faces.new([a0, a1, b1, b0])
            f.material_index = 0
        m.cylinder(Vector((0, sign * 0.075, 0)), Vector((0, blade_y + sign * 0.012, 0)), 0.003, "Steel")
    obj = m.make("Balfour", location=at)
    marker("Balfour_SEAT", obj, (0, 0, -0.03))
    return obj


def tray_and_dish():
    m = Mesh(["TrayMetal"])
    cx, cz, w, d = 0.42, -0.08, 0.48, 0.3
    m.box(B(cx, TRAY_TOP - 0.004, cz), (w, d, 0.008), "TrayMetal")
    for dz in (-d / 2, d / 2):
        m.box(B(cx, TRAY_TOP + 0.006, cz + dz), (w, 0.006, 0.012), "TrayMetal")
    for dx in (-w / 2, w / 2):
        m.box(B(cx + dx, TRAY_TOP + 0.006, cz), (0.006, d, 0.012), "TrayMetal")
    # the stand: a post from the floor in front of the table, an arm under the tray
    m.cylinder(B(cx, 0.03, 0.05), B(cx, TRAY_TOP - 0.06, 0.05), 0.015, "TrayMetal")
    m.cylinder(B(cx, TRAY_TOP - 0.06, 0.05), B(cx, TRAY_TOP - 0.012, cz), 0.012, "TrayMetal")
    m.box(B(cx, 0.015, 0.05), (0.34, 0.08, 0.03), "TrayMetal")
    m.make("MayoTray")
    # kidney dish: a bean-shaped bowl at the back left of the tray
    dish = Mesh(["Dish"])
    bm = dish.bm
    centre = B(0.27, TRAY_TOP + 0.002, -0.17)
    rings = []
    for r in range(6):
        t = r / 5
        row = []
        for s in range(40):
            a = 2 * math.pi * s / 40
            k = 1 - 0.28 * max(0.0, math.cos(a)) ** 2  # the kidney's notch, toward the viewer
            x, z = 0.075 * t * math.cos(a) * 1.0, 0.045 * t * math.sin(a) * k
            row.append(bm.verts.new(centre + Vector((x, -z, 0.025 * t**3))))
        rings.append(row)
    c = bm.verts.new(centre)
    for s in range(40):
        bm.faces.new([c, rings[0][s], rings[0][(s + 1) % 40]])
    for r in range(5):
        for s in range(40):
            bm.faces.new([rings[r][s], rings[r + 1][s], rings[r + 1][(s + 1) % 40], rings[r][(s + 1) % 40]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    dish.ring(centre + Vector((0, 0, 0.025)), Vector((0, 0, 1)), 0.075, 0.0025, "Dish", 64)
    dish.make("KidneyDish")


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    tray_and_dish()
    rest = lambda x, lift: B(x, TRAY_TOP + lift, -0.02)
    scalpel(rest(0.24, 0.003))
    forceps(rest(0.31, 0.002))
    scissors(rest(0.38, 0.003))
    needle_driver(rest(0.46, 0.003))
    stapler(rest(0.56, 0.054))
    balfour(B(0.52, TRAY_TOP + 0.05, -0.17))
    for o in scene.objects:
        if o.type == "MESH":
            for p in o.data.polygons:
                p.use_smooth = o.name in ("KidneyDish", "Stapler")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "assets/blender/instruments.blend"), compress=True)


build()
