"""Concept art for the cast with Z-Image-Turbo (Apache-2.0) on its Hugging Face ZeroGPU Space.
Uses the HF token from `huggingface-cli login` (free accounts get a daily GPU quota).

usage: python tools/concept.py <character> [seed]
Images land in art/concept/<character>-<seed>.png. These front views feed image-to-3D (tools/to3d.py).
"""
import sys
from pathlib import Path

import shutil

from gradio_client import Client

STYLE = (
    "3D animated feature film character render, highly detailed realistic soft fur, subsurface lighting, "
    "full body, front view, character turnaround reference pose: standing straight in a wide A-pose, both arms stretched "
    "out diagonally down and away from the body at 45 degrees with a clear gap between arms and torso, paws open, legs apart, "
    "centered, whole body visible from head to feet, plain flat light grey background, soft even studio light, "
    "no shadows on the background, no text"
)
CAST = {
    "chonk": "a very chubby orange tabby cat kung fu master, huge round belly with cream white fur, bold darker orange tabby stripes "
    "on the back, head and arms, big amber eyes, small pink nose, white whiskers, fluffy cheeks, red leather collar with a "
    "small golden bell, dark purple kung fu shorts down to the knees with a golden sash knotted at the hip, bare furry feet, "
    "determined friendly smile",
    "tiger": "a tall muscular tiger kung fu villain, broad shoulders, orange fur with bold black stripes, white chest and muzzle, "
    "amber eyes, dark grey kung fu trousers, purple sash, spiked dark shoulder guards, menacing grin",
    "wolf": "a lean grey wolf bandit, long snout, pointy ears, light grey chest, worn brown leather vest, red bandana around the neck, "
    "brown baggy trousers, sneaky grin",
    "tortoise": "a very old wise tortoise kung fu master, green wrinkled skin, large dark green shell with hexagonal plates, "
    "long white beard, kind half-closed eyes, holding a wooden staff, small golden sash",
    "pig": "a round friendly pig villager, pink skin, small snout, green tunic with a rope belt, brown trousers, cheerful smile",
    "bunny": "a small bunny villager, cream fur, long upright ears with pink insides, orange tunic, purple trousers, big curious eyes",
    "duck": "a plump white goose noodle chef, orange beak and feet, white chef hat, blue apron over a white shirt, cheerful",
}

def main():
    who = sys.argv[1]
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    prompt = f"{CAST[who]}. {STYLE}"
    client = Client("Tongyi-MAI/Z-Image-Turbo", verbose=False)
    gallery, _, _ = client.predict(prompt, "864x1152 ( 3:4 )", seed, 8, 3.0, False, [], api_name="/generate")
    out = Path(__file__).resolve().parent.parent / "art" / "concept" / f"{who}-{seed}.png"
    src = gallery[0]["image"]
    shutil.copy(src if isinstance(src, str) else src["path"], out)
    print(out)


if __name__ == "__main__":
    main()
