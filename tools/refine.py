"""Refine an AI-generated character mesh with its turnaround views, headless in Blender.

usage: blender -b -P tools/refine.py -- base.glb views_prefix out.glb [height=1.8] [faces=40000] [smooth=8] [voxel=220] [fit=1]

views_prefix: RGBA cutouts <prefix>-front.png, -back.png, -left.png, -right.png (tools/cutout.py --keep-frame)

1. geometry: weld, drop floating fragments, voxel remesh (watertight), smooth the lumps, decimate
2. UV unwrap (smart project)
3. texture: project the four views orthographically onto the surface; each view only paints where the
   surface faces it and is not hidden (ray-cast visibility); blend and bake into one texture with Cycles
4. export a GLB, ready for tools/rig.py
"""
import math
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
BASE, VIEWS, OUT = argv[0], argv[1], argv[2]
H = float(argv[3]) if len(argv) > 3 else 1.8
FACES = int(argv[4]) if len(argv) > 4 else 40000
SMOOTH = int(argv[5]) if len(argv) > 5 else 8
VOXEL = float(argv[6]) if len(argv) > 6 else 220
FIT = float(argv[7]) if len(argv) > 7 else 1.0
TEX = 2048

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=BASE)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
obj.name = "skin"
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def sel(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o

# ---- 1. geometry ----
bm = bmesh.new()
bm.from_mesh(obj.data)
size = max(obj.dimensions)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=size * 1e-4)
bm.verts.ensure_lookup_table()
# keep the main connected part and small parts inside its bounds
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
lo = Vector([min(v.co[i] for v in main) for i in range(3)])
hi = Vector([max(v.co[i] for v in main) for i in range(3)])
pad = (hi - lo) * 0.04
drop = [v for p in parts[1:] for v in p
        if not all(lo[i] - pad[i] <= (sum((w.co for w in p), Vector()) / len(p))[i] <= hi[i] + pad[i] for i in range(3))]
bmesh.ops.delete(bm, geom=list(set(drop)), context="VERTS")
bm.to_mesh(obj.data)
bm.free()
# normalise: feet at 0, centered, H tall
vs = [v.co for v in obj.data.vertices]
lo = Vector([min(v[i] for v in vs) for i in range(3)])
hi = Vector([max(v[i] for v in vs) for i in range(3)])
s = H / (hi.z - lo.z)
for v in obj.data.vertices:
    v.co = Vector(((v.co.x - (lo.x + hi.x) / 2) * s, (v.co.y - (lo.y + hi.y) / 2) * s, (v.co.z - lo.z) * s))
# ---- silhouette fit: warp the mesh so its outline matches the concept (front) and the side view ----
def alpha_of(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[:, :, 3] > 0.5  # rows bottom-up
    rows = np.where(a.any(axis=1))[0]
    y0, y1 = rows.min(), rows.max()
    scale = (y1 - y0) / H
    head = a[int(y1 - 0.18 * (y1 - y0)):y1 + 1]
    cx = float(np.where(head.any(axis=0))[0].mean())
    return a, y0, scale, cx

def extents(a, y0, scale, cx, z):
    """outline distances (m) left / right of the head axis at height z, or None"""
    r = int(round(y0 + z * scale))
    if r < 0 or r >= a.shape[0]:
        return None
    cols = np.where(a[r])[0]
    if len(cols) == 0:
        return None
    return (cx - cols.min()) / scale, (cols.max() - cx) / scale

def smooth(x, k=5):
    ker = np.exp(-0.5 * (np.arange(-2 * k, 2 * k + 1) / k) ** 2)
    ker /= ker.sum()
    pad = np.pad(x, 2 * k, mode="edge")
    return np.convolve(pad, ker, mode="same")[2 * k:-2 * k]

if FIT > 0:
    V0 = np.array([v.co[:] for v in obj.data.vertices])
    top = V0[V0[:, 2] > 0.82 * H]
    hx, hy = top[:, 0].mean(), top[:, 1].mean()
    bins = np.linspace(0, H, 181)
    fa = alpha_of(f"{VIEWS}-front.png")
    sa = alpha_of(f"{VIEWS}-left.png")
    rx, rf, rb = np.ones(180), np.ones(180), np.ones(180)
    for i in range(180):
        z0, z1 = bins[i], bins[i + 1]
        band = V0[(V0[:, 2] >= z0) & (V0[:, 2] < z1)]
        if len(band) < 3:
            continue
        zc = (z0 + z1) / 2
        e = extents(*fa, zc)
        if e:
            # the front concept may show the tail on one side: trust the narrower side (symmetric body)
            img_half = min(e)
            mesh_half = min(hx - band[:, 0].min(), band[:, 0].max() - hx)
            if mesh_half > 0.02:
                rx[i] = img_half / mesh_half
        e = extents(*sa, zc)
        if e:
            # left view: image-left is the character's front (-Y)
            front_img, back_img = e
            front_mesh, back_mesh = hy - band[:, 1].min(), band[:, 1].max() - hy
            if front_mesh > 0.02:
                rf[i] = front_img / front_mesh
            if back_mesh > 0.02:
                rb[i] = back_img / back_mesh
    rx, rf, rb = [smooth(np.clip(r, 0.82, 1.22)) for r in (rx, rf, rb)]
    rx, rf, rb = [1 + (r - 1) * FIT for r in (rx, rf, rb)]
    zi = np.clip((V0[:, 2] / H * 180).astype(int), 0, 179)
    for k, v in enumerate(obj.data.vertices):
        i = zi[k]
        x = hx + (v.co.x - hx) * rx[i]
        dy = v.co.y - hy
        y = hy + dy * (rf[i] if dy < 0 else rb[i])
        v.co = Vector((x, y, v.co.z))
    print("FIT x", np.round(rx[::20], 2).tolist())
    print("FIT front", np.round(rf[::20], 2).tolist())
    print("FIT back", np.round(rb[::20], 2).tolist())

# drop the old UVs / materials: the texture is re-baked from the views
obj.data.materials.clear()
while obj.data.uv_layers:
    obj.data.uv_layers.remove(obj.data.uv_layers[0])
sel(obj)
rm = obj.modifiers.new("remesh", "REMESH")
rm.mode = "VOXEL"
rm.voxel_size = H / VOXEL
bpy.ops.object.modifier_apply(modifier="remesh")
if SMOOTH:
    sm = obj.modifiers.new("smooth", "LAPLACIANSMOOTH")
    sm.iterations = SMOOTH
    sm.lambda_factor = 0.6
    sm.use_volume_preserve = True
    bpy.ops.object.modifier_apply(modifier="smooth")
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
if tris > FACES:
    dec = obj.modifiers.new("dec", "DECIMATE")
    dec.ratio = FACES / tris
    bpy.ops.object.modifier_apply(modifier="dec")
bpy.ops.object.shade_smooth()
print("GEOMETRY tris", sum(len(p.vertices) - 2 for p in obj.data.polygons))

# ---- 2. UVs ----
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")
obj.data.uv_layers[0].name = "bake"

# ---- 3. projection setup ----
V = np.array([v.co[:] for v in obj.data.vertices])
top = V[V[:, 2] > 0.82 * H]
head_x, head_y = float(top[:, 0].mean()), float(top[:, 1].mean())
# view name -> (direction from the surface toward the camera, image-x axis in world, horizontal head coordinate)
VIEWS_DEF = {
    "front": (Vector((0, -1, 0)), Vector((1, 0, 0))),
    "back": (Vector((0, 1, 0)), Vector((-1, 0, 0))),
    "left": (Vector((1, 0, 0)), Vector((0, 1, 0))),
    "right": (Vector((-1, 0, 0)), Vector((0, -1, 0))),
}
bvh = BVHTree.FromObject(obj, bpy.context.evaluated_depsgraph_get())
mat = bpy.data.materials.new("projected")
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
N = nt.nodes
L = nt.links
geo = N.new("ShaderNodeNewGeometry")
num_c = None
num_w = None
vis_layers = {}
for name, (d, ax) in VIEWS_DEF.items():
    img = bpy.data.images.load(f"{VIEWS}-{name}.png")
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[:, :, 3]  # rows bottom-up
    rows = np.where(a.max(axis=1) > 0.5)[0]
    y0, y1 = rows.min(), rows.max()  # feet row .. top row (bottom-up)
    scale = (y1 - y0) / H  # pixels per meter
    head_rows = a[int(y1 - 0.18 * (y1 - y0)):y1 + 1]
    cols = np.where(head_rows.max(axis=0) > 0.5)[0]
    cx = float(cols.mean())
    hcoord = head_x * ax.x + head_y * ax.y
    uvl = obj.data.uv_layers.new(name=f"p_{name}")
    for poly in obj.data.polygons:
        for li in poly.loop_indices:
            co = obj.data.vertices[obj.data.loops[li].vertex_index].co
            px = cx + ((co.x * ax.x + co.y * ax.y) - hcoord) * scale
            py = y0 + co.z * scale
            uvl.data[li].uv = (px / w, py / h)
    # visibility: is the vertex the first hit when looking from that camera?
    vis = obj.data.color_attributes.new(name=f"vis_{name}", type="FLOAT_COLOR", domain="POINT")
    for i, v in enumerate(obj.data.vertices):
        o = v.co + d * 5.0
        hit = bvh.ray_cast(o, -d, 10.0)
        seen_it = hit[0] is not None and (hit[0] - v.co).length < H * 0.012
        vis.data[i].color = (1.0 if seen_it else 0.0, 0, 0, 1)
    # nodes: colour, alpha, facing weight
    uvn = N.new("ShaderNodeUVMap"); uvn.uv_map = f"p_{name}"
    tex = N.new("ShaderNodeTexImage"); tex.image = img; tex.extension = "CLIP"; tex.interpolation = "Cubic"
    L.new(uvn.outputs["UV"], tex.inputs["Vector"])
    dot = N.new("ShaderNodeVectorMath"); dot.operation = "DOT_PRODUCT"; dot.inputs[1].default_value = d
    L.new(geo.outputs["Normal"], dot.inputs[0])
    face = N.new("ShaderNodeMath"); face.operation = "MAXIMUM"; face.inputs[1].default_value = 0.0
    L.new(dot.outputs["Value"], face.inputs[0])
    pw = N.new("ShaderNodeMath"); pw.operation = "POWER"; pw.inputs[1].default_value = 3.0
    L.new(face.outputs[0], pw.inputs[0])
    va = N.new("ShaderNodeVertexColor"); va.layer_name = f"vis_{name}"
    sep = N.new("ShaderNodeSeparateColor")
    L.new(va.outputs["Color"], sep.inputs["Color"])
    m1 = N.new("ShaderNodeMath"); m1.operation = "MULTIPLY"
    L.new(pw.outputs[0], m1.inputs[0]); L.new(sep.outputs[0], m1.inputs[1])
    wgt = N.new("ShaderNodeMath"); wgt.operation = "MULTIPLY"
    L.new(m1.outputs[0], wgt.inputs[0]); L.new(tex.outputs["Alpha"], wgt.inputs[1])
    # small unmasked fallback so every texel gets some colour
    fb = N.new("ShaderNodeMath"); fb.operation = "MULTIPLY_ADD"; fb.inputs[1].default_value = 0.02
    L.new(face.outputs[0], fb.inputs[0]); L.new(wgt.outputs[0], fb.inputs[2])
    cw = N.new("ShaderNodeVectorMath"); cw.operation = "SCALE"
    L.new(tex.outputs["Color"], cw.inputs[0]); L.new(fb.outputs[0], cw.inputs["Scale"])
    if num_c is None:
        num_c, num_w = cw.outputs[0], fb.outputs[0]
    else:
        ac = N.new("ShaderNodeVectorMath"); ac.operation = "ADD"
        L.new(num_c, ac.inputs[0]); L.new(cw.outputs[0], ac.inputs[1]); num_c = ac.outputs[0]
        aw = N.new("ShaderNodeMath"); aw.operation = "ADD"
        L.new(num_w, aw.inputs[0]); L.new(fb.outputs[0], aw.inputs[1]); num_w = aw.outputs[0]
    print("VIEW", name, "px/m", round(scale, 1), "head col", round(cx, 1))
eps = N.new("ShaderNodeMath"); eps.operation = "MAXIMUM"; eps.inputs[1].default_value = 1e-4
L.new(num_w, eps.inputs[0])
inv = N.new("ShaderNodeMath"); inv.operation = "DIVIDE"; inv.inputs[0].default_value = 1.0
L.new(eps.outputs[0], inv.inputs[1])
col = N.new("ShaderNodeVectorMath"); col.operation = "SCALE"
L.new(num_c, col.inputs[0]); L.new(inv.outputs[0], col.inputs["Scale"])
emit = N.new("ShaderNodeEmission")
L.new(col.outputs[0], emit.inputs["Color"])
out = N.new("ShaderNodeOutputMaterial")
L.new(emit.outputs[0], out.inputs["Surface"])
# bake target
target = bpy.data.images.new("baked", TEX, TEX)
tnode = N.new("ShaderNodeTexImage"); tnode.image = target
uvb = N.new("ShaderNodeUVMap"); uvb.uv_map = "bake"
L.new(uvb.outputs["UV"], tnode.inputs["Vector"])
N.active = tnode
obj.data.materials.append(mat)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 1
obj.data.uv_layers.active = obj.data.uv_layers["bake"]
sel(obj)
bpy.ops.object.bake(type="EMIT", margin=8, use_clear=True)
target.filepath_raw = OUT.replace(".glb", "-albedo.png")
target.file_format = "PNG"
target.save()
print("BAKED", target.filepath_raw)

# ---- 4. final material + export ----
for name in list(VIEWS_DEF):
    obj.data.uv_layers.remove(obj.data.uv_layers[f"p_{name}"])
    obj.data.color_attributes.remove(obj.data.color_attributes[f"vis_{name}"])
final = bpy.data.materials.new("fur")
final.use_nodes = True
bsdf = final.node_tree.nodes["Principled BSDF"]
t = final.node_tree.nodes.new("ShaderNodeTexImage")
t.image = target
final.node_tree.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.8
obj.data.materials.clear()
obj.data.materials.append(final)
sel(obj)
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=90)
print("EXPORTED", OUT)
