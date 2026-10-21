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

/** bridges cross the river where paths do */
export const BRIDGES = [{ z: 30 }, { z: -95 }, { z: 160 }].map((b) => ({ x: riverX(b.z), z: b.z }));

/** dirt paths (polylines) */
export const PATHS: [number, number][][] = [
  // main street: east bridge -> village square -> peach hill
  [[BRIDGES[0].x + 16, 30], [40, 30], [0, 30], [-50, 28], [-90, 18], [-118, 10]],
  // village square -> foot of the stairs
  [[0, 30], [0, 5], [STAIRS.x, STAIRS.z0]],
  // village -> training arena
  [[0, 30], [4, 70], [-4, 110], [ARENA.x, ARENA.z - ARENA.r]],
  // into the bamboo forest
  [[BRIDGES[0].x + 16, 30], [120, 20], [150, -10], [170, -50]],
  // north bridge trail
  [[0, -42], [40, -70], [BRIDGES[1].x, -95], [130, -110]],
  // pond trail
  [[-50, 28], [-60, 70], [POND.x, POND.z - POND.r]],
];

/** karst pillars ring the valley (x, z, radius, height) */
export const PILLARS: [number, number, number, number][] = [
  [-200, -150, 34, 95], [-235, -60, 30, 80], [-215, 60, 32, 100], [-230, 170, 36, 85],
  [-140, -230, 30, 110], [-60, -250, 28, 90], [80, -245, 34, 105], [170, -205, 30, 90],
  [235, -120, 32, 80], [245, -20, 28, 95], [230, 90, 34, 105], [215, 200, 30, 80],
  [130, 240, 32, 95], [20, 250, 30, 85], [-100, 240, 32, 100], [-170, -95, 16, 55],
  [-160, 120, 18, 50], [150, 150, 14, 45], [-30, -230, 18, 60],
];
