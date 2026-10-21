#!/usr/bin/env bash
# Rebuild the rigged cast (public/models/*.glb) from the raw TRELLIS.2 meshes in art/models/.
# usage: tools/build-cast.sh [name...]
#   raw meshes: python tools/to3d.py art/concept/<concept>.png <name> 100000 1536
set -euo pipefail
cd "$(dirname "$0")/.."
# name  height  faces  proportions (fractions of the height, see tools/rig.py)  [source mesh]
CAST=(
  "chonk    1.8  30000 hip=0.36,head=0.68,leg=0.27,knee=0.13 art/models/chonk-hy.glb"
  "chonk-tripo 1.8 30000 hip=0.36,head=0.68,leg=0.27,knee=0.13 art/models/tripo-2-5-chonk.glb"
  "chonk-meshy 1.8 30000 hip=0.36,head=0.68,leg=0.27,knee=0.13 art/models/meshy-6-1-chonk.glb"
  "chonk-open  1.8 30000 hip=0.36,head=0.68,leg=0.27,knee=0.13 art/models/chonk-a.glb"
  "chonk-hunyuan 1.8 30000 hip=0.36,head=0.68,leg=0.27,knee=0.13 art/models/chonk-hy.glb"
  "tiger    2.3  30000 hip=0.46,head=0.79,leg=0.43,knee=0.22,sh=0.71 art/models/tiger-hy.glb"
  "wolf     1.95 26000 hip=0.46,head=0.74,leg=0.43,knee=0.22,sh=0.66 art/models/wolf-hy.glb"
  "tortoise 1.75 26000 hip=0.24,head=0.55,leg=0.2,knee=0.1,sh=0.45 art/models/tortoise-hy.glb"
  "duck     1.6  22000 hip=0.24,head=0.55,leg=0.2,knee=0.1,sh=0.45 art/models/duck-hy.glb"
  "pig      1.45 22000 hip=0.3,head=0.62,leg=0.25,knee=0.12,sh=0.5 art/models/pig-hy.glb"
  "bunny    1.5  22000 hip=0.25,head=0.55,leg=0.21,knee=0.1,sh=0.44 art/models/bunny-hy.glb"
)
mkdir -p public/models
for row in "${CAST[@]}"; do
  read -r name height faces props explicit <<<"$row"
  if [ $# -gt 0 ] && [[ ! " $* " =~ " $name " ]]; then continue; fi
  [ -n "${explicit:-}" ] || [ -f "art/models/$name.glb" ] || [ -f "art/refined/$name.glb" ] || { echo "skip $name (no source mesh)"; continue; }
  src="art/models/$name.glb"
  # refined meshes (tools/refine.py) win over raw generator output
  [ -f "art/refined/$name.glb" ] && src="art/refined/$name.glb"
  [ "$name" = chonk ] && [ ! -f "$src" ] && src="art/models/chonk-a.glb"
  [ -n "${explicit:-}" ] && src="$explicit"
  tmp="$(mktemp -d)"
  blender -b -P tools/rig.py -- "$src" "$tmp/rigged.glb" "$height" "$faces" "${PREVIEW:--}${PREVIEW:+/$name}" "$props" 2>&1 | grep -E "PARTS|SKIN|EXPORTED"
  # meshoptimizer simplification to ~$faces triangles, then 1024 px textures
  tris=$(python3 -c "import json,struct;b=open('$tmp/rigged.glb','rb').read();n=struct.unpack('<I',b[12:16])[0];j=json.loads(b[20:20+n]);print(sum(j['accessors'][p['indices']]['count']//3 for m in j['meshes'] for p in m['primitives']))")
  ratio=$(python3 -c "print(min(1, $faces / $tris))")
  npx gltf-transform weld "$tmp/rigged.glb" "$tmp/welded.glb" >/dev/null
  npx gltf-transform simplify "$tmp/welded.glb" "$tmp/simple.glb" --ratio "$ratio" --error 0.01 >/dev/null
  npx gltf-transform resize "$tmp/simple.glb" "public/models/$name.glb" --width 1024 --height 1024 >/dev/null
  echo "$name: $tris -> ~$faces tris, $(du -h "public/models/$name.glb" | cut -f1)"
  rm -rf "$tmp"
done
