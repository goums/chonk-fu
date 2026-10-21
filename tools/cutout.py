"""Remove the studio background of a concept image with rembg (MIT, u2net / isnet models) -> RGBA PNG.

usage: python tools/cutout.py in.png out.png [--keep-frame]
--keep-frame keeps the original framing (no crop), for projection texturing; otherwise the subject is
centered on a square canvas with a 10% margin (what image-to-3D models like).
"""
import sys

from PIL import Image
from rembg import new_session, remove

keep = "--keep-frame" in sys.argv
src, dst = [a for a in sys.argv[1:] if not a.startswith("--")][:2]
im = Image.open(src).convert("RGB")
out = remove(im, session=new_session("isnet-general-use"), post_process_mask=True)
alpha = out.getchannel("A").point(lambda a: 255 if a > 128 else 0)
out.putalpha(alpha)
bbox = alpha.getbbox()
if keep:
    out.save(dst)
    print(dst, out.size, "bbox", bbox)
    sys.exit(0)
out = out.crop(bbox)
s = int(max(out.size) * 1.1)
canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
canvas.paste(out, ((s - out.width) // 2, (s - out.height) // 2))
canvas.save(dst)
print(dst, canvas.size)
