# Contact sheet of retargeted poses dumped by tools/retarget-test.mjs: one row per clip, 4 time samples,
# each as a front view (character faces the camera, its left = screen right) and a side view (facing
# screen right). Grey = skinned mesh points, red = left limbs, blue = right limbs, green = source
# skeleton (scaled to the rig's hip height, drawn beside the rig).
#   python tools/retarget-plot.py poses.json out.png
import json, sys
from PIL import Image, ImageDraw

data = json.load(open(sys.argv[1]))
out = sys.argv[2]
P = 230  # panel size (px)
S = 120  # px per metre (shrunk for tall rigs below)
COLS = 8
rows = data['clips']
rest = rows[0]['poses'][0]['pts']
S = min(S, (P - 40) / max(rest[1::3]))
img = Image.new('RGB', (COLS * P + 140, len(rows) * P + 30), 'white')
d = ImageDraw.Draw(img)

LIMBS = [('shoulderL', 'elbowL', 'pawL', (220, 40, 40)), ('shoulderR', 'elbowR', 'pawR', (40, 80, 230)),
         ('legL', 'kneeL', 'footL', (220, 40, 40)), ('legR', 'kneeR', 'footR', (40, 80, 230))]
SPINE = [('hips', 'body'), ('body', 'head'), ('body', 'shoulderL'), ('body', 'shoulderR'), ('hips', 'legL'), ('hips', 'legR')]

PTCOL = {'shoulderL': (240, 170, 170), 'elbowL': (250, 130, 110), 'shoulderR': (170, 180, 240), 'elbowR': (120, 150, 250),
         'legL': (240, 190, 150), 'kneeL': (240, 160, 90), 'legR': (150, 210, 230), 'kneeR': (90, 190, 220), 'head': (200, 200, 140)}
for c in range(COLS):
    u = [0, 0.25, 0.5, 0.75][c // 2]
    d.text((140 + c * P + 4, 4), f"t={u:.2f} {'front' if c % 2 == 0 else 'side'}", fill='black')

for r, clip in enumerate(rows):
    y0 = 30 + r * P
    d.text((4, y0 + P // 2 - 10), f"{clip['name']}\n{clip['duration']:.2f}s", fill='black')
    for k, pose in enumerate(clip['poses']):
        for view in (0, 1):
            x0 = 140 + (k * 2 + view) * P
            d.rectangle([x0, y0, x0 + P - 1, y0 + P - 1], outline=(200, 200, 200))
            gx, gy = x0 + P * 0.38, y0 + P - 14  # ground point under the rig

            def proj(p, off=0.0):
                h = p[0] if view == 0 else p[2]
                return (gx + (h + off) * S, gy - p[1] * S)
            d.line([x0, gy, x0 + P, gy], fill=(180, 160, 120))
            pts = pose['pts']
            for i in range(0, len(pts), 3):
                x, y = proj(pts[i:i + 3])
                b = data['boneOf'][i // 3]
                d.point((x, y), fill=PTCOL.get(b, (185, 185, 185)))
            J = pose['J']
            for a, b in SPINE:
                d.line([proj(J[a]), proj(J[b])], fill='black', width=2)
            for a, b, e, col in LIMBS:
                d.line([proj(J[a]), proj(J[b]), proj(J[e])], fill=col, width=3)
                x, y = proj(J[e]); d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=col)
            x, y = proj(J['head']); d.ellipse([x - 4, y - 4, x + 4, y + 4], outline='black')
            # source skeleton, to the right
            Sk = pose['S']
            for a, b in pose['srcLines']:
                col = (220, 120, 120) if a.endswith('_l') or b.endswith('_l') else (120, 140, 230) if a.endswith('_r') or b.endswith('_r') else (40, 160, 60)
                d.line([proj(Sk[a], 0.78), proj(Sk[b], 0.78)], fill=col, width=1)
            x, y = proj(Sk['head'], 0.78); d.ellipse([x - 3, y - 3, x + 3, y + 3], outline=(40, 160, 60))
img.save(out)
print(out, img.size)
