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


def lathe_bm(bm, prof, segs=48, M=None, closed=False):
    """A solid of revolution about z from a profile [(r, z)]; r = 0 ends become poles. closed: stitch last to first."""
    M = M or Matrix.Identity(4)
    rings = []
    for r, z in prof:
        if r < 1e-7: rings.append([bm.verts.new(M @ Vector((0, 0, z)))])
        else: rings.append([bm.verts.new(M @ Vector((r * math.cos(TAU * j / segs), r * math.sin(TAU * j / segs), z)))
                            for j in range(segs)])
    n = len(rings)
    pairs = list(zip(range(n - 1), range(1, n))) + ([(n - 1, 0)] if closed else [])
    for a, b_ in pairs:
        A, B = rings[a], rings[b_]
        if len(A) == 1 and len(B) == 1: continue
        for j in range(segs):
            k = (j + 1) % segs
            if len(A) == 1: bm.faces.new((A[0], B[k], B[j]))
            elif len(B) == 1: bm.faces.new((A[j], A[k], B[0]))
            else: bm.faces.new((A[j], A[k], B[k], B[j]))
    return rings


def lathe(name, prof, m=None, segs=48, closed=False, sharp=35, **kw):
    me, bm = bpy.data.meshes.new(name), bmesh.new()
    lathe_bm(bm, prof, segs, None, closed)
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
        "graphite": mat("graphite", GRAPHITE, 0.42, coat=0.15),
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
    }


def mallet(C, mats, name, tip_pt, u, length=0.34, head_r=0.017, head_mat=None, shaft_r=0.0045, shaft_mat=None,
           contact_normal=(0, 0, 1), angle=28.0, rise=0.01):
    """A mallet whose head touches tip_pt on frame 0. u: unit direction from the head toward the grip."""
    u, n = Vector(u).normalized(), Vector(contact_normal).normalized()
    hc = Vector(tip_pt) + n * head_r
    grip = hc + u * length
    piv = empty(name + "_pivot", grip)
    hd = finish(name + "_head", _sphere_me(name + "_head", head_r), head_mat or mats["yarn"], loc=hc, sharp=None)
    sh = rod(name + "_shaft", hc, grip, shaft_r, shaft_mat or mats["rattan"])
    cap = rod(name + "_cap", grip - u * 0.012, grip + u * 0.004, shaft_r * 1.25, mats["rubber"])
    for o in (hd, sh, cap): keep_parent(o, piv)
    C.fit += [hd, sh]
    C.stick_lift(piv, n, tip_pt, angle, rise)
    return piv


def stick(C, mats, name, tip_pt, u, length=0.40, contact_normal=(0, 0, 1), angle=24.0, rise=0.01, tip_mat=None):
    """A drumstick: an orange nylon tip on tip_pt at frame 0, a tapered hickory shaft toward u."""
    u, n = Vector(u).normalized(), Vector(contact_normal).normalized()
    tc = Vector(tip_pt) + n * 0.0055
    grip = tc + u * length
    piv = empty(name + "_pivot", grip)
    tip = rod(name + "_tip", tc - u * 0.004, tc + u * 0.004, 0.0058, tip_mat or mats["orange"])
    neck = rod(name + "_neck", tc + u * 0.003, tc + u * 0.085, 0.0032, mats["hickory"], r1=0.0068, mids=3)
    body = rod(name + "_body", tc + u * 0.08, grip, 0.0068, mats["hickory"], r1=0.0072)
    for o in (tip, neck, body): keep_parent(o, piv)
    C.fit += [tip, neck, body]
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
            leg = rod(f"leg{sy}{sx}", (x, y, 0.006), (x, y, rail_top - 0.03), 0.0075, mats["graphite_metal"], kind="cyl")
            foot = lathe(f"foot{sy}{sx}", [(0, 0), (0.014, 0), (0.016, 0.003), (0.012, 0.008), (0, 0.008)], mats["rubber"],
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
    env = add_glow(bar.data.materials[0], local_pt(bar, hit), radius=L * 0.32)
    C.glow(env, gain=5.0)
    C.ring(bar.data.shape_keys.key_blocks["bend"], 9.0, power=1.2)
    for p in parts: p.parent = grp
    C.fit += parts
    mallet(C, mats, "mallet", hit, (0.35, 0.75, 0.62), length=0.30, head_r=mallet_r, head_mat=mallet_mat, angle=30)
    return bar


def build_marimba(C, mats):
    wood = grain(mat("rosewood", "#6E3D2E", 0.42, coat=0.35, coat_rough=0.2), "#7A4634", "#55301F", scale=22, along="Y", across="X")
    bar_instrument(C, mats, L=0.38, W=0.058, T=0.022, bar_mat=wood, top_z=0.33, res_len=0.22, res_r=0.032,
                   res_mat=mats["graphite_metal"], mallet_mat=mats["yarn"], mallet_r=0.017, arch=0.008)


def build_vibraphone(C, mats):
    alu = mat("aluminium", "#C9CBCE", 0.3, 1.0, aniso=0.5)
    gold = mat("gold_anod", "#C8A867", 0.3, 1.0)
    bar_instrument(C, mats, L=0.30, W=0.050, T=0.013, bar_mat=alu, top_z=0.36, res_len=0.27, res_r=0.030,
                   res_mat=gold, mallet_mat=mats["orange"], mallet_r=0.015, arch=0.0035, holes=True)


def build_xylophone(C, mats):
    wood = grain(mat("padauk", "#9A5638", 0.38, coat=0.45, coat_rough=0.15), "#A65E3E", "#7E4229", scale=20, along="Y", across="X")
    bar_instrument(C, mats, L=0.22, W=0.042, T=0.024, bar_mat=wood, top_z=0.26, res_len=0.13, res_r=0.026,
                   res_mat=mats["graphite_metal"], mallet_mat=mats["orange"], mallet_r=0.012, arch=0.006)


def build_balafon(C, mats):
    wood = grain(mat("balafon_wood", "#8A5C3C", 0.6), "#94643F", "#6C4529", scale=12, along="Y", across="X", distort=9)
    gourd = grain(mat("gourd", "#A97A45", 0.55, coat=0.2), "#B08048", "#8C6034", scale=6, along="Z", across="X", distort=3, bump=0.03)
    bamboo = grain(mat("bamboo", "#C4AA70", 0.45, coat=0.2), "#CBB37A", "#A88F57", scale=30, along="X", across="Y", bump=0.02)
    bar_instrument(C, mats, L=0.30, W=0.050, T=0.020, bar_mat=wood, top_z=0.34, res_len=0, res_r=0, res_mat=None,
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
    hd = head(name + "_head", R - 0.001, head_mat or mats["head"], hit_xy, depth=depth, parent=grp, loc=(0, 0, zh + 0.0015))
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
    hd, zh = drum(C, mats, "snare", R, H, mats["steel"], mats["chrome"], mats["chrome"], hit_xy, lugs=10)
    C.ground.append(bpy.data.objects["snare_hoop_bot"])
    strainer = box("strainer", (0.02, 0.012, 0.05), mats["graphite"], bevel=0.002,
                   loc=(math.cos(-1.2) * (R + 0.012), math.sin(-1.2) * (R + 0.012), 0.08), rot=(0, 0, -1.2))
    lever = box("strainer_lever", (0.006, 0.008, 0.045), mats["chrome"], bevel=0.001,
                loc=(math.cos(-1.2) * (R + 0.021), math.sin(-1.2) * (R + 0.021), 0.085), rot=(0.2, 0, -1.2))
    C.fit += [strainer, lever]
    C.drum_head(hd, hz=8.0, hz2=6.1)
    hit = Vector((hit_xy[0], hit_xy[1], zh))
    C.glow(add_glow(hd.data.materials[0], local_pt(hd, hit), 0.11), gain=5.0)
    # the wires rattle: the whole drum buzzes a little while the sound lasts
    stick(C, mats, "stick", hit, (0.25, 0.75, 0.58), angle=24)


def build_cymbal(C, mats, R=0.215, top=0.30, tilt=12.0, mallet_hit=True, name="cymbal"):
    display_stand(C, mats, top - 0.013)
    piv = empty(name + "_pivot", (0, 0, top), rot=(math.radians(-tilt), 0, math.radians(15)))
    bronze = lathe_marks(mat(name + "_bronze", "#C49C62", 0.24, 1.0))
    t = lambda r: 0.0026 - 0.0013 * r / R
    topp = [(0.007, 0.040), (0.025, 0.0395), (0.045, 0.035), (0.058, 0.026), (0.068, 0.018), (0.09, 0.0145),
            (0.13, 0.0105), (0.17, 0.0065), (0.20, 0.0028), (R, 0.0)]
    prof = topp + [(r, z - t(r)) for r, z in reversed(topp)]
    cym = lathe(name, [(r, z - 0.04) for r, z in prof], bronze, segs=128, closed=True, parent=piv, sharp=60)
    felt_top = lathe(name + "_felt", cyl_prof(0.012, 0.016), mats["felt"], segs=24, loc=(0, 0, 0.0005), parent=piv)
    wing = lathe(name + "_wing", cyl_prof(0.010, 0.010), mats["graphite_metal"], segs=24, loc=(0, 0, 0.0125), parent=piv)
    felt_bot = lathe(name + "_felt_b", cyl_prof(0.010, 0.016), mats["felt"], segs=24, loc=(0, 0, -0.0128), parent=piv)
    tilter = rod(name + "_tilter", (0, 0, -0.02), (0, 0, 0.024), 0.0055, mats["graphite_metal"], kind="cyl", parent=piv)
    C.fit += [cym, felt_top, wing, felt_bot, tilter]
    a = math.radians(25)
    edge_local = Vector((R * 0.94 * math.cos(a), R * 0.94 * math.sin(a), 0.0005 - 0.04))
    hit = world_pt(piv, edge_local)
    nrm = (piv.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
    C.glow(add_glow(bronze, edge_local, 0.12), gain=6.0)
    C.wobble(piv, 7.0, 2.3, power=1.2)
    if mallet_hit:
        mallet(C, mats, "mallet", hit, (0.55, 0.45, 0.70), length=0.30, head_r=0.018, angle=30, contact_normal=nrm)
    return piv, cym


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


def studio(C, objs):
    cam, centre, S, wh = fit_camera(objs)
    sw = sweep(centre, S)
    made = bb.lights("product", objs=objs)
    for L in made:
        if hasattr(L.data, "use_shadow_jitter"): L.data.use_shadow_jitter = True   # house numbers, then the pack's balance: a softer key, a lifted fill, a thin rim
        role = L.name
        L.data.energy *= {"key": 1.0, "fill": 1.4, "rim": 0.9, "top": 0.6}.get(role, 1.0)
    bb.world("#ffffff", 0.18)
    return cam, sw, S


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--audio", default=os.path.join(REPO, "assets-src", "audio"))
    ap.add_argument("--size", default="960x540")
    ap.add_argument("--samples", type=int, default=40)
    ap.add_argument("--frames", default="all")
    ap.add_argument("--views", action="store_true")
    ap.add_argument("--no-blur", action="store_true")
    ap.add_argument("--bounces", type=int, default=3)
    ap.add_argument("--engine", default="CYCLES", choices=["CYCLES", "EEVEE"])
    a = ap.parse_args(sys.argv[1:])
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
    sc.render.use_motion_blur = not a.no_blur
    sc.render.motion_blur_shutter = 0.4

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
        sc.render.filepath = os.path.join(out, "frames", "")
        bpy.ops.render.render(animation=True)
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
