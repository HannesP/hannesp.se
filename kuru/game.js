const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const levelEl = document.getElementById('level');
const scoreEl = document.getElementById('score');
const hpEl = document.getElementById('hp');

const GRID = 20;
const WORLD_W = 80 * GRID; // 1600
const WORLD_H = 60 * GRID; // 1200
const VIEW_W = 800;
const VIEW_H = 600;
canvas.width = VIEW_W;
canvas.height = VIEW_H;

const camera = { x: 0, y: 0 };
function updateCamera() {
  camera.x = Math.max(0, Math.min(WORLD_W - VIEW_W, player.x - VIEW_W / 2));
  camera.y = Math.max(0, Math.min(WORLD_H - VIEW_H, player.y - VIEW_H / 2));
}

function toPixelPoly(gridPoints) {
  return gridPoints.map(([gx, gy]) => ({ x: gx * GRID, y: gy * GRID }));
}

// ---- Level data ----
// A level bundles everything the editor authors into one object: obstacle
// polygons, marker points, and the player's start/goal grid positions.
// Keeping it as a single object (rather than scattered top-level consts) is
// what lets the game load different levels, and to progress between them.
const LEVELS = [
  {"obstacles":[{"grid":[[33,0],[32,1],[31,0]]},{"grid":[[27,0],[26,1],[25,0]]},{"grid":[[12,0],[11,1],[10,0]]},{"grid":[[16,0],[17,1],[18,0]]},{"grid":[[39,0],[39,29],[80,29],[80,0]]},{"grid":[[26,30],[26,24],[28,24],[28,22],[26,22],[26,14],[24,14],[24,30]]},{"grid":[[31,14],[29,14],[29,16],[31,16]]},{"grid":[[14,2],[18,6],[25,6],[29,2],[33,6],[33,24],[31,24],[31,9],[12,9],[12,14],[19,14],[19,16],[10,16]]},{"grid":[[10,6],[14,2],[13,6],[10,16]]},{"grid":[[10,6],[8,6],[8,9],[10,9]]},{"grid":[[10,28],[10,30],[12,30],[12,28]]},{"grid":[[3,6],[8,6],[8,9],[3,9]],"type":"oneway","dir":"S"},{"grid":[[10,19],[10,25],[12,25],[12,21],[17,21],[17,28],[19,28],[19,19]]},{"grid":[[24,30],[39,30],[39,29],[80,29],[80,39],[40,40],[40,40],[0,40],[0,6],[3,6],[3,28],[10,28],[10,30],[12,30],[12,28],[24,28]]}],"markers":[{"gx":3,"gy":3},{"gx":8,"gy":3},{"gx":15,"gy":11},{"gx":14,"gy":23},{"gx":22,"gy":25}],"keys":[],"start":{"gx":7,"gy":15},"goal":{"gx":7,"gy":12}},
  {"obstacles":[{"grid":[[2,41],[2,60],[19,60],[19,57],[7,57],[7,41]]},{"grid":[[17,25],[17,13],[19,13],[19,25]]},{"grid":[[25,13],[25,11],[27,11],[27,13]],"type":"keyhole","color":"red"},{"grid":[[27,25],[27,13],[25,13],[25,25]]},{"grid":[[17,55],[17,57],[19,57],[19,55]],"type":"keyhole","color":"blue"},{"grid":[[25,55],[25,57],[27,57],[27,55]],"type":"keyhole","color":"yellow"},{"grid":[[19,43],[19,55],[17,55],[17,43]]},{"grid":[[25,25],[25,27],[27,27],[27,25]],"type":"oneway","dir":"E"},{"grid":[[17,43],[17,41],[19,41],[19,43]],"type":"oneway","dir":"W"},{"grid":[[27,27],[25,27],[25,55],[27,55]]},{"grid":[[19,41],[2,41],[2,60],[0,60],[0,0],[49,0],[49,60],[25,60],[25,57],[36,57],[36,41],[27,41],[27,27],[36,27],[36,11],[39,11],[39,4],[2,4],[2,27]]},{"grid":[[4,27],[19,27],[19,41],[8,32],[4,29]]},{"grid":[[2,27],[4,29],[4,27],[7,27],[7,11],[39,11],[39,4],[2,4]]}],"markers":[{"gx":12,"gy":22},{"gx":31,"gy":22},{"gx":32,"gy":45},{"gx":12,"gy":53},{"gx":32,"gy":53}],"keys":[{"gx":12,"gy":16,"color":"red"},{"gx":31,"gy":16,"color":"blue"},{"gx":12,"gy":45,"color":"yellow"}],"start":{"gx":22,"gy":54},"goal":{"gx":22,"gy":58}},
];

// Obstacles: polygons whose vertices are given in grid units (multiples of GRID)
const obstacles = [];
// Markers: collectible points placed at grid vertices
const markers = [];
// Keys: colored pickups placed at grid points, used to open matching keyholes
const keyItems = [];

let collectedCount = 0;
const MARKER_RADIUS = 7;

// Markers collected during play are removed from `remainingMarkers`, a
// runtime copy, so picking them up never mutates (or persists changes to)
// the level's `markers` definition.
let remainingMarkers = [];
function resetRemainingMarkers() {
  remainingMarkers = markers.map(m => ({ gx: m.gx, gy: m.gy }));
  collectedCount = 0;
}

// Keys picked up during play are removed from `remainingKeys`, a runtime
// copy, for the same reason (see resetRemainingMarkers).
let remainingKeys = [];
function resetRemainingKeys() {
  remainingKeys = keyItems.map(k => ({ gx: k.gx, gy: k.gy, color: k.color }));
}

// Keyhole obstacles that have been unlocked this playthrough (removed from
// play but not from the level definition, so it isn't persisted).
let openedKeyholes = new Set();

// Character
const player = {
  startGrid: { gx: 0, gy: 0 },
  goalGrid: { gx: 0, gy: 0 },
  x: 0,
  y: 0,
  angle: 0,
  speed: 200, // px/sec (2/3 of original 300)
  angularSpeed: (Math.PI * 2) / 4.5, // 4.5 seconds per revolution (2/3 of original speed)
  hp: 3,
  maxHp: 3,
  invulnTimer: 0,
  gameOver: false,
  win: false,
  knockbackTimer: 0,
  knockbackFrom: { x: 0, y: 0 },
  knockbackTo: { x: 0, y: 0 },
  heldKeys: [null, null], // color carried by each stick end (index 0 = "start"-side ball, 1 = "end"-side ball)
};

// ---- Level persistence (localStorage) ----
// Each level's edits are stored under its own key so editing level 2 never
// touches level 1's saved data. The player's current level also persists,
// so progress survives a page reload.
const LEVEL_STORAGE_PREFIX = 'stickGameLevel_';
const CURRENT_LEVEL_STORAGE_KEY = 'stickGameCurrentLevel';
let currentLevelIndex = 0;

function saveLevel() {
  const data = {
    obstacles,
    markers,
    keys: keyItems,
    start: player.startGrid,
    goal: player.goalGrid,
  };
  localStorage.setItem(LEVEL_STORAGE_PREFIX + currentLevelIndex, JSON.stringify(data));
}
// Populates obstacles/markers/keys/player start & goal from a level object
// ({obstacles, markers, keys, start, goal}), deep-copying so in-game edits
// never mutate the source data (a LEVELS entry or a parsed save).
function applyLevel(level) {
  obstacles.length = 0;
  for (const o of level.obstacles) {
    obstacles.push({ ...o, grid: o.grid.map(p => [...p]) });
  }
  markers.length = 0;
  for (const m of level.markers) markers.push({ gx: m.gx, gy: m.gy });
  keyItems.length = 0;
  for (const k of (level.keys || [])) keyItems.push({ gx: k.gx, gy: k.gy, color: k.color });
  player.startGrid = { gx: level.start.gx, gy: level.start.gy };
  player.goalGrid = { gx: level.goal.gx, gy: level.goal.gy };
  player.x = player.startGrid.gx * GRID;
  player.y = player.startGrid.gy * GRID;
}
// Loads the level at `index` (its saved edits if present, otherwise the
// authored LEVELS entry) and makes it the active level.
function loadLevel(index) {
  currentLevelIndex = index;
  const raw = localStorage.getItem(LEVEL_STORAGE_PREFIX + index);
  if (!raw) {
    applyLevel(LEVELS[index]);
    return;
  }
  try {
    applyLevel(JSON.parse(raw));
  } catch (e) {
    console.warn('Failed to load saved level, using default:', e);
    applyLevel(LEVELS[index]);
  }
}
// Switches the active level, persists the choice, and resets play state
// (HP, position, collected markers/keys) for a clean start on the new level.
function goToLevel(index) {
  index = Math.max(0, Math.min(LEVELS.length - 1, index));
  loadLevel(index);
  localStorage.setItem(CURRENT_LEVEL_STORAGE_KEY, String(index));
  restart();
  updateHud();
}

let startLevelIndex = 0;
const savedIndexRaw = localStorage.getItem(CURRENT_LEVEL_STORAGE_KEY);
if (savedIndexRaw !== null) {
  const parsed = parseInt(savedIndexRaw, 10);
  if (!Number.isNaN(parsed) && parsed >= 0 && parsed < LEVELS.length) startLevelIndex = parsed;
}
loadLevel(startLevelIndex);
resetRemainingMarkers();
resetRemainingKeys();

const STICK_LENGTH = 40;
const STICK_WIDTH = 6;
const END_BALL_RADIUS = 6;
const CENTER_BALL_RADIUS = 6;
const COLLECT_RADIUS = STICK_LENGTH / 2 + MARKER_RADIUS;
const KEY_RADIUS = 6;
const KEY_COLLECT_RADIUS = END_BALL_RADIUS + KEY_RADIUS;
const COLLISION_FORGIVENESS = 2; // px shaved off the stick's collision radius for a little slack
const STICK_COLLISION_RADIUS = Math.max(1, END_BALL_RADIUS - COLLISION_FORGIVENESS);
const GOAL_RADIUS = STICK_LENGTH / 2 + 10;
const HIT_INVULN_SECONDS = 0.8;
const KNOCKBACK_DISTANCE = 20;
const KNOCKBACK_DURATION = 0.15; // seconds
const EDITOR_PAN_SPEED = 600; // px/sec, arrow-key camera pan while in the editor

const TOOL_ORDER = ['add', 'oneway', 'keyhole', 'split', 'remove', 'marker', 'key', 'start', 'goal'];
const TOOL_LABELS = {
  add: 'WALL',
  oneway: 'ONE-WAY',
  keyhole: 'KEYHOLE',
  split: 'SPLIT',
  remove: 'REMOVE',
  marker: 'MARKER',
  key: 'KEY',
  start: 'START',
  goal: 'GOAL',
};

// One-way obstacles: like regular obstacles, but only block movement that
// crosses them in one chosen cardinal direction (movement in any other
// direction passes through freely).
const DIR_ORDER = ['N', 'E', 'S', 'W'];
const DIR_VECTORS = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } };
function nextDir(d) { return DIR_ORDER[(DIR_ORDER.indexOf(d) + 1) % DIR_ORDER.length]; }
let onewayDir = 'N'; // pending direction used for the next one-way polygon drawn

// Keys and keyhole obstacles: a key of a color unlocks (removes) a keyhole
// obstacle of the same color when either end of the stick touches it.
const KEY_COLORS = ['red', 'blue', 'yellow', 'green'];
const KEY_COLOR_HEX = { red: '#ff4d4d', blue: '#4da6ff', yellow: '#ffd84d', green: '#4dff88' };
const KEY_COLOR_FILL = {
  red: 'rgba(255,77,77,0.35)',
  blue: 'rgba(77,166,255,0.35)',
  yellow: 'rgba(255,216,77,0.35)',
  green: 'rgba(77,255,136,0.35)',
};
function nextColor(c) { return KEY_COLORS[(KEY_COLORS.indexOf(c) + 1) % KEY_COLORS.length]; }
let keyholeColor = 'red'; // pending color used for the next keyhole polygon drawn

const keys = new Set();
window.addEventListener('keydown', e => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    keys.add(e.key);
    e.preventDefault();
  }
  if (e.key === 'e' || e.key === 'E') {
    setEditorMode(!editorMode);
  }
  if (e.key === 'n' || e.key === 'N') goToLevel((currentLevelIndex + 1) % LEVELS.length);
  if (!editorMode) {
    if (player.gameOver && e.key === 'Enter') restart();
    if (player.win && e.key === 'Enter') {
      if (currentLevelIndex < LEVELS.length - 1) goToLevel(currentLevelIndex + 1);
      else goToLevel(0);
    }
    return;
  }
  if (e.key === 'Enter') finalizePolygon();
  if (e.key === 'Escape') cancelPolygon();
  if (e.key === 'Backspace') {
    currentPoints.pop();
  }
  if (e.key === 'r' || e.key === 'R') {
    editorTool = TOOL_ORDER[(TOOL_ORDER.indexOf(editorTool) + 1) % TOOL_ORDER.length];
    currentPoints = [];
    splitObstacle = null;
    splitPoints = [];
    updateHud();
  }
  if ((e.key === 'd' || e.key === 'D') && editorTool === 'oneway') {
    if (currentPoints.length === 0 && hoverObstacle && hoverObstacle.type === 'oneway') {
      hoverObstacle.dir = nextDir(hoverObstacle.dir);
      saveLevel();
    } else {
      onewayDir = nextDir(onewayDir);
    }
    updateHud();
  }
  if ((e.key === 'd' || e.key === 'D') && editorTool === 'keyhole') {
    if (currentPoints.length === 0 && hoverObstacle && hoverObstacle.type === 'keyhole') {
      hoverObstacle.color = nextColor(hoverObstacle.color);
      saveLevel();
    } else {
      keyholeColor = nextColor(keyholeColor);
    }
    updateHud();
  }
  if (e.key === 'v' || e.key === 'V') {
    viewMode = !viewMode;
    updateHud();
  }
});
window.addEventListener('keyup', e => {
  keys.delete(e.key);
});

// ---- Level editor ----
let editorMode = false;
let editorTool = 'add'; // 'add' | 'remove'
let viewMode = false; // zoomed-out, whole-level view (no scrolling)
let currentPoints = []; // grid coords [gx, gy] of in-progress polygon
let hoverGrid = null; // {gx, gy}
let hoverPixel = null; // {x, y} raw (unsnapped) world coords
let hoverObstacle = null; // obstacle under cursor in remove mode
let hoverMarker = null; // existing marker under cursor in marker mode
let hoverKeyItem = null; // existing key under cursor in key/remove mode
let splitObstacle = null; // obstacle currently selected for splitting
let splitPoints = []; // chosen cut points [{edgeIndex, gx, gy}, ...] (up to 2) for the split tool
let hoverSplitPoint = null; // {edgeIndex, x, y, obstacle} nearest edge point to the cursor, if within snap range

function setEditorMode(on) {
  editorMode = on;
  editorTool = 'add';
  viewMode = false;
  currentPoints = [];
  hoverGrid = null;
  hoverPixel = null;
  hoverObstacle = null;
  hoverMarker = null;
  hoverKeyItem = null;
  splitObstacle = null;
  splitPoints = [];
  hoverSplitPoint = null;
  updateHud();
}

function findMarkerAt(gx, gy) {
  return markers.find(m => m.gx === gx && m.gy === gy) || null;
}

function findKeyItemAt(gx, gy) {
  return keyItems.find(k => k.gx === gx && k.gy === gy) || null;
}

// World-to-canvas transform. In view mode, the whole world is scaled down
// to fit the viewport (no scrolling); otherwise it's the normal 1:1 camera.
function getTransform() {
  if (viewMode) {
    const scale = Math.min(VIEW_W / WORLD_W, VIEW_H / WORLD_H);
    const offsetX = (VIEW_W - WORLD_W * scale) / 2;
    const offsetY = (VIEW_H - WORLD_H * scale) / 2;
    return { scale, offsetX, offsetY };
  }
  return { scale: 1, offsetX: -camera.x, offsetY: -camera.y };
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function findObstacleAt(x, y) {
  for (let i = obstacles.length - 1; i >= 0; i--) {
    if (pointInPolygon(x, y, toPixelPoly(obstacles[i].grid))) {
      return obstacles[i];
    }
  }
  return null;
}

// Whether grid point (gx, gy) lies exactly on the segment from grid-unit
// vertex a to vertex b (collinear and between the endpoints).
function gridPointOnEdge(gx, gy, a, b) {
  const cross = (b[0] - a[0]) * (gy - a[1]) - (b[1] - a[1]) * (gx - a[0]);
  if (Math.abs(cross) > 1e-6) return false;
  const dot = (gx - a[0]) * (b[0] - a[0]) + (gy - a[1]) * (b[1] - a[1]);
  if (dot < -1e-6) return false;
  const lenSq = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  return dot <= lenSq + 1e-6;
}

// Finds the edge of obstacle's polygon (if any) that passes exactly through
// grid point (gx, gy), for snapping split points to the discrete grid.
function findGridEdgePoint(gx, gy, obstacle) {
  const poly = obstacle.grid;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    if (gridPointOnEdge(gx, gy, poly[i], poly[(i + 1) % n])) {
      return { edgeIndex: i, gx, gy, obstacle };
    }
  }
  return null;
}

canvas.addEventListener('mousemove', e => {
  if (!editorMode) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = (e.clientX - rect.left) * scaleX;
  const cy = (e.clientY - rect.top) * scaleY;
  const { scale, offsetX, offsetY } = getTransform();
  const px = (cx - offsetX) / scale;
  const py = (cy - offsetY) / scale;
  hoverPixel = { x: px, y: py };
  const gx = Math.round(px / GRID);
  const gy = Math.round(py / GRID);
  hoverGrid = { gx, gy };
  hoverMarker = (editorTool === 'marker' || editorTool === 'remove') ? findMarkerAt(gx, gy) : null;
  hoverKeyItem = (editorTool === 'key' || (editorTool === 'remove' && !hoverMarker)) ? findKeyItemAt(gx, gy) : null;
  hoverObstacle = (editorTool === 'oneway' || editorTool === 'keyhole' || (editorTool === 'remove' && !hoverMarker && !hoverKeyItem)) ? findObstacleAt(px, py) : null;

  hoverSplitPoint = null;
  if (editorTool === 'split') {
    if (splitObstacle) {
      hoverSplitPoint = findGridEdgePoint(gx, gy, splitObstacle);
    } else {
      for (let i = obstacles.length - 1; i >= 0; i--) {
        const found = findGridEdgePoint(gx, gy, obstacles[i]);
        if (found) { hoverSplitPoint = found; break; }
      }
    }
  }
});

canvas.addEventListener('click', () => {
  if (!editorMode) return;
  if (editorTool === 'split') {
    if (!hoverSplitPoint) return;
    const point = { edgeIndex: hoverSplitPoint.edgeIndex, gx: hoverSplitPoint.gx, gy: hoverSplitPoint.gy };
    if (!splitObstacle) {
      splitObstacle = hoverSplitPoint.obstacle;
      splitPoints = [point];
      return;
    }
    if (point.edgeIndex === splitPoints[0].edgeIndex) {
      console.log('Split points must be on different edges.');
      return;
    }
    const parts = splitPolygonAt(splitObstacle.grid, splitPoints[0], point);
    if (parts) {
      const idx = obstacles.indexOf(splitObstacle);
      if (idx !== -1) obstacles.splice(idx, 1);
      for (const grid of parts) {
        const newObstacle = { grid: simplifyCollinear(grid) };
        if (splitObstacle.type) newObstacle.type = splitObstacle.type;
        if (splitObstacle.dir) newObstacle.dir = splitObstacle.dir;
        if (splitObstacle.color) newObstacle.color = splitObstacle.color;
        obstacles.push(newObstacle);
      }
      console.log('Split obstacle into 2:', JSON.stringify(parts));
      saveLevel();
    }
    splitObstacle = null;
    splitPoints = [];
    hoverSplitPoint = null;
    return;
  }
  if (editorTool === 'remove') {
    if (hoverMarker) {
      markers.splice(markers.indexOf(hoverMarker), 1);
      hoverMarker = null;
      resetRemainingMarkers();
      updateScore();
      saveLevel();
    } else if (hoverKeyItem) {
      keyItems.splice(keyItems.indexOf(hoverKeyItem), 1);
      hoverKeyItem = null;
      resetRemainingKeys();
      saveLevel();
    } else if (hoverObstacle) {
      const idx = obstacles.indexOf(hoverObstacle);
      if (idx !== -1) obstacles.splice(idx, 1);
      hoverObstacle = null;
      saveLevel();
    }
    return;
  }
  if (editorTool === 'oneway') {
    if (currentPoints.length === 0 && hoverObstacle && hoverObstacle.type === 'oneway') {
      hoverObstacle.dir = nextDir(hoverObstacle.dir);
      saveLevel();
      return;
    }
    if (!hoverGrid) return;
    const last = currentPoints[currentPoints.length - 1];
    if (!last || last[0] !== hoverGrid.gx || last[1] !== hoverGrid.gy) {
      currentPoints.push([hoverGrid.gx, hoverGrid.gy]);
    }
    return;
  }
  if (editorTool === 'keyhole') {
    if (currentPoints.length === 0 && hoverObstacle && hoverObstacle.type === 'keyhole') {
      hoverObstacle.color = nextColor(hoverObstacle.color);
      saveLevel();
      return;
    }
    if (!hoverGrid) return;
    const last = currentPoints[currentPoints.length - 1];
    if (!last || last[0] !== hoverGrid.gx || last[1] !== hoverGrid.gy) {
      currentPoints.push([hoverGrid.gx, hoverGrid.gy]);
    }
    return;
  }
  if (editorTool === 'marker') {
    if (!hoverGrid) return;
    const existing = findMarkerAt(hoverGrid.gx, hoverGrid.gy);
    if (existing) {
      markers.splice(markers.indexOf(existing), 1);
      hoverMarker = null;
    } else {
      markers.push({ gx: hoverGrid.gx, gy: hoverGrid.gy });
      hoverMarker = markers[markers.length - 1];
    }
    resetRemainingMarkers();
    updateScore();
    saveLevel();
    return;
  }
  if (editorTool === 'key') {
    if (!hoverGrid) return;
    const existing = findKeyItemAt(hoverGrid.gx, hoverGrid.gy);
    if (existing) {
      existing.color = nextColor(existing.color);
    } else {
      keyItems.push({ gx: hoverGrid.gx, gy: hoverGrid.gy, color: KEY_COLORS[0] });
      hoverKeyItem = keyItems[keyItems.length - 1];
    }
    resetRemainingKeys();
    saveLevel();
    return;
  }
  if (editorTool === 'start') {
    if (!hoverGrid) return;
    player.startGrid = { gx: hoverGrid.gx, gy: hoverGrid.gy };
    player.x = hoverGrid.gx * GRID;
    player.y = hoverGrid.gy * GRID;
    saveLevel();
    return;
  }
  if (editorTool === 'goal') {
    if (!hoverGrid) return;
    player.goalGrid = { gx: hoverGrid.gx, gy: hoverGrid.gy };
    saveLevel();
    return;
  }
  if (!hoverGrid) return;
  const last = currentPoints[currentPoints.length - 1];
  if (!last || last[0] !== hoverGrid.gx || last[1] !== hoverGrid.gy) {
    currentPoints.push([hoverGrid.gx, hoverGrid.gy]);
  }
});

// ---- Edge-containment fusing ----
// If a new polygon's edge is fully contained within an existing polygon's
// edge (or vice versa), the two shapes share a wall and are merged into one.
function cross2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function dot2(ax, ay, bx, by) { return ax * bx + ay * by; }
function rotate(arr, start) { return arr.slice(start).concat(arr.slice(0, start)); }

function spliceEdge(outer, oi, inner, ii) {
  const nI = inner.length;
  const rotatedOuter = rotate(outer, oi); // starts at O_i
  const rotatedInner = rotate(inner, (ii + 1) % nI); // [P2, ..., P1]
  const merged = [rotatedOuter[0], ...rotatedInner, ...rotatedOuter.slice(1)];

  // dedupe consecutive (and wraparound) duplicate points
  const out = [];
  for (const p of merged) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  if (out.length > 1) {
    const first = out[0], last = out[out.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) out.pop();
  }
  return out;
}

function simplifyCollinear(poly) {
  const n = poly.length;
  if (n < 3) return poly;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    if (cross2(prev, cur, next) !== 0) out.push(cur);
  }
  return out.length >= 3 ? out : poly;
}

// Returns a merged grid-point array if polyA and polyB share a wall
// (one edge fully contained within a collinear, oppositely-directed edge
// of the other), otherwise null.
function tryFuse(polyA, polyB) {
  const nA = polyA.length, nB = polyB.length;
  for (let i = 0; i < nA; i++) {
    const a1 = polyA[i], a2 = polyA[(i + 1) % nA];
    const dAx = a2[0] - a1[0], dAy = a2[1] - a1[1];
    for (let j = 0; j < nB; j++) {
      const b1 = polyB[j], b2 = polyB[(j + 1) % nB];
      if (cross2(a1, a2, b1) !== 0 || cross2(a1, a2, b2) !== 0) continue; // not collinear
      const dBx = b2[0] - b1[0], dBy = b2[1] - b1[1];
      if (dot2(dAx, dAy, dBx, dBy) >= 0) continue; // must run opposite directions

      const lenA2 = dot2(dAx, dAy, dAx, dAy);
      const tB1 = dot2(b1[0] - a1[0], b1[1] - a1[1], dAx, dAy);
      const tB2 = dot2(b2[0] - a1[0], b2[1] - a1[1], dAx, dAy);

      if (tB1 >= 0 && tB1 <= lenA2 && tB2 >= 0 && tB2 <= lenA2) {
        // B's edge fully contained in A's edge -> A is outer, B is inner
        return spliceEdge(polyA, i, polyB, j);
      }

      const lenB2 = dot2(dBx, dBy, dBx, dBy);
      const tA1 = dot2(a1[0] - b1[0], a1[1] - b1[1], dBx, dBy);
      const tA2 = dot2(a2[0] - b1[0], a2[1] - b1[1], dBx, dBy);
      if (tA1 >= 0 && tA1 <= lenB2 && tA2 >= 0 && tA2 <= lenB2) {
        // A's edge fully contained in B's edge -> B is outer, A is inner
        return spliceEdge(polyB, j, polyA, i);
      }
    }
  }
  return null;
}

// ---- Split tool ----
// Cuts a polygon into two along a straight line between two points that lie
// on two different edges of its boundary.
function splitPolygonAt(poly, cutA, cutB) {
  let a = cutA, b = cutB;
  if (a.edgeIndex > b.edgeIndex) [a, b] = [b, a];
  if (a.edgeIndex === b.edgeIndex) return null;

  const n = poly.length;
  const partA = [[a.gx, a.gy]];
  for (let k = a.edgeIndex + 1; k <= b.edgeIndex; k++) partA.push(poly[k % n]);
  partA.push([b.gx, b.gy]);

  const partB = [[b.gx, b.gy]];
  for (let k = b.edgeIndex + 1; k <= a.edgeIndex + n; k++) partB.push(poly[k % n]);
  partB.push([a.gx, a.gy]);

  return [partA, partB];
}

function finalizePolygon() {
  if (currentPoints.length < 3) {
    currentPoints = [];
    return;
  }
  if (editorTool === 'oneway') {
    const newGrid = simplifyCollinear(currentPoints.slice());
    obstacles.push({ grid: newGrid, type: 'oneway', dir: onewayDir });
    console.log('Added one-way obstacle:', JSON.stringify(newGrid), 'dir:', onewayDir);
    currentPoints = [];
    saveLevel();
    return;
  }
  if (editorTool === 'keyhole') {
    const newGrid = simplifyCollinear(currentPoints.slice());
    obstacles.push({ grid: newGrid, type: 'keyhole', color: keyholeColor });
    console.log('Added keyhole obstacle:', JSON.stringify(newGrid), 'color:', keyholeColor);
    currentPoints = [];
    saveLevel();
    return;
  }
  let newGrid = currentPoints.slice();
  let fused = false;
  let changed = true;
  while (changed) {
    changed = false;
    for (let idx = 0; idx < obstacles.length; idx++) {
      if (obstacles[idx].type) continue; // don't fuse into typed obstacles (e.g. one-way), it would silently drop their type
      const merged = tryFuse(obstacles[idx].grid, newGrid);
      if (merged) {
        obstacles.splice(idx, 1);
        newGrid = merged;
        fused = true;
        changed = true;
        break;
      }
    }
  }
  newGrid = simplifyCollinear(newGrid);
  obstacles.push({ grid: newGrid });
  console.log(fused ? 'Fused obstacle:' : 'Added obstacle:', JSON.stringify(newGrid));
  currentPoints = [];
  saveLevel();
}

function cancelPolygon() {
  currentPoints = [];
  splitObstacle = null;
  splitPoints = [];
}

function updateHud() {
  if (editorMode) {
    const viewLabel = viewMode ? '<b>VIEW</b> (V to exit)<br>' : '(V for whole-level view)<br>';

    const toolHelp = {
      add: 'Click: add point &middot; Enter: finish polygon &middot; Backspace: undo point &middot; Esc: cancel polygon<br>' +
        'Points added to console as JSON on finish.',
      oneway: `Click: add point &middot; Enter: finish polygon &middot; D: cycle direction (current: ${onewayDir})<br>` +
        'Hover an existing one-way shape and press D (or click it) to cycle its direction. Blocks movement only in the chosen direction.',
      keyhole: `Click: add point &middot; Enter: finish polygon &middot; D: cycle color (current: ${keyholeColor})<br>` +
        'Hover an existing keyhole and press D (or click it) to cycle its color. Behaves like a wall until touched by a ball carrying a matching key.',
      split: 'Click a grid point on an obstacle\'s edge, then a grid point on a different edge, to cut it into two &middot; Esc: cancel.',
      remove: 'Click a highlighted obstacle, marker, or key to delete it.',
      marker: 'Click a grid point to place a marker &middot; click an existing marker to remove it.',
      key: 'Click a grid point to place a key &middot; click an existing key to cycle its color. Use REMOVE to delete a key.',
      start: 'Click a grid point to set the player\'s starting position.',
      goal: 'Click a grid point to set the goal. Reachable only once all markers are collected.',
    };

    const toolList = TOOL_ORDER.map(t => {
      const label = TOOL_LABELS[t];
      return t === editorTool ? `<span style="color:#ffcc00">${label}</span>` : label;
    }).join(' &middot; ');

    hud.innerHTML =
      '<b>EDITOR MODE</b> (E to exit &middot; R to cycle tool)<br>' +
      `${toolList}<br>` +
      viewLabel +
      '<br>' +
      toolHelp[editorTool];
  } else {
    hud.innerHTML = '<b>Arrow keys</b> to move &middot; <b>E</b> for level editor &middot; <b>N</b> for next level';
  }
}
updateHud();

function drawGrid() {
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const startX = viewMode ? 0 : Math.floor(camera.x / GRID) * GRID;
  const endX = viewMode ? WORLD_W : camera.x + VIEW_W;
  const startY = viewMode ? 0 : Math.floor(camera.y / GRID) * GRID;
  const endY = viewMode ? WORLD_H : camera.y + VIEW_H;
  for (let x = startX; x <= endX; x += GRID) {
    ctx.moveTo(x + 0.5, startY);
    ctx.lineTo(x + 0.5, endY);
  }
  for (let y = startY; y <= endY; y += GRID) {
    ctx.moveTo(startX, y + 0.5);
    ctx.lineTo(endX, y + 0.5);
  }
  ctx.stroke();
}

// Draws a single arrow glyph centered at (cx, cy), pointing along dirVec.
function drawArrowGlyph(cx, cy, dirVec, len, color) {
  const half = len / 2;
  const x1 = cx - dirVec.x * half, y1 = cy - dirVec.y * half;
  const x2 = cx + dirVec.x * half, y2 = cy + dirVec.y * half;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const headLen = len * 0.4;
  const angle = Math.atan2(dirVec.y, dirVec.x);
  const a1 = angle + Math.PI * 0.8;
  const a2 = angle - Math.PI * 0.8;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 + Math.cos(a1) * headLen, y2 + Math.sin(a1) * headLen);
  ctx.lineTo(x2 + Math.cos(a2) * headLen, y2 + Math.sin(a2) * headLen);
  ctx.closePath();
  ctx.fill();
}

// Draws a simple keyhole silhouette (circle + wedge) centered at (cx, cy).
function drawKeyholeGlyph(cx, cy, size) {
  ctx.fillStyle = '#fff2e0';
  const r = size * 0.28;
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.3, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, cy + r * 0.3);
  ctx.lineTo(cx + r * 0.5, cy + r * 0.3);
  ctx.lineTo(cx + r * 0.25, cy + r * 1.6);
  ctx.lineTo(cx - r * 0.25, cy + r * 1.6);
  ctx.closePath();
  ctx.fill();
}

function drawObstacles() {
  for (const o of obstacles) {
    if (o.type === 'keyhole' && openedKeyholes.has(o)) continue;
    const poly = toPixelPoly(o.grid);
    const isOneway = o.type === 'oneway';
    const isKeyhole = o.type === 'keyhole';
    if (isKeyhole) {
      ctx.fillStyle = KEY_COLOR_FILL[o.color];
      ctx.strokeStyle = KEY_COLOR_HEX[o.color];
      ctx.lineWidth = 2;
    } else {
      ctx.fillStyle = isOneway ? 'rgba(224,138,60,0.35)' : '#555';
      ctx.strokeStyle = isOneway ? '#e08a3c' : (editorMode ? '#888' : '#555');
      ctx.lineWidth = isOneway ? 2 : 1;
    }
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i].x, poly[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (isOneway) {
      const dv = DIR_VECTORS[o.dir];
      const dirVec = { x: -dv.x, y: -dv.y };
      const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const spacing = GRID;
      for (let y = minY + spacing / 2; y < maxY; y += spacing) {
        for (let x = minX + spacing / 2; x < maxX; x += spacing) {
          if (pointInPolygon(x, y, poly)) {
            drawArrowGlyph(x, y, dirVec, GRID * 0.65, '#fff2e0');
          }
        }
      }
    }

    if (isKeyhole) {
      const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
      drawKeyholeGlyph(cx, cy, GRID * 1.4);
    }
  }
}

// Draws a small key icon (bow + shaft + teeth) centered at (cx, cy).
function drawKeyGlyph(cx, cy, color) {
  const r = KEY_RADIUS * 0.85;
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx - r * 0.6, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1b1b1b';
  ctx.beginPath();
  ctx.arc(cx - r * 0.6, cy, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(cx - r * 0.6 + r - 1, cy - 1.5, r * 1.6, 3);
  ctx.fillRect(cx + r * 1.4, cy + 1.5, 2, 3);
  ctx.fillRect(cx + r * 0.7, cy + 1.5, 2, 3);
}

function drawKeys() {
  for (const k of (editorMode ? keyItems : remainingKeys)) {
    drawKeyGlyph(k.gx * GRID, k.gy * GRID, KEY_COLOR_HEX[k.color]);
  }
}

function drawMarkers() {
  ctx.fillStyle = '#3ee6ff';
  ctx.strokeStyle = '#0aa';
  ctx.lineWidth = 1.5;
  for (const m of (editorMode ? markers : remainingMarkers)) {
    ctx.beginPath();
    ctx.arc(m.gx * GRID, m.gy * GRID, MARKER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawStartPoint() {
  const x = player.startGrid.gx * GRID;
  const y = player.startGrid.gy * GRID;
  const s = 10;
  ctx.fillStyle = 'rgba(76,175,80,0.35)';
  ctx.strokeStyle = '#4CAF50';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawGoal() {
  const x = player.goalGrid.gx * GRID;
  const y = player.goalGrid.gy * GRID;
  const unlocked = remainingMarkers.length === 0;
  const color = unlocked ? '#ffd700' : '#888';

  // pole
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + 14);
  ctx.lineTo(x, y - 14);
  ctx.stroke();

  // flag
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - 14);
  ctx.lineTo(x + 14, y - 9);
  ctx.lineTo(x, y - 4);
  ctx.closePath();
  ctx.fill();
}

function drawEditor() {
  if (!editorMode) return;

  drawStartPoint();

  if (editorTool === 'goal') {
    if (hoverGrid) {
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hoverGrid.gx * GRID, hoverGrid.gy * GRID, 16, 0, Math.PI * 2);
      ctx.stroke();
    }
    return;
  }

  if (editorTool === 'start') {
    if (hoverGrid) {
      ctx.strokeStyle = '#4CAF50';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hoverGrid.gx * GRID, hoverGrid.gy * GRID, 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    return;
  }

  if (editorTool === 'marker') {
    if (hoverGrid) {
      const hx = hoverGrid.gx * GRID;
      const hy = hoverGrid.gy * GRID;
      ctx.strokeStyle = hoverMarker ? '#ff3c3c' : '#3ee6ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, hy, MARKER_RADIUS + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    return;
  }

  if (editorTool === 'key') {
    if (hoverGrid) {
      const hx = hoverGrid.gx * GRID;
      const hy = hoverGrid.gy * GRID;
      const previewColor = hoverKeyItem ? nextColor(hoverKeyItem.color) : KEY_COLORS[0];
      ctx.strokeStyle = KEY_COLOR_HEX[previewColor];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, hy, KEY_RADIUS + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    return;
  }

  if (editorTool === 'split') {
    const activeObstacle = splitObstacle || (hoverSplitPoint && hoverSplitPoint.obstacle);
    if (activeObstacle) {
      const poly = toPixelPoly(activeObstacle.grid);
      ctx.fillStyle = splitObstacle ? 'rgba(255,204,0,0.2)' : 'rgba(255,204,0,0.08)';
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i].x, poly[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    if (splitPoints.length > 0) {
      const p = splitPoints[0];
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.arc(p.gx * GRID, p.gy * GRID, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (hoverSplitPoint) {
      const hx = hoverSplitPoint.gx * GRID, hy = hoverSplitPoint.gy * GRID;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      ctx.fill();

      if (splitPoints.length > 0) {
        const p = splitPoints[0];
        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.gx * GRID, p.gy * GRID);
        ctx.lineTo(hx, hy);
        ctx.stroke();
      }
    }
    return;
  }

  if (editorTool === 'remove') {
    if (hoverMarker) {
      ctx.strokeStyle = '#ff3c3c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hoverMarker.gx * GRID, hoverMarker.gy * GRID, MARKER_RADIUS + 3, 0, Math.PI * 2);
      ctx.stroke();
    } else if (hoverObstacle) {
      const poly = toPixelPoly(hoverObstacle.grid);
      ctx.fillStyle = 'rgba(255,60,60,0.4)';
      ctx.strokeStyle = '#ff3c3c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i].x, poly[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    return;
  }

  if (editorTool === 'oneway' && currentPoints.length === 0 && hoverObstacle && hoverObstacle.type === 'oneway') {
    const poly = toPixelPoly(hoverObstacle.grid);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i].x, poly[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  if (editorTool === 'keyhole' && currentPoints.length === 0 && hoverObstacle && hoverObstacle.type === 'keyhole') {
    const poly = toPixelPoly(hoverObstacle.grid);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i].x, poly[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  if (hoverGrid) {
    const hx = hoverGrid.gx * GRID;
    const hy = hoverGrid.gy * GRID;
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.arc(hx, hy, 5, 0, Math.PI * 2);
    ctx.fill();

    if (editorTool === 'oneway') {
      const dv = DIR_VECTORS[onewayDir];
      drawArrowGlyph(hx, hy, { x: -dv.x, y: -dv.y }, GRID * 1.2, '#ffcc00');
    }

    if (editorTool === 'keyhole') {
      const previewColor = (hoverObstacle && hoverObstacle.type === 'keyhole') ? nextColor(hoverObstacle.color) : keyholeColor;
      ctx.strokeStyle = KEY_COLOR_HEX[previewColor];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, hy, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  if (currentPoints.length > 0) {
    const poly = toPixelPoly(currentPoints);
    ctx.strokeStyle = '#ffcc00';
    ctx.fillStyle = 'rgba(255,204,0,0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i].x, poly[i].y);
    }
    if (hoverGrid) ctx.lineTo(hoverGrid.gx * GRID, hoverGrid.gy * GRID);
    ctx.stroke();
    ctx.fill();

    ctx.fillStyle = '#ffcc00';
    for (const p of poly) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPlayer() {
  const halfLen = STICK_LENGTH / 2;
  const dx = Math.cos(player.angle) * halfLen;
  const dy = Math.sin(player.angle) * halfLen;
  const x1 = player.x - dx, y1 = player.y - dy;
  const x2 = player.x + dx, y2 = player.y + dy;

  const flashing = player.invulnTimer > 0 && Math.floor(player.invulnTimer * 10) % 2 === 0;
  const color = flashing ? '#ff4444' : '#fff';

  ctx.strokeStyle = color;
  ctx.lineWidth = STICK_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x1, y1, END_BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x2, y2, END_BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(player.x, player.y, CENTER_BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  if (player.heldKeys[0]) drawKeyGlyph(x1, y1, KEY_COLOR_HEX[player.heldKeys[0]]);
  if (player.heldKeys[1]) drawKeyGlyph(x2, y2, KEY_COLOR_HEX[player.heldKeys[1]]);
}

updateCamera();
updateScore();
updateHp();
updateLevelLabel();
let lastTime = performance.now();
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function orient(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function onSegment(a, b, c) {
  return Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) &&
         Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);
}
function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;
  return false;
}
function segToSegDist(p1, p2, p3, p4) {
  if (segmentsIntersect(p1, p2, p3, p4)) return 0;
  return Math.min(
    distToSegment(p1.x, p1.y, p3.x, p3.y, p4.x, p4.y),
    distToSegment(p2.x, p2.y, p3.x, p3.y, p4.x, p4.y),
    distToSegment(p3.x, p3.y, p1.x, p1.y, p2.x, p2.y),
    distToSegment(p4.x, p4.y, p1.x, p1.y, p2.x, p2.y)
  );
}

// Treats the rotating stick as a capsule (segment + radius) so a hit only
// registers when the stick itself overlaps a polygon, not just its center.
function capsuleHitsPolygon(x1, y1, x2, y2, r, pixelPoly) {
  if (pointInPolygon(x1, y1, pixelPoly) || pointInPolygon(x2, y2, pixelPoly)) return true;
  const p1 = { x: x1, y: y1 }, p2 = { x: x2, y: y2 };
  for (let i = 0; i < pixelPoly.length; i++) {
    const a = pixelPoly[i], b = pixelPoly[(i + 1) % pixelPoly.length];
    if (segToSegDist(p1, p2, a, b) <= r) return true;
  }
  return false;
}

function findCollidingObstacleForStick(cx, cy, angle, moveDir) {
  const halfLen = STICK_LENGTH / 2;
  const dx = Math.cos(angle) * halfLen;
  const dy = Math.sin(angle) * halfLen;
  const x1 = cx - dx, y1 = cy - dy;
  const x2 = cx + dx, y2 = cy + dy;
  for (const o of obstacles) {
    if (o.type === 'keyhole' && openedKeyholes.has(o)) continue;
    if (!capsuleHitsPolygon(x1, y1, x2, y2, STICK_COLLISION_RADIUS, toPixelPoly(o.grid))) continue;
    if (o.type === 'oneway') {
      const dv = DIR_VECTORS[o.dir];
      const dot = moveDir.x * dv.x + moveDir.y * dv.y;
      if (dot <= 0) continue; // moving with/across the shape, not against its blocked direction
    }
    if (o.type === 'keyhole') {
      const slot = player.heldKeys.indexOf(o.color);
      if (slot !== -1) {
        openedKeyholes.add(o);
        player.heldKeys[slot] = null;
        continue; // unlocked by the matching key just now, treat as passable
      }
    }
    return o;
  }
  return null;
}

function restart() {
  player.hp = player.maxHp;
  player.gameOver = false;
  player.win = false;
  player.invulnTimer = 0;
  player.knockbackTimer = 0;
  player.x = player.startGrid.gx * GRID;
  player.y = player.startGrid.gy * GRID;
  player.heldKeys = [null, null];
  openedKeyholes = new Set();
  resetRemainingMarkers();
  resetRemainingKeys();
  updateHp();
  updateScore();
  updateLevelLabel();
}

function updateLevelLabel() {
  levelEl.textContent = `Level ${currentLevelIndex + 1} / ${LEVELS.length}`;
}

function updateHp() {
  hpEl.textContent = Array(player.hp).fill('♥').join(' '); // `HP: ${player.hp}/${player.maxHp}`;
}

function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }

function update(dt) {
  player.angle += player.angularSpeed * dt;

  if (editorMode) {
    if (!viewMode) {
      let mx = 0, my = 0;
      if (keys.has('ArrowUp')) my -= 1;
      if (keys.has('ArrowDown')) my += 1;
      if (keys.has('ArrowLeft')) mx -= 1;
      if (keys.has('ArrowRight')) mx += 1;

      if (mx !== 0 || my !== 0) {
        const len = Math.hypot(mx, my);
        mx /= len;
        my /= len;
        camera.x = Math.max(0, Math.min(WORLD_W - VIEW_W, camera.x + mx * EDITOR_PAN_SPEED * dt));
        camera.y = Math.max(0, Math.min(WORLD_H - VIEW_H, camera.y + my * EDITOR_PAN_SPEED * dt));
      }
    }
    return;
  }

  if (player.gameOver || player.win) return;

  if (player.invulnTimer > 0) player.invulnTimer = Math.max(0, player.invulnTimer - dt);

  if (player.knockbackTimer > 0) {
    player.knockbackTimer = Math.max(0, player.knockbackTimer - dt);
    const t = easeOutQuad(1 - player.knockbackTimer / KNOCKBACK_DURATION);
    player.x = player.knockbackFrom.x + (player.knockbackTo.x - player.knockbackFrom.x) * t;
    player.y = player.knockbackFrom.y + (player.knockbackTo.y - player.knockbackFrom.y) * t;
  } else {
    let mx = 0, my = 0;
    if (keys.has('ArrowUp')) my -= 1;
    if (keys.has('ArrowDown')) my += 1;
    if (keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('ArrowRight')) mx += 1;

    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my);
      mx /= len;
      my /= len;

      const margin = STICK_LENGTH / 2;
      let nx = Math.max(margin, Math.min(WORLD_W - margin, player.x + mx * player.speed * dt));
      let ny = Math.max(margin, Math.min(WORLD_H - margin, player.y + my * player.speed * dt));

      const blockingObstacle = findCollidingObstacleForStick(nx, ny, player.angle, { x: mx, y: my });
      if (blockingObstacle) {
        // Blocked: recoil visibly away from the obstacle instead of tunneling through.
        const margin2 = STICK_LENGTH / 2;
        player.knockbackFrom = { x: player.x, y: player.y };
        player.knockbackTo = {
          x: Math.max(margin2, Math.min(WORLD_W - margin2, player.x - mx * KNOCKBACK_DISTANCE)),
          y: Math.max(margin2, Math.min(WORLD_H - margin2, player.y - my * KNOCKBACK_DISTANCE)),
        };
        player.knockbackTimer = KNOCKBACK_DURATION;

        if (blockingObstacle.type !== 'oneway' && player.invulnTimer <= 0) {
          player.hp--;
          player.invulnTimer = HIT_INVULN_SECONDS;
          updateHp();
          if (player.hp <= 0) {
            player.hp = 0;
            player.gameOver = true;
            updateHp();
          }
        }
      } else {
        player.x = nx;
        player.y = ny;
      }
    }
  }

  updateCamera();
  collectMarkers();
  collectKeys();

  if (remainingMarkers.length === 0 && !player.gameOver) {
    const dx = player.goalGrid.gx * GRID - player.x;
    const dy = player.goalGrid.gy * GRID - player.y;
    if (Math.hypot(dx, dy) <= GOAL_RADIUS) player.win = true;
  }
}

function collectMarkers() {
  for (let i = remainingMarkers.length - 1; i >= 0; i--) {
    const m = remainingMarkers[i];
    const dx = m.gx * GRID - player.x;
    const dy = m.gy * GRID - player.y;
    if (Math.hypot(dx, dy) <= COLLECT_RADIUS) {
      remainingMarkers.splice(i, 1);
      collectedCount++;
      updateScore();
    }
  }
}

// Either ball on the stick can pick up a key, but only into an empty slot;
// the key then renders on (and stays attached to) that specific ball.
function collectKeys() {
  const halfLen = STICK_LENGTH / 2;
  const dx = Math.cos(player.angle) * halfLen;
  const dy = Math.sin(player.angle) * halfLen;
  const balls = [
    { x: player.x - dx, y: player.y - dy },
    { x: player.x + dx, y: player.y + dy },
  ];
  for (let i = remainingKeys.length - 1; i >= 0; i--) {
    const k = remainingKeys[i];
    const kx = k.gx * GRID, ky = k.gy * GRID;
    for (let slot = 0; slot < 2; slot++) {
      if (player.heldKeys[slot]) continue;
      const b = balls[slot];
      if (Math.hypot(kx - b.x, ky - b.y) <= KEY_COLLECT_RADIUS) {
        player.heldKeys[slot] = k.color;
        remainingKeys.splice(i, 1);
        break;
      }
    }
  }
}

function updateScore() {
  scoreEl.textContent = `${remainingMarkers.length} remaining`;
}

function render() {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  ctx.save();
  const { scale, offsetX, offsetY } = getTransform();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  if (viewMode) {
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
  }
  if (editorMode) drawGrid();
  drawObstacles();
  drawMarkers();
  drawKeys();
  drawGoal();
  drawEditor();
  drawPlayer();
  ctx.restore();

  if (player.gameOver) drawGameOver();
  else if (player.win) drawWinScreen();
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff4444';
  ctx.font = 'bold 48px monospace';
  ctx.fillText('GAME OVER', VIEW_W / 2, VIEW_H / 2 - 10);

  ctx.fillStyle = '#ccc';
  ctx.font = '18px monospace';
  ctx.fillText('Press Enter to restart', VIEW_W / 2, VIEW_H / 2 + 30);
  ctx.textAlign = 'left';
}

function drawWinScreen() {
  const isLastLevel = currentLevelIndex >= LEVELS.length - 1;

  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 48px monospace';
  ctx.fillText(isLastLevel ? 'ALL LEVELS COMPLETE' : 'LEVEL COMPLETE', VIEW_W / 2, VIEW_H / 2 - 10);

  ctx.fillStyle = '#ccc';
  ctx.font = '18px monospace';
  ctx.fillText(isLastLevel ? 'Press Enter to play again' : 'Press Enter for next level', VIEW_W / 2, VIEW_H / 2 + 30);
  ctx.textAlign = 'left';
}

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 1 / 30);
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
