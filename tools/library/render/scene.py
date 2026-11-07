"""Pack art: one parametric bpy scene for the built-in library (tools/library/ART.md).

  KIT=../bar_builds/.claude/scripts/blender
  bash $KIT/run.sh tools/library/render/scene.py --id marimba --out tools/out/render/marimba [options]

Builds the shared studio set (a warm off-white sweep, a soft key from the upper left, a large fill, a thin rim,
a 3/4 product camera) and a procedural model of the instrument named in pack.json, then animates it from the
sound: frame 0 is the hit, and the RMS envelope of assets-src/audio/<id>.wav per 30 fps frame drives the
vibration, the orange glow on the struck part and every visible motion, for exactly the sound's length.

Options:
  --frames all|0,3,20    all = the whole clip to OUT/frames/####.png; a list = stills OUT/f####.png + strip.png
  --views                also OUT/views.png, five views around the model at frame 0 (the critic's sheet)
  --size 960x540 --samples 40 --no-blur
The bb kit (bar_builds/.claude/scripts/blender) is found beside this repo, or at $BB_KIT.
"""
import argparse
import json
import math
import os
import random
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
KIT = os.environ.get("BB_KIT") or os.path.join(os.path.dirname(REPO), "bar_builds", ".claude", "scripts", "blender")
sys.path.insert(0, KIT)
import bb  # noqa: E402  (imports bpy first)
import bpy  # noqa: E402
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402
from bpy_extras.object_utils import world_to_camera_view  # noqa: E402

FPS = 30
OFF, GRAPHITE, ORANGE = "#ECE8DE", "#2B2B30", "#F2621B"
CAM_DIR = Vector((0.53, -0.85, 0.40)).normalized()   # 3/4 from the front right, about 23 degrees up
LENS = 70
TAU = 2 * math.pi
WASH = 1.0


# ---------------------------------------------------------------- sound

def envelope(wav):
    """RMS per 30 fps frame. e: 0..1 on a dB scale (peak = 1, -48 dB = 0), so the picture rings as long as the ear."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", wav, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32)
    sr, hop = 48000, 48000 / FPS
    dur = len(x) / sr
    n = int(math.ceil(dur * FPS - 1e-6))
    rms = np.array([math.sqrt(float(np.mean(x[int(i * hop):int((i + 1) * hop)] ** 2)) + 1e-18) for i in range(n)])
    lin = rms / rms.max()
    e = np.clip(1 + 20 * np.log10(np.maximum(lin, 1e-9)) / 48.0, 0, 1)
    e[1:-1] = np.maximum(e[1:-1], (e[:-2] + e[1:-1] + e[2:]) / 3) if n > 2 else e[1:-1]
    return {"n": n, "dur": dur, "lin": lin.tolist(), "e": e.tolist(), "peak": int(np.argmax(rms))}


def lift_curve(n, t_peak=0.13):
    """The striker's path: 0 = contact on frame 0, a fast rebound to 1, then back down to touch again at frame n
    (the loop's next hit). sin(pi * u^p) with p putting the peak at t_peak seconds."""
    u_peak = min(0.45, max(1e-3, t_peak * FPS / n))
    p = math.log(0.5) / math.log(u_peak)
    return [math.sin(math.pi * (f / n) ** p) for f in range(n)]


# ---------------------------------------------------------------- materials

def mat(name, color, rough=0.5, metal=0.0, **kw):
    inputs = {"Base Color": color, "Roughness": rough, "Metallic": metal}
    names = {"coat": "Coat Weight", "coat_rough": "Coat Roughness", "sheen": "Sheen Weight", "spec": "Specular IOR Level",
             "trans": "Transmission Weight", "aniso": "Anisotropic", "sss": "Subsurface Weight", "alpha": "Alpha", "ior": "IOR"}
    for k, v in kw.items(): inputs[names.get(k, k)] = v
    return bb.material(name, None, **inputs)


def _nodes(m):
    return m.node_tree.nodes, m.node_tree.links, m.node_tree.nodes["Principled BSDF"]


def grain(m, c1, c2, scale=18.0, along="Y", across="X", distort=5.0, rings=False, bump=0.08):
    """Procedural wood: wave bands in object space between two tones (stripes run `along`, vary `across`),
    stretched along the grain, with a little bump."""
    nodes, links, b = _nodes(m)
    tc, mp = nodes.new("ShaderNodeTexCoord"), nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = tuple(0.15 if ax == along else 1.0 for ax in "XYZ")
    wave = nodes.new("ShaderNodeTexWave")
    wave.wave_type = "RINGS" if rings else "BANDS"
    if not rings: wave.bands_direction = across
    wave.inputs["Scale"].default_value, wave.inputs["Distortion"].default_value = scale, distort
    wave.inputs["Detail"].default_value, wave.inputs["Detail Scale"].default_value = 3.0, 1.5
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color, ramp.color_ramp.elements[1].color = bb.hex_rgba(c1), bb.hex_rgba(c2)
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[1].position = 0.25, 0.9
    links.new(tc.outputs["Object"], mp.inputs["Vector"])
    links.new(mp.outputs["Vector"], wave.inputs["Vector"])
    links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    if bump:
        bp = nodes.new("ShaderNodeBump")
        bp.inputs["Strength"].default_value, bp.inputs["Distance"].default_value = bump, 0.0005
        links.new(wave.outputs["Fac"], bp.inputs["Height"])
        links.new(bp.outputs["Normal"], b.inputs["Normal"])
    return m


def lathe_marks(m, scale=900.0, strength=0.12):
    """Turned grooves for a cymbal: concentric rings in object space into the bump."""
    nodes, links, b = _nodes(m)
    tc, wave, bp = nodes.new("ShaderNodeTexCoord"), nodes.new("ShaderNodeTexWave"), nodes.new("ShaderNodeBump")
    wave.wave_type, wave.rings_direction = "RINGS", "Z"
    wave.inputs["Scale"].default_value, wave.inputs["Distortion"].default_value = scale, 0.0
    bp.inputs["Strength"].default_value, bp.inputs["Distance"].default_value = strength, 0.0002
    links.new(tc.outputs["Object"], wave.inputs["Vector"])
    links.new(wave.outputs["Fac"], bp.inputs["Height"])
    links.new(bp.outputs["Normal"], b.inputs["Normal"])
    return m


def noise_rough(m, base, amount=0.12, scale=40.0):
    nodes, links, b = _nodes(m)
    tc, nz, mr = nodes.new("ShaderNodeTexCoord"), nodes.new("ShaderNodeTexNoise"), nodes.new("ShaderNodeMapRange")
    nz.inputs["Scale"].default_value = scale
    mr.inputs["To Min"].default_value, mr.inputs["To Max"].default_value = base - amount, base + amount
    links.new(tc.outputs["Object"], nz.inputs["Vector"])
    links.new(nz.outputs["Fac"], mr.inputs["Value"])
    links.new(mr.outputs["Result"], b.inputs["Roughness"])
    return m


def add_glow(m, hit_local, radius):
    """Orange emission around the hit point (object space), scaled by an animated Value node named 'env'."""
    nodes, links, b = _nodes(m)
    tc, dist, mr = nodes.new("ShaderNodeTexCoord"), nodes.new("ShaderNodeVectorMath"), nodes.new("ShaderNodeMapRange")
    dist.operation = "DISTANCE"
    dist.inputs[1].default_value = tuple(hit_local)
    mr.interpolation_type = "SMOOTHSTEP"
    mr.inputs["From Min"].default_value, mr.inputs["From Max"].default_value = 0.0, radius
    mr.inputs["To Min"].default_value, mr.inputs["To Max"].default_value = 1.0, 0.0
    env = nodes.new("ShaderNodeValue")
    env.name = env.label = "env"
    env.outputs[0].default_value = 0.0
    mul = nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    links.new(tc.outputs["Object"], dist.inputs[0])
    links.new(dist.outputs["Value"], mr.inputs["Value"])
    links.new(mr.outputs["Result"], mul.inputs[0])
    links.new(env.outputs[0], mul.inputs[1])
    b.inputs["Emission Color"].default_value = bb.hex_rgba(ORANGE)
    links.new(mul.outputs[0], b.inputs["Emission Strength"])
    return env


# ---------------------------------------------------------------- geometry

def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def finish(name, me, m=None, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, smooth=True, sharp=35):
    ob = link(bpy.data.objects.new(name, me))
    if smooth:
        for p in me.polygons: p.use_smooth = True
        if sharp is not None and hasattr(me, "set_sharp_from_angle"): me.set_sharp_from_angle(angle=math.radians(sharp))
    ob.location, ob.rotation_euler = loc, rot
    if m: me.materials.append(m)
    if parent: ob.parent = parent
    return ob


def empty(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None):
    ob = link(bpy.data.objects.new(name, None))
    ob.empty_display_size = 0.02
    ob.location, ob.rotation_euler = loc, rot
    if parent: ob.parent = parent
    return ob


def keep_parent(child, parent):
    bpy.context.view_layer.update()
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    bpy.context.view_layer.update()
    return child


def world_pt(ob, local):
    bpy.context.view_layer.update()
    return ob.matrix_world @ Vector(local)


def local_pt(ob, world):
    bpy.context.view_layer.update()
    return ob.matrix_world.inverted() @ Vector(world)


def seg_matrix(p0, p1):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return Matrix.Translation(p0) @ q.to_matrix().to_4x4(), d.length


def lathe_bm(bm, prof, segs=48, M=None, closed=False, arc=None):
    """A solid of revolution about z from a profile [(r, z)]; r = 0 ends become poles. closed: stitch last to first.
    arc=(a0, a1): only that sweep of angles, with both ends capped (the profile must then be closed)."""
    M = M or Matrix.Identity(4)
    nv = segs + 1 if arc else segs
    ang = (lambda j: arc[0] + (arc[1] - arc[0]) * j / segs) if arc else (lambda j: TAU * j / segs)
    rings = []
    for r, z in prof:
        if r < 1e-7: rings.append([bm.verts.new(M @ Vector((0, 0, z)))])
        else: rings.append([bm.verts.new(M @ Vector((r * math.cos(ang(j)), r * math.sin(ang(j)), z))) for j in range(nv)])
    n = len(rings)
    pairs = list(zip(range(n - 1), range(1, n))) + ([(n - 1, 0)] if closed else [])
    for a, b_ in pairs:
        A, B = rings[a], rings[b_]
        if len(A) == 1 and len(B) == 1: continue
        for j in range(segs):
            k = j + 1 if arc else (j + 1) % segs
            if len(A) == 1: bm.faces.new((A[0], B[k], B[j]))
            elif len(B) == 1: bm.faces.new((A[j], A[k], B[0]))
            else: bm.faces.new((A[j], A[k], B[k], B[j]))
    if arc and closed:
        bm.faces.new([rg[0] for rg in rings][::-1])
        bm.faces.new([rg[-1] for rg in rings])
    return rings


def lathe(name, prof, m=None, segs=48, closed=False, sharp=35, arc=None, **kw):
    me, bm = bpy.data.meshes.new(name), bmesh.new()
    lathe_bm(bm, prof, segs, None, closed, arc)
    if arc: bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return finish(name, me, m, sharp=sharp, **kw)


def capsule_prof(length, r0, r1=None, rings=6, mids=1):
    r1 = r0 if r1 is None else r1
    prof = [(r0 * math.cos(a), r0 * math.sin(a)) for a in (-math.pi / 2 + math.pi / 2 * i / rings for i in range(rings + 1))]
    prof += [(r0 + (r1 - r0) * i / (mids + 1), length * i / (mids + 1)) for i in range(1, mids + 1)]
    prof += [(r1 * math.cos(a), length + r1 * math.sin(a)) for a in (math.pi / 2 * i / rings for i in range(rings + 1))]
    return prof


def cyl_prof(length, r, bevel=0.0015, mids=0, r_top=None):
    rt = r if r_top is None else r_top
    b = min(bevel, r * 0.4, length * 0.2)
    prof = [(0, 0), (r - b, 0), (r, b)]
    prof += [(r + (rt - r) * i / (mids + 1), b + (length - 2 * b) * i / (mids + 1)) for i in range(1, mids + 1)]
    return prof + [(rt, length - b), (rt - b, length), (0, length)]


def tube_prof(length, r_out, r_in, bevel=0.0008):
    b = bevel
    return [(r_in, b), (r_in + b, 0), (r_out - b, 0), (r_out, b), (r_out, length - b), (r_out - b, length),
            (r_in + b, length), (r_in, length - b)]


def rod(name, p0, p1, r, m=None, r1=None, kind="capsule", segs=16, mids=1, parent=None):
    """A capsule or cylinder from p0 to p1 (world or parent space)."""
    M, L = seg_matrix(p0, p1)
    prof = capsule_prof(L, r, r1, mids=mids) if kind == "capsule" else cyl_prof(L, r, mids=mids, r_top=r1)
    me, bm = bpy.data.meshes.new(name), bmesh.new()
    lathe_bm(bm, prof, segs, M)
    bm.to_mesh(me)
    bm.free()
    return finish(name, me, m, parent=parent)


def box(name, dims, m=None, bevel=0.002, seg=3, cuts=0, cut_axis="Y", **kw):
    me, bm = bpy.data.meshes.new(name), bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=dims, verts=bm.verts)
    if cuts:
        ax = "XYZ".index(cut_axis)
        edges = [e for e in bm.edges if abs(e.verts[0].co[ax] - e.verts[1].co[ax]) > 1e-6]
        bmesh.ops.subdivide_edges(bm, edges=edges, cuts=cuts, use_grid_fill=True)
    bm.to_mesh(me)
    bm.free()
    ob = finish(name, me, m, sharp=30, **kw)
    if bevel:
        bb.modifier(ob, "BEVEL", width=bevel, segments=seg, limit_method="ANGLE", harden_normals=True)
    return ob


def disk_mesh(name, R, nr=18, ns=72):
    verts, faces = [(0, 0, 0)], []
    for i in range(1, nr + 1):
        rr = R * i / nr
        verts += [(rr * math.cos(TAU * j / ns), rr * math.sin(TAU * j / ns), 0) for j in range(ns)]
    faces += [(0, 1 + j, 1 + (j + 1) % ns) for j in range(ns)]
    for i in range(1, nr):
        a0, b0 = 1 + (i - 1) * ns, 1 + i * ns
        faces += [(a0 + j, b0 + j, b0 + (j + 1) % ns, a0 + (j + 1) % ns) for j in range(ns)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    return me


def shape(ob, name, fn):
    """A shape key whose offset per vertex is fn(co) -> Vector, value range -3..3."""
    if not ob.data.shape_keys: ob.shape_key_add(name="Basis", from_mix=False)
    kb = ob.shape_key_add(name=name, from_mix=False)
    kb.slider_min, kb.slider_max = -3.0, 3.0
    for i, v in enumerate(ob.data.vertices): kb.data[i].co = v.co + Vector(fn(v.co))
    return kb


def head(name, R, m, hit_xy, depth=0.005, sigma=None, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), waves=(2.5, 1.6)):
    """A drum head (polar grid) with three shape keys: push (a dent at the hit), ring and tilt (two modes)."""
    ob = finish(name, disk_mesh(name, R), m, loc=loc, rot=rot, parent=parent, sharp=None)
    hx, hy = hit_xy
    s = sigma or R * 0.35
    edge = lambda co: max(0.0, 1 - (math.hypot(co.x, co.y) / R) ** 2)
    shape(ob, "push", lambda co: (0, 0, -depth * math.exp(-((co.x - hx) ** 2 + (co.y - hy) ** 2) / (2 * s * s)) * edge(co)))
    shape(ob, "ring", lambda co: (0, 0, depth * 0.6 * math.cos(math.pi * waves[0] * math.hypot(co.x, co.y) / R) * edge(co)))
    ang = math.atan2(hy, hx)
    shape(ob, "tilt", lambda co: (0, 0, depth * 0.6 * (co.x * math.cos(ang) + co.y * math.sin(ang)) / R * edge(co) * waves[1]))
    return ob


# ---------------------------------------------------------------- the clip context

class Clip:
    def __init__(self, cid, env):
        self.id, self.env, self.n = cid, env, env["n"]
        self.e, self.lin = env["e"], env["lin"]
        self.L = lift_curve(self.n)
        self.fit, self.tracks, self.rng = [], [], random.Random(cid)
        self.ground = []   # objects that must touch the floor (checked in numbers)

    def t(self, f): return f / FPS

    # -- tracks: each sets values for frame f and keys them
    def glow(self, env_node, gain=5.0, power=1.6):
        def fn(f):
            env_node.outputs[0].default_value = gain * self.e[f] ** power
            env_node.outputs[0].keyframe_insert("default_value", frame=f)
        self.tracks.append(fn)

    def lift(self, piv, axis, angle_deg, trans=(0, 0, 0), curve=None):
        piv.rotation_mode = "QUATERNION"
        base_q, base_loc = piv.rotation_quaternion.copy(), piv.location.copy()
        axis, trans, curve = Vector(axis).normalized(), Vector(trans), curve or self.L
        def fn(f):
            piv.rotation_quaternion = Quaternion(axis, math.radians(angle_deg) * curve[f]) @ base_q
            piv.location = base_loc + trans * curve[f]
            piv.keyframe_insert("rotation_quaternion", frame=f)
            piv.keyframe_insert("location", frame=f)
        self.tracks.append(fn)

    def stick_lift(self, piv, normal, tip, angle_deg=25.0, rise=0.0):
        """Rotate a striker about its pivot so its tip leaves the surface along `normal`."""
        bpy.context.view_layer.update()
        u = (piv.matrix_world.translation - Vector(tip)).normalized()
        axis = Vector(normal).cross(u)
        self.lift(piv, axis, angle_deg, Vector(normal) * rise)

    def wobble(self, grp, amp_deg, hz, axes=((1, 0, 0), (0, 1, 0)), ratio=0.75, phase=0.0, power=1.0, decay_hz=0.0):
        q0 = grp.rotation_euler.to_quaternion() if grp.rotation_mode != "QUATERNION" else grp.rotation_quaternion.copy()
        grp.rotation_mode = "QUATERNION"
        a1, a2 = Vector(axes[0]), Vector(axes[1])
        def fn(f):
            t, k = self.t(f), math.radians(amp_deg) * self.e[f] ** power
            grp.rotation_quaternion = q0 @ Quaternion(a1, k * math.sin(TAU * hz * t + phase)) @ \
                Quaternion(a2, k * ratio * math.cos(TAU * hz * t + phase))
            grp.keyframe_insert("rotation_quaternion", frame=f)
        self.tracks.append(fn)

    def shiver(self, ob, vec, amp, hz, power=1.0, phase=0.0):
        base, vec = ob.location.copy(), Vector(vec)
        def fn(f):
            ob.location = base + vec * (amp * self.e[f] ** power * math.sin(TAU * hz * self.t(f) + phase))
            ob.keyframe_insert("location", frame=f)
        self.tracks.append(fn)

    def key(self, kb, fn):
        def tr(f):
            kb.value = fn(f)
            kb.keyframe_insert("value", frame=f)
        self.tracks.append(tr)

    def ring(self, kb, hz, power=1.0, phase=0.0, scale=1.0):
        self.key(kb, lambda f: scale * self.e[f] ** power * math.sin(TAU * hz * self.t(f) + phase))

    def pulse(self, kb, tau=1.3, scale=1.0):
        """1 on the hit frame, falling off over ~tau frames (a head pushed in by the stick)."""
        self.key(kb, lambda f: scale * math.exp(-f / tau) * (1 if f < self.n - 1 else 0))

    def drum_head(self, hd, hz=7.0, hz2=5.2, push=1.0, ring=1.0, tilt=1.0):
        ks = hd.data.shape_keys.key_blocks
        self.pulse(ks["push"], scale=push)
        self.ring(ks["ring"], hz, scale=ring, power=1.3)
        self.ring(ks["tilt"], hz2, scale=tilt, power=1.3, phase=1.1)

    def run(self):
        for f in range(self.n):
            for fn in self.tracks: fn(f)
        for act in bpy.data.actions:
            curves = list(getattr(act, "fcurves", []) or [])
            if not curves:
                for layer in getattr(act, "layers", []):
                    for strip in layer.strips:
                        for bag in strip.channelbags: curves += list(bag.fcurves)
            for fc in curves:
                for k in fc.keyframe_points: k.interpolation = "LINEAR"
        bpy.context.scene.frame_set(0)


# ---------------------------------------------------------------- shared parts

def M():
    """The pack's shared materials, made once per scene."""
    return {
        "graphite": mat("graphite", GRAPHITE, 0.55),
        "graphite_metal": mat("graphite_metal", "#3A3A40", 0.32, 1.0),
        "rubber": mat("rubber", "#232327", 0.75),
        "chrome": mat("chrome", "#E4E4E2", 0.08, 1.0),
        "steel": mat("steel", "#BFC1C3", 0.26, 1.0, aniso=0.4),
        "orange": mat("orange", ORANGE, 0.45, coat=0.2),
        "yarn": mat("yarn", ORANGE, 0.92, sheen=0.8),
        "felt": mat("felt", "#8E8A84", 0.95, sheen=0.6),
        "hickory": grain(mat("hickory", "#D3B891", 0.5, coat=0.15), "#D9C29E", "#BFA27A", scale=10, along="Z", across="X", bump=0.02),
        "rattan": grain(mat("rattan", "#CDB58C", 0.55), "#D4BE97", "#B89C70", scale=14, along="Z", across="X", bump=0.02),
        "head": noise_rough(mat("head", "#F4F1EA", 0.6), 0.6, 0.12, 60),
        "hand": mat("hand", "#4A4A50", 0.55, sheen=0.3),
        "rawhide": noise_rough(mat("rawhide", "#D9C39C", 0.55, sss=0.05), 0.55, 0.15, 25),
    }


def mallet(C, mats, name, tip_pt, u, length=0.34, head_r=0.017, head_mat=None, shaft_r=0.0045, shaft_mat=None,
           contact_normal=(0, 0, 1), angle=28.0, rise=0.01):
    """A mallet whose head touches tip_pt on frame 0. u: unit direction from the head toward the grip."""
    u, n = Vector(u).normalized(), Vector(contact_normal).normalized()
    hc = Vector(tip_pt) + n * head_r
    grip = hc + u * length
    piv = empty(name + "_pivot", grip)
    hd = finish(name + "_head", _sphere_me(name + "_head", head_r), head_mat or mats["yarn"], loc=hc, sharp=None)
    sh = rod(name + "_shaft", hc, grip, shaft_r, shaft_mat or mats["graphite"])
    cap = rod(name + "_cap", grip - u * 0.012, grip + u * 0.004, shaft_r * 1.25, mats["rubber"])
    for o in (hd, sh, cap): keep_parent(o, piv)
    C.fit += [hd]
    C.stick_lift(piv, n, tip_pt, angle, rise)
    return piv


def stick(C, mats, name, tip_pt, u, length=0.40, contact_normal=(0, 0, 1), angle=24.0, rise=0.01, tip_mat=None):
    """A drumstick: an orange nylon tip on tip_pt at frame 0, a tapered hickory shaft toward u."""
    u, n = Vector(u).normalized(), Vector(contact_normal).normalized()
    tc = Vector(tip_pt) + n * 0.0055
    grip = tc + u * length
    piv = empty(name + "_pivot", grip)
    tip = rod(name + "_tip", tc - u * 0.004, tc + u * 0.004, 0.0058, tip_mat or mats["orange"])
    neck = rod(name + "_neck", tc + u * 0.003, tc + u * 0.085, 0.0032, mats["graphite"], r1=0.0068, mids=3)
    body = rod(name + "_body", tc + u * 0.08, grip, 0.0068, mats["graphite"], r1=0.0072)
    for o in (tip, neck, body): keep_parent(o, piv)
    C.fit += [tip]
    C.stick_lift(piv, n, tip_pt, angle, rise)
    return piv


def _sphere_me(name, r, segs=32):
    me, bm = bpy.data.meshes.new(name), bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2, radius=r)
    bm.to_mesh(me)
    bm.free()
    return me


def sphere(name, r, m=None, loc=(0, 0, 0), parent=None, segs=32, scale=None):
    ob = finish(name, _sphere_me(name, r, segs), m, loc=loc, parent=parent, sharp=None)
    if scale: ob.scale = scale
    return ob


def display_stand(C, mats, top_z, base_r=0.09, rod_r=0.0065, xy=(0, 0)):
    """The pack's display stand: a graphite base disk and a rod up to top_z."""
    x, y = xy
    base = lathe("stand_base", [(0, 0), (base_r - 0.004, 0), (base_r, 0.004), (base_r, 0.010), (base_r - 0.006, 0.016),
                                (0, 0.016)], mats["graphite"], segs=64, loc=(x, y, 0))
    post = lathe("stand_rod", cyl_prof(top_z - 0.016, rod_r), mats["graphite_metal"], segs=24, loc=(x, y, 0.016))
    C.fit += [base, post]
    C.ground.append(base)
    return base, post


# ---------------------------------------------------------------- instruments

def bar_instrument(C, mats, *, L, W, T, bar_mat, top_z, res_len, res_r, res_mat, mallet_mat, mallet_r, arch,
                   holes=False, gourd=False, rails_mat=None):
    """One bar on a two-rail frame with its resonator below and a mallet on the bar's centre (marimba, vibes, xylo, balafon)."""
    grp = empty("bar_set")
    nodes_y = (0.5 - 0.224) * L
    bar = box("bar", (W, L, T), bar_mat, bevel=min(0.0025, T * 0.2), cuts=28, cut_axis="Y", loc=(0, 0, top_z - T / 2))
    for v in bar.data.vertices:          # the arch cut under the middle of the bar
        if v.co.z < 0:
            s = abs(v.co.y) / (L * 0.31)
            if s < 1: v.co.z += arch * (1 - s * s) ** 1.5
    shape(bar, "bend", lambda co: (0, 0, 0.0030 * math.cos(math.pi / 2 * co.y / (0.276 * L))))
    rail_top = top_z - T - 0.004
    rm = rails_mat or mats["graphite"]
    parts = [bar]
    for sy in (-1, 1):
        y = sy * nodes_y
        parts.append(box(f"rail{sy}", (W + 0.13, 0.024, 0.030), rm, bevel=0.003, loc=(0, y, rail_top - 0.015)))
        parts.append(box(f"felt{sy}", (W + 0.13, 0.014, 0.004), mats["felt"], bevel=0.001, loc=(0, y, rail_top + 0.001)))
        parts.append(rod(f"cord{sy}", (-(W / 2 + 0.06), y, top_z - T * 0.5), ((W / 2 + 0.06), y, top_z - T * 0.5), 0.0016,
                         mats["graphite"], kind="cyl"))
        for sx in (-1, 1):
            x = sx * (W / 2 + 0.05)
            parts.append(rod(f"post{sy}{sx}", (x, y, rail_top), (x, y, top_z - T * 0.2), 0.0035, mats["graphite_metal"]))
            leg = rod(f"leg{sy}{sx}", (x, y, 0.006), (x, y, rail_top - 0.03), 0.0105, mats["graphite_metal"], kind="cyl")
            foot = lathe(f"foot{sy}{sx}", [(0, 0), (0.017, 0), (0.019, 0.003), (0.015, 0.009), (0, 0.009)], mats["rubber"],
                         segs=24, loc=(x, y, 0))
            parts += [leg, foot]
            C.ground.append(foot)
    if gourd:
        g = lathe("gourd", [(0, -0.20), (0.035, -0.195), (0.065, -0.17), (0.08, -0.13), (0.075, -0.09), (0.05, -0.055),
                            (0.03, -0.03), (0.026, 0.0), (0.0, 0.0)], gourd, segs=48, loc=(0, 0, rail_top - 0.02))
        hole = lathe("gourd_hole", cyl_prof(0.004, 0.014), mats["graphite"], segs=24,
                     loc=(0.07 * 0.75, -0.07 * 0.66, rail_top - 0.02 - 0.13), rot=(math.radians(90), 0, math.radians(-49)))
        strap = box("strap", (0.012, 2 * nodes_y + 0.03, 0.006), mats["graphite"], bevel=0.001, loc=(0, 0, rail_top - 0.016))
        parts += [g, hole, strap]
    else:
        tube = lathe("resonator", tube_prof(res_len, res_r, res_r - 0.0015), res_mat, segs=48,
                     loc=(0, 0, rail_top - 0.012 - res_len))
        plug = lathe("res_plug", cyl_prof(0.004, res_r - 0.0016), res_mat, segs=48, loc=(0, 0, rail_top - 0.012 - res_len))
        strap = box("strap", (0.012, 2 * nodes_y + 0.03, 0.006), mats["graphite"], bevel=0.001, loc=(0, 0, rail_top - 0.016))
        parts += [tube, plug, strap]
    if holes:
        for sy in (-1, 1):
            parts.append(rod(f"hole{sy}", (-W / 2 - 0.0005, sy * nodes_y, top_z - T / 2), (W / 2 + 0.0005, sy * nodes_y, top_z - T / 2),
                             0.0024, mats["graphite"], kind="cyl"))
    hit = Vector((0, 0.012, top_z))
    env = add_glow(bar.data.materials[0], local_pt(bar, hit), radius=L * 0.13)
    C.glow(env, gain=2.2)
    C.ring(bar.data.shape_keys.key_blocks["bend"], 9.0, power=1.2)
    for p in parts: p.parent = grp
    C.fit += parts
    mallet(C, mats, "mallet", hit, (0.30, 0.80, 0.45), length=0.24, head_r=mallet_r, head_mat=mallet_mat, angle=12)
    return bar


def build_marimba(C, mats):
    wood = grain(mat("rosewood", "#6E3D2E", 0.45, coat=0.15, coat_rough=0.3), "#7A4634", "#55301F", scale=22, along="Y", across="X")
    bar_instrument(C, mats, L=0.38, W=0.058, T=0.022, bar_mat=wood, top_z=0.20, res_len=0.12, res_r=0.032,
                   res_mat=mats["graphite_metal"], mallet_mat=mats["yarn"], mallet_r=0.017, arch=0.008)


def build_vibraphone(C, mats):
    alu = mat("aluminium", "#C9CBCE", 0.3, 1.0, aniso=0.5)
    gold = mat("gold_anod", "#C8A867", 0.3, 1.0)
    bar_instrument(C, mats, L=0.30, W=0.050, T=0.013, bar_mat=alu, top_z=0.22, res_len=0.14, res_r=0.030,
                   res_mat=gold, mallet_mat=mats["orange"], mallet_r=0.015, arch=0.0035, holes=True)


def build_xylophone(C, mats):
    wood = grain(mat("padauk", "#9A5638", 0.38, coat=0.45, coat_rough=0.15), "#A65E3E", "#7E4229", scale=20, along="Y", across="X")
    bar_instrument(C, mats, L=0.22, W=0.042, T=0.024, bar_mat=wood, top_z=0.16, res_len=0.08, res_r=0.026,
                   res_mat=mats["graphite_metal"], mallet_mat=mats["orange"], mallet_r=0.012, arch=0.006)


def build_balafon(C, mats):
    wood = grain(mat("balafon_wood", "#8A5C3C", 0.6), "#94643F", "#6C4529", scale=12, along="Y", across="X", distort=9)
    gourd = grain(mat("gourd", "#A97A45", 0.55, coat=0.2), "#B08048", "#8C6034", scale=6, along="Z", across="X", distort=3, bump=0.03)
    bamboo = grain(mat("bamboo", "#C4AA70", 0.45, coat=0.2), "#CBB37A", "#A88F57", scale=30, along="X", across="Y", bump=0.02)
    bar_instrument(C, mats, L=0.30, W=0.050, T=0.020, bar_mat=wood, top_z=0.272, res_len=0, res_r=0, res_mat=None,
                   mallet_mat=mat("ball", ORANGE, 0.8), mallet_r=0.016, arch=0.004, gourd=gourd, rails_mat=bamboo)


def drum(C, mats, name, R, H, shell_mat, hoop_mat, lug_mat, hit_xy, lugs=10, head_mat=None, z0=0.0, hoop_h=0.022,
         grp=None, both_hoops=True, depth=0.005, wood_hoops=False):
    """A drum standing on its bottom hoop at z0 (in grp space): shell, two hoops, lugs and tension rods, a batter
    head with ripple keys. Returns (head, z of the head)."""
    sh0 = z0 + 0.010
    zh = sh0 + H
    shell = lathe(name + "_shell", tube_prof(H, R, R - 0.006, 0.002), shell_mat, segs=96, loc=(0, 0, sh0), parent=grp)
    hp = (lambda h: [(R + 0.001, 0.0), (R + 0.007, 0.0), (R + 0.009, 0.003), (R + 0.009, h - 0.003), (R + 0.007, h),
                     (R + 0.003, h), (R + 0.003, 0.004), (R + 0.001, 0.002)])
    if wood_hoops:
        hp = (lambda h: [(R + 0.000, 0.0), (R + 0.012, 0.0), (R + 0.014, 0.003), (R + 0.014, h - 0.003), (R + 0.012, h),
                         (R + 0.000, h)])
    top = lathe(name + "_hoop_top", hp(hoop_h), hoop_mat, segs=96, closed=True, loc=(0, 0, zh - hoop_h + 0.012), parent=grp)
    parts = [shell, top]
    if both_hoops:
        parts.append(lathe(name + "_hoop_bot", hp(hoop_h), hoop_mat, segs=96, closed=True, loc=(0, 0, z0), parent=grp))
    hd = head(name + "_head", R - 0.001, (head_mat or mats["head"]).copy(), hit_xy, depth=depth, parent=grp, loc=(0, 0, zh + 0.0015))
    collar = lathe(name + "_collar", [(R - 0.001, 0), (R + 0.0025, 0), (R + 0.0025, 0.006), (R - 0.001, 0.006)], head_mat or mats["head"],
                   segs=96, closed=True, loc=(0, 0, zh - 0.003), parent=grp)
    parts += [hd, collar]
    for i in range(lugs):
        a = TAU * (i + 0.5) / lugs
        c, s = math.cos(a), math.sin(a)
        lz = sh0 + H * 0.5
        lug = rod(f"{name}_lug{i}", (c * (R + 0.010), s * (R + 0.010), lz - min(0.035, H * 0.25)),
                  (c * (R + 0.010), s * (R + 0.010), lz + min(0.035, H * 0.25)), 0.0065, lug_mat, parent=grp)
        rr = R + 0.0085
        rod_t = rod(f"{name}_trod{i}", (c * rr, s * rr, lz + min(0.035, H * 0.25)), (c * rr, s * rr, zh + 0.014), 0.0022,
                    mats["chrome"], kind="cyl", parent=grp)
        cap = lathe(f"{name}_tcap{i}", cyl_prof(0.007, 0.0042), mats["chrome"], segs=16, loc=(c * rr, s * rr, zh + 0.012), parent=grp)
        parts += [lug, rod_t, cap]
        if both_hoops:
            parts.append(rod(f"{name}_brod{i}", (c * rr, s * rr, z0 + 0.004), (c * rr, s * rr, lz - min(0.035, H * 0.25)), 0.0022,
                             mats["chrome"], kind="cyl", parent=grp))
    C.fit += parts
    return hd, zh + 0.0015


def build_snare(C, mats):
    R, H = 0.178, 0.135
    hit_xy = (0.035, -0.06)
    hd, zh = drum(C, mats, "snare", R, H, mat("black_nickel", "#45464B", 0.3, 1.0), mats["chrome"], mats["chrome"], hit_xy, lugs=10)
    C.ground.append(bpy.data.objects["snare_hoop_bot"])
    strainer = box("strainer", (0.02, 0.012, 0.05), mats["graphite"], bevel=0.002,
                   loc=(math.cos(-1.2) * (R + 0.012), math.sin(-1.2) * (R + 0.012), 0.08), rot=(0, 0, -1.2))
    lever = box("strainer_lever", (0.006, 0.008, 0.045), mats["chrome"], bevel=0.001,
                loc=(math.cos(-1.2) * (R + 0.021), math.sin(-1.2) * (R + 0.021), 0.085), rot=(0.2, 0, -1.2))
    C.fit += [strainer, lever]
    C.drum_head(hd, hz=8.0, hz2=6.1)
    hit = Vector((hit_xy[0], hit_xy[1], zh))
    C.glow(add_glow(hd.data.materials[0], local_pt(hd, hit), 0.06), gain=2.2)
    # the wires rattle: the whole drum buzzes a little while the sound lasts
    stick(C, mats, "stick", hit, (0.25, 0.75, 0.50), angle=12)


def cymbal_mesh(name, R, m, parent=None, loc=(0, 0, 0), rot=(0, 0, 0)):
    """A cymbal (bell, bow, edge, thinning outward) with the bell's top at z = 0 and the edge at -0.186 R."""
    k = R / 0.215
    t = lambda r: (0.0026 - 0.0013 * r / R) * max(k, 0.7)
    topp = [(0.007, 0.040), (0.025, 0.0395), (0.045, 0.035), (0.058, 0.026), (0.068, 0.018), (0.09, 0.0145),
            (0.13, 0.0105), (0.17, 0.0065), (0.20, 0.0028), (0.215, 0.0)]
    topp = [(max(0.0065, r * k), z * k) for r, z in topp]
    prof = topp + [(r, z - t(r)) for r, z in reversed(topp)]
    return lathe(name, [(r, z - 0.040 * k) for r, z in prof], m, segs=128, closed=True, parent=parent, sharp=60,
                 loc=loc, rot=rot)


def build_cymbal(C, mats, R=0.215, top=0.30, tilt=12.0, mallet_hit=True, name="cymbal"):
    display_stand(C, mats, top - 0.013)
    piv = empty(name + "_pivot", (0, 0, top), rot=(math.radians(-tilt), 0, math.radians(15)))
    bronze = lathe_marks(mat(name + "_bronze", "#C49C62", 0.24, 1.0))
    cym = cymbal_mesh(name, R, bronze, parent=piv)
    felt_top = lathe(name + "_felt", cyl_prof(0.012, 0.016), mats["felt"], segs=24, loc=(0, 0, 0.0005), parent=piv)
    wing = lathe(name + "_wing", cyl_prof(0.010, 0.010), mats["graphite_metal"], segs=24, loc=(0, 0, 0.0125), parent=piv)
    felt_bot = lathe(name + "_felt_b", cyl_prof(0.010, 0.016), mats["felt"], segs=24, loc=(0, 0, -0.0128), parent=piv)
    tilter = rod(name + "_tilter", (0, 0, -0.02), (0, 0, 0.024), 0.0055, mats["graphite_metal"], kind="cyl", parent=piv)
    C.fit += [cym, felt_top, wing, felt_bot, tilter]
    a = math.radians(25)
    edge_local = Vector((R * 0.94 * math.cos(a), R * 0.94 * math.sin(a), 0.0005 - 0.04))
    hit = world_pt(piv, edge_local)
    nrm = (piv.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
    C.glow(add_glow(bronze, edge_local, 0.07), gain=2.5)
    C.wobble(piv, 7.0, 2.3, power=1.2)
    if mallet_hit:
        mallet(C, mats, "mallet", hit, (0.55, 0.45, 0.55), length=0.26, head_r=0.018, angle=12, contact_normal=nrm)
    return piv, cym


# ---------------------------------------------------------------- more shared parts

CH = Vector((CAM_DIR.x, CAM_DIR.y, 0)).normalized()   # toward the camera, flat
RIGHT = Vector((-CH.y, CH.x, 0))                      # the frame's right, flat
BACK = -CH                                            # where the players stand
UP, DOWN = Vector((0, 0, 1)), Vector((0, 0, -1))
FROM_BEHIND = Vector((0.25, 0.75, 0.50)).normalized()  # the pack's stick direction (grip behind, above, right)
CYM_TOP = [(0.007, 0.040), (0.025, 0.0395), (0.045, 0.035), (0.058, 0.026), (0.068, 0.018), (0.09, 0.0145),
           (0.13, 0.0105), (0.17, 0.0065), (0.20, 0.0028), (0.215, 0.0)]


def cym_top_z(R, r):
    """Height of a cymbal_mesh's top surface at radius r (object space, bell top = 0)."""
    k = R / 0.215
    pts = [(rr * k, z * k) for rr, z in CYM_TOP]
    for (r0, z0), (r1, z1) in zip(pts, pts[1:]):
        if r0 <= r <= r1: return z0 + (z1 - z0) * (r - r0) / (r1 - r0) - 0.040 * k
    return -0.040 * k


def quat_to(v):
    return Vector((0, 0, 1)).rotation_difference(Vector(v).normalized())


def set_quat(ob, q):
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = q
    return ob


def flat_dir(v):
    return Vector((v[0], v[1], 0)).normalized()


def tube_path(name, pts, r, m, segs=16, flat=1.0, side=(0, 1, 0), parent=None, r_fn=None):
    """A tube along a polyline; `flat` squashes the cross-section along `side`."""
    bm, pts, side = bmesh.new(), [Vector(p) for p in pts], Vector(side)
    n, rings = len(pts), []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        a = (side - t * side.dot(t)).normalized()
        b = t.cross(a)
        rr = r_fn(i / (n - 1)) if r_fn else r
        rings.append([bm.verts.new(p + (a * math.cos(TAU * j / segs) * flat + b * math.sin(TAU * j / segs)) * rr)
                      for j in range(segs)])
    for i in range(n - 1):
        A, B = rings[i], rings[i + 1]
        for j in range(segs): bm.faces.new((A[j], A[(j + 1) % segs], B[(j + 1) % segs], B[j]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return finish(name, me, m, parent=parent)


def grid_mesh(name, w, h, nx, ny):
    verts = [(-w / 2 + w * i / nx, -h / 2 + h * j / ny, 0) for j in range(ny + 1) for i in range(nx + 1)]
    faces = [(j * (nx + 1) + i, j * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i)
             for j in range(ny) for i in range(nx)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    return me


def frustum(name, p0, p1, w0, w1, d0, d1, side, m, parent=None, bevel=0.006):
    """A tapered box from p0 to p1: width along `side`, depth behind the front face (the face toward a x side)."""
    p0, p1, side = Vector(p0), Vector(p1), Vector(side).normalized()
    a = (p1 - p0).normalized()
    nn = a.cross(side).normalized()
    bm = bmesh.new()
    vs = []
    for p, w, d in ((p0, w0, d0), (p1, w1, d1)):
        vs += [bm.verts.new(p + side * w / 2), bm.verts.new(p - side * w / 2),
               bm.verts.new(p - side * w / 2 - nn * d), bm.verts.new(p + side * w / 2 - nn * d)]
    for f in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = finish(name, me, m, parent=parent, sharp=30)
    if bevel: bb.modifier(ob, "BEVEL", width=bevel, segments=3, limit_method="ANGLE", harden_normals=True)
    return ob


def hand(name, mats, mirror=False, curl=(10, 12, 10), spread=5.0, thumb_out=1.0, m=None):
    """A graphite mannequin hand in its own space: palm centre at the origin facing -Z, fingers along +Y,
    thumb on -X (+X when mirrored). Returns (root empty, info with local contact points)."""
    m = m or mats["hand"]
    sx = -1.0 if mirror else 1.0
    root = empty(name)
    palm = box(name + "_palm", (0.082, 0.090, 0.026), m.copy(), bevel=0.011, seg=4, parent=root)
    parts = [palm]
    specs = [(-0.0285, (0.042, 0.025, 0.020), 0.0085, -spread), (-0.0095, (0.047, 0.029, 0.022), 0.0089, -spread / 3),
             (0.0095, (0.043, 0.027, 0.021), 0.0084, spread / 3), (0.0280, (0.034, 0.021, 0.018), 0.0073, spread)]
    tip = None
    for k, (x, lens, r, spr) in enumerate(specs):
        p = Vector((sx * x, 0.038, -0.001))
        d = Quaternion((0, 0, 1), math.radians(-sx * spr)) @ Vector((0, 1, 0))
        for j, L in enumerate(lens):
            d = Quaternion((1, 0, 0), -math.radians(curl[j])) @ d
            q = p + d * L
            parts.append(rod(f"{name}_f{k}{j}", p, q, r, m, r1=r * 0.94, parent=root))
            p, r = q, r * 0.94
        if k == 1: tip = p + d * (r * 0.3) - Vector((0, 0, r * 0.95))
    tb = Vector((sx * -0.034, -0.022, -0.004))
    parts.append(rod(name + "_thenar", Vector((sx * -0.020, -0.032, -0.002)), tb, 0.0135, m, parent=root))
    d = Vector((sx * -0.62 * thumb_out, 0.72, -0.30)).normalized()
    p, r = tb, 0.0115
    for j, L in enumerate((0.036, 0.029, 0.024)):
        q = p + d * L
        parts.append(rod(f"{name}_t{j}", p, q, r, m, r1=r * 0.92, parent=root))
        p, r = q, r * 0.92
        d = (d + Vector((sx * 0.25, 0.10, -0.05))).normalized()
    parts.append(rod(name + "_wrist", Vector((0, -0.036, 0.001)), Vector((0, -0.088, 0.004)), 0.0235, m, r1=0.021, parent=root))
    return root, {"palm": Vector((0, 0.004, -0.0135)), "tip": tip, "wrist": Vector((0, -0.07, 0.003)), "thumb": p,
                  "palm_obj": palm, "parts": parts}


def place_hand(C, mats, name, contact, normal, fingers, at="palm", mirror=False, curl=(10, 12, 10), lift_deg=16.0,
               rise=0.03, spread=5.0, fit="palm"):
    """A hand whose `at` point touches `contact` on frame 0, palm facing `normal`, fingers toward `fingers`;
    it lifts off from the wrist (rotation + a rise against the normal) and comes back for the loop."""
    root, info = hand(name, mats, mirror, curl, spread)
    n, fy = Vector(normal).normalized(), Vector(fingers)
    y = (fy - n * fy.dot(n)).normalized()
    z = -n
    x = y.cross(z)
    R3 = Matrix((x, y, z)).transposed()
    set_quat(root, R3.to_quaternion())
    root.location = Vector(contact) - R3 @ info[at]
    piv = empty(name + "_pivot", root.location + R3 @ info["wrist"])
    keep_parent(root, piv)
    C.lift(piv, x, lift_deg, -n * rise)
    C.fit += info["parts"] if fit == "all" else [info["palm_obj"]]
    info.update(R=R3, root=root, piv=piv)
    return info


def uniform_glow(C, m, gain=1.5, power=1.6):
    C.glow(add_glow(m, (0, 0, 0), 50.0), gain=gain, power=power)


def glow_at(C, ob, world, radius, gain=2.2, power=1.6):
    """Give ob its own copy of its material, glowing around a world point."""
    m = ob.data.materials[0].copy()
    ob.data.materials[0] = m
    C.glow(add_glow(m, local_pt(ob, world), radius), gain=gain, power=power)
    return m


# ---------------------------------------------------------------- the other twenty

def build_kalimba(C, mats):
    maple = grain(mat("maple", "#C9A77C", 0.5, coat=0.25), "#CCAA7E", "#BD9A6B", scale=34, along="Y", across="X", distort=2.5)
    Wb, Lb, Hb = 0.13, 0.17, 0.045
    body = box("kalimba_body", (Wb, Lb, Hb), maple, bevel=0.007, seg=4, loc=(0, 0, Hb / 2 + 0.004))
    feet = [lathe(f"kfoot{i}", cyl_prof(0.004, 0.006), mats["rubber"], segs=16, loc=(sx * 0.05, sy * 0.07, 0))
            for i, (sx, sy) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1)))]
    top = Hb + 0.004
    hole = lathe("sound_hole", cyl_prof(0.0012, 0.017), mats["graphite"], segs=48, loc=(0, -0.055, top - 0.0008))
    saddle = box("saddle", (0.105, 0.010, 0.005), maple, bevel=0.0015, loc=(0, -0.028, top + 0.0025))
    bridge = rod("bridge", (-0.053, -0.028, top + 0.0075), (0.053, -0.028, top + 0.0075), 0.0028, mats["steel"], kind="cyl")
    zt = top + 0.0075 + 0.0028 + 0.0008
    bar = rod("press_bar", (-0.05, -0.042, zt + 0.0035), (0.05, -0.042, zt + 0.0035), 0.0026, mats["steel"], kind="cyl")
    screws = [rod(f"screw{s}", (s * 0.036, -0.042, top), (s * 0.036, -0.042, zt + 0.006), 0.0018, mats["chrome"], kind="cyl")
              for s in (-1, 1)]
    C.fit += [body, hole, saddle, bridge, bar] + feet + screws
    C.ground += feet
    pluck = None
    for i in range(9):
        x = (i - 4) * 0.0108
        Lf = 0.030 + 0.042 * (1 - abs(i - 4) / 4)
        y0, y1 = -0.048, -0.028 + Lf
        m = mats["steel"] if i != 5 else mats["steel"].copy()
        t = box(f"tine{i}", (0.0056, y1 - y0, 0.0016), m, bevel=0.0005, seg=2, cuts=16 if i == 5 else 0, cut_axis="Y",
                loc=(x, (y0 + y1) / 2, zt))
        C.fit.append(t)
        if i == 5: pluck = (t, x, y0, y1, Lf)
    t, x, y0, y1, Lf = pluck
    yc = (y0 + y1) / 2
    shape(t, "bend", lambda co: (0, 0, 0.004 * max(0.0, (co.y + yc + 0.028) / Lf) ** 2))
    C.ring(t.data.shape_keys.key_blocks["bend"], 12.0, power=1.2)
    tip = Vector((x, y1 - 0.006, zt + 0.0008))
    C.glow(add_glow(t.data.materials[0], local_pt(t, tip), 0.035), gain=2.6)
    # the thumb: a pad on the tine's tip, the joint behind and above
    u1, u2 = Vector((0.15, 0.75, 0.55)).normalized(), Vector((0.15, 0.55, 0.85)).normalized()
    c0 = tip + Vector((0, 0, 0.0095))
    j1 = c0 + u1 * 0.028
    j2 = j1 + u2 * 0.036
    piv = empty("thumb_pivot", j2)
    parts = [rod("thumb_d", c0 - u1 * 0.004, j1, 0.0095, mats["hand"], r1=0.0105),
             rod("thumb_p", j1, j2, 0.0108, mats["hand"], r1=0.0125),
             rod("thumb_b", j2, j2 + Vector((0.2, 0.5, 0.8)).normalized() * 0.03, 0.0130, mats["hand"], r1=0.016)]
    for o in parts: keep_parent(o, piv)
    C.fit.append(parts[0])
    C.lift(piv, UP.cross(c0 - j2).normalized() * -1, 10.0, Vector((0, 0.012, 0.010)))


def build_piano(C, mats):
    ivory = mat("key_white", "#F5F3EE", 0.25, coat=0.4)
    ebony = mat("key_black", "#1F1F23", 0.22, coat=0.5)
    spruce = grain(mat("spruce", "#D9C29A", 0.6), "#DEC8A2", "#C4A97E", scale=20, along="Y", across="X", bump=0.01)
    bx, bw = 0.047, 0.17                                   # the bed spans B..G
    bed = box("keybed", (bw, 0.33, 0.03), mats["graphite"], bevel=0.003, loc=(bx, 0.035, 0.015))
    rail = box("balance_rail", (bw, 0.012, 0.004), mats["felt"], bevel=0.001, loc=(bx, 0.03, 0.032))
    cheek = [box(f"cheek{s_}", (0.012, 0.20, 0.05), mats["graphite"], bevel=0.003, loc=(bx + s_ * (bw / 2 + 0.006), -0.035, 0.025))
             for s_ in (-1, 1)]
    zk = 0.034
    parts = [bed, rail] + cheek
    def white(name, x, parent=None, off=(0, 0, 0)):
        o = Vector(off)
        top = box(name + "_top", (0.0225, 0.150, 0.010), ivory, bevel=0.0012, loc=Vector((x, -0.060, zk + 0.023)) - o, parent=parent)
        body = box(name + "_body", (0.021, 0.30, 0.018), spruce, bevel=0.001, loc=Vector((x, 0.0125, zk + 0.009)) - o, parent=parent)
        return [top, body]
    for nm, k_ in (("b", -1), ("d", 1), ("e", 2), ("f", 3), ("g", 4)):
        parts += white("key_" + nm, 0.0235 * k_)
    for nm, x_ in (("cs", 0.01175), ("ds", 0.03525), ("fs", 0.08225)):
        parts.append(box("key_" + nm, (0.012, 0.095, 0.012), ebony, bevel=0.0015, loc=(x_, -0.0375, zk + 0.034)))
    kp = empty("key_c_pivot", (0, 0.03, zk))
    set_quat(kp, Quaternion((1, 0, 0), math.radians(3.5)))
    parts += white("key_c", 0.0, parent=kp, off=(0, 0.03, zk))
    # hammer, built struck (head on the string); it falls back about its flange
    P = Vector((0, 0.255, 0.085))
    H = Vector((0, 0.135, 0.108))
    flange = box("flange", (0.03, 0.02, 0.03), mats["graphite"], bevel=0.002, loc=P - Vector((0, 0, 0.012)))
    post = box("hammer_rail", (bw, 0.015, 0.06), mats["graphite"], bevel=0.002, loc=(bx, 0.27, 0.045))
    hp = empty("hammer_pivot", P)
    shank = rod("shank", P, H, 0.003, spruce, kind="cyl")
    molding = box("molding", (0.013, 0.02, 0.014), spruce, bevel=0.002, loc=H + Vector((0, 0, 0.004)))
    felt = rod("hammer_felt", H + Vector((0, 0, 0.010)), H + Vector((0, 0, 0.026)), 0.0085, mats["yarn"])
    for o in (shank, molding, felt): keep_parent(o, hp)
    zs = H.z + 0.026 + 0.0085 + 0.0009
    string = rod("string", (0, 0.035, zs), (0, 0.30, zs), 0.0009, mats["steel"].copy(), kind="cyl", mids=30)
    agraffe = box("agraffe", (0.018, 0.012, 0.012), mats["chrome"], bevel=0.002, loc=(0, 0.035, zs - 0.006))
    bridge = box("bridge", (0.04, 0.015, zs - 0.03), spruce, bevel=0.002, loc=(0, 0.30, (zs - 0.03) / 2 + 0.03))
    pin = rod("bridge_pin", (0, 0.298, zs - 0.004), (0, 0.298, zs + 0.006), 0.0015, mats["chrome"], kind="cyl")
    parts += [flange, post, felt, string, agraffe, bridge, pin]
    shape(string, "bow", lambda co: (0, 0, 0.0016 * math.sin(math.pi * min(1, max(0, (co.y - 0.035) / 0.265)))))
    C.ring(string.data.shape_keys.key_blocks["bow"], 14.0, power=1.1)
    C.glow(add_glow(string.data.materials[0], (0, H.y, zs), 0.06), gain=4.0)
    C.lift(kp, (1, 0, 0), -3.5)
    C.lift(hp, (1, 0, 0), 16.0)
    C.fit += parts
    C.ground.append(bed)


def build_harp(C, mats):
    wood = grain(mat("harp_wood", "#B98B5C", 0.45, coat=0.35), "#C29468", "#9E7247", scale=14, along="Z", across="X")
    grp = set_quat(empty("harp"), Quaternion((0, 0, 1), math.radians(-108)))
    zn = lambda x: 0.84 - 0.10 * (x / 0.48) + 0.06 * math.sin(TAU * x / 0.48)
    zsb = lambda x: 0.04 + (x - 0.10) * (0.70 / 0.38)
    box_ = frustum("soundbox", (0.10, 0, 0.035), (0.48, 0, 0.74), 0.20, 0.08, 0.10, 0.04, (0, 1, 0), wood, parent=grp)
    neck = tube_path("neck", [(x, 0, zn(x) + 0.028) for x in [i * 0.52 / 20 - 0.02 for i in range(21)]], 0.030, wood,
                     flat=0.55, parent=grp)
    pillar = tube_path("pillar", [(0.012 * math.sin(math.pi * t), 0, 0.03 + t * (zn(0) - 0.0)) for t in [i / 16 for i in range(17)]],
                       0.019, wood, parent=grp)
    base = box("harp_base", (0.17, 0.12, 0.035), wood, bevel=0.006, loc=(0.06, 0, 0.0175), parent=grp)
    C.fit += [box_, neck, pillar, base]
    C.ground.append(base)
    colors = {0: mat("string_c", "#D98A5B", 0.35), 3: mats["graphite"]}
    nylon = mat("nylon", "#EDE5D3", 0.3)
    pl = None
    for i in range(20):
        x = 0.14 + i * 0.0165
        zb, zt = zsb(x) + 0.004, zn(x) + 0.002
        m = colors.get(i % 7, nylon)
        if i == 7: m = m.copy()
        s = rod(f"str{i}", (x, 0, zb), (x, 0, zt), 0.0019 if i < 10 else 0.0015, m, kind="cyl", mids=30 if i == 7 else 0, parent=grp, segs=8)
        pin = rod(f"tpin{i}", (x, 0.022, zt + 0.02), (x, -0.004, zt + 0.02), 0.0022, mats["chrome"], kind="cyl", parent=grp, segs=8)
        C.fit.append(s)
        if i == 7: pl = (s, x, zb, zt)
    s, x, zb, zt = pl
    shape(s, "bow", lambda co: (0, 0.008 * math.sin(math.pi * min(1, max(0, (co.z - zb) / (zt - zb)))), 0))
    C.ring(s.data.shape_keys.key_blocks["bow"], 8.0, power=1.1)
    C.glow(add_glow(s.data.materials[0], (x, 0, zb + (zt - zb) * 0.35), 0.25), gain=4.0)


def build_chimes(C, mats):
    brass = mat("brass", "#C9A55E", 0.3, 1.0)
    rz = math.atan2(RIGHT.y, RIGHT.x)
    grp = set_quat(empty("chime", (0, 0, 0.03)), Quaternion((0, 0, 1), rz) @ Quaternion((0, 1, 0), math.radians(12)))
    handle = lathe("handle", cyl_prof(0.10, 0.0145, bevel=0.004), mats["rubber"], segs=32, parent=grp)
    yoke = box("yoke", (0.040, 0.030, 0.020), mats["chrome"], bevel=0.003, loc=(0, 0, 0.110), parent=grp)
    tube = lathe("chime_tube", tube_prof(0.30, 0.0175, 0.0155), brass.copy(), segs=64, loc=(0, 0, 0.12), parent=grp)
    cap = lathe("chime_plug", cyl_prof(0.006, 0.0172), brass, segs=64, loc=(0, 0, 0.118), parent=grp)
    cp = empty("clapper_pivot", (0.022, 0, 0.112), parent=grp)
    arm = rod("clapper_arm", (0, 0, 0), (0.0065, 0, 0.063), 0.0018, mats["chrome"], kind="cyl", parent=cp)
    ball = sphere("clapper", 0.011, mats["orange"], loc=(0.0065, 0, 0.063), parent=cp)
    C.fit += [handle, yoke, tube, cap, ball]
    C.glow(add_glow(tube.data.materials[0], (0.0175, 0, 0.055), 0.05), gain=2.0)
    C.lift(grp, Quaternion((0, 0, 1), rz) @ Vector((0, 1, 0)), -12.0)
    C.lift(cp, (0, 1, 0), 28.0)
    C.shiver(tube, (1, 0, 0), 0.0007, 14.0)


def build_ocarina(C, mats):
    clay = noise_rough(mat("ocarina_glaze", "#B5744F", 0.3, coat=0.5, coat_rough=0.1), 0.3, 0.1, 30)
    prof = [(0, -0.058), (0.016, -0.056), (0.028, -0.048), (0.036, -0.032), (0.039, -0.010), (0.038, 0.010),
            (0.033, 0.028), (0.024, 0.043), (0.013, 0.054), (0, 0.058)]
    zc = 0.039 * 0.78 + 0.001
    body = lathe("ocarina", prof, clay, segs=64, loc=(0, 0, zc), rot=(0, math.radians(90), 0))
    body.scale = (0.78, 1, 1)
    rz = math.atan2(RIGHT.y, RIGHT.x) + math.radians(15)
    grp = set_quat(empty("ocarina_grp"), Quaternion((0, 0, 1), rz))
    body.parent = grp
    rr = lambda z: next((r0 + (r1 - r0) * (z - z0) / (z1 - z0) for (r0, z0), (r1, z1) in zip(prof, prof[1:]) if z0 <= z <= z1), 0)
    surf = lambda x: zc + rr(x) * 0.78
    mouth = box("mouthpiece", (0.036, 0.024, 0.012), clay, bevel=0.005, loc=(0.066, 0, surf(0.048) - 0.004), parent=grp)
    window = box("window", (0.010, 0.013, 0.004), mats["graphite"], bevel=0.001, loc=(0.034, 0, surf(0.034) - 0.0008),
                 rot=(0, math.radians(-14), 0), parent=grp)
    holes = [lathe(f"fhole{i}", cyl_prof(0.002, 0.0045), mats["graphite"], segs=24, loc=(x, y, surf(x) - 0.0016), parent=grp)
             for i, (x, y) in enumerate(((-0.026, 0.014), (-0.026, -0.014), (0.0, 0.017), (0.0, -0.017)))]
    C.fit += [body, mouth, window] + holes
    C.ground.append(body)
    win = world_pt(grp, (0.034, 0, surf(0.034) + 0.002))
    C.glow(add_glow(clay, local_pt(body, win), 0.025), gain=2.0)
    # breath: puffs leaving the window, looping a whole number of times over the clip
    pm = bpy.data.materials.new("puff")
    pm.use_nodes = True
    nt = pm.node_tree
    nt.nodes.clear()
    out, mix = nt.nodes.new("ShaderNodeOutputMaterial"), nt.nodes.new("ShaderNodeMixShader")
    tr, em, env = nt.nodes.new("ShaderNodeBsdfTransparent"), nt.nodes.new("ShaderNodeEmission"), nt.nodes.new("ShaderNodeValue")
    em.inputs["Color"].default_value = bb.hex_rgba("#F6B089")   # breath: a warm white with the accent in it
    oi, fade = nt.nodes.new("ShaderNodeObjectInfo"), nt.nodes.new("ShaderNodeMath")
    fade.operation, fade.inputs[1].default_value = "MULTIPLY", 0.38
    nt.links.new(oi.outputs["Alpha"], fade.inputs[0])        # each puff fades through its object colour's alpha
    nt.links.new(fade.outputs[0], mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(env.outputs[0], em.inputs["Strength"])
    nt.links.new(mix.outputs[0], out.inputs[0])
    C.glow(env, gain=2.2, power=1.0)
    k = max(1, round(C.env["dur"] * 1.6))
    up = (UP * 1.0 - CH * 0.25 - RIGHT * 0.15).normalized()
    side = up.cross(CH).normalized()
    top = finish("puff_top", _sphere_me("puff_top", 0.01), None, loc=win + up * 0.11, sharp=None)
    top.hide_render = True
    C.fit.append(top)
    N = 16
    for i in range(N):
        pf = finish(f"puff{i}", _sphere_me(f"puff{i}", 0.0050, 20), pm, loc=win, sharp=None)
        drift = C.rng.uniform(-1, 1)
        def tr_(f, pf=pf, i=i, drift=drift):
            p = (k * f / C.n + i / N) % 1.0
            pf.location = win + up * (0.105 * p) + side * (p * (0.014 * math.sin(TAU * (p * 1.2 + i * 0.37)) + 0.010 * drift))
            s = 0.5 + 1.9 * p
            pf.scale = (s, s, s * (1.0 + 1.2 * (1 - p)))       # stretched leaving the window, rounder as it slows
            pf.color = (1, 1, 1, min(1.0, 4 * p) * (1 - p) ** 1.4)
            pf.keyframe_insert("location", frame=f)
            pf.keyframe_insert("scale", frame=f)
            pf.keyframe_insert("color", frame=f)
        C.tracks.append(tr_)
    C.shiver(grp, UP, 0.0005, 5.5)


def build_glockenspiel(C, mats):
    nickel = mat("nickel", "#E6E6E2", 0.24, 1.0, aniso=0.5)
    base, post = display_stand(C, mats, 0.50, base_r=0.10)
    d = -RIGHT
    E = Vector((0, 0, 0.495)) + d * 0.075
    arm = rod("arm", (0, 0, 0.495), E + d * 0.006, 0.0055, mats["graphite_metal"], kind="cyl")
    knob = sphere("arm_end", 0.008, mats["graphite_metal"], loc=E + d * 0.008)
    tg = empty("tube_pivot", E)
    zt = E.z - 0.03
    cord = rod("cord", E, Vector((E.x, E.y, zt + 0.004)), 0.0012, mats["graphite"], kind="cyl")
    capm, tubem = nickel.copy(), nickel.copy()
    cap = lathe("tube_cap", tube_prof(0.012, 0.0178, 0.010), capm, segs=64, loc=(E.x, E.y, zt - 0.012))
    tube = lathe("bell_tube", tube_prof(0.26, 0.016, 0.0145), tubem, segs=64, loc=(E.x, E.y, zt - 0.27))
    for o in (cord, cap, tube): keep_parent(o, tg)
    C.fit += [arm, knob, cap, tube]
    md = flat_dir(FROM_BEHIND)
    hit = Vector((E.x, E.y, zt)) + md * 0.0165
    n = (md + UP).normalized()
    C.glow(add_glow(capm, local_pt(cap, hit), 0.03), gain=2.6)
    C.glow(add_glow(tubem, local_pt(tube, hit), 0.07), gain=2.2)
    C.wobble(tg, 3.0, 1.15, power=1.0)
    mallet(C, mats, "mallet", hit, (0.30, 0.75, 0.45), length=0.24, head_r=0.012, head_mat=mats["orange"], angle=12,
           contact_normal=n)


def build_strumstick(C, mats):
    walnut = grain(mat("walnut", "#6E4A33", 0.4, coat=0.4), "#76503A", "#56392A", scale=16, along="Y", across="X", bump=0.01)
    spruce = grain(mat("st_top", "#D6BC8E", 0.45, coat=0.4), "#DCC398", "#C2A577", scale=26, along="Y", across="X", bump=0.005)
    nd = (BACK * 0.75 + RIGHT * 0.66).normalized()
    grp = set_quat(empty("strumstick"), Quaternion((0, 0, 1), math.atan2(nd.y, nd.x) - math.pi / 2))
    body = lathe("st_body", [(0, 0), (0.075, 0), (0.080, 0.006), (0.080, 0.052), (0.075, 0.058), (0, 0.058)], walnut, segs=64, parent=grp)
    body.scale = (1, 1.55, 1)
    topp = lathe("st_top", cyl_prof(0.002, 0.075, bevel=0.001), spruce, segs=64, loc=(0, 0, 0.0575), parent=grp)
    topp.scale = (1, 1.55, 1)
    holes = [lathe(f"st_hole{s}", cyl_prof(0.0008, 0.011), mats["graphite"], segs=32, loc=(s * 0.045, 0.0, 0.0595), parent=grp)
             for s in (-1, 1)]
    neck = box("st_neck", (0.034, 0.56, 0.018), walnut, bevel=0.003, loc=(0, 0.34, 0.068), parent=grp)
    head_ = box("st_head", (0.05, 0.10, 0.016), walnut, bevel=0.004, loc=(0, 0.675, 0.067), parent=grp)
    nut = box("st_nut", (0.034, 0.004, 0.004), mats["head"], bevel=0.0008, loc=(0, 0.622, 0.079), parent=grp)
    bridge = box("st_bridge", (0.05, 0.008, 0.008), walnut, bevel=0.0015, loc=(0, -0.09, 0.0635), parent=grp)
    parts = [body, topp, neck, head_, nut, bridge] + holes
    for i, sx in enumerate((-1, 0, 1)):
        parts.append(rod(f"peg{i}", (0.024, 0.64 + i * 0.03, 0.067), (0.045, 0.64 + i * 0.03, 0.067), 0.003, mats["chrome"], kind="cyl", parent=grp))
        parts.append(box(f"pegh{i}", (0.006, 0.016, 0.012), mats["graphite"], bevel=0.002, loc=(0.048, 0.64 + i * 0.03, 0.067), parent=grp))
    for k_, st in enumerate((2, 4, 5, 7, 9, 10, 12, 14, 16, 17)):
        y = 0.62 - 0.71 * (1 - 2 ** (-st / 12))
        parts.append(rod(f"fret{k_}", (-0.016, y, 0.0775), (0.016, y, 0.0775), 0.0009, mats["chrome"], kind="cyl", parent=grp, segs=8))
    pl = None
    for i, x in enumerate((-0.008, 0.0, 0.008)):
        m = mats["steel"] if i != 1 else mats["steel"].copy()
        s = rod(f"st_str{i}", (x, -0.09, 0.0685), (x, 0.622, 0.0815), 0.0007, m, kind="cyl", mids=40 if i == 1 else 0, parent=grp, segs=8)
        parts.append(s)
        if i == 1: pl = s
    shape(pl, "bow", lambda co: (0.0025 * math.sin(math.pi * min(1, max(0, (co.y + 0.09) / 0.712))), 0, 0))
    C.ring(pl.data.shape_keys.key_blocks["bow"], 11.0, power=1.1)
    hit_l = Vector((0, -0.02, 0.0685 + (0.07 / 0.712) * 0.013))
    C.glow(add_glow(pl.data.materials[0], hit_l, 0.12), gain=4.0)
    C.fit += parts
    C.ground.append(body)
    hit = world_pt(grp, hit_l + Vector((0, 0, 0.0007)))
    u = (FROM_BEHIND + UP * 0.6).normalized()
    pick = lathe("pick", cyl_prof(0.0012, 0.013, bevel=0.0004), mats["orange"], segs=3, sharp=None)
    pick.location = hit + u * 0.012
    set_quat(pick, quat_to(u.cross(RIGHT)))
    piv = empty("pick_pivot", hit + u * 0.06)
    keep_parent(pick, piv)
    C.fit.append(pick)
    C.lift(piv, RIGHT, -14.0, RIGHT * 0.008 + UP * 0.012)


def build_kick(C, mats):
    wrap = mat("kick_wrap", "#2E2E33", 0.25, coat=0.6, coat_rough=0.08)
    hoopw = grain(mat("hoop_wood", "#B88A5A", 0.35, coat=0.4), "#BF9060", "#9C7046", scale=12, along="Z", across="X")
    R, H = 0.28, 0.40
    n = (Quaternion((0, 0, 1), math.radians(50)) @ CH).normalized()
    q = quat_to(n)
    grp = set_quat(empty("kick", (0, 0, R + 0.014)), q)
    lu = q.inverted() @ UP
    hit_xy = (lu.x * 0.05, lu.y * 0.05)
    hd, zh = drum(C, mats, "kick", R, H, wrap, hoopw, mats["chrome"], hit_xy, lugs=10, z0=-(H / 2 + 0.01), hoop_h=0.035,
                  grp=grp, depth=0.012, wood_hoops=True)
    reso = lathe("kick_reso", cyl_prof(0.002, R - 0.002, bevel=0.0005), mats["graphite"], segs=96, loc=(0, 0, -(H / 2) + 0.004), parent=grp)
    C.fit.append(reso)
    C.ground += [bpy.data.objects["kick_hoop_bot"], bpy.data.objects["kick_hoop_top"]]
    contact = world_pt(grp, (hit_xy[0], hit_xy[1], zh))
    C.drum_head(hd, hz=4.5, hz2=3.6, push=1.6)
    C.glow(add_glow(hd.data.materials[0], (hit_xy[0], hit_xy[1], 0), 0.10), gain=2.2)
    hr = 0.032
    A = Vector((contact.x, contact.y, 0.09)) + n * 0.13
    ax = n.cross(UP).normalized()
    Hc = contact + n * hr
    piv = empty("beater_pivot", A)
    bh = sphere("beater", hr, mats["yarn"], loc=Hc)
    sh = rod("beater_shaft", A, Hc, 0.0045, mats["chrome"], kind="cyl")
    hub = rod("beater_hub", A - ax * 0.02, A + ax * 0.02, 0.009, mats["graphite_metal"], kind="cyl")
    for o in (bh, sh, hub): keep_parent(o, piv)
    for s_ in (-1, 1):
        C.fit.append(rod(f"pedal_post{s_}", A + ax * 0.04 * s_ - Vector((0, 0, A.z - 0.012)), A + ax * 0.04 * s_, 0.006,
                         mats["graphite_metal"], kind="cyl"))
    fb = box("footboard", (0.09, 0.26, 0.014), mats["graphite"], bevel=0.003,
             loc=Vector((A.x, A.y, 0.007)) + n * 0.12, rot=(0, 0, math.atan2(n.y, n.x) - math.pi / 2))
    C.ground.append(fb)
    C.fit += [bh, fb, hub]
    C.stick_lift(piv, n, contact, 34.0, 0.0)


def build_hihat(C, mats):
    R = 0.178
    k = R / 0.215
    bh = 0.040 * k
    ze = 0.20
    display_stand(C, mats, ze + 0.065, base_r=0.10)
    top_m = lathe_marks(mat("hat_top", "#C49C62", 0.24, 1.0))
    bot_m = lathe_marks(mat("hat_bot", "#BE965C", 0.26, 1.0))
    bot = cymbal_mesh("hat_bottom", R, bot_m, loc=(0, 0, ze - bh), rot=(math.pi, 0, 0))
    tp = empty("hat_pivot", (0, 0, ze + bh + 0.0012))
    top = cymbal_mesh("hat_top", R, top_m, parent=tp)
    clutch = lathe("clutch", cyl_prof(0.026, 0.011), mats["graphite_metal"], segs=24, loc=(0, 0, 0.004), parent=tp)
    pull = lathe("pull_rod", cyl_prof(0.10, 0.0042), mats["chrome"], segs=16, loc=(0, 0, 0.02), parent=tp)
    felt = lathe("hat_felt", cyl_prof(0.008, 0.015), mats["felt"], segs=24, loc=(0, 0, ze - bh - 0.009))
    C.fit += [bot, top, clutch, felt, pull]
    d = flat_dir(RIGHT * 0.8 + BACK * 0.5)
    r = 0.62 * R
    hit_l = Vector((d.x * r, d.y * r, cym_top_z(R, r)))
    hit = world_pt(tp, hit_l)
    C.glow(add_glow(top_m, hit_l, 0.06), gain=2.6)
    C.wobble(tp, 1.6, 7.0)
    C.shiver(bot, UP, 0.0005, 15.0)
    stick(C, mats, "stick", hit, FROM_BEHIND, angle=8)


def build_clap(C, mats):
    c = Vector((0, 0, 0.17))
    ax = (RIGHT * 0.75 + CH * 0.66).normalized()
    f = (UP + (UP.cross(ax)) * 0.25).normalized()
    a = place_hand(C, mats, "hand_r", c + ax * 0.0005, -ax, f, lift_deg=12, rise=0.05, curl=(8, 10, 8), fit="all")
    b = place_hand(C, mats, "hand_l", c - ax * 0.0005, ax, f, mirror=True, lift_deg=12, rise=0.05, curl=(8, 10, 8), fit="all")
    for h in (a, b):
        C.glow(add_glow(h["palm_obj"].data.materials[0], h["palm"], 0.055), gain=2.2)


def build_shaker(C, mats):
    shell = mat("shaker_shell", "#EEE9DD", 0.35, alpha=0.40, coat=0.3)
    prof = [(0, -0.030), (0.012, -0.0285), (0.019, -0.023), (0.0215, -0.012), (0.0215, 0.0), (0.020, 0.010),
            (0.016, 0.020), (0.009, 0.027), (0, 0.030)]
    ax = (UP * 0.85 + RIGHT * 0.5).normalized()
    grp = set_quat(empty("egg", (0, 0, 0.075)), quat_to(ax))
    fine = [(0.0215 * math.sin(math.pi * i / 24) * (1 - 0.12 * math.cos(math.pi * i / 24)), -0.030 * math.cos(math.pi * i / 24)) for i in range(25)]
    egg = lathe("egg", fine, shell, segs=64, parent=grp, sharp=None)
    C.fit.append(egg)
    bead = mats["orange"].copy()
    uniform_glow(C, bead, gain=1.4)
    rr = lambda z: next((r0 + (r1 - r0) * (z - z0) / (z1 - z0) for (r0, z0), (r1, z1) in zip(prof, prof[1:]) if z0 <= z <= z1), 0)
    rng = C.rng
    for i in range(22):
        z = rng.uniform(-0.024, -0.012)
        lim = max(0.002, rr(z) - 0.0055)
        a_, rad = rng.uniform(0, TAU), lim * math.sqrt(rng.random())
        rest = Vector((rad * math.cos(a_), rad * math.sin(a_), z))
        fly = Vector((rng.uniform(-0.006, 0.006), rng.uniform(-0.006, 0.006), rng.uniform(0.012, 0.030)))
        b = sphere(f"bead{i}", 0.0032, bead, loc=rest, parent=grp, segs=12)
        def tr_(f, b=b, rest=rest, fly=fly):
            p = rest + fly * C.L[f]
            lim2 = max(0.0, rr(p.z) - 0.0045)
            h = math.hypot(p.x, p.y)
            if h > lim2 and h > 0: p.x, p.y = p.x * lim2 / h, p.y * lim2 / h
            b.location = p
            b.keyframe_insert("location", frame=f)
        C.tracks.append(tr_)
    C.lift(grp, (1, 0, 0), 0.0, ax * 0.02)


def build_tambourine(C, mats):
    wood = grain(mat("tamb_wood", "#C69A68", 0.45, coat=0.35), "#CDA16F", "#AE8250", scale=14, along="Z", across="X", bump=0.01)
    brass = mat("jingle", "#CBA862", 0.2, 1.0)
    uniform_glow(C, brass, gain=1.2)
    R, h, w = 0.125, 0.046, 0.008
    nrm = (UP * math.cos(math.radians(30)) + CH * math.sin(math.radians(30))).normalized()
    q = quat_to(nrm)
    grp = set_quat(empty("tambourine"), q)
    band = 0.012
    parts = [lathe("tb_low", tube_prof(band, R, R - w), wood, segs=96, closed=True, parent=grp),
             lathe("tb_high", tube_prof(band, R, R - w), wood, segs=96, closed=True, loc=(0, 0, h - band), parent=grp)]
    slot = math.radians(24)
    mid = [(R - w, band), (R, band), (R, h - band), (R - w, h - band)][::-1]
    for i in range(5):
        a0 = TAU * i / 5 + slot / 2
        a1 = TAU * (i + 1) / 5 - slot / 2
        parts.append(lathe(f"tb_mid{i}", mid, wood, segs=16, closed=True, arc=(a0, a1), parent=grp))
    hit_xy = (0.01, -0.02)
    hd = head("tb_head", R - 0.002, mats["rawhide"].copy(), hit_xy, depth=0.004, parent=grp, loc=(0, 0, h + 0.0008))
    parts.append(hd)
    disk = [(0, 0.0016), (0.022, 0.0003), (0.025, -0.0004), (0.022, -0.0009), (0, 0.0005)]
    for i in range(5):
        a = TAU * (i + 0.5) / 5
        rr_ = R - w / 2
        x, y = rr_ * math.cos(a), rr_ * math.sin(a)
        parts.append(rod(f"jpin{i}", (x, y, band), (x, y, h - band), 0.0011, mats["chrome"], kind="cyl", parent=grp, segs=8))
        for j, dz in enumerate((-0.0028, 0.0028)):
            jg = lathe(f"jingle{i}{j}", disk if dz > 0 else [(r_, -z_) for r_, z_ in disk][::-1], brass, segs=32, closed=False,
                       loc=(x, y, h / 2 + dz), parent=grp)
            ph, hz = C.rng.uniform(0, TAU), C.rng.uniform(11, 17)
            C.shiver(jg, (0, 0, 1), 0.0022, hz, phase=ph)
            C.wobble(jg, 7.0, hz * 0.8, phase=ph)
    C.fit += parts
    bpy.context.view_layer.update()
    dl = q.inverted() @ DOWN
    dl = Vector((dl.x, dl.y, 0)).normalized()
    low = q @ (dl * (R + 0.004))
    rod_top = 0.16
    grp.location = Vector((0, 0, rod_top)) - low
    display_stand(C, mats, rod_top, base_r=0.09)
    clamp = box("tb_clamp", (0.02, 0.02, 0.03), mats["graphite_metal"], bevel=0.003, loc=(0, 0, rod_top + 0.004))
    C.fit.append(clamp)
    contact = world_pt(grp, (hit_xy[0], hit_xy[1], h + 0.0008))
    C.drum_head(hd, hz=6.0, hz2=4.4, push=1.0)
    C.glow(add_glow(hd.data.materials[0], (hit_xy[0], hit_xy[1], 0), 0.07), gain=2.0)
    fingers = (CH - nrm * CH.dot(nrm)).normalized()
    place_hand(C, mats, "hand", contact, -nrm, fingers, lift_deg=14, rise=0.035)
    C.wobble(grp, 2.5, 4.0, power=1.2)


def build_cajon(C, mats):
    birch = grain(mat("birch", "#D9C4A0", 0.5, coat=0.2), "#DDC8A5", "#C7AE86", scale=12, along="Z", across="X", bump=0.01)
    tapa_m = grain(mat("tapa", "#6E4C36", 0.4, coat=0.3), "#76523A", "#57392A", scale=18, along="Z", across="Y", bump=0.01)
    D, W, H = 0.30, 0.30, 0.48
    n = (Quaternion((0, 0, 1), math.radians(24)) @ CH).normalized()
    grp = set_quat(empty("cajon"), Quaternion((0, 0, 1), math.atan2(n.y, n.x)))
    body = box("cajon_body", (D, W, H), birch, bevel=0.006, seg=3, loc=(0, 0, H / 2 + 0.008), parent=grp)
    feet = [lathe(f"cfoot{i}", cyl_prof(0.008, 0.012), mats["rubber"], segs=16, loc=(sx * 0.12, sy * 0.12, 0), parent=grp)
            for i, (sx, sy) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1)))]
    tapa = finish("tapa", grid_mesh("tapa", 0.47, 0.294, 28, 18), tapa_m, loc=(D / 2 + 0.0025, 0, 0.008 + H / 2),
                  rot=(0, math.radians(90), 0), parent=grp, sharp=None)
    edge = box("tapa_edge", (0.004, 0.296, 0.472), tapa_m, bevel=0.001, loc=(D / 2 + 0.0005, 0, 0.008 + H / 2), parent=grp)
    screws = [lathe(f"cscrew{i}", cyl_prof(0.0015, 0.003), mats["chrome"], segs=12, loc=(D / 2 + 0.003, sy * 0.135, z),
                    rot=(0, math.radians(90), 0), parent=grp)
              for i, (sy, z) in enumerate(((1, 0.03), (-1, 0.03), (1, 0.25), (-1, 0.25), (1, 0.47), (-1, 0.47)))]
    C.fit += [body, tapa, edge] + feet
    C.ground += feet
    hz_ = 0.40
    hx = (0.008 + H / 2) - hz_
    shape(tapa, "dent", lambda co: (0, 0, -0.006 * math.exp(-((co.x - hx) ** 2 + co.y ** 2) / (2 * 0.07 ** 2))
                                    * max(0, 1 - (2 * co.y / 0.294) ** 4) * max(0, 1 - (2 * co.x / 0.47) ** 4)))
    kb = tapa.data.shape_keys.key_blocks["dent"]
    C.key(kb, lambda f: math.exp(-f / 1.4) * 0.8 + 0.35 * C.e[f] ** 1.3 * math.sin(TAU * 9 * C.t(f)))
    C.glow(add_glow(tapa_m, (hx, 0, 0), 0.07), gain=2.2)
    contact = world_pt(tapa, (hx, 0, 0.001))
    place_hand(C, mats, "hand", contact, -n, DOWN + n * 0.15, lift_deg=18, rise=0.03)


def build_conga(C, mats):
    wood = grain(mat("conga_wood", "#9C6438", 0.35, coat=0.5, coat_rough=0.1), "#A56B3D", "#7E4C28", scale=14, along="Z", across="X", bump=0.01)
    outer = [(0.112, 0.0), (0.128, 0.08), (0.145, 0.20), (0.150, 0.32), (0.145, 0.45), (0.136, 0.58), (0.131, 0.66), (0.130, 0.70)]
    shell = lathe("conga_shell", outer + [(r - 0.010, z) for r, z in reversed(outer)], wood, segs=96, closed=True, sharp=70)
    ring = lathe("conga_foot", tube_prof(0.02, 0.116, 0.104), mats["rubber"], segs=64, closed=True)
    crown = lathe("conga_crown", [(0.127, 0.692), (0.137, 0.692), (0.139, 0.700), (0.139, 0.712), (0.133, 0.716), (0.127, 0.716)],
                  mats["chrome"], segs=96, closed=True)
    d = flat_dir(BACK * 0.85 + RIGHT * 0.3)
    hit_xy = (d.x * 0.06, d.y * 0.06)
    hd = head("conga_head", 0.128, mats["rawhide"].copy(), hit_xy, depth=0.007, loc=(0, 0, 0.707))
    parts = [shell, ring, crown, hd]
    for i in range(6):
        a = TAU * (i + 0.5) / 6
        c, s = math.cos(a), math.sin(a)
        parts.append(box(f"cplate{i}", (0.008, 0.02, 0.05), mats["chrome"], bevel=0.002, loc=(c * 0.137, s * 0.137, 0.565), rot=(0, 0, a)))
        parts.append(rod(f"crod{i}", (c * 0.143, s * 0.143, 0.585), (c * 0.143, s * 0.143, 0.718), 0.003, mats["chrome"], kind="cyl"))
        parts.append(box(f"cear{i}", (0.014, 0.012, 0.008), mats["chrome"], bevel=0.002, loc=(c * 0.140, s * 0.140, 0.714), rot=(0, 0, a)))
    C.fit += parts
    C.ground.append(ring)
    C.drum_head(hd, hz=5.5, hz2=4.1)
    C.glow(add_glow(hd.data.materials[0], (hit_xy[0], hit_xy[1], 0), 0.07), gain=2.2)
    contact = Vector((hit_xy[0], hit_xy[1], 0.707 + 0.0005))
    place_hand(C, mats, "hand", contact, DOWN, -d + CH * 0.3, lift_deg=20, rise=0.035, curl=(4, 6, 4))


def build_bongo(C, mats):
    wood = grain(mat("bongo_wood", "#B07440", 0.35, coat=0.5, coat_rough=0.1), "#B97B45", "#93602F", scale=14, along="Z", across="X", bump=0.01)
    parts, heads = [], {}
    for name, R, off in (("macho", 0.090, -0.108), ("hembra", 0.110, 0.125)):
        o = RIGHT * off
        prof = [(R * 0.78, 0.0), (R * 0.86, 0.06), (R * 0.95, 0.12), (R, 0.15)]
        parts.append(lathe(f"{name}_shell", prof + [(r - 0.008, z) for r, z in reversed(prof)], wood, segs=80, closed=True,
                           loc=(o.x, o.y, 0), sharp=70))
        parts.append(lathe(f"{name}_hoop", [(R - 0.002, 0.146), (R + 0.008, 0.146), (R + 0.009, 0.150), (R + 0.009, 0.162),
                                            (R + 0.006, 0.165), (R - 0.002, 0.165)], mats["chrome"], segs=80, closed=True, loc=(o.x, o.y, 0)))
        heads[name] = (head(f"{name}_head", R - 0.001, mats["rawhide"].copy(), (0, 0), depth=0.004, loc=(o.x, o.y, 0.158)), o, R)
        for i in range(4):
            a = TAU * (i + 0.5) / 4
            c, s = math.cos(a), math.sin(a)
            parts.append(rod(f"{name}_rod{i}", (o.x + c * (R + 0.012), o.y + s * (R + 0.012), 0.165),
                             (o.x + c * (R * 0.9 + 0.012), o.y + s * (R * 0.9 + 0.012), 0.07), 0.003, mats["chrome"], kind="cyl"))
            parts.append(box(f"{name}_ear{i}", (0.016, 0.012, 0.012), mats["chrome"], bevel=0.002,
                             loc=(o.x + c * (R * 0.88 + 0.006), o.y + s * (R * 0.88 + 0.006), 0.066), rot=(0, 0, a)))
    bridge = box("bongo_bridge", (0.05, 0.05, 0.05), wood, bevel=0.005, loc=RIGHT * 0.006 + Vector((0, 0, 0.07)),
                 rot=(0, 0, math.atan2(RIGHT.y, RIGHT.x)))
    C.fit += parts + [bridge] + [h[0] for h in heads.values()]
    C.ground += [bpy.data.objects["macho_shell"], bpy.data.objects["hembra_shell"]]
    hd, o, R = heads["macho"]
    d = flat_dir(BACK * 0.9 + RIGHT * 0.2)
    hit_xy = (d.x * R * 0.62, d.y * R * 0.62)
    # rebuild the push key at the strike point (the head was made centred)
    hd.shape_key_clear()
    hd2 = head("macho_head_s", R - 0.001, hd.data.materials[0], hit_xy, depth=0.004, loc=(o.x, o.y, 0.158))
    C.fit.remove(hd)
    bpy.data.objects.remove(hd)
    C.fit.append(hd2)
    C.drum_head(hd2, hz=9.0, hz2=7.0)
    C.glow(add_glow(hd2.data.materials[0], (hit_xy[0], hit_xy[1], 0), 0.045), gain=2.4)
    hh, _, _ = heads["hembra"]
    contact = Vector((o.x + hit_xy[0], o.y + hit_xy[1], 0.158 + 0.0005))
    t = math.radians(28)
    f = -d * math.cos(t) + DOWN * math.sin(t)
    n = DOWN * math.cos(t) + d * math.sin(t)
    place_hand(C, mats, "hand", contact, n, f, at="tip", lift_deg=16, rise=0.02, curl=(12, 14, 10))


def build_tom(C, mats):
    walnut = grain(mat("tom_wood", "#5C3D2A", 0.3, coat=0.6, coat_rough=0.08), "#654430", "#47301F", scale=10, along="Z", across="X", bump=0.005)
    R, H = 0.152, 0.20
    nrm = (UP * math.cos(math.radians(14)) + CH * math.sin(math.radians(14))).normalized()
    q = quat_to(nrm)
    P = Vector((0, 0, 0.14))
    grp = set_quat(empty("tom", P), q)
    bl = q.inverted() @ BACK
    hit_xy = (bl.x * 0.05, bl.y * 0.05)
    hd, zh = drum(C, mats, "tom", R, H, walnut, mats["chrome"], mats["chrome"], hit_xy, lugs=6, grp=grp)
    display_stand(C, mats, P.z - 0.004, base_r=0.10, rod_r=0.008)
    mount = box("tom_mount", (0.03, 0.03, 0.02), mats["chrome"], bevel=0.003, loc=P + Vector((0, 0, 0.004)))
    C.fit.append(mount)
    C.drum_head(hd, hz=6.5, hz2=5.0)
    C.glow(add_glow(hd.data.materials[0], (hit_xy[0], hit_xy[1], 0), 0.06), gain=2.2)
    hit = world_pt(grp, (hit_xy[0], hit_xy[1], zh))
    stick(C, mats, "stick", hit, FROM_BEHIND, contact_normal=nrm, angle=12)


def build_cowbell(C, mats):
    paint = mat("cowbell_paint", "#2B2B30", 0.45, 0.4)
    m_dir = (CH * 0.6 - RIGHT * 0.8).normalized()
    c = Vector((0, 0, 0.17))
    grp = set_quat(empty("cowbell", c), Quaternion((0, 0, 1), math.atan2(m_dir.y, m_dir.x)))
    bm = bmesh.new()
    mouth = [(0.085, sy * 0.050, sz * 0.032) for sy, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    back = [(-0.085, sy * 0.028, sz * 0.020) for sy, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    vm, vb = [bm.verts.new(v) for v in mouth], [bm.verts.new(v) for v in back]
    for i in range(4): bm.faces.new((vb[i], vb[(i + 1) % 4], vm[(i + 1) % 4], vm[i]))
    bm.faces.new(vb[::-1])
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.x - e.verts[1].co.x) > 1e-6], cuts=6, use_grid_fill=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("cowbell")
    bm.to_mesh(me)
    bm.free()
    bell = finish("cowbell", me, paint.copy(), parent=grp, sharp=30)
    bb.modifier(bell, "SOLIDIFY", thickness=0.002, offset=-1)
    bb.modifier(bell, "BEVEL", width=0.0025, segments=3, limit_method="ANGLE")
    lip = [rod(f"lip{i}", Vector(mouth[i]) * 1.0, Vector(mouth[(i + 1) % 4]), 0.0022, mats["chrome"], kind="capsule", parent=grp)
           for i in range(4)]
    clampb = box("cb_clamp", (0.03, 0.03, 0.03), mats["chrome"], bevel=0.003, loc=(-0.10, 0, -0.005), parent=grp)
    arm = rod("cb_arm", (-0.10, 0, -0.005), (-0.085, 0, -0.005), 0.005, mats["chrome"], kind="cyl", parent=grp)
    sx = c - m_dir * 0.10
    display_stand(C, mats, c.z - 0.02, base_r=0.09, xy=(sx.x, sx.y))
    C.fit += [bell, clampb, arm] + lip
    hit_l = Vector((0.05, 0, 0.020 + (0.05 + 0.085) / 0.17 * 0.012 + 0.0005))
    hit = world_pt(grp, hit_l)
    C.glow(add_glow(bell.data.materials[0], hit_l, 0.045), gain=2.6)
    C.wobble(grp, 1.5, 9.0)
    stick(C, mats, "stick", hit, FROM_BEHIND, angle=6)


def build_claves(C, mats):
    rose = grain(mat("clave_wood", "#6E3D2E", 0.35, coat=0.4), "#7A4634", "#55301F", scale=16, along="Z", across="X", bump=0.01)
    r, L = 0.0125, 0.20
    a = (RIGHT * 0.9 + BACK * 0.4).normalized()
    c = Vector((0, 0, 0.030 + r))
    bot = rod("clave_bottom", c - a * (L / 2 - r), c + a * (L / 2 - r), r, rose.copy(), mids=4)
    cradles = [box(f"cradle{s}", (0.03, 0.035, 0.03), mats["graphite"], bevel=0.004, loc=c - a * 0.065 * s - Vector((0, 0, c.z - 0.015)),
                   rot=(0, 0, math.atan2(a.y, a.x))) for s in (-1, 1)]
    b = flat_dir(UP.cross(a))
    if b.dot(BACK) < 0: b = -b
    u = (b + UP * 0.35).normalized()
    contact = c + UP * (2 * r)
    top = rod("clave_top", contact - u * (L / 2 - r), contact + u * (L / 2 - r), r, rose.copy(), mids=4)
    piv = empty("clave_pivot", contact + u * (L / 2))
    keep_parent(top, piv)
    C.fit += [bot, top] + cradles
    C.ground += cradles
    C.glow(add_glow(bot.data.materials[0], local_pt(bot, c + UP * r), 0.04), gain=2.4)
    C.glow(add_glow(top.data.materials[0], local_pt(top, contact - UP * r), 0.04), gain=2.4)
    C.shiver(bot, UP, 0.0006, 16.0)
    C.stick_lift(piv, UP, contact, 7.0, 0.004)


def build_woodblock(C, mats):
    teak = grain(mat("block_wood", "#A8764A", 0.45, coat=0.3), "#B07E50", "#8C5F38", scale=14, along="X", across="Y", bump=0.015)
    L, W, H = 0.20, 0.07, 0.06
    a = (RIGHT * 0.85 + BACK * 0.5).normalized()
    grp = set_quat(empty("woodblock"), Quaternion((0, 0, 1), math.atan2(a.y, a.x)))
    block = box("block", (L, W, H), teak, bevel=0.005, seg=3, loc=(0, 0, 0.008 + H / 2), parent=grp)
    felts = [box(f"wfelt{s}", (0.014, W * 0.9, 0.008), mats["graphite"], bevel=0.002, loc=(s * 0.06, 0, 0.004), parent=grp) for s in (-1, 1)]
    slots = [box(f"slot{s}", (L * 0.82, 0.004, 0.008), mats["graphite"], bevel=0.001, loc=(0, s * (W / 2 - 0.0012), 0.008 + H * 0.70), parent=grp)
             for s in (-1, 1)]
    C.fit += [block] + felts + slots
    C.ground += felts
    hit = world_pt(grp, (0.02, 0, 0.008 + H))
    C.glow(add_glow(teak, local_pt(block, hit), 0.05), gain=2.4)
    C.shiver(block, UP, 0.0007, 18.0)
    stick(C, mats, "stick", hit, FROM_BEHIND, angle=6)


def build_framedrum(C, mats):
    wood = grain(mat("frame_wood", "#C4996A", 0.45, coat=0.35), "#CBA071", "#A97F52", scale=14, along="Z", across="X", bump=0.01)
    R, h, w = 0.225, 0.065, 0.012
    nrm = (UP * math.cos(math.radians(58)) + CH * math.sin(math.radians(58))).normalized()
    q = quat_to(nrm)
    grp = set_quat(empty("framedrum"), q)
    bl = q.inverted() @ BACK
    bl = Vector((bl.x, bl.y, 0)).normalized()
    hit_xy = (bl.x * R * 0.70, bl.y * R * 0.70)
    frame = lathe("fd_frame", tube_prof(h, R, R - w, 0.002), wood, segs=128, closed=True, parent=grp)
    hd = head("fd_head", R - 0.001, mats["rawhide"].copy(), hit_xy, depth=0.010, parent=grp, loc=(0, 0, h + 0.0008))
    C.fit += [frame, hd]
    dl = q.inverted() @ DOWN
    dl = Vector((dl.x, dl.y, 0)).normalized()
    rod_top = 0.09
    grp.location = Vector((0, 0, rod_top + 0.012)) - q @ (dl * R)
    display_stand(C, mats, rod_top, base_r=0.10)
    cradle = box("fd_cradle", (0.05, 0.03, 0.024), mats["graphite_metal"], bevel=0.003, loc=(0, 0, rod_top + 0.006),
                 rot=(0, 0, math.atan2(RIGHT.y, RIGHT.x)))
    C.fit.append(cradle)
    C.drum_head(hd, hz=4.0, hz2=3.1, push=1.2)
    C.glow(add_glow(hd.data.materials[0], (hit_xy[0], hit_xy[1], 0), 0.09), gain=2.2)
    contact = world_pt(grp, (hit_xy[0], hit_xy[1], h + 0.0013))
    fingers = -(q @ Vector((bl.x, bl.y, 0)))
    place_hand(C, mats, "hand", contact, -nrm, fingers, lift_deg=16, rise=0.03, curl=(5, 6, 4))


BUILD = {k[6:]: v for k, v in dict(globals()).items() if k.startswith("build_")}


# ---------------------------------------------------------------- set, camera, light

def sweep(centre, S):
    D, R, H, F, W = 2.6 * S, 2.4 * S, 16 * S, 30 * S, 60 * S
    prof = [(-F, 0.0), (0.0, 0.0), (D, 0.0)] + \
           [(D + R * math.sin(math.pi / 2 * i / 24), R - R * math.cos(math.pi / 2 * i / 24)) for i in range(1, 25)] + [(D + R, H)]
    n = len(prof)
    verts = [(x, y, z) for x in (-W / 2, W / 2) for y, z in prof]
    faces = [(i, n + i, n + i + 1, i + 1) for i in range(n - 1)]
    me = bpy.data.meshes.new("sweep")
    me.from_pydata(verts, [], faces)
    me.update()
    c = Vector((CAM_DIR.x, CAM_DIR.y)).normalized()
    ob = finish("sweep", me, mat("sweep", OFF, 0.85, spec=0.25), loc=(centre.x, centre.y, 0),
                rot=(0, 0, math.atan2(c.y, c.x) + math.pi / 2), sharp=None)
    ob["bb_floor"] = True
    return ob


def world_points(objs):
    bpy.context.view_layer.update()
    pts = []
    for o in objs:
        if o.type == "MESH" and len(o.data.vertices) < 60000:
            mw = o.matrix_world
            pts += [mw @ v.co for v in o.data.vertices]
        elif o.type in bb.GEOMETRY:
            pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    return pts


def fit_camera(objs, hfrac=0.60, wfrac=0.52):
    """The pack camera: CAM_DIR, LENS; distance and lens shift so the model fills hfrac of the height (or wfrac of
    the width, whichever binds) and sits centred, so a square or 9:16 crop of the 16:9 frame keeps it."""
    sc = bpy.context.scene
    pts = world_points(objs)
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    centre = (lo + hi) / 2
    cam = link(bpy.data.objects.new("cam", bpy.data.cameras.new("cam")))
    cam.data.lens, cam.data.sensor_fit, cam.data.sensor_width = LENS, "AUTO", 36.0
    sc.camera = cam
    dist = 4.0 * max(hi - lo)
    W, H = sc.render.resolution_x, sc.render.resolution_y
    for _ in range(8):
        cam.location = centre + CAM_DIR * dist
        bb.look_at(cam, centre)
        bpy.context.view_layer.update()
        ndc = [world_to_camera_view(sc, cam, p) for p in pts]
        xs, ys = [p.x for p in ndc], [p.y for p in ndc]
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        dist *= max(h / hfrac, w / wfrac)
        cam.data.shift_x += ((max(xs) + min(xs)) / 2 - 0.5)
        cam.data.shift_y += ((max(ys) + min(ys)) / 2 - 0.5) * H / W
    cam.data.clip_start, cam.data.clip_end = 0.01, 200
    return cam, centre, max(hi - lo), (w, h)


# role, azimuth from the camera (deg, + = camera right), elevation, distance x S, size x S, power x key, kelvin
RIG = [("key", -45, 50, 6.0, 4.0, 1.0, 6300), ("fill", 65, 18, 6.5, 5.0, 0.30, 6600),
       ("rim", 170, 35, 3.6, 1.2, 0.9, 6500), ("top", 0, 88, 5.0, 5.0, 0.35, 6500)]


def studio(C, objs):
    """The pack's light: big soft sources far from the model (6x its size) so the sweep falls off gently, a
    soft key from the upper left, a large fill, a thin rim from behind, an overhead, and a spot washing the
    backdrop so the top of the frame stays off-white. Power from the kit's calibration (looks.KEY_W_PER_M2)."""
    cam, centre, S, wh = fit_camera(objs)
    sw = sweep(centre, S)
    import looks
    base = math.atan2(CAM_DIR.y, CAM_DIR.x)
    for role, az, el, dist, size, pw, k in RIG:
        d, a_, e_ = dist * S, base + math.radians(az), math.radians(el)
        li = bpy.data.lights.new(role, "AREA")
        li.size, li.color, li.energy = size * S, looks.kelvin_rgb(k), looks.KEY_W_PER_M2 * d * d * pw
        if hasattr(li, "use_shadow_jitter"): li.use_shadow_jitter = True
        ob = link(bpy.data.objects.new(role, li))
        ob.location = centre + Vector((math.cos(e_) * math.cos(a_), math.cos(e_) * math.sin(a_), math.sin(e_))) * d
        bb.look_at(ob, centre)
    c = Vector((CAM_DIR.x, CAM_DIR.y, 0)).normalized()
    wash = link(bpy.data.objects.new("wash", bpy.data.lights.new("wash", "SPOT")))
    wash.location = centre + c * (2.0 * S) + Vector((0, 0, 5.0 * S))
    target = centre - c * (4.5 * S) + Vector((0, 0, 3.0 * S))
    wash.data.spot_size, wash.data.spot_blend, wash.data.shadow_soft_size = math.radians(70), 0.9, S
    wash.data.energy = 4 * looks.KEY_W_PER_M2 * (wash.location - target).length ** 2 * 0.5 * WASH
    bb.look_at(wash, target)
    bb.world("#ffffff", 0.22)
    if bpy.context.scene.render.engine != "CYCLES":
        kind = "SPHERE" if bpy.app.version >= (4, 1) else "CUBEMAP"
        pr = link(bpy.data.objects.new("probe", bpy.data.lightprobes.new("probe", kind)))
        pr.location = centre
        pr.data.influence_distance = 6 * S
    return cam, sw, S


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--audio", default=os.path.join(REPO, "assets-src", "audio"))
    ap.add_argument("--size", default="960x540")
    ap.add_argument("--samples", type=int, default=64)
    ap.add_argument("--frames", default="all")
    ap.add_argument("--views", action="store_true")
    ap.add_argument("--blur", action="store_true")
    ap.add_argument("--exposure", type=float, default=-1.35)
    ap.add_argument("--wash", type=float, default=1.0)
    ap.add_argument("--bounces", type=int, default=3)
    ap.add_argument("--engine", default="EEVEE", choices=["CYCLES", "EEVEE"])
    a = ap.parse_args(sys.argv[1:])
    global WASH
    WASH = a.wash
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    env = envelope(os.path.join(a.audio, a.id + ".wav"))

    sc = bb.reset("Khronos PBR Neutral")
    w, h = (int(v) for v in a.size.split("x"))
    bb.settings(a.engine, size=(w, h), samples=a.samples)
    if a.engine == "CYCLES":
        sc.cycles.use_adaptive_sampling, sc.cycles.adaptive_threshold = True, 0.02
        sc.cycles.max_bounces, sc.cycles.diffuse_bounces, sc.cycles.glossy_bounces = 8, a.bounces, 4
        sc.cycles.transmission_bounces, sc.cycles.transparent_max_bounces = 8, 8
    else:
        ee = sc.eevee
        for k, v in {"use_raytracing": True, "use_shadows": True, "shadow_ray_count": 2, "shadow_step_count": 8,
                     "use_fast_gi": True, "fast_gi_method": "GLOBAL_ILLUMINATION"}.items():
            if hasattr(ee, k): setattr(ee, k, v)
    sc.render.use_persistent_data = True
    sc.render.fps = FPS
    sc.render.use_motion_blur = a.blur
    sc.view_settings.exposure = a.exposure
    sc.render.motion_blur_shutter = 0.3

    C = Clip(a.id, env)
    mats = M()
    BUILD[a.id](C, mats)
    cam, sw, S = studio(C, C.fit)
    C.run()
    sc.frame_start, sc.frame_end = 0, C.n - 1

    contact = {o.name: round(min((o.matrix_world @ v.co).z for v in o.data.vertices), 4) for o in C.ground}
    info = {"id": a.id, "frames": C.n, "duration": round(env["dur"], 3), "peak": env["peak"], "size": round(S, 3),
            "ground_min_z": contact, "blender": bpy.app.version_string}
    if a.views:
        sw.hide_render = True
        sc.frame_set(0)
        bb.views(os.path.join(out, "views.png"), n=5, objs=[o for o in C.fit if o.type in bb.GEOMETRY], size=300)
        sw.hide_render = False
    if a.frames == "all":
        # one still per frame: measured about 2 s a frame in EEVEE, where render(animation=True) took 20-36 s
        import time
        t0 = time.time()
        os.makedirs(os.path.join(out, "frames"), exist_ok=True)
        for f in range(C.n):
            sc.frame_set(f)
            bb.render(os.path.join(out, "frames", f"{f:04d}.png"))
        info["render_s"] = round(time.time() - t0, 1)
    else:
        import sheetlib
        shots = []
        for f in [int(x) for x in a.frames.split(",")]:
            f = min(f, C.n - 1)
            sc.frame_set(f)
            p = bb.render(os.path.join(out, f"f{f:04d}.png"))
            shots.append(bb._pixels(p))
        if len(shots) > 1:
            small = [s[::2, ::2] for s in shots]
            sheetlib.write_png(os.path.join(out, "strip.png"), sheetlib.stitch(small, cols=min(4, len(small))))
    with open(os.path.join(out, "info.json"), "w") as fh: json.dump(info, fh, indent=1)
    print(json.dumps(info))


if __name__ == "__main__":
    main()
