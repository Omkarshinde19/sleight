"""Builds assets/blender/robot-hand.blend: the rigged chrome robot hand (right hand, real-hand metres).

    blender -b --factory-startup --python scripts/blender/build_hand.py

The look follows the procedural ChromeHand: muscle-profile phalanges with gunmetal armour plates and
hinge knuckles, a thick palm with thenar/hypothenar pads, copper tendon cables over the back of the hand,
and a muscled forearm with bundles, veins, hoses and a wrist collar.

Contract with the code (see docs/BLENDER.md):
- Armature "RobotHand" with 21 bones named after MediaPipe's landmarks plus FOREARM. Bone X starts at
  landmark X and points at the next landmark down the chain; the *_TIP bones are 12 mm nubs. FOREARM runs
  elbow -> wrist and parents WRIST; every finger root (THUMB_CMC, *_MCP) is a child of WRIST.
- Rest pose: open right hand, wrist at the origin, fingers up, back of the hand toward the viewer
  (three.js: fingers +Y, palm facing -Z, thumb on -X), the same frame the tracker uses in the scene.
- Bone axes: local +Y along the bone, local +Z toward the back of the hand (the thumbnail for the thumb).
- One skinned mesh "RobotHandMesh"; each rigid part is weighted 100 % to one bone.
- Materials: Chrome, Gunmetal, Copper, Muscle.
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# ---------- landmarks (Blender axes: x right, y into the screen, z up; metres) ----------

NAMES = [
    "WRIST",
    "THUMB_CMC", "THUMB_MCP", "THUMB_IP", "THUMB_TIP",
    "INDEX_FINGER_MCP", "INDEX_FINGER_PIP", "INDEX_FINGER_DIP", "INDEX_FINGER_TIP",
    "MIDDLE_FINGER_MCP", "MIDDLE_FINGER_PIP", "MIDDLE_FINGER_DIP", "MIDDLE_FINGER_TIP",
    "RING_FINGER_MCP", "RING_FINGER_PIP", "RING_FINGER_DIP", "RING_FINGER_TIP",
    "PINKY_MCP", "PINKY_PIP", "PINKY_DIP", "PINKY_TIP",
]
WRIST, THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP = 0, 1, 2, 3, 4
MCPS = [5, 9, 13, 17]
INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP = MCPS
DISTALS = [7, 11, 15, 19]
CHAINS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]


def from_camera(x, y, z):
    """src/lib/hand/synth.ts camera axes -> scene (cameraToScene) -> Blender (x, -z, y)."""
    return Vector((-x, -z, -y))


def rest_landmarks():
    """The open pose of synth.ts's localRightHand, so the model matches the simulated hand."""
    p = [None] * 21
    p[WRIST] = Vector((0, 0, 0))
    mcp = [(0.024, -0.088, 0), (0.004, -0.094, 0), (-0.016, -0.09, 0.002), (-0.033, -0.079, 0.004)]
    splay = [0.1, 0.0, -0.09, -0.2]
    phalanx = [[0.042, 0.025, 0.022], [0.046, 0.028, 0.024], [0.043, 0.027, 0.023], [0.034, 0.021, 0.02]]
    for f in range(4):
        d = from_camera(math.sin(splay[f]), -math.cos(splay[f]), 0)
        q = from_camera(*mcp[f])
        p[MCPS[f]] = q
        for j in range(3):
            q = q + d * phalanx[f][j]
            p[MCPS[f] + j + 1] = q
    q = from_camera(0.022, -0.026, -0.01)
    p[THUMB_CMC] = q
    d = from_camera(0.5, -0.82, -0.28).normalized()
    for j, length in enumerate([0.032, 0.03, 0.026]):
        q = q + d * length
        p[THUMB_MCP + j] = q
    return p


J = rest_landmarks()
DORSAL = Vector((0, -1, 0))  # back of the hand, toward the viewer
PALMAR = -DORSAL
THUMB_NAIL = Vector((-0.8, -0.6, 0)).normalized()
ACROSS = J[INDEX_MCP] - J[PINKY_MCP]  # unnormalised on purpose: offsets below are fractions of it
FOREARM_LENGTH = 0.27
FOREARM_RADIUS = 0.024
ARM_DIR = (J[WRIST] - J[MIDDLE_MCP]).normalized()
ELBOW = J[WRIST] + ARM_DIR * FOREARM_LENGTH
PALM_HALF_THICKNESS = 0.017
TIP_NUB = 0.012


def dorsal_for(i):
    return THUMB_NAIL if 1 <= i <= 4 else DORSAL


def bone_radius(a):
    """Segment radius by joint, as in ChromeHand: thumb chunkiest, distal phalanges slimmest."""
    if a == THUMB_CMC:
        return 0.0145
    if a == THUMB_MCP:
        return 0.0128
    if a == THUMB_IP:
        return 0.0112
    if a in MCPS:
        return 0.0108 if a == PINKY_MCP else 0.0122
    base = 0.0098 if a >= PINKY_MCP else 0.011
    return base * 0.9 if a in DISTALS else base


# ---------- mesh building ----------

MATERIALS = ["Chrome", "Gunmetal", "Copper", "Muscle"]
BONES = ["FOREARM"] + NAMES


class Builder:
    """Accumulates every part into one bmesh with a material index and a single bone weight per vertex."""

    def __init__(self):
        self.bm = bmesh.new()
        self.deform = self.bm.verts.layers.deform.verify()

    def _verts(self, pts, bone):
        g = BONES.index(bone)
        vs = []
        for p in pts:
            v = self.bm.verts.new(p)
            v[self.deform][g] = 1.0
            vs.append(v)
        return vs

    def _face(self, vs, mat):
        f = self.bm.faces.new(vs)
        f.material_index = MATERIALS.index(mat)
        f.smooth = True

    def sweep(self, frame, section, rings, bone, mat, cap=True, poles=None):
        """Loft a closed 2D section (x, z) along the frame's +Y. rings: (y, sx, sz[, dx, dz]) in metres.
        Ends are closed with a fan to a pole at each end ring, or at y = poles[0] / poles[1] if given."""
        n = len(section)
        loops = []
        for ring in rings:
            y, sx, sz = ring[:3]
            dx, dz = ring[3:5] if len(ring) > 3 else (0.0, 0.0)
            loops.append(self._verts([frame @ Vector((x * sx + dx, y, z * sz + dz)) for x, z in section], bone))
        for a, b in zip(loops, loops[1:]):
            for i in range(n):
                j = (i + 1) % n
                self._face([a[i], a[j], b[j], b[i]], mat)
        if cap:
            ends = poles or (rings[0][0], rings[-1][0])
            for loop, y, flip in ((loops[0], ends[0], True), (loops[-1], ends[1], False)):
                c = self._verts([frame @ Vector((0, y, 0))], bone)[0]
                for i in range(n):
                    j = (i + 1) % n
                    self._face([c, loop[j], loop[i]] if flip else [c, loop[i], loop[j]], mat)

    def tube(self, pts, radius, bone, mat, sides=6):
        """A cable through 3D points, with parallel-transported cross-sections and closed ends."""
        n = len(pts)
        tangents = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
        normal = tangents[0].orthogonal().normalized()
        loops = []
        for p, t in zip(pts, tangents):
            normal = (normal - t * normal.dot(t)).normalized()
            binormal = t.cross(normal)
            ring = [p + (normal * math.cos(a) + binormal * math.sin(a)) * radius for a in circle_angles(sides)]
            loops.append(self._verts(ring, bone))
        for a, b in zip(loops, loops[1:]):
            for i in range(sides):
                j = (i + 1) % sides
                self._face([a[i], b[i], b[j], a[j]], mat)
        self._face(list(reversed(loops[0])), mat)
        self._face(loops[-1], mat)

    def torus(self, frame, major, minor, bone, mat, seg=32, sides=10):
        """Ring around the frame's +Y axis."""
        loops = []
        for i in range(seg):
            u = 2 * math.pi * i / seg
            ring = []
            for v in circle_angles(sides):
                r = major + minor * math.cos(v)
                ring.append(frame @ Vector((r * math.cos(u), minor * math.sin(v), r * math.sin(u))))
            loops.append(self._verts(ring, bone))
        for i in range(seg):
            a, b = loops[i], loops[(i + 1) % seg]
            for k in range(sides):
                m = (k + 1) % sides
                self._face([a[k], a[m], b[m], b[k]], mat)

    def to_mesh(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        return me


def circle_angles(n):
    return [2 * math.pi * i / n for i in range(n)]


def circle(n):
    return [(math.cos(a), math.sin(a)) for a in circle_angles(n)]


def frame_between(a, b, dorsal):
    """Matrix whose +Y runs a -> b, +Z leans toward `dorsal`, origin at a. Returns (matrix, length)."""
    y = b - a
    length = y.length
    y.normalize()
    z = dorsal - y * dorsal.dot(y)
    if z.length < 1e-6:
        z = y.orthogonal()
    z.normalize()
    x = y.cross(z)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = a
    return m, length


def profile(fn, steps):
    """Rings for sweep() from a radius function of t in [0, 1]."""
    return [fn(i / steps) for i in range(steps + 1)]


def ellipsoid(b, a, c, dorsal, rx, rz, bone, mat, seg=16, steps=8):
    """Spheroid spanning a -> c along its long axis."""
    m, length = frame_between(a, c, dorsal)
    rings = []
    for i in range(1, steps):
        th = math.pi * i / steps
        rings.append((length * (1 - math.cos(th)) / 2, rx * math.sin(th), rz * math.sin(th)))
    b.sweep(m, circle(seg), rings, bone, mat, poles=(0.0, length))


def build_fingers(b):
    for chain in CHAINS:
        for a, c in zip(chain, chain[1:]):
            bone = NAMES[a]
            dorsal = dorsal_for(a)
            r = bone_radius(a)
            m, length = frame_between(J[a], J[c], dorsal)
            # muscle-profile segment: tapered at both joints, bulging in the middle
            rings = profile(lambda t: (t * length, r * (0.78 + 0.28 * math.sin(math.pi * t) ** 0.75), r * 0.92 * (0.78 + 0.28 * math.sin(math.pi * t) ** 0.75)), 8)
            b.sweep(m, circle(16), rings, bone, "Chrome")
            # dorsal armour plate: a curved shell over the back of the phalanx
            arc = [(-math.pi / 2 + 0.25) + (math.pi - 0.5) * i / 9 for i in range(10)]
            outer = [(math.sin(t) * 1.12 * r, math.cos(t) * 1.18 * r) for t in arc]
            inner = [(math.sin(t) * 1.02 * r, math.cos(t) * 1.06 * r) for t in reversed(arc)]
            b.sweep(m, outer + inner, [(0.12 * length, 1, 1), (0.86 * length, 1, 1)], bone, "Gunmetal")
            # hinge knuckle across the base of the phalanx
            hm, _ = frame_between(J[a], J[a] + m.col[0].to_3d(), dorsal)
            b.sweep(hm, circle(14), [(-r * 1.025, r * 0.74, r * 0.74), (r * 1.025, r * 0.74, r * 0.74)], bone, "Gunmetal")
        # fingertip cap, on the distal phalanx
        tip, prev = J[chain[-1]], J[chain[-2]]
        r = bone_radius(chain[-2]) * 0.92
        d = (tip - prev).normalized()
        ellipsoid(b, prev.lerp(tip, 0.6), tip + d * r * 0.9, dorsal_for(chain[-2]), r, r * 0.9, NAMES[chain[-2]], "Chrome")


def build_palm(b):
    thick = PALM_HALF_THICKNESS
    w = J[WRIST]
    perimeter = [
        w - ACROSS * 0.42,
        w + ACROSS * 0.38,
        J[THUMB_CMC].lerp(J[THUMB_MCP], 0.25),
        J[INDEX_MCP] + ACROSS * 0.08,
        J[MIDDLE_MCP],
        J[RING_MCP],
        J[PINKY_MCP] - ACROSS * 0.1,
        J[PINKY_MCP].lerp(w, 0.45) - ACROSS * 0.2,
        w.lerp(J[PINKY_MCP], 0.2) - ACROSS * 0.32,
    ]
    centre = sum(perimeter, Vector()) / len(perimeter)
    # rings from the back of the hand to the palm side, bulging at the rim so the slab reads as rounded
    layers = [(0.8, 0.93), (0.55, 1.03), (0.0, 1.06), (-0.6, 1.03), (-1.0, 0.94)]
    loops = []
    for k, grow in layers:
        pts = [centre + (p - centre) * grow + DORSAL * thick * k for p in perimeter]
        loops.append(b._verts(pts, "WRIST"))
    n = len(perimeter)
    for a, c in zip(loops, loops[1:]):
        for i in range(n):
            j = (i + 1) % n
            b._face([a[i], c[i], c[j], a[j]], "Chrome")
    top = b._verts([centre + DORSAL * thick * 1.55], "WRIST")[0]
    bottom = b._verts([centre - DORSAL * thick * 1.5], "WRIST")[0]
    for i in range(n):
        j = (i + 1) % n
        b._face([top, loops[0][j], loops[0][i]], "Chrome")
        b._face([bottom, loops[-1][i], loops[-1][j]], "Chrome")

    # muscle pads on the palm side: thumb (thenar) and little finger (hypothenar)
    ellipsoid(
        b,
        w.lerp(J[THUMB_CMC], 0.6) + PALMAR * thick * 0.6,
        J[THUMB_MCP].lerp(J[INDEX_MCP], 0.35) + PALMAR * thick * 0.6,
        PALMAR, 0.021, 0.014, "WRIST", "Muscle",
    )
    ellipsoid(
        b,
        w.lerp(J[PINKY_MCP], 0.15) - ACROSS * 0.22 + PALMAR * thick * 0.55,
        J[PINKY_MCP].lerp(w, 0.25) - ACROSS * 0.1 + PALMAR * thick * 0.55,
        PALMAR, 0.016, 0.012, "WRIST", "Muscle",
    )

    # copper tendons over the back of the hand: wrist -> knuckle, then along each proximal phalanx
    wrist_back = w + DORSAL * thick * 1.1
    for i, m in enumerate(MCPS):
        start = wrist_back + ACROSS * ((1.5 - i) * 0.11)
        knuckle = J[m] + DORSAL * thick * 1.05
        b.tube([start.lerp(knuckle, t / 4) + DORSAL * 0.002 * math.sin(math.pi * t / 4) for t in range(5)], 0.0032, "WRIST", "Copper")
        pip = J[m + 1] + DORSAL * bone_radius(m) * 1.05
        b.tube([knuckle.lerp(pip, 0.08), pip], 0.0026, NAMES[m], "Copper")
    b.tube([J[THUMB_CMC] + DORSAL * thick * 0.6, J[THUMB_MCP] + THUMB_NAIL * bone_radius(THUMB_CMC)], 0.0034, "THUMB_CMC", "Copper")
    b.tube([J[THUMB_MCP] + THUMB_NAIL * bone_radius(THUMB_CMC), J[THUMB_IP] + THUMB_NAIL * bone_radius(THUMB_MCP)], 0.0028, "THUMB_MCP", "Copper")

    # wrist hinge across the base of the hand
    hm, _ = frame_between(w, w + (J[INDEX_MCP] - J[PINKY_MCP]).normalized(), DORSAL)
    fr = FOREARM_RADIUS
    b.sweep(hm, circle(18), [(-fr * 0.95, fr * 0.7, fr * 0.7), (fr * 0.95, fr * 0.7, fr * 0.7)], "WRIST", "Gunmetal")


def forearm_profile(t):
    """Radius along the forearm (0 = wrist, 1 = elbow): slim wrist, muscle belly two thirds up."""
    return 1 + 0.62 * math.exp(-(((t - 0.62) / 0.28) ** 2)) + 0.18 * t


def build_forearm(b):
    w = J[WRIST]
    fr = FOREARM_RADIUS
    m, length = frame_between(w, ELBOW, DORSAL)
    rings = profile(lambda t: (t * length, fr * forearm_profile(t), fr * 0.86 * forearm_profile(t)), 20)
    b.sweep(m, circle(28), rings, "FOREARM", "Chrome")

    side = ARM_DIR.cross(DORSAL).normalized()
    # flexor / extensor bundles bulging out of the forearm
    for direction, at in ((DORSAL, 0.6), (side, 0.55), (-side, 0.5), (PALMAR, 0.62)):
        a = w.lerp(ELBOW, at - 0.32) + direction * fr * 0.95
        c = w.lerp(ELBOW, at + 0.3) + direction * fr * 1.25
        ellipsoid(b, a, c, direction, fr * 0.55, fr * 0.42, "FOREARM", "Muscle", seg=14, steps=8)

    # veins: copper cables riding the muscle contour, wandering a little
    for v, k in enumerate((-0.6, 0.05, 0.62)):
        pts = []
        for i in range(16):
            t = 0.04 + 0.88 * i / 15
            ang = k + math.sin(t * 5 + v * 2) * 0.12
            direction = (DORSAL * math.cos(ang) + side * math.sin(ang)).normalized()
            r_scale = math.hypot(math.cos(ang) * 0.86, math.sin(ang))
            pts.append(w.lerp(ELBOW, t) + direction * fr * (forearm_profile(t) * r_scale + 0.1))
        b.tube(pts, 0.0033, "FOREARM", "Copper")

    # hydraulic hoses on the inner forearm
    for k in (0.35, -0.35):
        direction = (PALMAR * math.cos(k) + side * math.sin(k)).normalized()
        b.tube([w + direction * fr * 1.05, ELBOW + direction * fr * 1.3], 0.0052, "FOREARM", "Gunmetal", sides=10)

    # wrist collar
    cm, _ = frame_between(w + ARM_DIR * 0.006, ELBOW, DORSAL)
    b.torus(cm, fr * 1.08, fr * 1.08 * 0.22, "FOREARM", "Gunmetal")


# ---------- materials ----------

def make_material(name, color, roughness, coat=0.5, film=0.0):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = 0.06
    # thin film exports as KHR_materials_iridescence
    bsdf.inputs["Thin Film Thickness"].default_value = film
    bsdf.inputs["Thin Film IOR"].default_value = 1.7
    return mat


def srgb(hex_colour):
    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return tuple(lin(int(hex_colour[i : i + 2], 16) / 255) for i in (1, 3, 5))


# ---------- armature ----------

def build_armature():
    arm = bpy.data.armatures.new("RobotHand")
    obj = bpy.data.objects.new("RobotHand", arm)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones

    def bone(name, head, tail, dorsal, parent=None, connect=False):
        e = eb.new(name)
        e.head, e.tail = head, tail
        e.align_roll(dorsal)
        if parent:
            e.parent = eb[parent]
            e.use_connect = connect
        return e

    bone("FOREARM", ELBOW, J[WRIST], DORSAL)
    bone("WRIST", J[WRIST], J[MIDDLE_MCP], DORSAL, "FOREARM", connect=True)
    for chain in CHAINS:
        for k, i in enumerate(chain):
            tail = J[chain[k + 1]] if k + 1 < len(chain) else J[i] + (J[i] - J[chain[k - 1]]).normalized() * TIP_NUB
            bone(NAMES[i], J[i], tail, dorsal_for(i), "WRIST" if k == 0 else NAMES[chain[k - 1]], connect=k > 0)
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    rig = build_armature()

    b = Builder()
    build_fingers(b)
    build_palm(b)
    build_forearm(b)
    me = b.to_mesh("RobotHandMesh")
    mats = {
        "Chrome": make_material("Chrome", srgb("#eef1f7"), 0.09, film=400),
        "Gunmetal": make_material("Gunmetal", srgb("#6f7689"), 0.26, film=250),
        "Copper": make_material("Copper", srgb("#d0835a"), 0.2, film=200),
        "Muscle": make_material("Muscle", srgb("#cdd3e2"), 0.16, film=400),
    }
    for name in MATERIALS:
        me.materials.append(mats[name])

    mesh = bpy.data.objects.new("RobotHandMesh", me)
    bpy.context.collection.objects.link(mesh)
    for name in BONES:
        mesh.vertex_groups.new(name=name)
    mesh.parent = rig
    mesh.modifiers.new("Armature", "ARMATURE").object = rig

    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))

    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    print(f"RobotHandMesh: {len(me.vertices)} verts, {tris} tris")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "assets/blender/robot-hand.blend"), compress=True)


main()
