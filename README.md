# CHONK FU

A 3D open-world kung fu adventure in the browser. You play Le Chonk, a chubby orange cat, in a Chinese valley.
Explore, smash things, find the five Jade Stones, eat the Dragon Noodles and beat Overfit the tiger.

```bash
npm install
npm run dev
```

Keys: arrows / WASD move, Shift sprint, J punch (J J J combo), K belly jump, Space jump (Space then J: ground slam), Enter talk, M mute. Drag the mouse to turn the camera.

## Mistral plays

Open the game with `?agent` (for example `http://localhost:5173/?agent`). A panel lets Mistral play, and replays recorded runs.

- **High-level actions.** Each turn the model calls one tool, `act`, with one action: `go`, `talk`, `hit`, `fight`, `sprint` or `wait`, and a target id. The harness does the rest: A* paths on a 1 m grid, facing, punch combos, belly jump timing, reading dialogs.
- **Short text observations.** About 300 tokens per turn: health, bag, quest lines with target ids and distances, things nearby, the last 6 actions and their results, what people said. No images.
- **The world waits** while the model thinks.
- **Replays are exact.** The simulation and the skills are deterministic, so a replay re-runs the recorded actions and gets the same game. Recorded runs live in `public/runs/`.
- **Stats** at the end of a run: completion, game time, turns, tokens, cost, knock-outs, jade stones, distance and when each quest step was reached.

In `npm run dev` the Vite proxy adds the key from `.env` (`MISTRAL_STUDIO_API_KEY`). On a static build, paste a key in the panel. It stays in the browser.

Headless run, saved for replay:

```bash
npm run play -- --model mistral-large-4 --max-cost 0.5
```

`--model script` runs a scripted player with the same actions (no API calls). `--replay <file>` re-runs a recorded game and checks it matches.

### Results

Mistral Large 4, no reasoning, 3 runs:

| Run | Completed | Game time | Turns | Tokens in / out | Cost |
|---|---|---|---|---|---|
| 1 | yes | 6:33 | 55 | 56k / 12k | $0.049 |
| 2 | yes | 5:26 | 49 | 51k / 10k | $0.043 |
| 3 | yes | 5:06 | 44 | 45k / 10k | $0.039 |

About 5 s per turn. The model skips the optional Training Arena and goes straight for the main quest.
Most wasted turns are `wait`, or `hit` on something that is not an object (the Oracle, a jade stone on the ground).

## Stack

three.js, TypeScript, Vite. Characters: Hunyuan3D-2.1 (image to 3D), rigged in Blender, animated with Quaternius / Mesh2Motion CC0 mocap. See [CREDITS.md](CREDITS.md).
