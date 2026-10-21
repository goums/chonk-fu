"""Image (+ optional turnaround views) -> textured 3D with Tencent Hunyuan3D-2.1 on its HF Space.
Note: the Hunyuan3D-2.1 community license excludes the EU, UK and South Korea (private experiments only).

usage: python tools/hunyuan.py art/cutout/chonk.png name [views_prefix]
"""
import shutil
import sys
import time
from pathlib import Path

from gradio_client import Client, handle_file

src, name = sys.argv[1], sys.argv[2]
views = sys.argv[3] if len(sys.argv) > 3 else None
mv = [handle_file(f"{views}-{v}.png") if views else None for v in ("front", "back", "left", "right")]
c = Client("tencent/Hunyuan3D-2.1", verbose=False)
t0 = time.time()
res = c.predict(handle_file(src), *mv, 30, 5.0, 1234, 384, True, 8000, False, api_name="/generation_all")
print("generated", round(time.time() - t0), "s", [str(r)[:120] for r in res])
out = Path(__file__).resolve().parent.parent / "art" / "models"
paths = [r if isinstance(r, str) else (r or {}).get("value") or (r or {}).get("path") for r in res[:2]]
for i, p in enumerate(paths):
    if p and Path(p).exists():
        dst = out / f"{name}{'-shape' if i == 0 else ''}{Path(p).suffix}"
        shutil.copy(p, dst)
        print(dst)
