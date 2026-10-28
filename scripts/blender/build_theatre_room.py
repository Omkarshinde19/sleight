"""Builds assets/blender/theatre-room.blend: the operating room around the theatre scene (step 1.1, shell).

    blender -b --factory-startup --python scripts/blender/build_theatre_room.py

A 7 x 7 m room with a 3 m ceiling, centred on the operating table, after a hybrid operating room:
blue-violet wall panels on dark seams, a skirting, sliding double doors straight ahead, a recessed wall
monitor, a control panel and the horse painting on the front wall, a warm
grey floor with a pale blue round inlay under the table, a white ceiling with LED light panels, a ceiling
boom carrying twin round surgical lights over the table; the wall monitor shows vital signs.

Contract with the code (see docs/BLENDER.md):
- The floor's top is at height 0; everything is visual only (the floor collider is in code).
- One mesh per material, each named "Room_<Material>", so the room is a handful of draw calls.
- The table's centre (three.js x -0.1, z -0.4) is the room's centre on the floor.
- Empties LIGHT_Surgical_A / _B mark the surgical lights' faces and LIGHT_Surgical_A_TARGET / _B_TARGET
  where they aim; the code puts its live spotlights there.
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# ---------- layout (Blender axes: x right, y away from the viewer, z up; metres) ----------

# three.js (x, y, z) -> Blender (x, -z, y): the table centre (-0.1, _, -0.4) is Blender (-0.1, 0.4).
CX, CY = -0.1, 0.4
HALF = 3.5
HEIGHT = 3.0
X0, X1 = CX - HALF, CX + HALF
Y0, Y1 = CY - HALF, CY + HALF  # Y1 is the front wall, the one the viewer faces

PANEL = 1.0  # wall panel width
SEAM = 0.008  # gap between panels
PANEL_DEPTH = 0.02  # how far panels stand off the seam backing
SKIRT = 0.12
PANEL_TOP = 2.9

DOOR = {"u": (2.0, 4.0), "height": 2.2, "header": 0.12}  # front wall, panel columns 2-3
MONITOR = {"u": 1.0, "z": 1.55, "size": (1.2, 0.75)}  # front wall, centre of columns 0-1
CONTROL = {"u": 4.5, "z": 1.3, "size": (0.4, 0.5)}  # front wall, beside the doors
PAINTING = {"u": 6.0, "z": 1.6, "size": (1.8, 1.2), "depth": 0.04}  # front wall right of the doors, a wrapped canvas
PAINTING_IMAGE = os.path.join(ROOT, "assets/textures/painting.jpg")
INLAY = {"radius": 2.2, "ring": 0.06}

# Surgical lights: twin heads on a ceiling boom, aimed at the operating field. three.js (x, y, z) is
# Blender (x, -z, y): head A hangs at three (-0.45, 2.3, -1.05), head B at (0.35, 2.35, -1.15), high and
# far enough back to frame the top of the view without covering the doors.
FIELD = Vector((-0.1, 0.4, 1.05))  # where the lights aim: the abdomen
HUB = Vector((CX, CY, HEIGHT))
HEADS = {"A": (Vector((-0.45, 1.05, 2.3)), 2.75), "B": (Vector((0.35, 1.15, 2.35)), 2.66)}  # centre, arm height
HEAD_RADIUS = 0.3


def linear(hex_colour):
    """sRGB hex -> linear RGBA, as Blender's colour inputs expect."""
    rgb = [int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb) + (1.0,)


# ---------- materials ----------

MATERIALS = {
    # name: (base colour, roughness, metallic, emission colour, emission strength)
    "Wall": ("#5A62B4", 0.55, 0.0, None, 0),
    "Seam": ("#2C3066", 0.7, 0.0, None, 0),
    "Skirting": ("#2E3266", 0.5, 0.0, None, 0),
    "Floor": ("#D8D3CA", 0.6, 0.0, None, 0),
    "Inlay": ("#C9D6E3", 0.5, 0.0, None, 0),
    "InlayRing": ("#8FA6C2", 0.5, 0.0, None, 0),
    "Ceiling": ("#F2F3F5", 0.8, 0.0, None, 0),
    "LedPanel": ("#FFFFFF", 0.4, 0.0, "#F4F8FF", 3.0),
    "DoorSteel": ("#A4A9B3", 0.4, 0.6, None, 0),
    "DoorGlass": ("#1E2A3A", 0.15, 0.0, None, 0),
    "MonitorBezel": ("#16181E", 0.45, 0.2, None, 0),
    "ControlPanel": ("#C9CDD4", 0.45, 0.3, None, 0),
    "ControlLight": ("#3FD08A", 0.4, 0.0, "#3FD08A", 2.0),
    "Painting": ("#FFFFFF", 0.7, 0.0, None, 0),
    "CanvasEdge": ("#EDEBE6", 0.8, 0.0, None, 0),
    "LampHousing": ("#E8EBF0", 0.35, 0.3, None, 0),
    "LampLED": ("#FFFFFF", 0.3, 0.0, "#FFF6EA", 6.0),
    "BoomArm": ("#D3D7DE", 0.35, 0.5, None, 0),
    "VitalsScreen": ("#000000", 0.3, 0.0, "#FFFFFF", 1.4),
}


def make_material(name, base, roughness, metallic, emission, strength):
    mat = bpy.data.materials.new(name)
    nodes = mat.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = linear(base)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = linear(emission)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


# ---------- geometry: one bmesh per material ----------

meshes = {name: bmesh.new() for name in MATERIALS}


def box(mat, x0, x1, y0, y1, z0, z1):
    lo = (min(x0, x1), min(y0, y1), min(z0, z1))
    hi = (max(x0, x1), max(y0, y1), max(z0, z1))
    size = [h - l for l, h in zip(lo, hi)]
    centre = [(l + h) / 2 for l, h in zip(lo, hi)]
    m = Matrix.Translation(centre) @ Matrix.Diagonal((*size, 1.0))
    bmesh.ops.create_cube(meshes[mat], size=1.0, matrix=m)


def cylinder(mat, p0, p1, r, r1=None, segments=24):
    """A cylinder (or cone, radius r at p0 and r1 at p1) between two points."""
    d = p1 - p0
    m = Matrix.Translation((p0 + p1) / 2) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    bmesh.ops.create_cone(meshes[mat], cap_ends=True, segments=segments, radius1=r, radius2=r if r1 is None else r1, depth=d.length, matrix=m)


def sphere(mat, centre, r):
    bmesh.ops.create_uvsphere(meshes[mat], u_segments=16, v_segments=8, radius=r, matrix=Matrix.Translation(centre))


class Wall:
    """A wall in local coordinates: u along the wall from its left end (seen from inside), d from the
    wall face into the room, z up. Converts local boxes to world boxes (walls are axis-aligned)."""

    def __init__(self, origin, u_dir, inward):
        self.origin, self.u_dir, self.inward = origin, u_dir, inward

    def point(self, u, d):
        return (
            self.origin[0] + self.u_dir[0] * u + self.inward[0] * d,
            self.origin[1] + self.u_dir[1] * u + self.inward[1] * d,
        )

    def box(self, mat, u0, u1, d0, d1, z0, z1):
        a = self.point(u0, d0)
        b = self.point(u1, d1)
        box(mat, a[0], b[0], a[1], b[1], z0, z1)


FRONT = Wall((X0, Y1), (1, 0), (0, -1))
RIGHT = Wall((X1, Y1), (0, -1), (-1, 0))
BACK = Wall((X1, Y0), (-1, 0), (0, 1))
LEFT = Wall((X0, Y0), (0, 1), (1, 0))


def panels(wall, skip=()):
    """Seam backing, skirting and a row of panels; columns in `skip` are left out."""
    width = 2 * HALF
    wall.box("Seam", 0, width, -0.1, 0, 0, HEIGHT)
    for i in range(int(width / PANEL)):
        if i in skip:
            continue
        u0, u1 = i * PANEL + SEAM / 2, (i + 1) * PANEL - SEAM / 2
        wall.box("Wall", u0, u1, 0, PANEL_DEPTH, SKIRT + SEAM, PANEL_TOP)
        wall.box("Wall", u0, u1, 0, PANEL_DEPTH, PANEL_TOP + SEAM, HEIGHT)
    for i in range(int(width / PANEL)):
        if i not in skip:
            wall.box("Skirting", i * PANEL, (i + 1) * PANEL, 0, PANEL_DEPTH + 0.01, 0, SKIRT)


def front_wall():
    u0, u1 = DOOR["u"]
    doors = (int(u0 / PANEL), int(u1 / PANEL) - 1)
    panels(FRONT, skip=doors)
    h, header = DOOR["height"], DOOR["header"]
    # panels above the doors
    for i in doors:
        a, b = i * PANEL + SEAM / 2, (i + 1) * PANEL - SEAM / 2
        FRONT.box("Wall", a, b, 0, PANEL_DEPTH, h + header + SEAM, PANEL_TOP)
        FRONT.box("Wall", a, b, 0, PANEL_DEPTH, PANEL_TOP + SEAM, HEIGHT)
    # frame, header and two sliding leaves with window strips
    FRONT.box("DoorSteel", u0, u0 + 0.05, 0, 0.05, 0, h + header)
    FRONT.box("DoorSteel", u1 - 0.05, u1, 0, 0.05, 0, h + header)
    FRONT.box("DoorSteel", u0, u1, 0, 0.05, h, h + header)
    mid = (u0 + u1) / 2
    for a, b in ((u0 + 0.05, mid - 0.005), (mid + 0.005, u1 - 0.05)):
        FRONT.box("DoorSteel", a, b, 0.01, 0.04, 0, h)
        c = (a + b) / 2
        FRONT.box("DoorGlass", c - 0.13, c + 0.13, 0.04, 0.045, 1.1, 2.0)
        FRONT.box("DoorSteel", c - 0.15, c + 0.15, 0.04, 0.05, 0.95, 1.0)  # push plate
    # recessed wall monitor
    w, hh = MONITOR["size"]
    u, z = MONITOR["u"], MONITOR["z"]
    FRONT.box("MonitorBezel", u - w / 2 - 0.04, u + w / 2 + 0.04, PANEL_DEPTH, PANEL_DEPTH + 0.03, z - hh / 2 - 0.04, z + hh / 2 + 0.04)
    bm = meshes["VitalsScreen"]
    uv = bm.loops.layers.uv.new("UVMap")
    d = PANEL_DEPTH + 0.032
    corners = [(u - w / 2, z - hh / 2, (0, 0)), (u + w / 2, z - hh / 2, (1, 0)), (u + w / 2, z + hh / 2, (1, 1)), (u - w / 2, z + hh / 2, (0, 1))]
    f = bm.faces.new([bm.verts.new((*FRONT.point(cu, d), cz)) for cu, cz, _ in corners])
    for loop, (_, _, st) in zip(f.loops, corners):
        loop[uv].uv = st
    # control panel with a column of status lights
    w, hh = CONTROL["size"]
    u, z = CONTROL["u"], CONTROL["z"]
    FRONT.box("ControlPanel", u - w / 2, u + w / 2, PANEL_DEPTH, PANEL_DEPTH + 0.025, z - hh / 2, z + hh / 2)
    for k in range(4):
        FRONT.box("ControlLight", u - w / 2 + 0.05, u - w / 2 + 0.09, PANEL_DEPTH + 0.025, PANEL_DEPTH + 0.03, z + hh / 2 - 0.1 - k * 0.09, z + hh / 2 - 0.06 - k * 0.09)
    FRONT.box("MonitorBezel", u - 0.02, u + w / 2 - 0.05, PANEL_DEPTH + 0.025, PANEL_DEPTH + 0.028, z - hh / 2 + 0.06, z + hh / 2 - 0.06)


def floor():
    box("Floor", X0, X1, Y0, Y1, -0.05, 0)
    seg = 96
    r, ring = INLAY["radius"], INLAY["ring"]
    for mat, r0, r1, z in (("Inlay", 0, r, 0.0015), ("InlayRing", r, r + ring, 0.002)):
        bm = meshes[mat]
        outer = [bm.verts.new((CX + r1 * math.cos(2 * math.pi * i / seg), CY + r1 * math.sin(2 * math.pi * i / seg), z)) for i in range(seg)]
        if r0 == 0:
            bm.faces.new(outer)
        else:
            inner = [bm.verts.new((CX + r0 * math.cos(2 * math.pi * i / seg), CY + r0 * math.sin(2 * math.pi * i / seg), z)) for i in range(seg)]
            for i in range(seg):
                j = (i + 1) % seg
                bm.faces.new((inner[i], outer[i], outer[j], inner[j]))  # counter-clockwise from above: faces up


def ceiling():
    box("Ceiling", X0, X1, Y0, Y1, HEIGHT, HEIGHT + 0.05)
    z0, z1 = HEIGHT - 0.015, HEIGHT
    # a square ring of LED strips around the table, as in the reference photo
    s, w = 1.6, 0.18
    box("LedPanel", CX - s, CX + s, CY - s, CY - s + w, z0, z1)
    box("LedPanel", CX - s, CX + s, CY + s - w, CY + s, z0, z1)
    box("LedPanel", CX - s, CX - s + w, CY - s + w, CY + s - w, z0, z1)
    box("LedPanel", CX + s - w, CX + s, CY - s + w, CY + s - w, z0, z1)
    # four panels inside the ring, and long strips along the side walls
    for dx in (-0.75, 0.75):
        for dy in (-0.75, 0.75):
            box("LedPanel", CX + dx - 0.3, CX + dx + 0.3, CY + dy - 0.3, CY + dy + 0.3, z0, z1)
    for dx in (-2.6, 2.6):
        box("LedPanel", CX + dx - 0.12, CX + dx + 0.12, CY - 2.4, CY + 2.4, z0, z1)


def painting():
    """The horse painting on the front wall: a canvas box with the picture on a UV-mapped front face."""
    w, h = PAINTING["size"]
    u, z, depth = PAINTING["u"], PAINTING["z"], PAINTING["depth"]
    FRONT.box("CanvasEdge", u - w / 2, u + w / 2, PANEL_DEPTH, PANEL_DEPTH + depth, z - h / 2, z + h / 2)
    bm = meshes["Painting"]
    uv = bm.loops.layers.uv.new("UVMap")
    d = PANEL_DEPTH + depth + 0.001
    corners = [(u - w / 2, z - h / 2, (0, 0)), (u + w / 2, z - h / 2, (1, 0)), (u + w / 2, z + h / 2, (1, 1)), (u - w / 2, z + h / 2, (0, 1))]
    verts = [bm.verts.new((*FRONT.point(cu, d), cz)) for cu, cz, _ in corners]
    face = bm.faces.new(verts)  # u runs left to right as seen from inside the room, so it faces in
    for loop, (_, _, st) in zip(face.loops, corners):
        loop[uv].uv = st


def surgical_lights():
    """Ceiling hub, a column, an arm and a yoke per head; each head a domed housing whose face (toward
    the field) carries LED cells round a sterile handle."""
    sphere("BoomArm", HUB - Vector((0, 0, 0.02)), 0.11)
    cylinder("BoomArm", HUB, Vector((HUB.x, HUB.y, 2.56)), 0.06)
    for centre, arm_z in HEADS.values():
        n = (FIELD - centre).normalized()  # the face points at the field
        u = n.orthogonal().normalized()
        v = n.cross(u)
        elbow = Vector((HUB.x, HUB.y, arm_z))
        above = Vector((centre.x, centre.y, arm_z))
        sphere("BoomArm", elbow, 0.045)
        cylinder("BoomArm", elbow, above, 0.03)
        sphere("BoomArm", above, 0.04)
        top = centre - n * 0.15
        cylinder("BoomArm", above, top, 0.022)
        sphere("BoomArm", top, 0.03)
        cylinder("LampHousing", centre - n * 0.05, centre + n * 0.03, HEAD_RADIUS, segments=48)
        cylinder("LampHousing", centre - n * 0.05, top, HEAD_RADIUS, 0.09, segments=48)
        face = centre + n * 0.03
        for k in range(8):
            a = 2 * math.pi * k / 8
            c = face + (u * math.cos(a) + v * math.sin(a)) * 0.2
            cylinder("LampLED", c, c + n * 0.004, 0.06)
        for k in range(4):
            a = 2 * math.pi * k / 4 + math.pi / 4
            c = face + (u * math.cos(a) + v * math.sin(a)) * 0.095
            cylinder("LampLED", c, c + n * 0.004, 0.04)
        cylinder("BoomArm", face, face + n * 0.11, 0.022)  # sterile handle


def vitals_image(w=640, h=400):
    """Vital signs, drawn into an image: ECG, SpO2 and respiration traces with 7-segment readings."""
    import numpy as np

    px = np.zeros((h, w, 4), dtype=np.float32)
    px[..., :3] = (0.02, 0.03, 0.045)
    px[..., 3] = 1

    def dot(x, y, colour, r=2):
        x, y = int(x), int(y)
        px[max(0, y - r) : y + r, max(0, x - r) : x + r, :3] = colour

    def trace(f, y0, amp, colour, x1=440):
        prev = None
        for x in range(16, x1):
            y = y0 - amp * f(x)
            if prev is not None:
                for t in np.linspace(0, 1, 6):
                    dot(x - 1 + t, prev + (y - prev) * t, colour)
            prev = y

    def ecg(x):
        t = (x % 110) / 110
        if 0.30 < t < 0.34:
            return (t - 0.30) / 0.04 * 1.0
        if 0.34 <= t < 0.38:
            return 1.0 - (t - 0.34) / 0.04 * 1.4
        if 0.38 <= t < 0.41:
            return -0.4 + (t - 0.38) / 0.03 * 0.4
        if 0.55 < t < 0.7:
            return 0.18 * math.sin((t - 0.55) / 0.15 * math.pi)
        if 0.12 < t < 0.2:
            return 0.1 * math.sin((t - 0.12) / 0.08 * math.pi)
        return 0.0

    green, cyan, yellow = (0.25, 1.0, 0.45), (0.3, 0.85, 1.0), (1.0, 0.85, 0.25)
    trace(ecg, 100, 60, green)
    trace(lambda x: max(0.0, math.sin(x / 110 * 2 * math.pi)) ** 1.5, 230, 45, cyan)
    trace(lambda x: math.sin(x / 260 * 2 * math.pi), 330, 22, yellow)
    px[:, 452:454, :3] = (0.15, 0.18, 0.22)

    SEGMENTS = {"0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcfgd"}

    def digit(ch, x, y, colour, s=26):
        t = max(3, s // 6)
        bars = {"a": (x, y, s, t), "g": (x, y + s, s, t), "d": (x, y + 2 * s, s, t), "f": (x, y, t, s), "b": (x + s - t, y, t, s), "e": (x, y + s, t, s), "c": (x + s - t, y + s, t, s)}
        for seg in SEGMENTS[ch]:
            bx, by, bw, bh = bars[seg]
            px[by : by + bh + t, bx : bx + bw, :3] = colour

    for text, y, colour in (("72", 60, green), ("98", 190, cyan), ("16", 300, yellow)):
        for i, ch in enumerate(text):
            digit(ch, 480 + i * 40, y, colour)
    img = bpy.data.images.new("vitals", w, h)
    img.pixels.foreach_set(px[::-1].ravel())  # Blender images start at the bottom row
    img.pack()
    return img


def light_markers(scene):
    for name, (centre, _) in HEADS.items():
        n = (FIELD - centre).normalized()
        for suffix, at in (("", centre + n * 0.04), ("_TARGET", FIELD)):
            e = bpy.data.objects.new(f"LIGHT_Surgical_{name}{suffix}", None)
            e.empty_display_size = 0.1
            e.location = at
            scene.collection.objects.link(e)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    floor()
    ceiling()
    front_wall()
    for wall in (RIGHT, BACK, LEFT):
        panels(wall)
    painting()
    surgical_lights()

    for name, spec in MATERIALS.items():
        bm = meshes[name]
        if not bm.verts:
            continue
        mesh = bpy.data.meshes.new(f"Room_{name}")
        bm.to_mesh(mesh)
        bm.free()
        mat = make_material(name, *spec)
        if name == "Painting":
            nodes, links = mat.node_tree.nodes, mat.node_tree.links
            tex = nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images.load(PAINTING_IMAGE)
            tex.image.pack()
            bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
            links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if name == "VitalsScreen":
            nodes, links = mat.node_tree.nodes, mat.node_tree.links
            tex = nodes.new("ShaderNodeTexImage")
            tex.image = vitals_image()
            bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
            links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        mesh.materials.append(mat)
        obj = bpy.data.objects.new(f"Room_{name}", mesh)
        scene.collection.objects.link(obj)

    light_markers(scene)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "assets/blender/theatre-room.blend"), compress=True)


build()
