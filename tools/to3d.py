"""Image -> textured 3D mesh with Microsoft TRELLIS.2 (MIT) on its Hugging Face ZeroGPU Space.

usage: python tools/to3d.py art/concept/chonk-1.png [name] [faces] [resolution]
The GLB lands in art/models/<name>.glb (PBR textures baked in). Rigging is done by tools/rig.py in Blender.
"""
import shutil
import sys
import time
from pathlib import Path

from gradio_client import Client, handle_file

def main():
    src = Path(sys.argv[1])
    name = sys.argv[2] if len(sys.argv) > 2 else src.stem
    faces = int(sys.argv[3]) if len(sys.argv) > 3 else 100000  # Space minimum; decimated later in Blender
    res = sys.argv[4] if len(sys.argv) > 4 else "1024"
    c = Client("microsoft/TRELLIS.2", verbose=False)
    t0 = time.time()
    c.predict(api_name="/start_session")
    pre = c.predict(handle_file(str(src)), api_name="/preprocess_image")
    print("preprocessed", round(time.time() - t0), "s")
    c.predict(handle_file(pre if isinstance(pre, str) else pre["path"]), 1, res, api_name="/image_to_3d")
    print("generated", round(time.time() - t0), "s")
    glb, _ = c.predict(faces, 2048, api_name="/extract_glb")
    out = Path(__file__).resolve().parent.parent / "art" / "models" / f"{name}.glb"
    shutil.copy(glb, out)
    print(out, out.stat().st_size // 1024, "KB", round(time.time() - t0), "s")

if __name__ == "__main__":
    main()
