"""Builds assets/blender/patient.blend: the operating table, the draped patient and the open abdomen.

    blender -b --factory-startup --python scripts/blender/build_patient.py

The patient lies along x (head at -x, behind the anaesthesia screen), the viewer stands at +z. The
abdomen shows through a window in the drape; under the skin are fat, fascia, muscle and the peritoneal
cavity with the bowel. One small-bowel loop runs under the midline incision; its middle is dead
(Bowel_Necrotic), held between two clamps, to be cut out and the healthy ends joined.

Contract with the code (see docs/BLENDER.md and src/scenes/theatre/layout.ts):
- Skin and Fascia: shape keys Open_0 … Open_6 open the incision section by section along the guide
  (tent-shaped, they sum to the whole cut), Retracted pulls it wide (on top of a full Open). Nothing
  opens outside the guide, x -0.08 … 0.08, z -0.4 (three.js).
- Bowel_Proximal and Bowel_Distal: shape key Approximate brings their cut ends together at x 0.
- Bowel_Necrotic: the dead segment, a separate mesh, origin at its centre.
- Empties: INCISION_From/To, CUT_Proximal/Distal, STITCH_01 … 08 (in order), STAPLE_01 … 10.
- Guides (code shows and hides them): Guide_Incision, Guide_Staples, Guide_Stitches, Guide_CutRings.
- The skin's height is skin_height() below; layout.ts has the same function (a test compares them).
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def B(x, y, z):
    """three.js (x, y up, z toward the viewer) -> Blender (x, y away, z up)."""
    return Vector((x, -z, y))


def linear(hex_colour):
    rgb = [int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb) + (1.0,)


# ---------- layout (three.js coordinates, metres) ----------

TABLE_TOP = 0.82
TABLE = {"x": -0.1, "z": -0.4, "length": 2.0, "width": 0.56}
MID_Z = -0.4  # the body's midline
INCISION = (-0.08, 0.08)  # along x, at MID_Z
WINDOW = {"x": 0.16, "z": 0.12}  # half sizes of the drape's window, centred on (0, MID_Z)
PATCH = {"x": 0.2, "z": 0.16}  # half sizes of the skin patch (its edges hide under the drape)
SCREEN_X = -0.62  # anaesthesia screen


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def body_thickness(x):
    """Height of the body above the table along its length (head -x … feet +x)."""
    head, chest, belly, pelvis, legs = 0.12, 0.25, 0.24, 0.2, 0.13
    t = head + (chest - head) * smoothstep(-0.8, -0.62, x)
    t += (belly - chest) * smoothstep(-0.3, -0.18, x)
    t += (pelvis - belly) * smoothstep(0.18, 0.32, x)
    t += (legs - pelvis) * smoothstep(0.35, 0.5, x)
    return t


def skin_height(x, z):
    """Top of the body (three.js y). Across the body it's elliptical, 0.2 m half-width."""
    dz = (z - MID_Z) / 0.2
    return TABLE_TOP + body_thickness(x) * math.sqrt(max(0.0, 1 - dz * dz))


# ---------- materials ----------

MATERIALS = {
    # name: (base colour, roughness, metallic, sheen, emission colour, emission strength)
    "TableTop": ("#4A5163", 0.4, 0.5, 0, None, 0),
    "TablePad": ("#2B2F38", 0.75, 0.0, 0, None, 0),
    "TableSteel": ("#C9CED6", 0.32, 0.8, 0, None, 0),
    "Drape": ("#3D7EB8", 0.85, 0.0, 0.4, None, 0),
    "Skin": ("#D9A07A", 0.55, 0.0, 0.5, None, 0),
    "Fat": ("#E8C46A", 0.5, 0.0, 0.3, None, 0),
    "Fascia": ("#E9DDD3", 0.45, 0.0, 0.4, None, 0),
    "Muscle": ("#A8433F", 0.5, 0.0, 0.3, None, 0),
    "Peritoneum": ("#9C3F3C", 0.5, 0.0, 0.4, None, 0),
    "Bowel": ("#E3858A", 0.42, 0.0, 0.5, None, 0),
    "Necrotic": ("#5B2233", 0.4, 0.0, 0.4, None, 0),
    "Mucosa": ("#B83A4B", 0.45, 0.0, 0.3, None, 0),
    "Colon": ("#D9787A", 0.45, 0.0, 0.5, None, 0),
    "Mesentery": ("#F0C9A0", 0.5, 0.0, 0.4, None, 0),
    "ClampSteel": ("#C8CED8", 0.28, 1.0, 0, None, 0),
    "GuideInk": ("#6A2C91", 0.6, 0.0, 0, None, 0),
    "GuideDot": ("#38E0D0", 0.4, 0.0, 0, "#38E0D0", 2.0),
}


def make_material(name, base, roughness, metallic, sheen, emission, strength):
    mat = bpy.data.materials.new(name)
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = linear(base)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if sheen:
        bsdf.inputs["Sheen Weight"].default_value = sheen
        bsdf.inputs["Sheen Tint"].default_value = (1.0, 0.92, 0.88, 1.0)
    if emission:
        bsdf.inputs["Emission Color"].default_value = linear(emission)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


MATS = {}


def mat(name):
    if name not in MATS:
        MATS[name] = make_material(name, *MATERIALS[name])
    return MATS[name]


# ---------- helpers ----------


def new_object(name, bm, materials, smooth=True):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for m in materials:
        mesh.materials.append(mat(m))
    if smooth:
        for p in mesh.polygons:
            p.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def face(bm, verts, want, material=0):
    """A face whose normal points along `want` (flipped if needed)."""
    f = bm.faces.new(verts)
    f.material_index = material
    f.normal_update()
    if f.normal.dot(want) < 0:
        f.normal_flip()
    return f


def box(bm, centre, size, material=0):
    res = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(centre) @ Matrix.Diagonal((*size, 1.0)))
    for v in res["verts"]:
        for f in v.link_faces:
            f.material_index = material


def cylinder(bm, p0, p1, r, r1=None, segments=20, material=0):
    d = p1 - p0
    m = Matrix.Translation((p0 + p1) / 2) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=r, radius2=r if r1 is None else r1, depth=d.length, matrix=m)
    for v in res["verts"]:
        for f in v.link_faces:
            f.material_index = material


def torus(bm, centre, axis, R, r, segments=24, rings=8, arc=(0, 2 * math.pi), material=0):
    """A torus (or an arc of one) round `axis` through `centre`."""
    axis = axis.normalized()
    u = axis.orthogonal().normalized()
    v = axis.cross(u)
    a0, a1 = arc
    closed = abs(a1 - a0 - 2 * math.pi) < 1e-6
    n = segments if closed else segments + 1
    grid = []
    for i in range(n):
        a = a0 + (a1 - a0) * i / segments
        c = centre + (u * math.cos(a) + v * math.sin(a)) * R
        radial = (c - centre).normalized()
        grid.append([bm.verts.new(c + (radial * math.cos(2 * math.pi * j / rings) + axis * math.sin(2 * math.pi * j / rings)) * r) for j in range(rings)])
    for i in range(segments):
        i2 = (i + 1) % n
        for j in range(rings):
            j2 = (j + 1) % rings
            q = [grid[i][j], grid[i2][j], grid[i2][j2], grid[i][j2]]
            mid = sum((v.co for v in q), Vector()) / 4
            ring_c = centre + ((mid - centre) - axis * (mid - centre).dot(axis)).normalized() * R
            face(bm, q, mid - ring_c, material)


def catmull_rom(points, samples_per_span=24):
    pts = [points[0]] + points + [points[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for k in range(samples_per_span):
            t = k / samples_per_span
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(points[-1])
    return out


def tube(bm, path, radius, segments=16, cap_start=False, cap_end=False, material=0, cap_material=None):
    """A tube along `path` (Blender coords); radius(i, n) gives each ring's radius. Parallel-transport
    frames so it never twists. Caps are discs (the cut end of a bowel shows its lining)."""
    n = len(path)
    tangents = [(path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized() for i in range(n)]
    normal = tangents[0].orthogonal().normalized()
    rings = []
    for i in range(n):
        if i:
            normal = (normal - tangents[i] * normal.dot(tangents[i])).normalized()
        binormal = tangents[i].cross(normal)
        r = radius(i, n)
        rings.append([bm.verts.new(path[i] + (normal * math.cos(2 * math.pi * j / segments) + binormal * math.sin(2 * math.pi * j / segments)) * r) for j in range(segments)])
    for i in range(n - 1):
        for j in range(segments):
            j2 = (j + 1) % segments
            q = [rings[i][j], rings[i + 1][j], rings[i + 1][j2], rings[i][j2]]
            mid = sum((v.co for v in q), Vector()) / 4
            face(bm, q, mid - (path[i] + path[i + 1]) / 2, material)
    for cap, i, out in ((cap_start, 0, -tangents[0]), (cap_end, n - 1, tangents[-1])):
        if cap:
            centre = bm.verts.new(path[i] + out * 0.001)
            for j in range(segments):
                face(bm, [rings[i][j], rings[i][(j + 1) % segments], centre], out, material if cap_material is None else cap_material)
    return rings


def empty(name, at):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.01
    e.location = at
    bpy.context.scene.collection.objects.link(e)
    return e


# ---------- table, drape, screen ----------


def table():
    bm = bmesh.new()
    tx, tz = TABLE["x"], TABLE["z"]
    L, W = TABLE["length"], TABLE["width"]
    box(bm, B(tx, TABLE_TOP - 0.035, tz), (L, W, 0.05), 1)  # mattress
    box(bm, B(tx, TABLE_TOP - 0.075, tz), (L + 0.02, W + 0.02, 0.03), 0)  # top frame
    for side in (-1, 1):  # side rails
        box(bm, B(tx, TABLE_TOP - 0.07, tz + side * (W / 2 + 0.02)), (L - 0.1, 0.012, 0.02), 2)
    cylinder(bm, B(tx, 0.08, tz), B(tx, TABLE_TOP - 0.09, tz), 0.11, 0.09, segments=32, material=2)
    box(bm, B(tx, 0.04, tz), (0.64, 0.4, 0.08), 0)  # base (covers the baked stand-in's shadow)
    new_object("Table", bm, ["TableTop", "TablePad", "TableSteel"], smooth=False)


def drape():
    """A blanket over the body heights, with a window over the abdomen and skirts over the table's edges."""
    bm = bmesh.new()
    x0, x1 = TABLE["x"] - TABLE["length"] / 2 - 0.03, TABLE["x"] + TABLE["length"] / 2 + 0.03
    half = TABLE["width"] / 2
    xs = [x0 + i * 0.02 for i in range(int(round((x1 - x0) / 0.02)) + 1)]
    zs = [MID_Z - half - 0.04 + j * 0.02 for j in range(int(round((2 * half + 0.08) / 0.02)) + 1)]

    def height(x, z):
        dz = abs(z - MID_Z)
        if dz > half + 0.005 or x < x0 + 0.025 or x > x1 - 0.025:
            return 0.52  # the skirt hangs down past the table's edge
        return max(TABLE_TOP + 0.006, skin_height(x, z) + 0.004)

    grid = [[bm.verts.new(B(x, height(x, z), z)) for z in zs] for x in xs]
    up = Vector((0, 0, 1))
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if abs(cx) < WINDOW["x"] and abs(cz - MID_Z) < WINDOW["z"]:
                continue
            face(bm, [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]], up)
    # anaesthesia screen: drape hung from a bar across the table, hiding the head
    bar_y = 1.48
    screen = [[bm.verts.new(B(SCREEN_X + 0.03 * math.sin(math.pi * k / 10), y, z)) for z in zs[2:-2]] for k, y in enumerate([skin_height(SCREEN_X, MID_Z) - 0.12 + (bar_y - skin_height(SCREEN_X, MID_Z) + 0.12) * k / 10 for k in range(11)])]
    for k in range(10):
        for j in range(len(screen[k]) - 1):
            face(bm, [screen[k][j], screen[k][j + 1], screen[k + 1][j + 1], screen[k + 1][j]], Vector((1, 0, 0)))
    new_object("Drape", bm, ["Drape"])
    bm = bmesh.new()
    cylinder(bm, B(SCREEN_X, bar_y, zs[0]), B(SCREEN_X, bar_y, zs[-1]), 0.008, material=0)
    for z in (zs[0], zs[-1]):
        cylinder(bm, B(SCREEN_X, TABLE_TOP - 0.06, z), B(SCREEN_X, bar_y, z), 0.008, material=0)
    new_object("ScreenBar", bm, ["TableSteel"], smooth=False)


# ---------- the abdominal wall: skin and fascia, with the incision's shape keys ----------

NODES = 7  # Open_0 … Open_6


def envelope(x):
    a, b = INCISION
    u = (x - (a + b) / 2) / ((b - a) / 2)
    return math.sqrt(max(0.0, 1 - u * u))


def tent(k, x):
    a, b = INCISION
    step = (b - a) / (NODES - 1)
    return max(0.0, 1 - abs(x - (a + k * step)) / step)


def layer(name, depth, wall, top_mat, wall_mat, open_cut, retract):
    """A height-field sheet `depth` under the skin's surface, split along the incision, with cut walls
    `wall` deep. open_cut / retract: (half-gap, falloff) of the opened and the retracted wound."""
    bm = bmesh.new()
    a, b = INCISION
    step_x = 0.008
    xs = [-PATCH["x"] + i * step_x for i in range(int(round(2 * PATCH["x"] / step_x)) + 1)]
    near = [k * 0.004 for k in range(1, 26)]  # fine rows by the cut
    far = [0.1 + k * 0.01 for k in range(1, int(round((PATCH["z"] - 0.1) / 0.01)) + 1)]
    rows = sorted([-d for d in near + far]) + [0.0] + near + far
    seam = rows.index(0.0)
    inside = lambda x: a + 1e-6 < x < b - 1e-6
    side = {}  # vertex -> (-1 back / +1 front, distance from the cut)
    top, top_r, bottom, bottom_r = {}, {}, {}, {}
    for i, x in enumerate(xs):
        for j, dz in enumerate(rows):
            z = MID_Z + dz
            v = bm.verts.new(B(x, skin_height(x, z) - depth, z))
            top[i, j] = v
            side[v] = (-1 if dz <= 0 else 1, abs(dz))
            if j == seam:
                if inside(x):
                    r = bm.verts.new(v.co.copy())
                    side[r] = (1, 0.0)
                    top_r[i] = r
                else:
                    top_r[i] = v
    up = Vector((0, 0, 1))
    for i in range(len(xs) - 1):
        for j in range(len(rows) - 1):
            if j == seam:
                q = [top_r[i], top_r[i + 1], top[i + 1, j + 1], top[i, j + 1]]
            else:
                q = [top[i, j], top[i + 1, j], top[i + 1, j + 1], top[i, j + 1]]
            face(bm, q, up, 0)
    # cut walls, front and back
    for i, x in enumerate(xs):
        if a - 1e-6 <= x <= b + 1e-6:
            c = top[i, seam]
            bl = bm.verts.new(c.co - Vector((0, 0, wall)))
            side[bl] = (-1, 0.0)
            bottom[i] = bl
            if inside(x):
                br = bm.verts.new(c.co - Vector((0, 0, wall)))
                side[br] = (1, 0.0)
                bottom_r[i] = br
            else:
                bottom_r[i] = bl
    idx = sorted(bottom)
    for i, i2 in zip(idx, idx[1:]):
        back = Vector((0, -1, 0))  # the back lip's wall faces the viewer (three +z = Blender -y)
        face(bm, [top[i, seam], top[i2, seam], bottom[i2], bottom[i]], back, 1)
        face(bm, [top_r[i], top_r[i2], bottom_r[i2], bottom_r[i]], -back, 1)
    bm.verts.index_update()
    lookup = {v.index: s for v, s in side.items()}  # to_mesh keeps the vertex order
    obj = new_object(name, bm, [top_mat, wall_mat])

    # shape keys, from each vertex's side and distance from the cut
    me = obj.data

    def displace(v, half_gap, falloff, lip):
        s, d = lookup[v.index]
        x = v.co.x
        w = envelope(x) * max(0.0, 1 - d / falloff)
        # three +z (front) is Blender -y
        return Vector((0, -s * half_gap * w, -lip * w))

    obj.shape_key_add(name="Basis")
    full_open = [displace(v, *open_cut, 0.003) for v in me.vertices]
    for k in range(NODES):
        key = obj.shape_key_add(name=f"Open_{k}")
        for v, d in zip(me.vertices, full_open):
            key.data[v.index].co = v.co + d * tent(k, v.co.x)
    key = obj.shape_key_add(name="Retracted")
    for v, d in zip(me.vertices, full_open):
        key.data[v.index].co = v.co + displace(v, *retract, 0.006) - d
    obj.active_shape_key_index = 0
    return obj


# ---------- the cavity and the bowel ----------

BOWEL_R = 0.014
NECROTIC = (-0.03, 0.03)  # along x
BOWEL_PATH = [(-0.17, 0.975, -0.47), (-0.12, 0.995, -0.43), (-0.07, 1.012, -0.405), (0.0, 1.016, -0.4), (0.07, 1.012, -0.395), (0.12, 0.995, -0.37), (0.17, 0.975, -0.33)]


def cavity():
    """The peritoneal cavity: a bowl whose rim follows the skin, 2 cm under it."""
    bm = bmesh.new()
    rx, rz, floor = 0.185, 0.145, 0.965
    rings, segs = 10, 48
    centre = bm.verts.new(B(0, floor, MID_Z))
    grid = []
    for r in range(1, rings + 1):
        t = r / rings
        row = []
        for s in range(segs):
            a = 2 * math.pi * s / segs
            x, dz = rx * t * math.cos(a), rz * t * math.sin(a)
            rim = skin_height(x, MID_Z + dz) - 0.02
            row.append(bm.verts.new(B(x, floor + (rim - floor) * t**4, MID_Z + dz)))
        grid.append(row)
    up = Vector((0, 0, 1))
    for s in range(segs):
        face(bm, [centre, grid[0][s], grid[0][(s + 1) % segs]], up)
    for r in range(rings - 1):
        for s in range(segs):
            s2 = (s + 1) % segs
            face(bm, [grid[r][s], grid[r + 1][s], grid[r + 1][s2], grid[r][s2]], up)
    new_object("Cavity", bm, ["Peritoneum"])


def bowel():
    path = catmull_rom([B(*p) for p in BOWEL_PATH], 40)
    a, b = NECROTIC
    prox = [p for p in path if p.x <= a] + [B(a, *_at_x(path, a))]
    dist = [B(b, *_at_x(path, b))] + [p for p in path if p.x >= b]
    nec = [B(a - 0.003, *_at_x(path, a - 0.003))] + [p for p in path if a - 0.003 < p.x < b + 0.003] + [B(b + 0.003, *_at_x(path, b + 0.003))]
    healthy = lambda i, n: BOWEL_R

    bm = bmesh.new()
    tube(bm, prox, healthy, cap_end=True, material=0, cap_material=1)
    p_obj = new_object("Bowel_Proximal", bm, ["Bowel", "Mucosa"])
    bm = bmesh.new()
    tube(bm, dist, healthy, cap_start=True, material=0, cap_material=1)
    d_obj = new_object("Bowel_Distal", bm, ["Bowel", "Mucosa"])
    swollen = lambda i, n: BOWEL_R + 0.003 * math.sin(math.pi * i / (n - 1)) ** 0.5
    centre = sum(nec, Vector()) / len(nec)
    bm = bmesh.new()
    tube(bm, [p - centre for p in nec], swollen, cap_start=True, cap_end=True, material=0, cap_material=0)
    n_obj = new_object("Bowel_Necrotic", bm, ["Necrotic"])
    n_obj.location = centre

    # Approximate: the last 5 cm of each healthy end slides along to meet at x 0
    for obj, end, sign in ((p_obj, a, 1), (d_obj, b, -1)):
        obj.shape_key_add(name="Basis")
        key = obj.shape_key_add(name="Approximate")
        for v in obj.data.vertices:
            reach = 1 - min(1.0, abs(v.co.x - end) / 0.05)
            key.data[v.index].co = v.co + Vector((sign * abs(end) * smoothstep(0, 1, reach), 0, 0.002 * reach))
        obj.active_shape_key_index = 0

    # mesentery: a fan under the healthy parts, down to the cavity floor
    bm = bmesh.new()
    for part in (prox, dist):
        pts = [p for p in part if abs(p.x) > 0.04]
        top = [bm.verts.new(p - Vector((0, 0, BOWEL_R * 0.8))) for p in pts]
        bot = [bm.verts.new(Vector((p.x, p.y, 0.962))) for p in pts]
        for i in range(len(pts) - 1):
            face(bm, [top[i], top[i + 1], bot[i + 1], bot[i]], Vector((0, -1, 0)))
    new_object("Mesentery", bm, ["Mesentery"])
    return path


def _at_x(path, x):
    """(y, z) in three.js terms of the path where it crosses Blender x."""
    for p, q in zip(path, path[1:]):
        if p.x <= x <= q.x:
            t = (x - p.x) / (q.x - p.x)
            c = p.lerp(q, t)
            return c.z, -c.y
    raise ValueError(x)


def coils_and_colon():
    """Static bowel filling the cavity round the loop that's operated on, and the colon framing it."""
    bm = bmesh.new()
    for z0, y0, phase in ((-0.48, 0.99, 0.0), (-0.325, 0.988, 1.3)):
        pts = [B(x, y0 + 0.006 * math.sin(x * 40 + phase), z0 + 0.018 * math.sin(x * 28 + phase)) for x in [-0.16 + k * 0.004 for k in range(81)]]
        tube(bm, pts, lambda i, n: 0.013)
    for x0 in (-0.14, 0.14):
        pts = [B(x0 + 0.02 * math.sin(k * 0.35), 0.985, -0.5 + k * 0.005) for k in range(41)]
        tube(bm, pts, lambda i, n: 0.012)
    new_object("Bowel_Coils", bm, ["Bowel"])
    bm = bmesh.new()
    rx, rz = 0.15, 0.105  # inside the dome: it must stay under the fascia
    pts = [B(rx * math.cos(a), 0.975, MID_Z + rz * math.sin(a)) for a in [math.radians(200 + k * 4.4) for k in range(81)]]
    tube(bm, pts, lambda i, n: 0.02 * (1 + 0.12 * abs(math.sin(i * 0.9))), segments=18)
    new_object("Colon", bm, ["Colon"])


def clamps():
    """Two bowel clamps either side of the dead segment, handles out of the wound toward the viewer."""
    for name, x in (("Clamp_Proximal", -0.05), ("Clamp_Distal", 0.05)):
        bm = bmesh.new()
        y, z = 1.016 + 0.004, MID_Z
        for dy in (BOWEL_R + 0.002, -(BOWEL_R + 0.002)):
            cylinder(bm, B(x, y + dy, z - 0.035), B(x, y + dy, z + 0.03), 0.0025, segments=10)
        cylinder(bm, B(x, y, z + 0.03), B(x, 1.1, z + 0.12), 0.003, segments=10)
        torus(bm, B(x + 0.012, 1.105, z + 0.13), Vector((0, 0, 1)), 0.009, 0.0022, 16, 6)
        torus(bm, B(x - 0.012, 1.105, z + 0.13), Vector((0, 0, 1)), 0.009, 0.0022, 16, 6)
        new_object(name, bm, ["ClampSteel"])


# ---------- guides and markers ----------


def guides(bowel_path):
    a, b = INCISION
    lift = 0.0006
    bm = bmesh.new()
    x = a
    while x < b - 1e-6:
        x1 = min(b, x + 0.006)
        q = [B(x, skin_height(x, MID_Z - 0.0008) + lift, MID_Z - 0.0008), B(x1, skin_height(x1, MID_Z - 0.0008) + lift, MID_Z - 0.0008), B(x1, skin_height(x1, MID_Z + 0.0008) + lift, MID_Z + 0.0008), B(x, skin_height(x, MID_Z + 0.0008) + lift, MID_Z + 0.0008)]
        face(bm, [bm.verts.new(p) for p in q], Vector((0, 0, 1)))
        x += 0.01
    new_object("Guide_Incision", bm, ["GuideInk"], smooth=False)
    empty("INCISION_From", B(a, skin_height(a, MID_Z), MID_Z))
    empty("INCISION_To", B(b, skin_height(b, MID_Z), MID_Z))

    bm = bmesh.new()
    for k in range(10):
        x = a + 0.008 + k * (b - a - 0.016) / 9
        y = skin_height(x, MID_Z)
        empty(f"STAPLE_{k + 1:02d}", B(x, y, MID_Z))
        q = [B(x - 0.0008, y + lift * 2, MID_Z - 0.008), B(x + 0.0008, y + lift * 2, MID_Z - 0.008), B(x + 0.0008, y + lift * 2, MID_Z + 0.008), B(x - 0.0008, y + lift * 2, MID_Z + 0.008)]
        face(bm, [bm.verts.new(p) for p in q], Vector((0, 0, 1)))
    new_object("Guide_Staples", bm, ["GuideInk"], smooth=False)

    # stitches: 8 points over the top of the joined bowel at x 0, back to front
    yc, zc = 1.016, MID_Z
    bm = bmesh.new()
    for k in range(8):
        phi = math.radians(-78.75 + k * 22.5)
        p = B(0.0, yc + 0.017 * math.cos(phi), zc + 0.017 * math.sin(phi))
        empty(f"STITCH_{k + 1:02d}", p)
        bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.0016, matrix=Matrix.Translation(p))
    new_object("Guide_Stitches", bm, ["GuideDot"])

    bm = bmesh.new()
    for name, x in (("CUT_Proximal", NECROTIC[0]), ("CUT_Distal", NECROTIC[1])):
        y, z = _at_x(bowel_path, x)
        empty(name, B(x, y + BOWEL_R, z))
        for k in range(8):
            a0 = 2 * math.pi * k / 8
            torus(bm, B(x, y, z), Vector((1, 0, 0)), BOWEL_R + 0.004, 0.0008, 4, 4, (a0, a0 + 2 * math.pi / 16))
    new_object("Guide_CutRings", bm, ["GuideInk"], smooth=False)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    table()
    drape()
    layer("Skin", 0.0, 0.012, "Skin", "Fat", open_cut=(0.012, 0.035), retract=(0.06, 0.11))
    layer("Fascia", 0.014, 0.006, "Fascia", "Muscle", open_cut=(0.01, 0.03), retract=(0.057, 0.1))
    cavity()
    path = bowel()
    coils_and_colon()
    clamps()
    guides(path)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "assets/blender/patient.blend"), compress=True)


build()
