"""Image -> 3D with VAST's TripoSG (MIT) on its Hugging Face ZeroGPU Space: shape, then MV-Adapter texture.

usage: python tools/triposg.py art/concept/chonk-3.png name [faces]
Writes art/models/<name>.glb (textured) and art/models/<name>-shape.glb (untextured).
"""
import shutil
import sys
import time
from pathlib import Path

from gradio_client import Client, handle_file

src, name = Path(sys.argv[1]), sys.argv[2]
faces = int(sys.argv[3]) if len(sys.argv) > 3 else 60000
out_dir = Path(__file__).resolve().parent.parent / "art" / "models"
c = Client("VAST-AI/TripoSG", verbose=False)
t0 = time.time()
c.predict(api_name="/start_session")
seg = c.predict(handle_file(str(src)), api_name="/run_segmentation")
seg_path = seg if isinstance(seg, str) else seg["path"]
print("segmented", round(time.time() - t0), "s")
mesh = c.predict(handle_file(seg_path), 0, 50, 7.0, True, faces, api_name="/image_to_3d")
mesh_path = mesh if isinstance(mesh, str) else mesh.get("path", mesh)
shutil.copy(mesh_path, out_dir / f"{name}-shape.glb")
print("shape", round(time.time() - t0), "s")
tex = c.predict(handle_file(seg_path), mesh_path, 0, api_name="/run_texture")
tex_path = tex if isinstance(tex, str) else tex.get("path", tex)
shutil.copy(tex_path, out_dir / f"{name}.glb")
print("textured", out_dir / f"{name}.glb", round(time.time() - t0), "s")
