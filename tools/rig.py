"""Rig an AI-generated character mesh for the game, headless in Blender.

usage: blender -b -P tools/rig.py -- in.glb out.glb [height=1.8] [faces=30000] [preview_prefix|-] [proportions]

proportions: joint heights as fractions of the total height, e.g. "hip=0.45,head=0.78,leg=0.42,knee=0.22,sh=0.72"
(defaults fit Le Chonk; `sh` = shoulder height, automatic from the paws when omitted)

1. keep the main body (drops floating fragments such as a detached tail), scale to `height`, feet at 0
2. decimate to about `faces` triangles (textures and UVs kept)
3. find landmarks (feet, paws, collar height) and build a skeleton with the game's joint names
4. skin with Blender's bone-heat automatic weights
5. export a GLB (mesh + skin + JPEG textures) and, optionally, render a posed test

Only the skin weights and the joint positions are used by the game: it rebuilds its own skeleton
with the same joints and drives it with the procedural animator.
"""
import math
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]
HEIGHT = float(argv[2]) if len(argv) > 2 else 1.8
FACES = int(argv[3]) if len(argv) > 3 else 30000
PREVIEW = argv[4] if len(argv) > 4 and argv[4] != "-" else None
R = {"hip": 0.36, "head": 0.68, "leg": 0.27, "knee": 0.13, "sh": 0.0}
if len(argv) > 5:
    for kv in argv[5].split(","):
        k, v = kv.split("=")
        R[k] = float(v)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = "skin"
# drop any parent empties from the import, bake transforms
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---- 1. keep the main part (and small parts touching its bounds: collar, bell...) ----
bm = bmesh.new()
bm.from_mesh(body.data)
# generated meshes come split along UV seams: weld coincident vertices first (UVs live on loops, kept)
size = max(body.dimensions)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=size * 1e-4)
bm.verts.ensure_lookup_table()
seen, parts = set(), []
for v in bm.verts:
    if v.index in seen:
        continue
    stack, part = [v], []
    seen.add(v.index)
    while stack:
        a = stack.pop()
        part.append(a)
        for e in a.link_edges:
            b = e.other_vert(a)
            if b.index not in seen:
                seen.add(b.index)
                stack.append(b)
    parts.append(part)
parts.sort(key=len, reverse=True)
main = parts[0]
lo = Vector((min(v.co.x for v in main), min(v.co.y for v in main), min(v.co.z for v in main)))
hi = Vector((max(v.co.x for v in main), max(v.co.y for v in main), max(v.co.z for v in main)))
pad = (hi - lo) * 0.04
drop = []
for p in parts[1:]:
    c = sum((v.co for v in p), Vector()) / len(p)
    inside = all(lo[i] - pad[i] <= c[i] <= hi[i] + pad[i] for i in range(3))
    if not inside:
        drop.extend(p)
print(f"PARTS {len(parts)} main={len(main)} dropped_verts={len(drop)}")
bmesh.ops.delete(bm, geom=list(set(drop)), context="VERTS")
bm.to_mesh(body.data)
bm.free()
# smooth shading: drop imported (sometimes hard-edged, faceted) normals
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
if body.data.has_custom_normals:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
bpy.ops.object.shade_smooth()

# ---- normalise: feet on the ground, centered, `HEIGHT` tall, facing -Y (glTF +Z) ----
def bounds(o):
    vs = [o.matrix_world @ v.co for v in o.data.vertices]
    return Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))), Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))

lo, hi = bounds(body)
s = HEIGHT / (hi.z - lo.z)
for v in body.data.vertices:
    v.co = Vector(((v.co.x - (lo.x + hi.x) / 2) * s, (v.co.y - (lo.y + hi.y) / 2) * s, (v.co.z - lo.z) * s))
body.data.update()

# ---- 2. no decimation here: Blender's collapse tears generated meshes. tools/build-cast.sh simplifies
# the exported GLB with meshoptimizer instead (vertex removal only: UVs and skin weights stay intact).
tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
print("TRIS", tris)

# ---- 3. landmarks ----
V = [v.co.copy() for v in body.data.vertices]
H = HEIGHT
maxx = max(v.x for v in V)
minx = min(v.x for v in V)
def mean(vs):
    return sum(vs, Vector()) / max(1, len(vs))
# paws: the outermost 6% of the width on each side
pawL = mean([v for v in V if v.x > maxx - 0.06 * (maxx - minx)])
pawR = mean([v for v in V if v.x < minx + 0.06 * (maxx - minx)])
# feet: lowest 6% of the height, split by side
feet = [v for v in V if v.z < 0.06 * H]
footL = mean([v for v in feet if v.x > 0])
footR = mean([v for v in feet if v.x < 0])
# body width at shoulder height (where the arms leave the torso): the narrowest torso slice above the paws
def half_width(z0, z1, xs_max):
    sl = [abs(v.x) for v in V if z0 <= v.z <= z1 and abs(v.x) < xs_max]
    return max(sl) if sl else 0.2 * H
paw_z = (pawL.z + pawR.z) / 2
sh_z = R["sh"] * H if R["sh"] else min(paw_z + 0.17 * H, 0.66 * H)
sh_x = half_width(sh_z - 0.02 * H, sh_z + 0.02 * H, (abs(pawL.x) + abs(pawR.x)) / 2 * 0.62) * 0.78
J = {
    "hips": Vector((0, 0, R["hip"] * H)),
    "body": Vector((0, 0, R["hip"] * H)),
    "head": Vector((0, 0, R["head"] * H)),
    "shoulderL": Vector((sh_x, (pawL.y + 0) / 2 * 0.4, sh_z)),
    "shoulderR": Vector((-sh_x, (pawR.y + 0) / 2 * 0.4, sh_z)),
    "legL": Vector((footL.x * 0.95, 0, R["leg"] * H)),
    "legR": Vector((footR.x * 0.95, 0, R["leg"] * H)),
    "kneeL": Vector((footL.x, footL.y * 0.3, R["knee"] * H)),
    "kneeR": Vector((footR.x, footR.y * 0.3, R["knee"] * H)),
}
J["elbowL"] = J["shoulderL"].lerp(pawL, 0.55)
J["elbowR"] = J["shoulderR"].lerp(pawR, 0.55)
back_y = max(v.y for v in V if abs(v.x) < 0.1 * H and (R["hip"] - 0.08) * H < v.z < R["hip"] * H)
J["tail0"] = Vector((0, back_y, (R["hip"] - 0.06) * H))
TAILS = {
    "hips": J["hips"] + Vector((0, 0, 0.08 * H)),
    "body": J["head"],
    "head": Vector((0, 0, H)),
    "shoulderL": J["elbowL"], "elbowL": pawL,
    "shoulderR": J["elbowR"], "elbowR": pawR,
    "legL": J["kneeL"], "kneeL": Vector((footL.x, footL.y, 0.02 * H)),
    "legR": J["kneeR"], "kneeR": Vector((footR.x, footR.y, 0.02 * H)),
    "tail0": J["tail0"] + Vector((0, 0.1 * H, 0)),
}
PARENT = {"body": "hips", "head": "body", "shoulderL": "body", "elbowL": "shoulderL", "shoulderR": "body", "elbowR": "shoulderR",
          "legL": "hips", "kneeL": "legL", "legR": "hips", "kneeR": "legR", "tail0": "body"}
for k, v in J.items():
    print("JOINT", k, tuple(round(c, 3) for c in v))

# ---- build the armature ----
arm_data = bpy.data.armatures.new("rig")
arm = bpy.data.objects.new("rig", arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
for name in J:
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = J[name], TAILS[name]
for name, par in PARENT.items():
    arm_data.edit_bones[name].parent = arm_data.edit_bones[par]
bpy.ops.object.mode_set(mode="OBJECT")
# the tail stump drives nothing (the game adds its own tail)
arm_data.bones["tail0"].use_deform = False

# ---- 4. bone-heat skinning ----
# heat diffusion is numerically fragile on small meshes: solve at 10x scale, then scale back
def rescale(k):
    for o in (body, arm):
        o.scale = (k, k, k)
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
body.data.validate()
rescale(10)
# Bone heat needs a clean, watertight surface. Generated meshes rarely are, so the heat weights are
# solved on a voxel-remeshed proxy and transferred to the real mesh (nearest face, interpolated).
proxy = body.copy()
proxy.data = body.data.copy()
proxy.name = "proxy"
bpy.context.scene.collection.objects.link(proxy)
rm = proxy.modifiers.new("remesh", "REMESH")
rm.mode = "VOXEL"
rm.voxel_size = H * 10 / 140
bpy.context.view_layer.objects.active = proxy
bpy.ops.object.select_all(action="DESELECT")
proxy.select_set(True)
bpy.ops.object.modifier_apply(modifier="remesh")
bpy.ops.object.select_all(action="DESELECT")
proxy.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
proxy_unweighted = sum(1 for v in proxy.data.vertices if not v.groups)
print("PROXY verts", len(proxy.data.vertices), "unweighted", proxy_unweighted)
for g in proxy.vertex_groups:
    body.vertex_groups.new(name=g.name)
dt = body.modifiers.new("dt", "DATA_TRANSFER")
dt.object = proxy
dt.use_vert_data = True
dt.data_types_verts = {"VGROUP_WEIGHTS"}
dt.vert_mapping = "POLYINTERP_NEAREST"
dt.layers_vgroup_select_src = "ALL"
dt.layers_vgroup_select_dst = "NAME"
bpy.context.view_layer.objects.active = body
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.ops.object.modifier_apply(modifier="dt")
bpy.data.objects.remove(proxy)
rescale(0.1)
am = body.modifiers.new("rig", "ARMATURE")
am.object = arm
body.parent = arm
unweighted = sum(1 for v in body.data.vertices if not v.groups)
print("SKIN groups", [g.name for g in body.vertex_groups], "unweighted_verts", unweighted)
if unweighted > 0.2 * len(body.data.vertices):
    # bone heat failed (non-manifold mesh): fall back to envelope-like distance weights
    print("FALLBACK distance weights")
    for g in list(body.vertex_groups):
        body.vertex_groups.remove(g)
    groups = {n: body.vertex_groups.new(name=n) for n in J if n != "tail0"}
    def seg_dist(p, a, b):
        ab = b - a
        t = max(0, min(1, (p - a).dot(ab) / ab.length_squared))
        return (a + ab * t - p).length
    for v in body.data.vertices:
        ds = {n: seg_dist(v.co, J[n], TAILS[n]) for n in groups}
        dmin = min(ds.values())
        ws = {n: math.exp(-(d - dmin) / (0.03 * H)) for n, d in ds.items()}
        top = sorted(ws.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(w for _, w in top)
        for n, w in top:
            groups[n].add([v.index], w / tot, "REPLACE")

# ---- 5. export ----
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
arm.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT, use_selection=True, export_format="GLB", export_skins=True, export_animations=False,
    export_image_format="JPEG", export_jpeg_quality=88, export_yup=True, export_apply=False,
)
print("EXPORTED", OUT)

# ---- optional posed preview (arms down, one leg forward, head turned) ----
if PREVIEW:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 640, 800
    scene.world = bpy.data.worlds.new("w")
    scene.world.color = (0.8, 0.8, 0.82)
    light = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    light.data.energy = 3.5
    light.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(light)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    center = Vector((0, 0, H / 2))
    for label, pose in [("rest", {}), ("posed", {"shoulderL": (0, 0, -0.9), "shoulderR": (0, 0, 0.9), "legL": (0.6, 0, 0), "head": (0, 0, 0.5), "elbowR": (1.2, 0, 0)})]:
        for pb in arm.pose.bones:
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = pose.get(pb.name, (0, 0, 0))
        for name, ang in [("front", 0), ("side", 90)]:
            a = math.radians(ang)
            cam.location = center + Vector((math.sin(a) * H * 2.4, -math.cos(a) * H * 2.4, 0.1 * H))
            cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = f"{PREVIEW}-{label}-{name}.png"
            bpy.ops.render.render(write_still=True)
