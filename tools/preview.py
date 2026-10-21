"""Render front / side / back previews of a GLB with Blender (headless).

usage: blender -b -P tools/preview.py -- art/models/chonk.glb out_prefix
"""
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
tris = 0
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
center, size = (lo + hi) / 2, hi - lo
print("BOUNDS", tuple(round(v, 3) for v in lo), tuple(round(v, 3) for v in hi), "tris", tris, "meshes", len(meshes))
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
d = max(size) * 2.4
for name, ang in [("front", 0), ("side", 90), ("back", 180)]:
    a = math.radians(ang)
    # glTF +Z (front) becomes Blender -Y
    cam.location = center + Vector((math.sin(a) * d, -math.cos(a) * d, size.z * 0.1))
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = f"{out}-{name}.png"
    bpy.ops.render.render(write_still=True)
