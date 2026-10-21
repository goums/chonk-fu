// The map of the Valley: every landmark lives here so the terrain, the decor, the quests and the
// agent observation all agree. x = east, z = south (north is -z). 1 unit = 1 meter.

export const WORLD_SIZE = 560; // square, centered on the origin
export const WATER_LEVEL = 0.6;
export const GROUND = 2; // height of the valley floor

export const VILLAGE = { x: 0, z: 30, r: 62 };
/** the Palace of the Chonk sits on a flat-topped mountain north of the village */
export const PALACE_MOUNT = { x: 0, z: -165, r: 82, h: 58, plateau: 26 };
/** the Thousand Steps: a straight stairway from the village up to the palace plateau */
export const STAIRS = { x: 0, z0: -42, z1: -165 + 26, halfWidth: 4 };
export const PEACH_HILL = { x: -125, z: 10, r: 46, h: 15 };
export const ARENA = { x: 0, z: 150, r: 26 };
export const BAMBOO_FOREST = { x0: 95, x1: 205, z0: -90, z1: 110 };
export const POND = { x: -70, z: 105, r: 18 };

/** the river meanders north to south, east of the village */
export const riverX = (z: number) => 72 + 16 * Math.sin(z * 0.022) + 6 * Math.sin(z * 0.061 + 1.3);
export const RIVER_HALF_WIDTH = 7;

/** slope of the river course, d riverX / dz */
export const riverSlope = (z: number) => 16 * 0.022 * Math.cos(z * 0.022) + 6 * 0.061 * Math.cos(z * 0.061 + 1.3);

/**
 * An arched footbridge laid square across the river. Local axis s runs along the deck (unit vector
 * (ux, uz), toward the east bank), l across it; the deck spans s0..s1 with its ends (y0, y1) resting on
 * dry ground. ry is the Batch/Object3D yaw that maps local +x onto the deck axis. The span is measured
 * on the terrain by measureBridges() before the heightfield is baked.
 */
export interface Bridge { x: number; z: number; ux: number; uz: number; ry: number; s0: number; s1: number; y0: number; y1: number; arch: number; w: number }

/**
 * bridges cross the river where paths do (x, z = the middle of the stream). Each sits where both banks are
 * firm: north of the village the east bank is a flooded flat from z = -140 to -80, so the north bridge
 * crosses at z = -56.
 */
export const BRIDGES: Bridge[] = [30, -56, 160].map((z) => {
  const k = riverSlope(z), n = Math.hypot(1, k);
  const ux = 1 / n, uz = -k / n; // perpendicular to the river's tangent (k, 1)
  return { x: riverX(z), z, ux, uz, ry: Math.atan2(-uz, ux), s0: -14, s1: 14, y0: GROUND, y1: GROUND, arch: 2.2, w: 3.6 };
});

/** world -> bridge-local (s along the deck, l across it) */
export const bridgeLocal = (b: Bridge, x: number, z: number) => {
  const dx = x - b.x, dz = z - b.z;
  return { s: dx * b.ux + dz * b.uz, l: -dx * b.uz + dz * b.ux };
};
/** a point on the bridge axis, `s` meters from the middle of the stream */
export const bridgePoint = (b: Bridge, s: number): [number, number] => [b.x + b.ux * s, b.z + b.uz * s];
/** flat stone landing beyond each deck end, level with it (walkable, part of the bridge) */
export const BRIDGE_LANDING = 1.8;
/** deck walking height at local s (a gentle arch between the two bank heights; flat on the landings) */
export const bridgeDeckY = (b: Bridge, s: number) => {
  const t = Math.min(1, Math.max(0, (s - b.s0) / (b.s1 - b.s0)));
  return b.y0 + (b.y1 - b.y0) * t + b.arch * 4 * t * (1 - t);
};

/** dirt paths (polylines); filled by measureBridges, since their ends meet the bridge landings */
export const PATHS: [number, number][][] = [];

/**
 * Size every bridge on the real (pre-path) terrain: walk out from the stream along the deck axis until
 * the ground is well above the water on each bank, then add a landing so the deck ends on dry land.
 * Then lay out the paths so they meet the bridge ends.
 */
export function measureBridges(height: (x: number, z: number) => number) {
  const LANDING = 2.5;
  for (const b of BRIDGES) {
    for (const side of [-1, 1]) {
      let s = 0;
      // the bank is where the ground clears the water by a margin across the whole deck width
      const dry = (s: number) => {
        for (const l of [-b.w / 2, 0, b.w / 2]) {
          const x = b.x + b.ux * s * side - b.uz * l, z = b.z + b.uz * s * side + b.ux * l;
          if (height(x, z) < WATER_LEVEL + 0.7) return false;
        }
        return true;
      };
      while (s < 40 && !dry(s)) s += 0.25;
      const end = s + LANDING;
      // the deck end rests on the bank: as high as the ground under any part of its width
      let y = -Infinity;
      for (const l of [-b.w / 2, 0, b.w / 2]) y = Math.max(y, height(b.x + b.ux * end * side - b.uz * l, b.z + b.uz * end * side + b.ux * l));
      y += 0.02;
      if (side < 0) { b.s0 = -end; b.y0 = y; } else { b.s1 = end; b.y1 = y; }
    }
    b.arch = Math.min(2.4, Math.max(1.2, (b.s1 - b.s0) * 0.075));
  }
  const [B0, B1, B2] = BRIDGES;
  const end = (b: Bridge, side: number, out = 0) => bridgePoint(b, side < 0 ? b.s0 - out : b.s1 + out);
  PATHS.length = 0;
  PATHS.push(
    // main street: east bridge -> village square -> peach hill
    [end(B0, -1), end(B0, -1, 5), [40, 30], [0, 30], [-50, 28], [-90, 18], [-118, 10]],
    // village square -> foot of the stairs
    [[0, 30], [0, 5], [STAIRS.x, STAIRS.z0]],
    // village -> training arena
    [[0, 30], [4, 70], [-4, 110], [ARENA.x, ARENA.z - ARENA.r]],
    // into the bamboo forest
    [end(B0, 1), end(B0, 1, 5), [120, 20], [150, -10], [170, -50]],
    // north bridge trail
    [[0, -42], [24, -50], end(B1, -1, 6), end(B1, -1)],
    [end(B1, 1), end(B1, 1, 6), [130, -110]],
    // south bridge: from the arena gate across the river to the forest's southern edge
    [[ARENA.x, ARENA.z - ARENA.r], [24, 120], end(B2, -1, 6), end(B2, -1)],
    [end(B2, 1), end(B2, 1, 6), [118, 112]],
    // pond trail
    [[-50, 28], [-60, 70], [POND.x, POND.z - POND.r]],
  );
}

/** karst pillars ring the valley (x, z, radius, height) */
export const PILLARS: [number, number, number, number][] = [
  [-200, -150, 34, 95], [-235, -60, 30, 80], [-215, 60, 32, 100], [-230, 170, 36, 85],
  [-140, -230, 30, 110], [-60, -250, 28, 90], [80, -245, 34, 105], [170, -205, 30, 90],
  [235, -120, 32, 80], [245, -20, 28, 95], [230, 90, 34, 105], [215, 200, 30, 80],
  [130, 240, 32, 95], [20, 250, 30, 85], [-100, 240, 32, 100], [-170, -95, 16, 55],
  [-160, 120, 18, 50], [150, 150, 14, 45], [-30, -230, 18, 60],
];

/** gameplay spots: NPCs, hidden Jade Stones, ingredient patches (kept clear of trees) */
export const SPOTS = {
  canard: { x: -2, z: 14.2 },
  crates: { x: 6.8, z: 11 },
  tortue: { x: PEACH_HILL.x + 4.5, z: PEACH_HILL.z + 3.5 },
  boulder: { x: 168, z: 34 },
  islet: { x: POND.x, z: POND.z },
  oldTree: { x: -156, z: -22 },
  camp: { x: 132, z: -112 },
  oracle: { x: 0, z: -150 },
  palace: { x: 0, z: -160 },
  arenaGate: { x: ARENA.x, z: ARENA.z - ARENA.r },
};
/** peach trees on the hill that drop a peach when shaken */
export const FRUIT_TREES: [number, number][] = [
  [-108, 30], [-140, 32], [-150, 0], [-104, -8], [-130, -16], [-96, 14],
];
/** bamboo shoots on the forest floor */
export const SHOOTS: [number, number][] = [[120, 52], [138, 66], [178, 8], [186, -40], [150, -62], [112, -30]];
/** mossy rocks around the pond; some hide mushrooms */
export const MUSHROOM_ROCKS: [number, number, boolean][] = [
  [-46, 98, true], [-52, 124, false], [-74, 130, true], [-96, 118, false], [-92, 86, true], [-58, 80, false],
];
