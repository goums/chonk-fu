"""Turnaround views of a concept (back, left, right) with an image-editing model on OpenRouter.

usage: python tools/views.py art/concept/chonk-3.png chonk [model]
Writes art/views/<name>-{back,left,right}.png. Needs OPEN_ROUTER_API_KEY in .env.
"""
import base64
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
for line in (ROOT / ".env").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

src, name = Path(sys.argv[1]), sys.argv[2]
model = sys.argv[3] if len(sys.argv) > 3 else "google/gemini-3-pro-image"
views = sys.argv[4].split(",") if len(sys.argv) > 4 else ["back", "left", "right"]
# "notail": the game animates its own tail, so the texture views must not show one
notail = "--notail" in sys.argv
img64 = base64.b64encode(src.read_bytes()).decode()
DESC = {
    "back": "seen exactly from behind (a 180 degree turn): we see the back of the head, the back and the tail",
    "left": "seen exactly from its left side (a 90 degree turn, profile view facing the left edge of the image)",
    "right": "seen exactly from its right side (a 90 degree turn, profile view facing the right edge of the image)",
}
out_dir = ROOT / "art" / "views"
out_dir.mkdir(parents=True, exist_ok=True)
total = 0.0
for v in views:
    prompt = (
        f"Character turnaround sheet. Show this exact same character {DESC[v]}. Keep everything identical: same design, "
        "proportions, colors, fur pattern, clothes and the same A-pose with arms out, same size and vertical position in the frame, "
        "full body from head to feet, orthographic camera, the same plain light grey background and soft even studio light. "
        "Only one character, no text."
    )
    if notail:
        prompt += " IMPORTANT: this character has NO tail: draw it without any tail, the pants and back fully visible."
    body = {
        "model": model,
        "modalities": ["image", "text"],
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img64}"}},
        ]}],
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions", data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {os.environ['OPEN_ROUTER_API_KEY']}", "Content-Type": "application/json"},
    )
    res = json.load(urllib.request.urlopen(req, timeout=300))
    msg = res["choices"][0]["message"]
    imgs = msg.get("images") or []
    if not imgs:
        print(v, "no image:", str(msg.get("content"))[:200])
        continue
    url = imgs[0]["image_url"]["url"]
    data = base64.b64decode(url.split(",", 1)[1])
    out = out_dir / f"{name}-{v}{'-notail' if notail else ''}.png"
    out.write_bytes(data)
    cost = res.get("usage", {}).get("cost")
    total += cost or 0
    print(out, "cost", cost)
print("total cost", round(total, 4))
