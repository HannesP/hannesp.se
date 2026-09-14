"use strict";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TILE = 40;           // pixel size of one tile
const ROOM_COLS = 18;      // tiles per room, horizontally
const ROOM_ROWS = 12;      // tiles per room, vertically
const GRID_COLS = 4;       // rooms per level, horizontally
const GRID_ROWS = 3;       // rooms per level, vertically
const DOOR_SIZE = 3;       // tiles wide, door gap in a wall

const WALL_HEIGHT = 24;    // px the top face of a wall is raised, for pseudo-3D
const COVER_HEIGHT = 11;   // shorter than WALL_HEIGHT — reads as waist-high, not full cover
const PLAYER_HEIGHT = 14;
const PLAYER_HEIGHT_CROUCH = 6;

const BARREL_RADIUS = 16;
const BARREL_HEIGHT = 20;

const HEALTH_PACK_RADIUS = 14;
const HEALTH_PACK_HEIGHT = 10;
const HEALTH_PACK_HEAL = 20;

const BEER_GLASS_RADIUS = 9;
const BEER_GLASS_HEIGHT = 13;

// A whiskey bottle behaves exactly like a beer glass (see glassRestHeight,
// shatterGlassProp, shatterGlassesAlongRay — all shared) — it just looks
// different and leaves a whiskey-colored puddle. Same footprint radius as a
// beer glass, so it interacts (hit-testing, dragging, shot collision) the
// same way; only its drawn body/neck heights are its own.
const WHISKEY_BOTTLE_RADIUS = BEER_GLASS_RADIUS;
const WHISKEY_BOTTLE_BODY_HEIGHT = 15;
const WHISKEY_BOTTLE_NECK_HEIGHT = 9;
const WHISKEY_BOTTLE_NECK_RADIUS = 4;
const WHISKEY_BOTTLE_HEIGHT = WHISKEY_BOTTLE_BODY_HEIGHT + WHISKEY_BOTTLE_NECK_HEIGHT;

const CHAIR_RADIUS = 12;      // also its collision radius, like a barrel's
const CHAIR_SEAT_HEIGHT = 8;
const CHAIR_BACK_HEIGHT = 20; // backrest rises this far above the seat

const ENEMY_FIRE_COOLDOWN = 2; // seconds between shots
// A beat held at full stand, before firing, and again at full stand after
// firing before ducking back down — see updateEnemyStance. Without it the
// stand/fire/crouch cycle reads as one instant flicker instead of a
// deliberate "pop up, shoot, duck back down."
const ENEMY_ENGAGE_PAUSE = 0.2;
const ENEMY_MAX_HEALTH = 40;
const ENEMY_DAMAGE = 12;
const HIT_KNOCKBACK = 6; // px a shooter/target is shoved back, along the shot's line, on a non-lethal hit — same for an enemy hit by the player and the player hit by an enemy
const PLAYER_MAX_HEALTH = 100;
// Getting hit stuns the shooter's target out of firing (but not out of
// taking further damage) for this long — a shootout beat where landing a
// hit buys a moment of safety instead of an instant trade. Applies the same
// way to the player and to enemies — see fireEnemyWeapon/fireWeapon (where
// it's set) and the fire gates in update()/updateEnemyStance (where it's
// checked).
const SHOT_COOLDOWN = 0.5;

// Angular spread of an enemy's shot scales with range: tight up close,
// wide at distance — a stand-in for how much harder a target is to track
// precisely the farther away it is. Within ENEMY_ACCURATE_RANGE they shoot
// at their tightest; beyond ENEMY_INACCURATE_RANGE, their widest.
const ENEMY_SPREAD_MIN_RAD = (4 * Math.PI) / 180;
const ENEMY_SPREAD_MAX_RAD = (22 * Math.PI) / 180;
const ENEMY_ACCURATE_RANGE = 3 * TILE;
const ENEMY_INACCURATE_RANGE = 12 * TILE;

// A moving player is a harder target to track, so widen enemy spread while
// the player has movement input held.
const ENEMY_MOVING_SPREAD_MULT = 1.8;

// The raised top face of a row-0 wall tile extends WALL_HEIGHT px above the
// room's own bounds. Reserve that much header room on the canvas so it isn't
// clipped, and shift all drawing down by the same amount.
const TOP_PADDING = WALL_HEIGHT;

const TILE_FLOOR_A = 0;
const TILE_FLOOR_B = 1;
const TILE_WALL = 2;
const TILE_OBSTACLE = 3;
const TILE_COVER = 4; // waist-height: blocks movement, but not sightlines/bullets

const canvas = document.getElementById("game");
canvas.width = ROOM_COLS * TILE;
canvas.height = ROOM_ROWS * TILE + TOP_PADDING;
document.getElementById("hud").style.width = canvas.width + "px";
const ctx = canvas.getContext("2d");

// Offscreen scratch canvas puddles are flattened onto before hitting the
// main canvas — see buildPoolLayer — so two overlapping puddles read as one
// puddle's worth of opacity instead of stacking darker where they overlap.
// Sized to the room's own footprint (no TOP_PADDING — puddles never reach
// up into that header strip) and in the same untranslated, room-local
// coordinate space pool.x/y already use.
const poolLayerCanvas = document.createElement("canvas");
poolLayerCanvas.width = ROOM_COLS * TILE;
poolLayerCanvas.height = ROOM_ROWS * TILE;
const poolLayerCtx = poolLayerCanvas.getContext("2d");

// ---------------------------------------------------------------------------
// Level: a grid of rooms. Each room is a 2D tile array with a 1-tile wall
// border, punctured by door gaps wherever a neighboring room exists.
// ---------------------------------------------------------------------------

function buildRoom(exits) {
  const tiles = [];
  for (let row = 0; row < ROOM_ROWS; row++) {
    const rowTiles = [];
    for (let col = 0; col < ROOM_COLS; col++) {
      const checker = (row + col) % 2 === 0 ? TILE_FLOOR_A : TILE_FLOOR_B;
      rowTiles.push(checker);
    }
    tiles.push(rowTiles);
  }

  const colDoorStart = Math.floor(ROOM_COLS / 2) - Math.floor(DOOR_SIZE / 2);
  const rowDoorStart = Math.floor(ROOM_ROWS / 2) - Math.floor(DOOR_SIZE / 2);

  for (let col = 0; col < ROOM_COLS; col++) {
    const inDoorRange = col >= colDoorStart && col < colDoorStart + DOOR_SIZE;
    if (!(exits.N && inDoorRange)) tiles[0][col] = TILE_WALL;
    if (!(exits.S && inDoorRange)) tiles[ROOM_ROWS - 1][col] = TILE_WALL;
  }
  for (let row = 0; row < ROOM_ROWS; row++) {
    const inDoorRange = row >= rowDoorStart && row < rowDoorStart + DOOR_SIZE;
    if (!(exits.W && inDoorRange)) tiles[row][0] = TILE_WALL;
    if (!(exits.E && inDoorRange)) tiles[row][ROOM_COLS - 1] = TILE_WALL;
  }

  return {
    tiles, exits,
    barrels: [], enemies: [], healthPacks: [], beerGlasses: [], whiskeyBottles: [], chairs: [],
    hats: [], bulletHoles: [], beerPools: [], beerShards: [], cartridges: [],
  };
}

function buildLevel() {
  const rooms = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    const rowRooms = [];
    for (let c = 0; c < GRID_COLS; c++) {
      const exits = {
        N: r > 0,
        S: r < GRID_ROWS - 1,
        W: c > 0,
        E: c < GRID_COLS - 1,
      };
      rowRooms.push(buildRoom(exits));
    }
    rooms.push(rowRooms);
  }
  return rooms;
}

const level = buildLevel();

// A fresh enemy, as placed by the level editor's "enemy" brush or loaded
// from a saved/default level snapshot. Cooldown starts randomized so a
// room full of enemies doesn't fire in lockstep.
function makeEnemy(x, y) {
  return {
    x, y, facingAngle: 0,
    cooldown: Math.random() * ENEMY_FIRE_COOLDOWN,
    muzzleFlashTime: 0,
    health: ENEMY_MAX_HEALTH,
    shotCooldown: 0,   // seconds left of a getting-shot stun — see SHOT_COOLDOWN
    crouching: false,  // current crouch TARGET — same meaning as player.crouching
    crouchAnim: 0,      // 0 standing .. 1 crouched — same easing as the player's, see updateEnemyStance
    phase: "resting",   // "resting" | "standingUp" | "preFire" | "postFire" | "crouchingDown"
    phaseTimer: 0,        // seconds left in a timed phase — see ENEMY_ENGAGE_PAUSE
  };
}

// True only once an enemy has fully settled into a crouch (crouchAnim all
// the way to 1) — mid-transition, popping up or ducking down, they're not
// actually down behind cover yet/anymore, so they're not protected from
// incoming fire either (see nearestEnemyAlongRay/fireWeapon).
function isEnemyCrouched(enemy) {
  return enemy.crouchAnim === 1;
}

// An enemy's height right now — exactly playerVisualHeight's own formula,
// just driven by the enemy's own crouchAnim instead of the player's.
function enemyVisualHeight(enemy) {
  return PLAYER_HEIGHT - enemy.crouchAnim * (PLAYER_HEIGHT - PLAYER_HEIGHT_CROUCH);
}

// Drives one enemy's crouch/engage cycle for this frame:
//  - "resting": tucked into cover (or just standing in the open, if there's
//    no cover nearby) waiting out its fire cooldown. Once the cooldown
//    expires with a clear line to the player, an enemy already standing in
//    the open just fires immediately, same as before crouching existed —
//    but a crouched one has to stand up first (its own cover would block a
//    shot fired from a crouch — see castRay/fireEnemyWeapon).
//  - "standingUp" / "crouchingDown": waiting for crouchAnim to finish
//    easing toward its target — the exact same rise/descend the player's
//    own crouchAnim uses in update(), just applied to this enemy.
//  - "preFire" / "postFire": a short held beat (ENEMY_ENGAGE_PAUSE), fully
//    stood, before actually firing and again before ducking back down — so
//    the cycle reads as a deliberate pop-up-and-shoot, not an instant
//    flicker.
function updateEnemyStance(room, enemy, dt, hasLineOfSight) {
  if (enemy.shotCooldown > 0) enemy.shotCooldown = Math.max(0, enemy.shotCooldown - dt);

  const crouchTarget = enemy.crouching ? 1 : 0;
  if (enemy.crouchAnim !== crouchTarget) {
    const step = dt / CROUCH_TRANSITION_TIME;
    enemy.crouchAnim = enemy.crouchAnim < crouchTarget
      ? Math.min(crouchTarget, enemy.crouchAnim + step)
      : Math.max(crouchTarget, enemy.crouchAnim - step);
  }

  switch (enemy.phase) {
    case "resting":
      // Would crouching here actually help against the player right now?
      // Needs both: cover to physically tuck into (isNextToCover), and
      // that cover actually sitting between this enemy and the player's
      // current position (hasCoverBetween) — cover on the wrong side of
      // them doesn't hide them from anything. Rechecked every frame since,
      // unlike the enemy, the player keeps moving.
      enemy.crouching =
        isNextToCover(room, enemy.x, enemy.y) &&
        hasCoverBetween(room, player.x, player.y, enemy.x, enemy.y);
      enemy.cooldown -= dt;
      if (enemy.cooldown <= 0) {
        // A recently-shot enemy still stands up out of cover on schedule
        // (so it doesn't look frozen), it just holds its fire once stood —
        // see the shotCooldown check in "preFire" below.
        if (hasLineOfSight) {
          if (enemy.crouching) {
            enemy.crouching = false; // stand up before shooting over cover
            enemy.phase = "standingUp";
          } else if (enemy.shotCooldown <= 0) {
            fireEnemyWeapon(enemy);
          }
        }
        // Resets on schedule whether or not a shot actually went off, so a
        // blocked enemy doesn't "bank" shots and loose them all the moment
        // sight is regained.
        enemy.cooldown = ENEMY_FIRE_COOLDOWN;
      }
      break;
    case "standingUp":
      if (enemy.crouchAnim === 0) {
        enemy.phase = "preFire";
        enemy.phaseTimer = ENEMY_ENGAGE_PAUSE;
      }
      break;
    case "preFire":
      enemy.phaseTimer -= dt;
      if (enemy.phaseTimer <= 0) {
        // Sight may have been lost while standing up (e.g. the player
        // ducked out of view), or the enemy may have taken a hit while
        // standing up and still be in its own shot-cooldown stun — either
        // way, skip the shot but still duck back down rather than getting
        // stuck standing.
        if (hasLineOfSight && enemy.shotCooldown <= 0) fireEnemyWeapon(enemy);
        enemy.phase = "postFire";
        enemy.phaseTimer = ENEMY_ENGAGE_PAUSE;
      }
      break;
    case "postFire":
      enemy.phaseTimer -= dt;
      if (enemy.phaseTimer <= 0) {
        enemy.crouching = true; // back down into the cover it stood up from
        enemy.phase = "crouchingDown";
      }
      break;
    case "crouchingDown":
      if (enemy.crouchAnim === 1) {
        enemy.phase = "resting";
      }
      break;
  }
}

// Blocks movement: full walls/obstacles and waist-height cover alike.
function isSolidTile(t) {
  return t === TILE_WALL || t === TILE_OBSTACLE || t === TILE_COVER;
}

// Blocks bullets/sightlines: full-height blocks only — cover is low enough
// to shoot (and see) over — but only at low trajectory. A crouched shooter's
// muzzle sits at cover height, so cover blocks their own shots too, same
// as it hides them: you can't fire over the very thing you're hiding
// behind without standing up first. The same low/high split is reused for
// shots (and sightlines) aimed AT the player: a crouching player is down at
// cover height, so cover between them and the shooter blocks it, the same
// as it would block a crouching shooter's own low shot.
function isBulletBlockingTile(t, lowTrajectory) {
  if (t === TILE_WALL || t === TILE_OBSTACLE) return true;
  return lowTrajectory && t === TILE_COVER;
}

function roomAt(gridRow, gridCol) {
  if (gridRow < 0 || gridRow >= GRID_ROWS || gridCol < 0 || gridCol >= GRID_COLS) return null;
  return level[gridRow][gridCol];
}

function isSolidAt(room, row, col) {
  if (row < 0 || row >= ROOM_ROWS || col < 0 || col >= ROOM_COLS) return false;
  return isSolidTile(room.tiles[row][col]);
}

function isBulletBlockingAt(room, row, col, lowTrajectory) {
  if (row < 0 || row >= ROOM_ROWS || col < 0 || col >= ROOM_COLS) return false;
  return isBulletBlockingTile(room.tiles[row][col], lowTrajectory);
}

function isCoverAt(room, row, col) {
  if (row < 0 || row >= ROOM_ROWS || col < 0 || col >= ROOM_COLS) return false;
  return room.tiles[row][col] === TILE_COVER;
}

// Whether (x, y) has a waist-height cover tile on at least one orthogonal
// side — i.e. there's actually something to tuck in behind there, not just
// open floor. Shared by isPlayerInCover (crouching there does something)
// and the enemy AI (whether crouching is worth doing at all).
function isNextToCover(room, x, y) {
  const col = Math.floor(x / TILE);
  const row = Math.floor(y / TILE);
  return (
    isCoverAt(room, row - 1, col) ||
    isCoverAt(room, row + 1, col) ||
    isCoverAt(room, row, col - 1) ||
    isCoverAt(room, row, col + 1)
  );
}

// Whether a straight line between (x1, y1) and (x2, y2) crosses any
// waist-height cover tile — the same tile-marching test castRay uses to
// decide whether a low-trajectory shot between two points is blocked, just
// without an actual shot to trace. Used by the enemy AI (see
// updateEnemyStance) to tell "there's cover next to me" apart from "that
// cover is actually between me and the player right now" — cover on the
// wrong side doesn't hide you from anything.
function hasCoverBetween(room, x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const stepSize = 4;
  const steps = Math.ceil(dist / stepSize);
  for (let i = 1; i < steps; i++) {
    const t = (i * stepSize) / dist;
    const col = Math.floor((x1 + (x2 - x1) * t) / TILE);
    const row = Math.floor((y1 + (y2 - y1) * t) / TILE);
    if (isCoverAt(room, row, col)) return true;
  }
  return false;
}

// True while the player is crouched with a waist-height cover tile on at
// least one orthogonal side — i.e. actually tucked in behind something,
// not just crouching in the open.
function isPlayerInCover() {
  if (!player.crouching) return false;
  const room = roomAt(gridRow, gridCol);
  return isNextToCover(room, player.x, player.y);
}

// ---------------------------------------------------------------------------
// Pushable props — free-moving (not tile-locked) props the player shoves
// around by walking into them. Barrels and chairs both work this way; they
// only differ in whether they block bullets (see castRay for barrels —
// chairs are never checked there, which is what makes them cover-free).
// ---------------------------------------------------------------------------

// Whether a circle of the given radius centered at (x, y) would overlap a
// solid tile. Checked at four cardinal points rather than a bounding box's
// corners, since that's a closer fit for a round object.
function circleBlockedByTiles(room, x, y, radius) {
  const points = [
    [x, y - radius], [x, y + radius],
    [x - radius, y], [x + radius, y],
  ];
  return points.some(([px, py]) => isSolidAt(room, Math.floor(py / TILE), Math.floor(px / TILE)));
}

function propOverlapsAnother(collection, self, x, y) {
  return collection.some((other) => {
    if (other === self) return false;
    return Math.hypot(x - other.x, y - other.y) < self.radius + other.radius;
  });
}

// Pushes a prop (barrel or chair) directly away from the player if they're
// overlapping. If the prop has nowhere to go (blocked by a wall, cover, or
// another prop in the same collection), the player is shoved back out of
// it instead, same as hitting any other solid obstacle. Props in different
// collections don't block each other — a barrel and a chair can overlap.
function resolvePropPush(room, prop, collection) {
  const dx = prop.x - player.x;
  const dy = prop.y - player.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  const minDist = player.size / 2 + prop.radius;
  if (dist >= minDist) return;

  const overlap = minDist - dist;
  const nx = dx / dist;
  const ny = dy / dist;
  const newX = prop.x + nx * overlap;
  const newY = prop.y + ny * overlap;

  if (
    !circleBlockedByTiles(room, newX, newY, prop.radius) &&
    !propOverlapsAnother(collection, prop, newX, newY)
  ) {
    prop.x = newX;
    prop.y = newY;
  } else {
    player.x -= nx * overlap;
    player.y -= ny * overlap;
  }
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

const ROTATE_SPEED = 3.2;       // radians / second, turning left/right
const CROUCH_SPEED_MULTIPLIER = 0.3;
const CROUCH_TRANSITION_TIME = 0.2; // seconds to fully rise/descend between standing and crouched

// The player's three weapons, cycled with Q (see cycleWeapon) — each is a
// full magazine of `capacity` rounds consumed one per trigger pull
// (regardless of pelletCount) and refilled by reloading (see startReload).
// A shot's actual firing angle is the player's facing jittered by up to
// `spreadRad` either way, redrawn independently per pellet — 0 for the
// rifle means it's dead straight as long as it's paced; see
// rapidFireThreshold/rapidFireJitterMax below for what happens otherwise —
// matching its "straight but slower" role next to the revolver's
// faster-but-wilder shots and the shotgun's wide, multi-pellet spread.
//
// Casings: `casingsPerShot` eject with each trigger pull (fireWeapon), the
// rifle's own single ejection port. `casingsOnReload` instead eject all at
// once when reloading starts (startReload) — the revolver dumping its whole
// cylinder and the shotgun picking spent shells out by hand aren't a
// per-shot ejection at all. `casingColor` overrides the usual brass casing
// color (see spawnCartridge/drawCartridge) for the shotgun's red shells.
//
// `damagePerPellet` is the point-blank damage a pellet lands for. For a
// weapon with `tracerFadeDistance` set (currently just the shotgun), the
// actual damage a given pellet does is scaled down by distanceFalloff at
// however far it actually traveled — the same falloff its tracer's opacity
// follows — so a shotgun blast hits hardest up close and tapers off to
// nothing by tracerFadeDistance, same as its visible spread. Weapons
// without tracerFadeDistance always deal the full damagePerPellet
// regardless of range.
const WEAPONS = [
  {
    id: "rifle",
    name: "Rifle",
    capacity: 10,
    fireCooldown: 0.5,
    reloadTime: 1.2,
    pelletCount: 1,
    spreadRad: 0,
    // Firing again less than rapidFireThreshold seconds after the last shot
    // (fireCooldown alone allows up to 2/s) adds extra spread on top of
    // spreadRad — scaling from 0 right at the threshold up to
    // rapidFireJitterMax for a shot fired with (near) zero gap — see the
    // fire gate in fireWeapon(). Weapons that omit these two fields (the
    // revolver, the shotgun) aren't penalized this way at all.
    rapidFireThreshold: 1,
    rapidFireJitterMax: (12 * Math.PI) / 180,
    damagePerPellet: 10,
    casingsPerShot: 1,
    casingsOnReload: 0,
  },
  {
    id: "revolver",
    name: "Revolver",
    capacity: 6,
    fireCooldown: 0.14,
    reloadTime: 0.9,
    pelletCount: 1,
    spreadRad: (7 * Math.PI) / 180,
    damagePerPellet: 10,
    casingsPerShot: 0,
    casingsOnReload: 6,
  },
  {
    id: "shotgun",
    name: "Shotgun",
    capacity: 2,
    fireCooldown: 0.6,
    reloadTime: 1.5,
    pelletCount: 5,
    spreadRad: (14 * Math.PI) / 180,
    damagePerPellet: 16,
    casingsPerShot: 0,
    casingsOnReload: 2,
    casingColor: "#b5342a",
    // Pellets are thinner than a normal tracer, and fade out with distance
    // on top of the usual lifetime-based fade — solid right at the muzzle,
    // fully transparent by tracerFadeDistance out — since a shotgun blast
    // reads as a short-range spray rather than a single traced line. See
    // drawTracers.
    tracerLineWidth: 1.4,
    tracerFadeDistance: 8 * TILE,
  },
];

const player = {
  x: (ROOM_COLS / 2) * TILE,
  y: (ROOM_ROWS / 2) * TILE,
  size: 26,       // collision box side length
  speed: 190,     // px / second
  color: "#e0553b",
  facingAngle: 0, // radians; turned by left/right input, kept while idle
  crouching: false,
  crouchAnim: 0,  // 0 = fully standing, 1 = fully crouched; eases toward crouching's target over CROUCH_TRANSITION_TIME — see playerVisualHeight and the fire gate in update()
  health: PLAYER_MAX_HEALTH,
  shotCooldown: 0, // seconds left of a getting-shot stun — see SHOT_COOLDOWN
  moving: false,  // true while forward/back/strafe input is held; widens enemy aim
  weaponIndex: 0,             // index into WEAPONS — current weapon, changed by cycleWeapon
  ammo: WEAPONS.map((w) => w.capacity), // rounds left in each weapon's own magazine, kept even while it's not equipped
  reloading: false,
  reloadTimeRemaining: 0,
  timeSinceLastShot: WEAPONS.map(() => Infinity), // seconds since each weapon's own last shot — see rapidFireThreshold in fireWeapon()
};

// ---------------------------------------------------------------------------
// Weapon: hitscan — one instant line per pellet, fired at a slightly
// randomized angle around the player's facing direction. Each pellet stops
// at the first solid tile it touches. No projectile travel time.
// ---------------------------------------------------------------------------

const TRACER_LIFETIME = 0.12;           // seconds a tracer stays visible
const RIFLE_LENGTH = 16;                // px the rifle's tip sticks out past the player box
const MUZZLE_FLASH_LIFETIME = 0.06;     // seconds the muzzle flash stays visible

// How high the player (and so the rifle/muzzle) currently stands — used to
// keep the gun, its tip, and its tracers all rendered at a consistent
// height, whether standing or crouched. Interpolated by crouchAnim rather
// than snapping, so rising/descending plays out as a brief animation
// instead of an instant cut — see the crouchAnim easing in update().
function playerVisualHeight() {
  return PLAYER_HEIGHT - player.crouchAnim * (PLAYER_HEIGHT - PLAYER_HEIGHT_CROUCH);
}

// Ground-plane position of a rifle's tip, given the shooter's position and
// facing angle — this is where their shots originate. Shared by the player
// and enemies, who carry the same body radius and rifle length.
function muzzlePosition(x, y, angle) {
  const dist = player.size / 2 + RIFLE_LENGTH;
  return {
    x: x + Math.cos(angle) * dist,
    y: y + Math.sin(angle) * dist,
  };
}

let fireRequested = false; // set on each fresh trigger press (not key-repeat); consumed by the next shot
let fireCooldownRemaining = 0;
let muzzleFlashTime = 0;
const tracers = [];

// Cycles to the next weapon (wrapping around), dropping any reload the
// weapon being switched away from was mid-way through — switching guns
// mid-reload abandons it rather than finishing in the background, same as
// most shooters. Ammo already in the magazine is untouched either way.
function cycleWeapon() {
  player.weaponIndex = (player.weaponIndex + 1) % WEAPONS.length;
  player.reloading = false;
  player.reloadTimeRemaining = 0;
}

// Starts reloading the current weapon back to a full magazine, unless it's
// already full or already reloading. Firing while reloading just waits (see
// the fire gate in update()) rather than cancelling it.
function startReload() {
  const weapon = WEAPONS[player.weaponIndex];
  if (player.reloading || player.ammo[player.weaponIndex] >= weapon.capacity) return;
  player.reloading = true;
  player.reloadTimeRemaining = weapon.reloadTime;

  // Weapons that don't eject a casing per shot (see fireWeapon) dump their
  // spent casings all at once here instead, as reloading starts.
  const room = roomAt(gridRow, gridCol);
  const heightOffset = playerVisualHeight();
  for (let i = 0; i < weapon.casingsOnReload; i++) {
    spawnCartridge(room, player.x, player.y, player.facingAngle, heightOffset * 0.85, weapon.casingColor);
  }
}

// Sparks: a short-lived kick of debris at the bullet's impact point, to
// sell the hit as landing on something solid.
const SPARK_LIFETIME = 0.25;
const sparks = [];

function spawnSparks(x, y, angle, heightOffset, color = "255,214,120") {
  const count = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    // Kick back roughly opposite the bullet's travel direction, fanned out.
    const kick = angle + Math.PI + (Math.random() * 2 - 1) * (Math.PI / 3);
    const speed = 60 + Math.random() * 100;
    sparks.push({
      x, y,
      vx: Math.cos(kick) * speed,
      vy: Math.sin(kick) * speed,
      life: SPARK_LIFETIME,
      heightOffset,
      color,
    });
  }
}

// Bullet holes: unlike sparks, these don't fade — a permanent scorch mark
// left in a wall/obstacle/cover tile's surface wherever a shot stopped dead
// on the environment rather than an enemy or barrel. Lives in room.bulletHoles
// so it stays put in whatever room it was made in, same as barrels/hats.
// Capped per room so a very long fight in one room doesn't accumulate marks
// forever.
const MAX_BULLET_HOLES_PER_ROOM = 60;

function spawnBulletHole(room, x, y, heightOffset, small = false) {
  room.bulletHoles.push({ x, y, heightOffset, small });
  if (room.bulletHoles.length > MAX_BULLET_HOLES_PER_ROOM) room.bulletHoles.shift();
}

// A beer glass (or whiskey bottle) isn't tile-locked (it's a free-positioned
// prop, same as a barrel), but it's meant to rest on top of a waist-height
// cover tile — so its resting height is derived from whatever tile currently
// sits under it, same spirit as isPlayerInCover checking the tile under the
// player. Placed off cover, it just rests on the floor instead of floating
// or erroring. Shared by both prop kinds since this only depends on x/y.
function glassRestHeight(room, glass) {
  const col = Math.floor(glass.x / TILE);
  const row = Math.floor(glass.y / TILE);
  return isCoverAt(room, row, col) ? COVER_HEIGHT : 0;
}

// Glass shards: shaped and colored like flying glass, launched in a full
// spread around the impact (a shattering glass throws debris outward in
// every direction, not just back toward the shooter like sparks' kick
// cone), and — unlike sparks — they don't fade. Like a flying hat/cartridge,
// each pops upward (vz) and arcs back down under its own (much gentler)
// gravity — see BEER_SHARD_GRAVITY — rather than just sliding straight down
// from wherever it started, so light glass actually hangs and tumbles in
// the air instead of dropping immediately. They also slide (vx/vy drag
// toward 0) until they touch down, then freeze in place and stay there for
// good, same spirit as a landed hat. Lives in room.beerShards, capped like
// the other permanent debris.
const BEER_SHARD_COUNT = 5;
const MAX_BEER_SHARDS_PER_ROOM = 100;
const BEER_SHARD_GRAVITY = 260;       // px/s^2 — noticeably softer than CARTRIDGE_GRAVITY/HAT_GRAVITY
const BEER_SHARD_POP_UP_SPEED = [45, 85]; // px/s, initial upward kick range

function spawnBeerShards(room, x, y, heightOffset) {
  const baseAngle = Math.random() * Math.PI * 2;
  for (let i = 0; i < BEER_SHARD_COUNT; i++) {
    const shardAngle = baseAngle + (i / BEER_SHARD_COUNT) * Math.PI * 2 + (Math.random() * 2 - 1) * 0.3;
    const speed = 70 + Math.random() * 60;
    room.beerShards.push({
      x, y,
      vx: Math.cos(shardAngle) * speed,
      vy: Math.sin(shardAngle) * speed,
      vz: randRange(BEER_SHARD_POP_UP_SPEED),
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() * 2 - 1) * 10,
      heightOffset,
      landed: false,
    });
  }
  if (room.beerShards.length > MAX_BEER_SHARDS_PER_ROOM) {
    room.beerShards.splice(0, room.beerShards.length - MAX_BEER_SHARDS_PER_ROOM);
  }
}

// Beer pools: unlike shards, these don't fade — a permanent stain left
// wherever a glass (or bottle) shattered, growing from nothing up to its
// full size instead of appearing instantly. Rendered at the same height the
// glass was resting at (see glassRestHeight) — on top of a cover tile if
// that's where the glass sat, same as the glass itself — so it stays
// puddled on that surface rather than dripping down to the floor. Capped
// per room like bullet holes, for the same reason. fill defaults to beer's
// amber, but a whiskey bottle passes its own darker tone — the pool itself
// doesn't otherwise care what it came from.
//
// fill is a solid (alpha-less) color rather than baking translucency in —
// POOL_ALPHA is applied once, for the whole flattened puddle layer, when
// it's composited onto the main canvas (see buildPoolLayer/render), so two
// overlapping puddles read as one puddle's worth of opacity instead of
// stacking darker where they overlap.
const MAX_BEER_POOLS_PER_ROOM = 20;
const BEER_POOL_GROWTH_SPEED = 18; // px/s the radius grows until it hits maxRadius
const BEER_POOL_FILL = "rgb(201,131,42)";
const WHISKEY_POOL_FILL = "rgb(120,58,18)";
const POOL_ALPHA = 0.5;

function spawnBeerPool(room, x, y, heightOffset, fill = BEER_POOL_FILL) {
  room.beerPools.push({ x, y, radius: 0, maxRadius: randRange([12, 18]), heightOffset, fill });
  if (room.beerPools.length > MAX_BEER_POOLS_PER_ROOM) room.beerPools.shift();
}

// Breaks a beer glass or whiskey bottle: shards fly from where it sat (cover
// height and all), and a pool spreads at that same spot, in whatever color
// that prop leaves behind. Doesn't remove the prop from its collection
// itself — callers do that, same division of labor as knockBackEnemy vs.
// the splice in fireWeapon.
function shatterGlassProp(room, x, y, restHeight, breakHeight, poolFill) {
  spawnBeerShards(room, x, y - restHeight, restHeight + breakHeight * 0.6);
  spawnBeerPool(room, x, y, restHeight, poolFill);
}

function shatterBeerGlass(room, glass) {
  const restHeight = glassRestHeight(room, glass);
  shatterGlassProp(room, glass.x, glass.y, restHeight, BEER_GLASS_HEIGHT, BEER_POOL_FILL);
}

function shatterWhiskeyBottle(room, bottle) {
  const restHeight = glassRestHeight(room, bottle);
  shatterGlassProp(room, bottle.x, bottle.y, restHeight, WHISKEY_BOTTLE_HEIGHT, WHISKEY_POOL_FILL);
}

// A beer glass (or whiskey bottle) is fragile, not an obstacle — castRay
// doesn't stop for one, so a shot passes straight through and can still go
// on to hit whatever's behind it. This is the other half of that: given the
// ray's actual path (however far it did travel before something else
// stopped it), shatter every item in `items` that path passed through, and
// return the surviving collection for the caller to store back. Reuses
// rayHitsPoint's closest-approach math per item rather than a step-by-step
// march, since the ray itself was never marched with these in mind.
function shatterGlassesAlongRay(items, shatterFn, room, originX, originY, angle, hit) {
  const hitDist = Math.hypot(hit.x - originX, hit.y - originY);
  const hitItems = items.filter((it) =>
    rayHitsPoint(originX, originY, angle, it.x, it.y, it.radius, hitDist)
  );
  if (hitItems.length === 0) return items;
  for (const item of hitItems) shatterFn(room, item);
  return items.filter((it) => !hitItems.includes(it));
}

// Distance along the ray from (originX, originY) at the given angle to its
// closest approach to (targetX, targetY) — or null if the target sits
// behind the ray's origin, past maxDist, or further off the ray's line
// than targetRadius (i.e. the shot doesn't actually connect).
function rayHitsPoint(originX, originY, angle, targetX, targetY, targetRadius, maxDist) {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const toTargetX = targetX - originX;
  const toTargetY = targetY - originY;
  const along = toTargetX * dirX + toTargetY * dirY;
  if (along < 0 || along > maxDist) return false;
  const closestX = originX + dirX * along;
  const closestY = originY + dirY * along;
  return Math.hypot(targetX - closestX, targetY - closestY) <= targetRadius;
}

// The nearest enemy a ray fired from (originX, originY) at `angle` would
// eventually reach, ignoring walls/cover/barrels along the way — i.e.
// whichever enemy is actually in the player's crosshairs, regardless of
// what's in front of them. Used to decide, before marching the ray for
// real, whether this shot should run at low trajectory because its
// presumptive target happens to be crouched — see fireWeapon and castRay's
// own comment below. Ignoring obstacles here is deliberate: any cover
// between the shooter and this enemy is exactly what a low trajectory is
// there to check for; if it's in the way, castRay stops at it instead of
// reaching them.
function nearestEnemyAlongRay(room, originX, originY, angle) {
  const enemyRadius = player.size / 2;
  const maxRange = Math.hypot(ROOM_COLS * TILE, ROOM_ROWS * TILE);
  let nearest = null;
  let nearestDist = Infinity;
  for (const enemy of room.enemies) {
    const dist = Math.hypot(enemy.x - originX, enemy.y - originY);
    if (dist < nearestDist && rayHitsPoint(originX, originY, angle, enemy.x, enemy.y, enemyRadius, maxRange)) {
      nearest = enemy;
      nearestDist = dist;
    }
  }
  return nearest;
}

// Marches along the given angle from (x, y) in fixed steps until it enters
// a bullet-blocking tile, a barrel, or a living enemy, or reaches maxRange,
// returning the stopping point. Waist-height cover only stops it at low
// trajectory (lowTrajectory true) — the player crouching, whether tracing
// their own outgoing shot or an enemy's shot toward them; or a crouching
// enemy, when tracing the player's own shot toward the enemy it's
// presumptively aimed at (see nearestEnemyAlongRay and isEnemyCrouched) —
// in every case, the crouching party is down at cover height, so cover in
// the way hides them from whoever's shooting at them. An enemy's own
// outgoing shot never runs low trajectory off its own crouch — it stands to
// fire (see fireEnemyWeapon), same as it would have to physically. A
// standing shooter's shots, and shots aimed at a standing target, both
// clear it. excludeEnemy lets an enemy's own shot ignore its own body (the
// ray starts inside its own radius otherwise).
function castRay(room, x, y, angle, lowTrajectory, excludeEnemy = null) {
  const stepSize = 4;
  const maxRange = Math.hypot(ROOM_COLS * TILE, ROOM_ROWS * TILE);
  const dx = Math.cos(angle) * stepSize;
  const dy = Math.sin(angle) * stepSize;
  const enemyRadius = player.size / 2;

  let px = x;
  let py = y;
  for (let dist = 0; dist < maxRange; dist += stepSize) {
    px += dx;
    py += dy;
    const col = Math.floor(px / TILE);
    const row = Math.floor(py / TILE);
    if (isBulletBlockingAt(room, row, col, lowTrajectory)) break;
    if (room.barrels.some((b) => Math.hypot(px - b.x, py - b.y) < b.radius)) break;
    if (room.enemies.some((e) => e !== excludeEnemy && Math.hypot(px - e.x, py - e.y) < enemyRadius)) break;
  }
  return { x: px, y: py };
}

// Shoves a surviving, hit enemy back a few px along the shot's travel
// direction, so a hit reads as having force behind it. Skipped if that
// would push them into a wall/obstacle/cover — better to hold position
// than clip through geometry.
function knockBackEnemy(room, enemy, angle) {
  const newX = enemy.x + Math.cos(angle) * HIT_KNOCKBACK;
  const newY = enemy.y + Math.sin(angle) * HIT_KNOCKBACK;
  if (!circleBlockedByTiles(room, newX, newY, player.size / 2)) {
    enemy.x = newX;
    enemy.y = newY;
  }
}

// The player's side of the same idea: shoved back along the shot's travel
// direction when an enemy's shot connects and they survive it. Uses
// collides (the player's own square-footprint check) rather than
// circleBlockedByTiles, since that's what governs the player's own
// movement elsewhere.
function knockBackPlayer(room, angle) {
  const newX = player.x + Math.cos(angle) * HIT_KNOCKBACK;
  const newY = player.y + Math.sin(angle) * HIT_KNOCKBACK;
  if (!collides(room, newX, newY)) {
    player.x = newX;
    player.y = newY;
  }
}

// A short-lived projectile arc: launched with upward + outward velocity,
// pulled down by gravity, tumbling (ellipse rotation) the whole way, until
// it touches the ground and settles into a flat, resting hat — same
// draw call as a worn hat, just with no body underneath and a frozen
// rotation. Lives in room.hats so it stays put in whatever room the enemy
// died in, same as barrels/health packs.
const HAT_GRAVITY = 640;              // px/s^2
const HAT_POP_UP_SPEED = [160, 230];  // px/s, launch speed range straight up
const HAT_POP_OUT_SPEED = [70, 140];  // px/s, horizontal launch speed range
const HAT_POP_SPIN_SPEED = [7, 13];   // rad/s, magnitude range (direction randomized)

function randRange([min, max]) {
  return min + Math.random() * (max - min);
}

function spawnHatFlight(room, enemy, angle) {
  // Knocked roughly away from the shot's travel direction, fanned out, same
  // spirit as spawnSparks' kickback.
  const outAngle = angle + (Math.random() * 2 - 1) * (Math.PI / 3);
  const outSpeed = randRange(HAT_POP_OUT_SPEED);
  room.hats.push({
    x: enemy.x, y: enemy.y, z: enemyVisualHeight(enemy),
    vx: Math.cos(outAngle) * outSpeed,
    vy: Math.sin(outAngle) * outSpeed,
    vz: randRange(HAT_POP_UP_SPEED),
    rotation: 0,
    rotationSpeed: randRange(HAT_POP_SPIN_SPEED) * (Math.random() < 0.5 ? -1 : 1),
    landed: false,
  });
}

// Ejected cartridges: a small brass (or, per weapon, tinted — see
// spawnCartridge) casing popped out to the side, arcing up under gravity
// (same z/vz mechanics as a flying hat) and tumbling as it goes, then
// landing and staying put for good — permanent floor debris, same as bullet
// holes/beer shards. Lives in room.cartridges, capped like the other
// permanent debris. When each weapon ejects its casings — per shot or all
// at once on reload — is up to WEAPONS' casingsPerShot/casingsOnReload.
const CARTRIDGE_GRAVITY = 520;
const CARTRIDGE_UP_SPEED = [70, 110];
const CARTRIDGE_SIDE_SPEED = [55, 95];
const CARTRIDGE_SPIN_SPEED = [9, 15];
const CARTRIDGE_EJECT_JITTER = (35 * Math.PI) / 180; // spread around straight right of facing
const MAX_CARTRIDGES_PER_ROOM = 80;

// Ejects to the shooter's right (facingAngle + 90°, jittered) — the usual
// ejection side for a right-handed action — from roughly gun height. color
// overrides the casing's usual brass body (see drawCartridge) — used for
// the shotgun's red shells.
function spawnCartridge(room, x, y, facingAngle, heightOffset, color) {
  const ejectAngle = facingAngle + Math.PI / 2 + (Math.random() * 2 - 1) * CARTRIDGE_EJECT_JITTER;
  const sideSpeed = randRange(CARTRIDGE_SIDE_SPEED);
  room.cartridges.push({
    x, y, z: heightOffset,
    vx: Math.cos(ejectAngle) * sideSpeed,
    vy: Math.sin(ejectAngle) * sideSpeed,
    vz: randRange(CARTRIDGE_UP_SPEED),
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: randRange(CARTRIDGE_SPIN_SPEED) * (Math.random() < 0.5 ? -1 : 1),
    landed: false,
    color,
  });
  if (room.cartridges.length > MAX_CARTRIDGES_PER_ROOM) room.cartridges.shift();
}

// How much of a pellet's force is left after traveling `distance`, for a
// weapon whose tracer fades over `fadeDistance` (see WEAPONS) — 1 right at
// the muzzle, linearly down to 0 at fadeDistance and beyond. This is the
// exact same ramp drawTracers uses for the tracer's opacity, just evaluated
// at a single point instead of drawn as a gradient, so a pellet's damage
// and its bullet hole (see fireWeapon) always match how faded it looks.
// Weapons without a fadeDistance (no falloff at all) always return 1.
function distanceFalloff(fadeDistance, distance) {
  if (!fadeDistance) return 1;
  return Math.max(0, 1 - distance / fadeDistance);
}

// Fires the current weapon: one trigger pull, consuming one round from its
// own magazine regardless of pelletCount — a shotgun blast is still one
// shell. Each of the weapon's pellets is its own independent hitscan line,
// redrawn at a fresh random angle within spreadRad of facing (0 for the
// rifle, so it always lands dead-on unless fired too fast — see
// rapidFireThreshold below) and resolved exactly like a single shot:
// stopped by the first wall/barrel/enemy in its path, damaging whatever
// enemy it lands on for damagePerPellet scaled by distanceFalloff. Casings
// eject per casingsPerShot, not per pellet — see WEAPONS.
function fireWeapon() {
  const weapon = WEAPONS[player.weaponIndex];
  const timeSincePrev = player.timeSinceLastShot[player.weaponIndex];
  player.timeSinceLastShot[player.weaponIndex] = 0;
  fireCooldownRemaining = weapon.fireCooldown;
  muzzleFlashTime = MUZZLE_FLASH_LIFETIME;
  player.ammo[player.weaponIndex] = Math.max(0, player.ammo[player.weaponIndex] - 1);

  // Extra spread stacked on top of the weapon's own spreadRad when fired
  // faster than rapidFireThreshold allows, scaling from 0 right at the
  // threshold up to rapidFireJitterMax for (near) zero gap — see WEAPONS.
  // Weapons without these fields (currently the revolver and shotgun) are
  // never penalized this way.
  let extraSpread = 0;
  if (weapon.rapidFireThreshold && timeSincePrev < weapon.rapidFireThreshold) {
    const rapidness = 1 - timeSincePrev / weapon.rapidFireThreshold;
    extraSpread = rapidness * weapon.rapidFireJitterMax;
  }

  const room = roomAt(gridRow, gridCol);
  const heightOffset = playerVisualHeight();
  for (let i = 0; i < weapon.casingsPerShot; i++) {
    spawnCartridge(room, player.x, player.y, player.facingAngle, heightOffset * 0.85, weapon.casingColor);
  }

  for (let i = 0; i < weapon.pelletCount; i++) {
    const angle = player.facingAngle + (Math.random() * 2 - 1) * (weapon.spreadRad + extraSpread);
    const origin = muzzlePosition(player.x, player.y, player.facingAngle);
    // Low trajectory if the player's crouched, or if whoever this pellet is
    // presumptively aimed at is — see nearestEnemyAlongRay and castRay.
    const presumptiveTarget = nearestEnemyAlongRay(room, origin.x, origin.y, angle);
    const lowTrajectory = player.crouching || Boolean(presumptiveTarget && isEnemyCrouched(presumptiveTarget));
    const hit = castRay(room, origin.x, origin.y, angle, lowTrajectory);
    tracers.push({
      x1: origin.x, y1: origin.y, x2: hit.x, y2: hit.y,
      life: TRACER_LIFETIME, heightOffset, color: "255,224,120",
      lineWidth: weapon.tracerLineWidth, fadeDistance: weapon.tracerFadeDistance,
    });

    // Glasses/bottles don't stop the shot (see castRay), so check for them
    // separately against the ray's actual path — any it passed through
    // shatter, whether or not the shot goes on to also hit an enemy/wall/
    // barrel beyond them.
    room.beerGlasses = shatterGlassesAlongRay(room.beerGlasses, shatterBeerGlass, room, origin.x, origin.y, angle, hit);
    room.whiskeyBottles = shatterGlassesAlongRay(room.whiskeyBottles, shatterWhiskeyBottle, room, origin.x, origin.y, angle, hit);

    // How much this particular pellet has left by the time it landed —
    // full force for the rifle/revolver (no fadeDistance), tapering off for
    // the shotgun exactly as far as its tracer had already faded visually.
    const falloff = distanceFalloff(weapon.tracerFadeDistance, Math.hypot(hit.x - origin.x, hit.y - origin.y));

    // If the ray was stopped by an enemy rather than a wall/barrel, it lands
    // on them — damage them, and kill (remove) them once their HP runs out.
    const hitEnemy = room.enemies.find((e) => Math.hypot(hit.x - e.x, hit.y - e.y) < player.size / 2);
    if (hitEnemy) {
      hitEnemy.health -= weapon.damagePerPellet * falloff;
      if (hitEnemy.health <= 0) {
        spawnHatFlight(room, hitEnemy, angle);
        room.enemies.splice(room.enemies.indexOf(hitEnemy), 1);
      } else {
        hitEnemy.shotCooldown = SHOT_COOLDOWN;
        knockBackEnemy(room, hitEnemy, angle);
      }
      spawnSparks(hit.x, hit.y, angle, heightOffset, "255,70,60");
    } else {
      spawnSparks(hit.x, hit.y, angle, heightOffset);
      // No mark left at all once a pellet's fully spent (falloff 0); one
      // that's already mostly faded (below half strength) leaves a smaller
      // mark than a full-force hit — see drawBulletHole.
      if (falloff > 0 && isSolidAt(room, Math.floor(hit.y / TILE), Math.floor(hit.x / TILE))) {
        spawnBulletHole(room, hit.x, hit.y, heightOffset, falloff < 0.5);
      }
    }
  }
}

// Angular spread of an enemy's shot widens with range — tight and lethal
// up close, wide and often-missing at distance — as a stand-in for how
// much harder a target is to track precisely the farther away it is.
function enemySpreadForDistance(dist) {
  const t = Math.min(1, Math.max(0,
    (dist - ENEMY_ACCURATE_RANGE) / (ENEMY_INACCURATE_RANGE - ENEMY_ACCURATE_RANGE)
  ));
  const spread = ENEMY_SPREAD_MIN_RAD + t * (ENEMY_SPREAD_MAX_RAD - ENEMY_SPREAD_MIN_RAD);
  return player.moving ? spread * ENEMY_MOVING_SPREAD_MULT : spread;
}

// True while an enemy has a clear, unjittered line to the player — same
// blocking rules as its shots (walls/obstacles/barrels/other enemies, and
// cover that actually sits between this enemy and a crouching player) —
// used to let it track the player visually even between shots, rather than
// only snapping to face them when firing.
function enemyHasLineOfSightToPlayer(room, enemy) {
  const baseAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
  const hit = castRay(room, enemy.x, enemy.y, baseAngle, player.crouching, enemy);
  const hitDist = Math.hypot(hit.x - enemy.x, hit.y - enemy.y);
  return rayHitsPoint(enemy.x, enemy.y, baseAngle, player.x, player.y, player.size / 2, hitDist);
}

// An enemy's single hitscan shot, aimed at the player's current position
// and jittered by a range-dependent spread so it doesn't land dead-on every
// time. Blocked by the same walls/obstacles/barrels/other enemies a
// player's shot would be; also blocked by waist-height cover that sits
// between this enemy and the player, but only while the player is
// crouching — a crouching player is down at cover height, so an obstacle
// on the line between them and this particular enemy hides them from it,
// exactly like it would hide a crouching shooter's own low shot.
function fireEnemyWeapon(enemy) {
  const room = roomAt(gridRow, gridCol);
  const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
  const baseAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
  const angle = baseAngle + (Math.random() * 2 - 1) * enemySpreadForDistance(dist);
  enemy.facingAngle = angle;
  enemy.muzzleFlashTime = MUZZLE_FLASH_LIFETIME;

  // Always called with the enemy already fully stood up (updateEnemyStance
  // only fires from "resting" while in the open, or from "preFire" once
  // crouchAnim has finished easing to 0) — otherwise a crouched enemy's own
  // muzzle would be right behind the cover protecting it, and its "low
  // trajectory" shot would hit that cover point-blank instead of ever
  // reaching the player.
  const origin = muzzlePosition(enemy.x, enemy.y, angle);
  const heightOffset = enemyVisualHeight(enemy);
  // Low trajectory only if the player is crouched (see castRay) — the
  // enemy itself is always standing for the shot it's actively taking.
  const hit = castRay(room, origin.x, origin.y, angle, player.crouching, enemy);
  const hitDist = Math.hypot(hit.x - origin.x, hit.y - origin.y);
  const connects = rayHitsPoint(origin.x, origin.y, angle, player.x, player.y, player.size / 2, hitDist);
  const end = connects ? { x: player.x, y: player.y } : hit;

  tracers.push({
    x1: origin.x, y1: origin.y, x2: end.x, y2: end.y,
    life: TRACER_LIFETIME, heightOffset, color: "255,224,120",
  });
  spawnCartridge(room, enemy.x, enemy.y, angle, heightOffset * 0.85);

  // Glasses/bottles don't stop the shot (see castRay) — shatter any it
  // passed through regardless of whether it also goes on to connect with
  // the player, same as the player's own shots.
  room.beerGlasses = shatterGlassesAlongRay(room.beerGlasses, shatterBeerGlass, room, origin.x, origin.y, angle, hit);
  room.whiskeyBottles = shatterGlassesAlongRay(room.whiskeyBottles, shatterWhiskeyBottle, room, origin.x, origin.y, angle, hit);

  spawnSparks(end.x, end.y, angle, connects ? playerVisualHeight() : heightOffset, "255,224,120");
  if (!connects && isSolidAt(room, Math.floor(hit.y / TILE), Math.floor(hit.x / TILE))) {
    spawnBulletHole(room, hit.x, hit.y, heightOffset);
  }

  if (connects) {
    player.health = Math.max(0, player.health - ENEMY_DAMAGE);
    // Same non-lethal-only knockback rule as knockBackEnemy — no point
    // shoving a defeated player around.
    if (player.health > 0) {
      player.shotCooldown = SHOT_COOLDOWN;
      knockBackPlayer(room, angle);
    }
  }
}

let gridRow = 0;
let gridCol = 0;

const roomLabelEl = document.getElementById("roomLabel");
const roomTotalEl = document.getElementById("roomTotal");
const statusLabelEl = document.getElementById("statusLabel");
const healthLabelEl = document.getElementById("healthLabel");
const ammoLabelEl = document.getElementById("ammoLabel");
roomTotalEl.textContent = `${GRID_COLS * GRID_ROWS} rooms (${GRID_COLS}x${GRID_ROWS})`;

// Enemies check this same crouch/cover state before their shots are allowed
// to connect, so it doubles as a "how exposed am I to enemy fire" readout:
// standing is always exposed; crouching only hides you while tucked against
// a waist-height cover tile.
function updateStatusHud() {
  if (player.health <= 0) {
    statusLabelEl.textContent = "Defeated";
    statusLabelEl.style.color = "#e0553b";
  } else if (!player.crouching) {
    statusLabelEl.textContent = "Standing — exposed";
    statusLabelEl.style.color = "#e0553b";
  } else if (isPlayerInCover()) {
    statusLabelEl.textContent = "Crouched — in cover";
    statusLabelEl.style.color = "#6fcf6f";
  } else {
    statusLabelEl.textContent = "Crouched — no cover nearby";
    statusLabelEl.style.color = "#ccc";
  }
  healthLabelEl.textContent = `HP: ${player.health}`;

  const weapon = WEAPONS[player.weaponIndex];
  ammoLabelEl.textContent = player.reloading
    ? `${weapon.name}: reloading…`
    : `${weapon.name}: ${player.ammo[player.weaponIndex]}/${weapon.capacity}`;
}

function updateHud() {
  roomLabelEl.textContent = `${gridCol + 1},${gridRow + 1}`;
}
updateHud();

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const keys = new Set();

// F/B drive the player forward/backward along its current facing; L/R turn
// that facing left/right — tank-style controls, so the player can aim (and
// so shoot) in any direction just by turning, independent of which way
// they're moving. Holding Shift locks that facing (L/R stop turning it) and
// switches all four keys to 8-direction movement in fixed world directions
// instead — F/B/L/R become north/south/west/east on the map — so the player
// can move freely around a locked aim point instead of turning to move.
const KEY_TO_DIR = {
  KeyW: "F", ArrowUp: "F",
  KeyS: "B", ArrowDown: "B",
  KeyA: "L", ArrowLeft: "L",
  KeyD: "R", ArrowRight: "R",
};

let strafeModifier = false;

window.addEventListener("keydown", (e) => {
  if (KEY_TO_DIR[e.code]) {
    keys.add(KEY_TO_DIR[e.code]);
    e.preventDefault();
  } else if (e.code === "Space" && !editMode) {
    if (!e.repeat) fireRequested = true; // manual fire: one shot per fresh press, not per held frame
    e.preventDefault();
  } else if (e.code === "KeyC" && !e.ctrlKey && !e.metaKey && !editMode) {
    player.crouching = true;
    e.preventDefault();
  } else if (e.code === "KeyQ" && !editMode) {
    if (!e.repeat) cycleWeapon();
    e.preventDefault();
  } else if (e.code === "KeyR" && !editMode) {
    if (!e.repeat) startReload();
    e.preventDefault();
  } else if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
    strafeModifier = true;
  }
});
window.addEventListener("keyup", (e) => {
  if (KEY_TO_DIR[e.code]) {
    keys.delete(KEY_TO_DIR[e.code]);
    e.preventDefault();
  } else if (e.code === "KeyC") {
    player.crouching = false;
  } else if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
    strafeModifier = false;
  }
});
// If the window loses focus mid-hold, the matching keyup never arrives —
// drop all held state so keys don't get stuck "on".
window.addEventListener("blur", () => {
  keys.clear();
  strafeModifier = false;
  fireRequested = false;
});

// ---------------------------------------------------------------------------
// Collision
// ---------------------------------------------------------------------------

function tileSolidAt(room, px, py) {
  const col = Math.floor(px / TILE);
  const row = Math.floor(py / TILE);
  if (row < 0 || row >= ROOM_ROWS || col < 0 || col >= ROOM_COLS) return false; // let transitions handle bounds
  return isSolidTile(room.tiles[row][col]);
}

function collides(room, x, y) {
  const half = player.size / 2;
  const corners = [
    [x - half, y - half],
    [x + half, y - half],
    [x - half, y + half],
    [x + half, y + half],
  ];
  return corners.some(([cx, cy]) => tileSolidAt(room, cx, cy));
}

// ---------------------------------------------------------------------------
// Room transitions
// ---------------------------------------------------------------------------

function tryTransition() {
  const half = player.size / 2;
  const room = roomAt(gridRow, gridCol);

  if (player.y + half < 0 && room.exits.N) {
    const next = roomAt(gridRow - 1, gridCol);
    if (next) {
      gridRow -= 1;
      player.y = (ROOM_ROWS - 2) * TILE + TILE / 2;
      updateHud();
      return;
    }
  }
  if (player.y - half > ROOM_ROWS * TILE && room.exits.S) {
    const next = roomAt(gridRow + 1, gridCol);
    if (next) {
      gridRow += 1;
      player.y = TILE + TILE / 2;
      updateHud();
      return;
    }
  }
  if (player.x + half < 0 && room.exits.W) {
    const next = roomAt(gridRow, gridCol - 1);
    if (next) {
      gridCol -= 1;
      player.x = (ROOM_COLS - 2) * TILE + TILE / 2;
      updateHud();
      return;
    }
  }
  if (player.x - half > ROOM_COLS * TILE && room.exits.E) {
    const next = roomAt(gridRow, gridCol + 1);
    if (next) {
      gridCol += 1;
      player.x = TILE + TILE / 2;
      updateHud();
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

function update(dt) {
  // The level editor freezes gameplay entirely — no player movement, no
  // enemy AI/fire, nothing in flight ages — so the room holds still while
  // placing/dragging things.
  if (editMode) return;

  const room = roomAt(gridRow, gridCol);

  // Once defeated, the player stops moving/shooting and enemies stop
  // firing at them — but tracers/sparks/muzzle flashes already in flight
  // still play out.
  if (player.health > 0) {
    // Eases crouchAnim toward crouching's target (1 = crouched, 0 =
    // standing) at a constant rate that covers the full 0..1 range in
    // CROUCH_TRANSITION_TIME — a linear rise/descend rather than a snap.
    // Reversing mid-transition (tapping crouch again before it settles)
    // just turns the ease around from wherever it currently is, so it
    // doesn't need to finish one direction before starting the other.
    const crouchTarget = player.crouching ? 1 : 0;
    if (player.crouchAnim !== crouchTarget) {
      const step = dt / CROUCH_TRANSITION_TIME;
      player.crouchAnim = player.crouchAnim < crouchTarget
        ? Math.min(crouchTarget, player.crouchAnim + step)
        : Math.max(crouchTarget, player.crouchAnim - step);
    }

    let dx = 0;
    let dy = 0;
    if (strafeModifier) {
      // Shift locks aim — L/R don't rotate facing at all here — and swaps
      // movement to 8 fixed world directions (F/B/L/R as north/south/west/
      // east on the map) instead of sliding relative to facing, so the
      // player can move any which way while holding a direction steady.
      if (keys.has("F")) dy -= 1;
      if (keys.has("B")) dy += 1;
      if (keys.has("L")) dx -= 1;
      if (keys.has("R")) dx += 1;
      if (dx !== 0 && dy !== 0) {
        const inv = 1 / Math.SQRT2;
        dx *= inv;
        dy *= inv;
      }
      player.moving = dx !== 0 || dy !== 0;
    } else {
      let rotateDir = 0;
      if (keys.has("L")) rotateDir -= 1;
      if (keys.has("R")) rotateDir += 1;
      if (rotateDir !== 0) {
        player.facingAngle += rotateDir * ROTATE_SPEED * dt;
      }

      let moveDir = 0;
      if (keys.has("F")) moveDir += 1;
      if (keys.has("B")) moveDir -= 1;

      player.moving = moveDir !== 0;

      // Forward/backward runs along facing.
      dx = Math.cos(player.facingAngle) * moveDir;
      dy = Math.sin(player.facingAngle) * moveDir;
    }

    const step = player.speed * (player.crouching ? CROUCH_SPEED_MULTIPLIER : 1) * dt;

    const nextX = player.x + dx * step;
    if (!collides(room, nextX, player.y)) {
      player.x = nextX;
    }

    const nextY = player.y + dy * step;
    if (!collides(room, player.x, nextY)) {
      player.y = nextY;
    }

    for (const barrel of room.barrels) {
      resolvePropPush(room, barrel, room.barrels);
    }
    for (const chair of room.chairs) {
      resolvePropPush(room, chair, room.chairs);
    }

    // Walking over a health pack heals and consumes it — but only while
    // actually hurt, so a full-health player can walk past one and leave it
    // for later instead of burning it for nothing.
    if (player.health < PLAYER_MAX_HEALTH) {
      for (let i = room.healthPacks.length - 1; i >= 0; i--) {
        const pack = room.healthPacks[i];
        if (Math.hypot(player.x - pack.x, player.y - pack.y) < player.size / 2 + pack.radius) {
          player.health = Math.min(PLAYER_MAX_HEALTH, player.health + HEALTH_PACK_HEAL);
          room.healthPacks.splice(i, 1);
        }
      }
    }

    for (const enemy of room.enemies) {
      // Only actually fires with a clear line to the player — e.g. not
      // while they're crouched out of sight behind waist-height cover —
      // see updateEnemyStance for the full crouch/stand/fire cycle.
      const hasLineOfSight = enemyHasLineOfSightToPlayer(room, enemy);
      if (hasLineOfSight) {
        enemy.facingAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
      }
      updateEnemyStance(room, enemy, dt, hasLineOfSight);
    }

    tryTransition();

    if (fireCooldownRemaining > 0) fireCooldownRemaining -= dt;
    if (player.shotCooldown > 0) player.shotCooldown = Math.max(0, player.shotCooldown - dt);
    for (let i = 0; i < player.timeSinceLastShot.length; i++) player.timeSinceLastShot[i] += dt;

    if (player.reloading) {
      player.reloadTimeRemaining -= dt;
      if (player.reloadTimeRemaining <= 0) {
        player.reloading = false;
        player.ammo[player.weaponIndex] = WEAPONS[player.weaponIndex].capacity;
      }
    } else if (player.ammo[player.weaponIndex] <= 0) {
      // Empty magazine reloads on its own — no need to pull the trigger on
      // a dry gun first.
      startReload();
    }

    // Mid rise/descend, the player can't fire — a press during the
    // transition just waits (fireRequested stays set) and goes off the
    // moment crouchAnim settles, same as a press waiting out the cooldown.
    // Recently getting shot holds fire the same way — see SHOT_COOLDOWN.
    // Reloading is the same wait, except a request against an empty
    // magazine (already auto-reloading itself, above) doesn't hold onto
    // fireRequested — an empty trigger pull isn't a shot queued up for
    // whenever ammo shows up.
    const crouchSettled = player.crouchAnim === crouchTarget;
    if (fireRequested) {
      if (player.ammo[player.weaponIndex] <= 0) {
        fireRequested = false;
      } else if (fireCooldownRemaining <= 0 && crouchSettled && player.shotCooldown <= 0 && !player.reloading) {
        fireWeapon();
        fireRequested = false;
      }
    }
  }

  if (muzzleFlashTime > 0) muzzleFlashTime = Math.max(0, muzzleFlashTime - dt);
  for (const enemy of room.enemies) {
    if (enemy.muzzleFlashTime > 0) enemy.muzzleFlashTime = Math.max(0, enemy.muzzleFlashTime - dt);
  }

  for (const hat of room.hats) {
    if (hat.landed) continue;
    hat.vz -= HAT_GRAVITY * dt;
    hat.x += hat.vx * dt;
    hat.y += hat.vy * dt;
    hat.z += hat.vz * dt;
    hat.rotation += hat.rotationSpeed * dt;
    if (hat.z <= 0) {
      hat.z = 0;
      hat.landed = true;
      hat.vx = 0;
      hat.vy = 0;
      hat.vz = 0;
      hat.rotation = 0; // settle flat, brim-up, regardless of where the tumble left off
    }
  }

  for (const c of room.cartridges) {
    if (c.landed) continue;
    c.vz -= CARTRIDGE_GRAVITY * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.z += c.vz * dt;
    c.rotation += c.rotationSpeed * dt;
    if (c.z <= 0) {
      c.z = 0;
      c.landed = true;
      c.vx = 0;
      c.vy = 0;
      c.vz = 0;
      c.rotationSpeed = 0;
    }
  }

  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    if (tracers[i].life <= 0) tracers.splice(i, 1);
  }

  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt;
    if (s.life <= 0) {
      sparks.splice(i, 1);
      continue;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vx *= 0.9;
    s.vy *= 0.9;
    s.heightOffset = Math.max(0, s.heightOffset - dt * 220);
  }

  for (const s of room.beerShards) {
    if (s.landed) continue;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vx *= 0.9;
    s.vy *= 0.9;
    s.rotation += s.rotationSpeed * dt;
    s.vz -= BEER_SHARD_GRAVITY * dt;
    s.heightOffset += s.vz * dt;
    if (s.heightOffset <= 0) {
      s.heightOffset = 0;
      s.landed = true;
      s.vx = 0;
      s.vy = 0;
      s.vz = 0;
      s.rotationSpeed = 0;
    }
  }

  for (const pool of room.beerPools) {
    if (pool.radius < pool.maxRadius) {
      pool.radius = Math.min(pool.maxRadius, pool.radius + BEER_POOL_GROWTH_SPEED * dt);
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const FLOOR_COLOR_A = "#ab9268";
const FLOOR_COLOR_B = "#9c8459";
const WALL_EDGE_COLOR = "#2b2e33";

// Each material is flat colors only, no gradients: a top face, a rim line
// along its back edge, and a single darker front face. The top/front
// contrast alone reads as a raised block without needing a gradient or a
// glowing edge highlight to sell it.
const WALL_MATERIAL = { top: "#9aa0ab", topRim: "#c3c8d1", front: "#4b4e54" };
const OBSTACLE_MATERIAL = { top: "#c98a3f", topRim: "#e8b276", front: "#7a5426" };
const COVER_MATERIAL = { top: "#8a7a52", topRim: "#b0a274", front: "#544a2e" };

function drawFloor(room) {
  for (let row = 0; row < ROOM_ROWS; row++) {
    for (let col = 0; col < ROOM_COLS; col++) {
      const t = room.tiles[row][col];
      if (t !== TILE_FLOOR_A && t !== TILE_FLOOR_B) continue;
      ctx.fillStyle = t === TILE_FLOOR_A ? FLOOR_COLOR_A : FLOOR_COLOR_B;
      ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
    }
  }
}

// Draws a rectangular footprint that has "height": a front face at the
// footprint itself, and a top face shifted upward, giving the illusion of
// a raised block viewed from slightly above. Both faces are flat fills —
// the top/front contrast is what sells the height, not a lighting
// gradient. Shared by tiles (a fixed TILE x TILE square) and any other
// free-positioned raised prop (e.g. a chair's seat/backrest) that wants
// the same look at an arbitrary size and position.
function drawRaisedRect(x, y, w, h, height, material) {
  // Front face (footprint) — only the strip below the top face actually
  // shows, but a full fill keeps the seams between adjacent blocks clean.
  ctx.fillStyle = material.front;
  ctx.fillRect(x, y, w, h);

  // Top face, raised.
  ctx.fillStyle = material.top;
  ctx.fillRect(x, y - height, w, h);

  // Rim line along the top's back edge and a seam line where it meets the
  // front, together reading as a subtle course line between blocks.
  ctx.fillStyle = material.topRim;
  ctx.fillRect(x, y - height, w, 2);
  ctx.fillStyle = WALL_EDGE_COLOR;
  ctx.fillRect(x, y - height + h, w, 1);
}

function drawRaisedTile(col, row, height, material) {
  drawRaisedRect(col * TILE, row * TILE, TILE, TILE, height, material);
}

const SHADOW_DEPTH = 6; // px a wall's contact shadow reaches onto the floor beside it

// Grounds a raised tile with a flat (non-gradient) contact shadow on the
// floor tile beyond the given edge, where that neighboring tile isn't
// itself solid.
function drawEdgeShadow(room, col, row, side) {
  const dr = side === "S" ? 1 : 0;
  const dc = side === "E" ? 1 : side === "W" ? -1 : 0;
  if (isSolidAt(room, row + dr, col + dc)) return;

  let x, y, w, h;
  if (side === "S") {
    x = col * TILE; y = (row + 1) * TILE; w = TILE; h = SHADOW_DEPTH;
  } else if (side === "E") {
    x = (col + 1) * TILE; y = row * TILE; w = SHADOW_DEPTH; h = TILE;
  } else {
    x = col * TILE - SHADOW_DEPTH; y = row * TILE; w = SHADOW_DEPTH; h = TILE;
  }
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(x, y, w, h);
}

const BARREL_SQUASH = 0.6; // vertical squash on the lid ellipses, for the top-down tilt

// A cylinder, drawn round instead of boxy: a flat body band between a base
// rim (in shadow) and a lit lid raised `height` px up — the same top/front
// raised-block trick used elsewhere, just built from ellipses instead of
// rects. Shared by barrels, the player, and enemies; only the colors and
// height differ between them.
function drawCylinder(x, y, radius, height, bodyColor, lidColor, lidStroke, drawShadow = true) {
  const ry = radius * BARREL_SQUASH;
  const topY = y - height;

  // Ground shadow — skipped for a part stacked on top of another cylinder
  // (e.g. a bottle's neck on its body), which shouldn't cast its own
  // separate shadow floating partway up the object.
  if (drawShadow) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x, y + ry * 0.3, radius * 0.95, ry * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Body: one continuous outline — the base's lower curve, straight up
  // the sides, into the lid's upper curve — instead of a flat-sided rect
  // sitting between two ellipses. That mismatch (hard vertical edges
  // meeting round rims in a different, flat color) is what read as
  // flimsy/papery rather than a solid cylinder.
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.ellipse(x, y, radius, ry, 0, 0, Math.PI);
  ctx.lineTo(x - radius, topY);
  ctx.ellipse(x, topY, radius, ry, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();

  // Dark seam along the base for depth, instead of a flat-colored rim
  // ellipse that used to sit visibly disconnected from the body.
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(x, y, radius, ry, 0, 0, Math.PI);
  ctx.stroke();

  // Lid, raised — flat fill, one shade lighter than the body.
  ctx.fillStyle = lidColor;
  ctx.beginPath();
  ctx.ellipse(x, topY, radius, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = lidStroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawBarrel(barrel) {
  const { x, y, radius } = barrel;
  drawCylinder(x, y, radius, BARREL_HEIGHT, "#6b4a26", "#c98a3f", "#5c4023");

  const topY = y - BARREL_HEIGHT;
  const ry = radius * BARREL_SQUASH;

  // Both the plank seams and the hoops below are drawn after drawCylinder,
  // so on top of everything it already drew, lid included — anything
  // placed above bandTop would cut across the lid's own front edge instead
  // of sitting on the body beneath it. bandTop (the lid's lowest point,
  // reached only at dead center) is the first y that's guaranteed clear of
  // the lid at every x across the full width, so it's the floor for
  // everything decorating the body.
  const bandTop = topY + ry;

  // Vertical plank seams (barrel staves). Clipped twice: once to the
  // body's own silhouette (the same path drawCylinder filled it with —
  // straight sides, curving in at the bottom-center rim), so a seam near
  // the left/right edge tapers off with that curve instead of running
  // straight down past the barrel's actual outline into the floor beside
  // it; and once to the flat band below bandTop, so no seam reaches up
  // into the lid either. Canvas clip() intersects on repeated calls, so
  // both restrictions apply together.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, radius, ry, 0, 0, Math.PI);
  ctx.lineTo(x - radius, topY);
  ctx.ellipse(x, topY, radius, ry, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.beginPath();
  ctx.rect(x - radius - 1, bandTop, radius * 2 + 2, y + ry - bandTop + 1);
  ctx.clip();

  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  const plankCount = 6;
  for (let i = 1; i < plankCount; i++) {
    const px = x - radius + (radius * 2 * i) / plankCount;
    ctx.beginPath();
    ctx.moveTo(px, bandTop);
    ctx.lineTo(px, y + ry);
    ctx.stroke();
  }
  ctx.restore();

  // Two metal hoops. Each is a curved band — a stroked arc built the same
  // way as the lid/base rim (an ellipse at the body's own radius/squash,
  // only its front half drawn since the back half would be hidden behind
  // the body) — so it wraps the barrel's round cross-section instead of
  // sitting flat across it like a rectangle would.
  //
  // Unlike the plank seams, a hoop doesn't need bandTop's conservative
  // margin: since it's built from the exact same ellipse shape as the lid
  // (just shifted straight down by hoopY - topY), its curve sits that same
  // constant distance below the lid's curve at every x, not just at dead
  // center — so any hoopY > topY is already guaranteed clear of the lid,
  // no matter how close. That means hoops can use fractions of the full
  // body height and land symmetrically about its vertical center, rather
  // than being squeezed into the shorter lid-avoidance band the planks need.
  ctx.strokeStyle = "rgba(35,33,30,0.8)";
  ctx.lineWidth = 2;
  for (const t of [0.3, 0.7]) {
    const hoopY = topY + BARREL_HEIGHT * t;
    ctx.beginPath();
    ctx.ellipse(x, hoopY, radius, ry, 0, 0, Math.PI);
    ctx.stroke();
  }
}

const CHAIR_SEAT_MATERIAL = { front: "#5c3d24", top: "#8a5f37", topRim: "#a97c4f" };
const CHAIR_BACK_MATERIAL = { front: "#4a3018", top: "#7a5230", topRim: "#9c7548" };

// A chair: a square (not round, unlike every other prop) raised-block
// seat, plus a thin raised slat along its back edge for a backrest — the
// same drawRaisedRect front/top trick tiles and walls use, just at an
// arbitrary free position instead of a tile. Drawn boxy on purpose so it
// silhouettes differently from the round barrels/health packs/beer
// glasses. No rotation — the backrest always faces the same edge, same as
// every other prop having a fixed, non-orientable shape.
function drawChair(chair) {
  const { x, y, radius } = chair;
  const size = radius * 2;
  const half = radius;

  // Ground shadow.
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(x, y + 2, half * 0.95, half * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Backrest, drawn first so the seat (below) paints over its unraised
  // front face within their shared footprint, leaving only its raised
  // slat visible sticking up behind the seat.
  const backDepth = size * 0.22;
  drawRaisedRect(x - half, y - half, size, backDepth, CHAIR_BACK_HEIGHT, CHAIR_BACK_MATERIAL);

  // Seat.
  drawRaisedRect(x - half, y - half, size, size, CHAIR_SEAT_HEIGHT, CHAIR_SEAT_MATERIAL);
}

// A health pack: the same cylinder shape as a barrel, in a first-aid-kit
// white, with a flat red cross on the lid — squashed to match the lid's
// elliptical tilt so the cross reads as painted on it, not floating above.
function drawHealthPack(pack) {
  const { x, y, radius } = pack;
  drawCylinder(x, y, radius, HEALTH_PACK_HEIGHT, "#b5b2a6", "#f0efe6", "#c2c2b8");

  const topY = y - HEALTH_PACK_HEIGHT;
  const ry = radius * BARREL_SQUASH;
  const armThickness = radius * 0.34;
  const armLenX = radius * 1.15;
  const armLenY = ry * 1.3;
  ctx.fillStyle = "#d43b3b";
  ctx.fillRect(x - armLenX / 2, topY - armThickness / 2, armLenX, armThickness);
  ctx.fillRect(x - armThickness / 2, topY - armLenY / 2, armThickness, armLenY);
}

// A beer glass: the same cylinder shape again, amber body and foam-white
// lid, rendered from whatever height it's resting at (see glassRestHeight —
// normally a cover tile's height, since that's what it's meant to sit on).
// A thin vertical highlight down one side reads as glass rather than a
// solid mug.
function drawBeerGlass(room, glass) {
  const { x, y, radius } = glass;
  const restHeight = glassRestHeight(room, glass);
  const groundY = y - restHeight;
  drawCylinder(x, groundY, radius, BEER_GLASS_HEIGHT, "#c9832a", "#f2ecd6", "#a9793f");

  const topY = groundY - BEER_GLASS_HEIGHT;
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(x - radius * 0.55, topY + BEER_GLASS_HEIGHT * 0.25, 1.5, BEER_GLASS_HEIGHT * 0.55);
}

// A whiskey bottle: a dark glass body cylinder with a narrower neck
// cylinder stacked on top (the neck skips its own ground shadow — see
// drawCylinder's drawShadow param — since it's not sitting on the ground
// itself, the body already cast one). Same resting-height treatment as a
// beer glass. A thin highlight down the body reads as glass, same idea as
// the glass's own highlight, just dimmer against the darker body color.
function drawWhiskeyBottle(room, bottle) {
  const { x, y, radius } = bottle;
  const restHeight = glassRestHeight(room, bottle);
  const groundY = y - restHeight;
  drawCylinder(x, groundY, radius, WHISKEY_BOTTLE_BODY_HEIGHT, "#4a2e18", "#6b4526", "#33200f");

  const neckGroundY = groundY - WHISKEY_BOTTLE_BODY_HEIGHT;
  drawCylinder(
    x, neckGroundY, WHISKEY_BOTTLE_NECK_RADIUS, WHISKEY_BOTTLE_NECK_HEIGHT,
    "#33200f", "#241708", "#1a1006", false
  );

  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x - radius * 0.5, groundY - WHISKEY_BOTTLE_BODY_HEIGHT * 0.9, 1.5, WHISKEY_BOTTLE_BODY_HEIGHT * 0.7);
}

const HAT_COLOR = "#5c4326";
const HAT_DARK = "#3a2c18";

// A cowboy hat, worn by every figure in the game: a wide flat brim (same
// squashed-ellipse trick as a barrel/health-pack lid) with a short cylinder
// crown rising from its center. Drawn at the figure's head — the raised top
// face of its body cylinder — so it rides along with crouch height and stays
// put regardless of facing angle (unlike the rifle, a hat doesn't point).
function drawCowboyHat(x, headTopY, radius, rotation = 0) {
  const brimRx = radius * 1.55;
  const brimRy = brimRx * BARREL_SQUASH;
  const brimY = headTopY - 3;
  const crownRadius = radius * 0.68;
  const crownRy = crownRadius * BARREL_SQUASH;
  const crownHeight = 9;
  const crownTopY = brimY - crownHeight;

  // Brim, drawn first so the crown stands on top of it rather than being
  // swallowed by it. `rotation` spins the squash axis of every ellipse here
  // in lockstep — cheap stand-in for a tumbling 3D hat (flat and wide at
  // rotation 0/π, edge-on and narrow near π/2) used while a hat is in flight.
  ctx.fillStyle = HAT_COLOR;
  ctx.beginPath();
  ctx.ellipse(x, brimY, brimRx, brimRy, rotation, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Crown: a short cylinder, same body/lid construction as drawCylinder.
  ctx.fillStyle = HAT_COLOR;
  ctx.beginPath();
  ctx.ellipse(x, brimY, crownRadius, crownRy, rotation, 0, Math.PI);
  ctx.lineTo(x - crownRadius, crownTopY);
  ctx.ellipse(x, crownTopY, crownRadius, crownRy, rotation, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = HAT_DARK;
  ctx.beginPath();
  ctx.ellipse(x, crownTopY, crownRadius, crownRy, rotation, 0, Math.PI * 2);
  ctx.fill();

  // Band at the crown's base.
  ctx.beginPath();
  ctx.ellipse(x, brimY - crownHeight * 0.15, crownRadius * 1.05, crownRy * 1.05, rotation, 0, Math.PI);
  ctx.fill();
}

// A hat with no body underneath — mid-flight after popping off a killed
// enemy, or already landed and resting on the floor. Reuses drawCowboyHat
// exactly as worn, just elevated by its own height (z) instead of a
// figure's, and tumbling via `rotation` while airborne.
function drawFlyingHat(hat) {
  drawCowboyHat(hat.x, hat.y - hat.z, player.size / 2, hat.rotation);
}

// While stunned (shotCooldown > 0 — see SHOT_COOLDOWN), a figure's cylinder
// blinks red on/off instead of its usual colors, for the whole stun, not
// just an instant flash on impact — a clear "can't shoot right now" tell
// shared by the player and every enemy. STUN_BLINK_INTERVAL is the on/off
// phase length; isStunFlashOn just reads remaining stun time as a clock.
const STUN_BLINK_INTERVAL = 0.1;
const STUN_BODY_COLOR = "#7a1414";
const STUN_LID_COLOR = "#ff3b30";
const STUN_LID_STROKE = "#4a0d0d";

function isStunFlashOn(shotCooldown) {
  return shotCooldown > 0 && Math.floor(shotCooldown / STUN_BLINK_INTERVAL) % 2 === 0;
}

// The player is a barrel too, just one that stands up (or crouches down)
// and carries a rifle. The collision footprint (a square around
// player.x/y) doesn't change with crouch — only how tall the cylinder is
// drawn does, since crouching doesn't change where the player physically
// fits, only how exposed they are.
function drawPlayer() {
  const height = playerVisualHeight();
  const stunned = isStunFlashOn(player.shotCooldown);
  const bodyColor = stunned ? STUN_BODY_COLOR : "#6e281b";
  const lidColor = stunned ? STUN_LID_COLOR : (isPlayerInCover() ? "#8a4530" : player.color);
  const lidStroke = stunned ? STUN_LID_STROKE : "#5c1f14";
  drawCylinder(player.x, player.y, player.size / 2, height, bodyColor, lidColor, lidStroke);
  drawRifle(player.x, player.y - height, player.facingAngle, player.size / 2, muzzleFlashTime);
  drawCowboyHat(player.x, player.y - height, player.size / 2);
}

// Enemies use the same cylinder-and-rifle figure as the player, just in a
// different color — and crouch/stand through the same eased height change
// as the player's own crouch (see updateEnemyStance).
function drawEnemy(enemy) {
  const radius = player.size / 2;
  const height = enemyVisualHeight(enemy);
  const stunned = isStunFlashOn(enemy.shotCooldown);
  const bodyColor = stunned ? STUN_BODY_COLOR : "#2e3b26";
  const lidColor = stunned ? STUN_LID_COLOR : "#5a7048";
  const lidStroke = stunned ? STUN_LID_STROKE : "#232b1f";
  drawCylinder(enemy.x, enemy.y, radius, height, bodyColor, lidColor, lidStroke);
  drawRifle(enemy.x, enemy.y - height, enemy.facingAngle, radius, enemy.muzzleFlashTime);
  drawCowboyHat(enemy.x, enemy.y - height, radius);
}

// A rifle is just a thick black line pointing the given facing angle,
// mounted on the raised top face so it moves with the figure's "head".
function drawRifle(cx, cy, angle, radius, flashTime) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const start = radius * 0.2;
  const end = radius + RIFLE_LENGTH;

  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx + cos * start, cy + sin * start);
  ctx.lineTo(cx + cos * end, cy + sin * end);
  ctx.stroke();

  drawMuzzleFlash(cx + cos * end, cy + sin * end, angle, flashTime);
}

// A brief bright burst at the rifle's tip, on for just a couple of frames
// so rapid fire reads as a flicker rather than a steady glow.
const MUZZLE_FLASH_SCALE = 2.4;

function drawMuzzleFlash(tipX, tipY, angle, flashTime) {
  if (flashTime <= 0) return;
  const alpha = flashTime / MUZZLE_FLASH_LIFETIME;
  const s = MUZZLE_FLASH_SCALE;

  ctx.save();
  ctx.translate(tipX, tipY);
  ctx.rotate(angle);

  ctx.fillStyle = `rgba(255,150,40,${alpha * 0.85})`;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(9 * s, -5 * s);
  ctx.lineTo(13 * s, 0);
  ctx.lineTo(9 * s, 5 * s);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = `rgba(255,244,200,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(3 * s, 0, 5 * s, 3 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

const DEFAULT_TRACER_LINE_WIDTH = 2.5;

// Bullets are instantaneous — each is a solid line already resolved out to
// the first obstacle (or target) it hit. Drawn as a bright tracer that
// fades out fast; color distinguishes the player's shots from enemies'.
// A tracer with fadeDistance set (currently just the shotgun's pellets —
// see WEAPONS) also fades along its own length: solid at its origin (x1,y1
// — the muzzle, always the "near" end since only the player's own shots use
// this), fully transparent by fadeDistance out, on top of the usual
// lifetime fade — reading as a short-range spray rather than one traced
// line reaching all the way to whatever it hit.
function drawTracers() {
  for (const t of tracers) {
    const alpha = Math.max(0, t.life / TRACER_LIFETIME);
    ctx.lineWidth = t.lineWidth || DEFAULT_TRACER_LINE_WIDTH;
    ctx.lineCap = "round";
    ctx.beginPath();
    const y1 = t.y1 - t.heightOffset;
    const y2 = t.y2 - t.heightOffset;
    ctx.moveTo(t.x1, y1);
    ctx.lineTo(t.x2, y2);
    const length = Math.hypot(t.x2 - t.x1, t.y2 - t.y1);
    if (t.fadeDistance && length > 0.01) {
      const gradient = ctx.createLinearGradient(t.x1, y1, t.x2, y2);
      const midStop = Math.min(1, (t.fadeDistance / 2) / length);
      const endStop = Math.min(1, t.fadeDistance / length);
      gradient.addColorStop(0, `rgba(${t.color},${alpha})`);
      gradient.addColorStop(midStop, `rgba(${t.color},${alpha * 0.5})`);
      gradient.addColorStop(endStop, `rgba(${t.color},0)`);
      ctx.strokeStyle = gradient;
    } else {
      ctx.strokeStyle = `rgba(${t.color},${alpha})`;
    }
    ctx.stroke();
  }
}

function drawSparks() {
  for (const s of sparks) {
    const alpha = Math.max(0, s.life / SPARK_LIFETIME);
    ctx.fillStyle = `rgba(${s.color},${alpha})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y - s.heightOffset, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A permanent scorch mark: a small dark crater with a darker center, left
// where a shot stopped dead on a wall/obstacle/cover tile instead of an
// enemy or barrel. A pellet that had already mostly fallen off by the time
// it landed (see distanceFalloff/fireWeapon) leaves a smaller mark, not a
// full-force impact.
function drawBulletHole(hole) {
  const hx = hole.x;
  const hy = hole.y - hole.heightOffset;
  const outerRadius = hole.small ? 1.6 : 3;
  const innerRadius = hole.small ? 0.7 : 1.3;
  ctx.fillStyle = "rgba(15,12,10,0.7)";
  ctx.beginPath();
  ctx.arc(hx, hy, outerRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.arc(hx, hy, innerRadius, 0, Math.PI * 2);
  ctx.fill();
}

// A beer pool: a flat amber disc, growing from nothing up to its full
// radius (see BEER_POOL_GROWTH_SPEED) and then staying put — a permanent
// stain. Rendered at pool.heightOffset (see spawnBeerPool), the same
// height the glass it came from was resting at, so a pool from a glass
// that sat on a cover tile stays puddled up on that cover's surface rather
// than appearing to sink through it to the floor. Drawn fully opaque onto
// targetCtx (see buildPoolLayer) — translucency is applied once, later, to
// the flattened layer as a whole, not per pool.
function drawBeerPool(targetCtx, room, pool) {
  const py = pool.y - pool.heightOffset;

  // Resting up on a raised cover surface, rather than flush on the floor
  // (heightOffset 0, where there's no edge to fall off) — clip the disc to
  // the footprint of whatever cover tile(s) it's actually sitting on, so it
  // can't spill out past that surface's edge and read as floating in mid-
  // air over the (lower) floor beside it. Its home tile plus the 3x3
  // neighborhood around it is enough: a pool's radius never reaches past
  // the tile adjacent to the one it started on.
  if (pool.heightOffset > 0) {
    const homeCol = Math.floor(pool.x / TILE);
    const homeRow = Math.floor(pool.y / TILE);
    targetCtx.save();
    targetCtx.beginPath();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const row = homeRow + dr;
        const col = homeCol + dc;
        if (isCoverAt(room, row, col)) {
          targetCtx.rect(col * TILE, row * TILE - COVER_HEIGHT, TILE, TILE);
        }
      }
    }
    targetCtx.clip();
    drawBeerPoolDisc(targetCtx, pool.x, py, pool.radius, pool.fill);
    targetCtx.restore();
  } else {
    drawBeerPoolDisc(targetCtx, pool.x, py, pool.radius, pool.fill);
  }
}

function drawBeerPoolDisc(targetCtx, x, y, radius, fill) {
  targetCtx.fillStyle = fill;
  targetCtx.beginPath();
  targetCtx.ellipse(x, y, radius, radius * BARREL_SQUASH, 0, 0, Math.PI * 2);
  targetCtx.fill();
}

// Draws `pools` fully opaque onto poolLayerCanvas, then composites that
// whole layer onto the main canvas once at POOL_ALPHA — so any of them
// that overlap read as one puddle's worth of opacity instead of stacking
// darker where they overlap (two overlapping opaque fills on the offscreen
// layer just overwrite each other's pixels; only the single final
// composite actually applies any transparency). Called once per row (see
// render()) with that row's own pools, rather than once for the whole
// room: a pool is drawn unclipped, so on a cover tile it can reach a little
// past its own row (see drawBeerPool's clip footprint), and re-flattening
// per row keeps that overflow from being cut off at a row boundary. Pools
// from different rows that happen to overlap are a rare enough case not to
// bother flattening together.
function drawPoolLayer(room, pools) {
  if (pools.length === 0) return;
  poolLayerCtx.clearRect(0, 0, poolLayerCanvas.width, poolLayerCanvas.height);
  for (const pool of pools) drawBeerPool(poolLayerCtx, room, pool);
  ctx.save();
  ctx.globalAlpha = POOL_ALPHA;
  ctx.drawImage(poolLayerCanvas, 0, 0);
  ctx.restore();
}

// A glass shard: a small rotated triangular sliver, colored like glass
// rather than sparks' amber-ember dots. Doesn't fade — it's permanent
// debris, drawn at a fixed alpha whether still sliding or long since landed.
function drawBeerShards(room) {
  for (const s of room.beerShards) {
    ctx.save();
    ctx.translate(s.x, s.y - s.heightOffset);
    ctx.rotate(s.rotation);
    ctx.fillStyle = "rgba(226,240,255,0.45)";
    ctx.beginPath();
    ctx.moveTo(-3, -1.2);
    ctx.lineTo(4, 0);
    ctx.lineTo(-2, 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// An ejected cartridge: a small brass capsule with a slightly darker rim at
// one end (the primer), tumbling while airborne then resting wherever it
// lands — permanent debris, same as beer shards. While airborne it's drawn
// in the per-row pass alongside bullet holes/beer pools, before that row's
// sprites; once landed, it moves to its own pass drawn right after the
// floor (see render()), so a resting cartridge is always underneath the
// player/enemies, not just when they happen to share a tile row.
function drawCartridge(c) {
  ctx.save();
  ctx.translate(c.x, c.y - c.z);
  ctx.rotate(c.rotation);
  ctx.fillStyle = c.color || "#c9a227";
  ctx.fillRect(-3, -1, 6, 2);
  ctx.fillStyle = "#8a6f1a";
  ctx.fillRect(2, -1, 1.5, 2);
  ctx.restore();
}

function render() {
  const room = roomAt(gridRow, gridCol);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // While editing, statusLabelEl is repurposed for editor feedback (see
  // exportLevel/importLevel/setEditMode) — don't have the normal
  // exposure readout stomp it every frame.
  if (!editMode) updateStatusHud();

  // Shift everything down by TOP_PADDING so a row-0 wall's raised top face
  // (which extends WALL_HEIGHT px above the room) has headroom to render
  // instead of being clipped by the canvas edge.
  ctx.save();
  ctx.translate(0, TOP_PADDING);

  drawFloor(room);

  // Resting (landed) cartridges are flat floor debris, drawn once here as
  // their own pass right on top of the floor — before anything else in the
  // room, including the player — rather than folded into the per-row pass
  // below with the rest of the floor debris. That per-row pass only
  // guarantees "beneath the player" when the cartridge and the player share
  // a tile row; a cartridge resting one row closer to the camera than the
  // player would otherwise be drawn in a later loop iteration and end up on
  // top. Still-tumbling cartridges are airborne, not floor debris yet, so
  // they stay in the per-row pass and depth-sort normally.
  for (const c of room.cartridges) {
    if (c.landed) drawCartridge(c);
  }

  // Contact shadows first, so they sit under the raised blocks drawn next.
  for (let row = 0; row < ROOM_ROWS; row++) {
    for (let col = 0; col < ROOM_COLS; col++) {
      if (!isSolidAt(room, row, col)) continue;
      drawEdgeShadow(room, col, row, "S");
      drawEdgeShadow(room, col, row, "E");
      drawEdgeShadow(room, col, row, "W");
    }
  }

  // Merge walls/obstacles and the player into one top-to-bottom painter's
  // pass so the player is correctly occluded by / occludes blocks.
  for (let row = 0; row < ROOM_ROWS; row++) {
    for (let col = 0; col < ROOM_COLS; col++) {
      const t = room.tiles[row][col];
      if (t === TILE_WALL || t === TILE_OBSTACLE || t === TILE_COVER) {
        const material = t === TILE_WALL ? WALL_MATERIAL : t === TILE_OBSTACLE ? OBSTACLE_MATERIAL : COVER_MATERIAL;
        const height = t === TILE_COVER ? COVER_HEIGHT : WALL_HEIGHT;
        drawRaisedTile(col, row, height, material);
      }
    }
    for (const hole of room.bulletHoles) {
      if (Math.floor(hole.y / TILE) === row) drawBulletHole(hole);
    }
    drawPoolLayer(room, room.beerPools.filter((pool) => Math.floor(pool.y / TILE) === row));
    for (const c of room.cartridges) {
      // Landed ones are already drawn in their own pass above.
      if (!c.landed && Math.floor(c.y / TILE) === row) drawCartridge(c);
    }
    // Sort this row's props by actual y (not just tile row) and draw
    // lowest-first, so the one with the highest y — closest to the
    // camera — is drawn last and correctly overlaps the others.
    const sprites = [];
    for (const barrel of room.barrels) {
      if (Math.floor(barrel.y / TILE) === row) sprites.push({ y: barrel.y, draw: () => drawBarrel(barrel) });
    }
    for (const chair of room.chairs) {
      if (Math.floor(chair.y / TILE) === row) sprites.push({ y: chair.y, draw: () => drawChair(chair) });
    }
    for (const pack of room.healthPacks) {
      if (Math.floor(pack.y / TILE) === row) sprites.push({ y: pack.y, draw: () => drawHealthPack(pack) });
    }
    for (const hat of room.hats) {
      if (Math.floor(hat.y / TILE) === row) sprites.push({ y: hat.y, draw: () => drawFlyingHat(hat) });
    }
    for (const glass of room.beerGlasses) {
      if (Math.floor(glass.y / TILE) === row) sprites.push({ y: glass.y, draw: () => drawBeerGlass(room, glass) });
    }
    for (const bottle of room.whiskeyBottles) {
      if (Math.floor(bottle.y / TILE) === row) sprites.push({ y: bottle.y, draw: () => drawWhiskeyBottle(room, bottle) });
    }
    for (const enemy of room.enemies) {
      if (Math.floor(enemy.y / TILE) === row) sprites.push({ y: enemy.y, draw: () => drawEnemy(enemy) });
    }
    if (Math.floor(player.y / TILE) === row) {
      sprites.push({ y: player.y, draw: drawPlayer });
    }
    sprites.sort((a, b) => a.y - b.y);
    for (const sprite of sprites) sprite.draw();
  }

  drawTracers();
  drawSparks();
  drawBeerShards(room);

  if (editMode) drawEditorOverlay(room);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Level editor — place/move/delete barrels and enemies, paint tiles, and
// move the player's starting point, all in the current room. Freezes
// gameplay (see the `editMode` check at the top of update()) so nothing
// shoots at you while you're arranging a room.
// ---------------------------------------------------------------------------

let editMode = false;
let editBrush = "wall";
let isPainting = false;   // true while a tile brush's mouse button is held, for click-and-drag painting
let dragTarget = null;    // { type: "enemy" | "barrel" | "healthpack" | "beerglass" | "whiskeybottle" | "player", ref } while an existing prop is being dragged
let hoverPos = null;      // last known mouse position in room space, for the brush-preview outline

// Tile brushes paint a fixed tile value on click/drag; "barrel"/"enemy" drop
// a new prop once per click; "start" relocates the player's (single,
// level-wide) starting point to the click; "erase" resets a tile back to
// plain floor.
const TILE_BRUSHES = {
  floorA: TILE_FLOOR_A,
  floorB: TILE_FLOOR_B,
  wall: TILE_WALL,
  obstacle: TILE_OBSTACLE,
  cover: TILE_COVER,
};

const editModeToggleEl = document.getElementById("editModeToggle");
const editorBarEl = document.getElementById("editorBar");
const editorRoomLabelEl = document.getElementById("editorRoomLabel");
const brushButtons = document.querySelectorAll("#editorBar [data-brush]");

function setBrush(name) {
  editBrush = name;
  for (const btn of brushButtons) {
    btn.classList.toggle("active", btn.dataset.brush === name);
  }
}
setBrush(editBrush);

function updateEditorUI() {
  editModeToggleEl.classList.toggle("active", editMode);
  editorBarEl.classList.toggle("hidden", !editMode);
  editorRoomLabelEl.textContent = `${gridCol + 1},${gridRow + 1}`;
}

function setEditMode(on) {
  editMode = on;
  if (editMode) {
    // Don't carry gameplay input into the editor, and don't leave it primed
    // to resume firing/moving the instant editing ends.
    fireRequested = false;
    keys.clear();
    strafeModifier = false;
    statusLabelEl.textContent = "Editing";
    statusLabelEl.style.color = "#ccc";
  } else {
    dragTarget = null;
    isPainting = false;
  }
  updateEditorUI();
}

editModeToggleEl.addEventListener("click", () => setEditMode(!editMode));
for (const btn of brushButtons) {
  btn.addEventListener("click", () => setBrush(btn.dataset.brush));
}

// Plain-data snapshot of the whole level: tiles + prop positions, and the
// player's starting room/position — none of the runtime state
// (health/cooldowns/exits) — exits are structural, derived from a room's
// position in the grid, and everything else resets cleanly through
// makeEnemy. Shared by the clipboard export/import and the localStorage
// autosave/autoload below, so all three read/write one shape.
function snapshotLevel() {
  return {
    start: { gridRow, gridCol, x: player.x, y: player.y },
    rooms: level.map((row) =>
      row.map((room) => ({
        tiles: room.tiles.map((r) => r.slice()),
        barrels: room.barrels.map((b) => ({ x: b.x, y: b.y })),
        chairs: room.chairs.map((c) => ({ x: c.x, y: c.y })),
        enemies: room.enemies.map((e) => ({ x: e.x, y: e.y })),
        healthPacks: room.healthPacks.map((h) => ({ x: h.x, y: h.y })),
        beerGlasses: room.beerGlasses.map((g) => ({ x: g.x, y: g.y })),
        whiskeyBottles: room.whiskeyBottles.map((b) => ({ x: b.x, y: b.y })),
      }))
    ),
  };
}

// Replaces every room's tiles/barrels/chairs/enemies/healthPacks/
// beerGlasses/whiskeyBottles, and the player's starting room/position, with
// a previously captured snapshot (same shape snapshotLevel produces). Also
// accepts a bare rooms array — the shape an earlier version of this feature
// saved, before it tracked a start point — and just leaves the player's
// position alone in that case; fields saved before they existed
// (healthPacks, beerGlasses, chairs, whiskeyBottles) default to none.
// Throws on a malformed snapshot — callers decide how to report that.
function applyLevelSnapshot(data) {
  const rooms = Array.isArray(data) ? data : data.rooms;
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const src = rooms[r][c];
      const room = level[r][c];
      room.tiles = src.tiles.map((row) => row.slice());
      room.barrels = src.barrels.map((b) => ({ x: b.x, y: b.y, radius: BARREL_RADIUS }));
      room.chairs = (src.chairs || []).map((ch) => ({ x: ch.x, y: ch.y, radius: CHAIR_RADIUS }));
      room.enemies = src.enemies.map((e) => makeEnemy(e.x, e.y));
      room.healthPacks = (src.healthPacks || []).map((h) => ({ x: h.x, y: h.y, radius: HEALTH_PACK_RADIUS }));
      room.beerGlasses = (src.beerGlasses || []).map((g) => ({ x: g.x, y: g.y, radius: BEER_GLASS_RADIUS }));
      room.whiskeyBottles = (src.whiskeyBottles || []).map((b) => ({ x: b.x, y: b.y, radius: WHISKEY_BOTTLE_RADIUS }));
      room.hats = []; // combat debris, not level design — never part of a saved snapshot
      room.bulletHoles = [];
      room.beerPools = [];
      room.beerShards = [];
      room.cartridges = [];
    }
  }
  const start = !Array.isArray(data) && data.start;
  if (start) {
    gridRow = clamp(start.gridRow, 0, GRID_ROWS - 1);
    gridCol = clamp(start.gridCol, 0, GRID_COLS - 1);
    player.x = start.x;
    player.y = start.y;
    updateHud();
    updateEditorUI();
  }
}

// Autosave: every edit (paint, drag, delete, import) is persisted to
// localStorage so the level survives a refresh without needing an explicit
// export/import round trip. Silently no-ops if storage is unavailable
// (private browsing, quota, etc.) — editing still works, it just won't
// survive a reload.
const LEVEL_STORAGE_KEY = "duckaskjut:level:v1";

function persistLevel() {
  try {
    localStorage.setItem(LEVEL_STORAGE_KEY, JSON.stringify(snapshotLevel()));
  } catch (err) {
    // Ignore — editing still works for the rest of this session.
  }
}

function loadPersistedLevel() {
  let raw;
  try {
    raw = localStorage.getItem(LEVEL_STORAGE_KEY);
  } catch (err) {
    return;
  }
  if (!raw) return;
  try {
    applyLevelSnapshot(JSON.parse(raw));
  } catch (err) {
    console.warn("Duckaskjut: ignoring corrupt saved level", err);
  }
}

// Serializes the level to JSON, logs it, and copies it to the clipboard —
// a portable backup/share path alongside the automatic localStorage save.
function exportLevel() {
  const json = JSON.stringify(snapshotLevel());
  console.log("Duckaskjut level export:", json);
  if (navigator.clipboard) {
    navigator.clipboard.writeText(json).catch(() => {});
  }
  statusLabelEl.textContent = "Level exported to clipboard + console";
  statusLabelEl.style.color = "#6fcf6f";
}

// Loads a previously exported JSON blob, pasted in via a prompt, and
// persists it so it also survives the next refresh.
function importLevel() {
  const raw = window.prompt("Paste exported level JSON:");
  if (!raw) return;
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    window.alert("That wasn't valid JSON.");
    return;
  }
  try {
    applyLevelSnapshot(data);
  } catch (err) {
    window.alert("That JSON didn't match the expected level shape.");
    return;
  }
  persistLevel();
  statusLabelEl.textContent = "Level imported";
  statusLabelEl.style.color = "#6fcf6f";
}

document.getElementById("editorExport").addEventListener("click", exportLevel);
document.getElementById("editorImport").addEventListener("click", importLevel);

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Client (mouse) coordinates -> room-space pixel coordinates, matching the
// same space player.x/y, tile math, etc. all live in — accounting for the
// canvas possibly being CSS-scaled, and for render()'s TOP_PADDING shift.
function roomPosFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY - TOP_PADDING,
  };
}

function enemyAt(room, pos) {
  const radius = player.size / 2;
  return room.enemies.find((en) => Math.hypot(en.x - pos.x, en.y - pos.y) < radius + 4);
}

function barrelAt(room, pos) {
  return room.barrels.find((b) => Math.hypot(b.x - pos.x, b.y - pos.y) < b.radius + 4);
}

function healthPackAt(room, pos) {
  return room.healthPacks.find((h) => Math.hypot(h.x - pos.x, h.y - pos.y) < h.radius + 4);
}

function beerGlassAt(room, pos) {
  return room.beerGlasses.find((g) => Math.hypot(g.x - pos.x, g.y - pos.y) < g.radius + 4);
}

function whiskeyBottleAt(room, pos) {
  return room.whiskeyBottles.find((b) => Math.hypot(b.x - pos.x, b.y - pos.y) < b.radius + 4);
}

function chairAt(room, pos) {
  return room.chairs.find((c) => Math.hypot(c.x - pos.x, c.y - pos.y) < c.radius + 4);
}

// The player is level-wide, not per-room (its room is whatever gridRow/
// gridCol — the same pair the editor's room-switch keys drive — currently
// point at), so unlike enemyAt/barrelAt this doesn't take a room.
function playerAt(pos) {
  return Math.hypot(player.x - pos.x, player.y - pos.y) < player.size / 2 + 4 ? player : null;
}

// Whatever per-room prop (of any deletable/draggable kind — not the player,
// which is level-wide and neither deletable nor brush-placed) sits at pos,
// in the same priority order every caller here wants: first match wins
// where footprints could overlap. Bundled with its owning collection so a
// caller can splice it out without re-deriving which array it lives in.
// Shared by right-click delete, the "erase" brush (so it deletes entities,
// not just tiles), the drag-target hit test, and the hover outline.
function entityAt(room, pos) {
  const enemy = enemyAt(room, pos);
  if (enemy) return { type: "enemy", ref: enemy, collection: room.enemies };
  const barrel = barrelAt(room, pos);
  if (barrel) return { type: "barrel", ref: barrel, collection: room.barrels };
  const chair = chairAt(room, pos);
  if (chair) return { type: "chair", ref: chair, collection: room.chairs };
  const healthPack = healthPackAt(room, pos);
  if (healthPack) return { type: "healthpack", ref: healthPack, collection: room.healthPacks };
  const beerGlass = beerGlassAt(room, pos);
  if (beerGlass) return { type: "beerglass", ref: beerGlass, collection: room.beerGlasses };
  const whiskeyBottle = whiskeyBottleAt(room, pos);
  if (whiskeyBottle) return { type: "whiskeybottle", ref: whiskeyBottle, collection: room.whiskeyBottles };
  return null;
}

function paintTileAt(room, pos, tile) {
  const col = Math.floor(pos.x / TILE);
  const row = Math.floor(pos.y / TILE);
  if (row < 0 || row >= ROOM_ROWS || col < 0 || col >= ROOM_COLS) return;
  room.tiles[row][col] = tile;
}

function resetTileToFloor(room, pos) {
  const col = Math.floor(pos.x / TILE);
  const row = Math.floor(pos.y / TILE);
  paintTileAt(room, pos, (row + col) % 2 === 0 ? TILE_FLOOR_A : TILE_FLOOR_B);
}

function applyBrushAt(room, pos) {
  if (editBrush in TILE_BRUSHES) {
    paintTileAt(room, pos, TILE_BRUSHES[editBrush]);
  } else if (editBrush === "erase") {
    // Erase a prop under the cursor if there is one, same as right-click
    // delete; only falls back to clearing the tile when there isn't.
    const entity = entityAt(room, pos);
    if (entity) {
      entity.collection.splice(entity.collection.indexOf(entity.ref), 1);
    } else {
      resetTileToFloor(room, pos);
    }
  } else if (editBrush === "barrel") {
    room.barrels.push({ x: pos.x, y: pos.y, radius: BARREL_RADIUS });
  } else if (editBrush === "chair") {
    room.chairs.push({ x: pos.x, y: pos.y, radius: CHAIR_RADIUS });
  } else if (editBrush === "healthpack") {
    room.healthPacks.push({ x: pos.x, y: pos.y, radius: HEALTH_PACK_RADIUS });
  } else if (editBrush === "beerglass") {
    room.beerGlasses.push({ x: pos.x, y: pos.y, radius: BEER_GLASS_RADIUS });
  } else if (editBrush === "whiskeybottle") {
    room.whiskeyBottles.push({ x: pos.x, y: pos.y, radius: WHISKEY_BOTTLE_RADIUS });
  } else if (editBrush === "enemy") {
    room.enemies.push(makeEnemy(pos.x, pos.y));
  } else if (editBrush === "start") {
    player.x = pos.x;
    player.y = pos.y;
  }
}

canvas.addEventListener("mousedown", (e) => {
  if (!editMode) return;
  const room = roomAt(gridRow, gridCol);
  const pos = roomPosFromEvent(e);

  if (e.button === 2) {
    const entity = entityAt(room, pos);
    if (entity) { entity.collection.splice(entity.collection.indexOf(entity.ref), 1); return; }
    resetTileToFloor(room, pos);
    return;
  }
  if (e.button !== 0) return;

  // The erase brush deletes whatever's under the cursor — a prop if there's
  // one there, the tile otherwise (see applyBrushAt) — rather than picking
  // it up to drag, and (like every tile brush) keeps erasing on drag.
  if (editBrush === "erase") {
    applyBrushAt(room, pos);
    isPainting = true;
    return;
  }

  const entity = entityAt(room, pos);
  if (entity) { dragTarget = { type: entity.type, ref: entity.ref }; return; }
  if (playerAt(pos)) { dragTarget = { type: "player", ref: player }; return; }

  applyBrushAt(room, pos);
  if (editBrush in TILE_BRUSHES) isPainting = true;
});

window.addEventListener("mousemove", (e) => {
  if (!editMode) return;
  const pos = roomPosFromEvent(e);
  hoverPos = pos;

  if (dragTarget) {
    dragTarget.ref.x = clamp(pos.x, 0, ROOM_COLS * TILE);
    dragTarget.ref.y = clamp(pos.y, 0, ROOM_ROWS * TILE);
    return;
  }
  if (isPainting) {
    applyBrushAt(roomAt(gridRow, gridCol), pos);
  }
});

window.addEventListener("mouseup", () => {
  // Every mousedown in edit mode either mutates the level immediately
  // (paint/place/delete) or starts a drag that mutates it on the moves in
  // between, so a save on every release — even a stray one — covers all of
  // it with one call; it's just a redundant write when nothing changed.
  if (editMode) persistLevel();
  dragTarget = null;
  isPainting = false;
});

canvas.addEventListener("contextmenu", (e) => {
  if (editMode) e.preventDefault();
});

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyE" && !e.ctrlKey && !e.metaKey) {
    setEditMode(!editMode);
    e.preventDefault();
    return;
  }
  if (!editMode) return;

  // Digit0 follows Digit9 on the keyboard, so it maps to the 10th brush.
  const DIGIT_BRUSHES = ["floorA", "floorB", "wall", "obstacle", "cover", "barrel", "enemy", "erase", "start", "healthpack"];
  if (e.code.startsWith("Digit")) {
    const n = e.code === "Digit0" ? 10 : Number(e.code.slice(5));
    if (DIGIT_BRUSHES[n - 1]) { setBrush(DIGIT_BRUSHES[n - 1]); e.preventDefault(); }
    return;
  }

  if (e.code === "BracketLeft") { gridCol = Math.max(0, gridCol - 1); updateHud(); updateEditorUI(); }
  else if (e.code === "BracketRight") { gridCol = Math.min(GRID_COLS - 1, gridCol + 1); updateHud(); updateEditorUI(); }
  else if (e.code === "Comma") { gridRow = Math.max(0, gridRow - 1); updateHud(); updateEditorUI(); }
  else if (e.code === "Period") { gridRow = Math.min(GRID_ROWS - 1, gridRow + 1); updateHud(); updateEditorUI(); }
  else if (e.code === "KeyP") { exportLevel(); }
  else if (e.code === "KeyO") { importLevel(); }
});

// A light grid overlay plus an outline around whatever the brush would
// affect (a prop under the cursor, or the tile it sits on), so painting and
// dragging have a clear, precise target.
function drawEditorOverlay(room) {
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  for (let col = 1; col < ROOM_COLS; col++) {
    ctx.beginPath();
    ctx.moveTo(col * TILE, 0);
    ctx.lineTo(col * TILE, ROOM_ROWS * TILE);
    ctx.stroke();
  }
  for (let row = 1; row < ROOM_ROWS; row++) {
    ctx.beginPath();
    ctx.moveTo(0, row * TILE);
    ctx.lineTo(ROOM_COLS * TILE, row * TILE);
    ctx.stroke();
  }

  // An enemy's (and the player's) hitbox is the shared square-ish body
  // radius; every other prop carries its own radius.
  if (dragTarget) {
    const r = dragTarget.type === "enemy" || dragTarget.type === "player"
      ? player.size / 2
      : dragTarget.ref.radius;
    ctx.strokeStyle = "#6fcf6f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(dragTarget.ref.x, dragTarget.ref.y, r + 4, 0, Math.PI * 2);
    ctx.stroke();
  } else if (hoverPos) {
    const entity = entityAt(room, hoverPos);
    const target = entity ? entity.ref : playerAt(hoverPos);
    if (target) {
      const r = entity && entity.type !== "enemy" ? entity.ref.radius : player.size / 2;
      ctx.strokeStyle = "#e0553b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(target.x, target.y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (editBrush in TILE_BRUSHES || editBrush === "erase") {
      const col = Math.floor(hoverPos.x / TILE);
      const row = Math.floor(hoverPos.y / TILE);
      if (row >= 0 && row < ROOM_ROWS && col >= 0 && col < ROOM_COLS) {
        ctx.strokeStyle = "#e0553b";
        ctx.lineWidth = 2;
        ctx.strokeRect(col * TILE + 1, row * TILE + 1, TILE - 2, TILE - 2);
      }
    }
  }

  ctx.fillStyle = "rgba(224,85,59,0.9)";
  ctx.font = "bold 13px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(`EDIT MODE — brush: ${editBrush}`, 8, 16 - TOP_PADDING);
}

// The default level: a hand-built layout captured via the editor's export
// (see snapshotLevel/applyLevelSnapshot — same shape). Applied before
// checking for a saved edit session, so a fresh browser (no localStorage
// save yet) starts here instead of buildLevel()'s bare checkerboard rooms.
const DEFAULT_LEVEL = {"start":{"gridRow":1,"gridCol":0,"x":378.600242194063,"y":214.92608699273978},"rooms":[[{"tiles":[[2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],[2,0,1,0,1,0,1,4,4,4,4,4,4,4,4,4,4,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,4,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,4,4,4,4,4,4,4,4,4,4,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[2,1,0,4,4,1,0,1,0,1,0,1,0,1,0,1,0,1],[2,0,1,4,4,0,1,0,1,0,1,0,1,0,1,0,1,0],[2,1,0,4,4,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,2,2,2,2,2,2,2,1,0,1,2,2,2,2,2,2,2]],"barrels":[{"x":332.1546961325967,"y":324.23622047244095},{"x":423.646408839779,"y":290.503937007874}],"chairs":[{"x":102.43093922651934,"y":258.755905511811},{"x":100.44198895027624,"y":309.35433070866145},{"x":222.76243093922653,"y":277.6062992125984},{"x":217.79005524861878,"y":343.0866141732283},{"x":375.91160220994476,"y":209.1496062992126},{"x":598.6740331491712,"y":209.1496062992126},{"x":494.25414364640886,"y":208.15748031496062}],"enemies":[{"x":397.7900552486188,"y":120.85039370078741},{"x":576.7955801104972,"y":124.81889763779529},{"x":99.4475138121547,"y":158.5511811023622}],"healthPacks":[{"x":648.3977900552486,"y":104.97637795275591}],"beerGlasses":[{"x":141.21546961325967,"y":313.3228346456693},{"x":185.9668508287293,"y":263.7165354330709},{"x":329.17127071823205,"y":170.45669291338584},{"x":442.5414364640884,"y":181.37007874015748},{"x":639.4475138121547,"y":179.38582677165354}],"whiskeyBottles":[{"x":346.0773480662983,"y":48.425196850393704},{"x":367.9558011049724,"y":48.425196850393704},{"x":394.8066298342541,"y":56.36220472440945},{"x":451.49171270718233,"y":44.45669291338582},{"x":587.7348066298342,"y":54.37795275590551},{"x":620.5524861878453,"y":55.37007874015748},{"x":294.3646408839779,"y":63.30708661417323}]},{"tiles":[[2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[2,1,0,1,0,1,0,1,0,1,4,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,4,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,4,1,0,1,0,1,0,2],[2,2,2,2,2,2,2,2,1,0,1,2,2,2,2,2,2,2]],"barrels":[{"x":200,"y":200}],"chairs":[],"enemies":[{"x":560,"y":120}],"healthPacks":[],"beerGlasses":[],"whiskeyBottles":[]},{"tiles":[[2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,2,2,2,2,2,2,2,1,0,1,2,2,2,2,2,2,2]],"barrels":[],"chairs":[],"enemies":[{"x":360,"y":120}],"healthPacks":[],"beerGlasses":[],"whiskeyBottles":[]},{"tiles":[[2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,2,2,2,2,2,2,2,1,0,1,2,2,2,2,2,2,2]],"barrels":[],"chairs":[],"enemies":[{"x":200,"y":320}],"healthPacks":[],"beerGlasses":[],"whiskeyBottles":[]}],[{"tiles":[[2,2,2,2,2,2,2,2,0,1,0,2,2,2,2,2,2,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,2,2,2,2,2,2,2,1,0,1,2,2,2,2,2,2,2]],"barrels":[],"chairs":[],"enemies":[],"healthPacks":[{"x":377.90055248618785,"y":139.70078740157481},{"x":375.91160220994476,"y":109.93700787401576},{"x":374.9171270718232,"y":79.18110236220473},{"x":374.9171270718232,"y":51.4015748031496},{"x":351.0497237569061,"y":69.25984251968504},{"x":334.1436464088398,"y":86.1259842519685},{"x":398.78453038674036,"y":63.30708661417323},{"x":420.6629834254144,"y":79.18110236220473}],"beerGlasses":[],"whiskeyBottles":[]},{"tiles":[[2,2,2,2,2,2,2,2,0,1,0,2,2,2,2,2,2,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,2,2,2,2,2,2,2,1,0,1,2,2,2,2,2,2,2]],"barrels":[],"chairs":[],"enemies":[{"x":360,"y":240}],"healthPacks":[],"beerGlasses":[],"whiskeyBottles":[]},{"tiles":[[2,2,2,2,2,2,2,2,0,1,0,2,2,2,2,2,2,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,2,2,2,2,2,2,2,1,0,1,2,2,2,2,2,2,2]],"barrels":[],"chairs":[],"enemies":[],"healthPacks":[],"beerGlasses":[],"whiskeyBottles":[]},{"tiles":[[2,2,2,2,2,2,2,2,0,1,0,2,2,2,2,2,2,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,2,2,2,2,2,2,2,1,0,1,2,2,2,2,2,2,2]],"barrels":[],"chairs":[],"enemies":[],"healthPacks":[],"beerGlasses":[],"whiskeyBottles":[]}],[{"tiles":[[2,2,2,2,2,2,2,2,0,1,0,2,2,2,2,2,2,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2]],"barrels":[],"chairs":[],"enemies":[],"healthPacks":[],"beerGlasses":[],"whiskeyBottles":[]},{"tiles":[[2,2,2,2,2,2,2,2,0,1,0,2,2,2,2,2,2,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2]],"barrels":[],"chairs":[],"enemies":[],"healthPacks":[],"beerGlasses":[],"whiskeyBottles":[]},{"tiles":[[2,2,2,2,2,2,2,2,0,1,0,2,2,2,2,2,2,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2]],"barrels":[],"chairs":[],"enemies":[{"x":240,"y":200}],"healthPacks":[],"beerGlasses":[],"whiskeyBottles":[]},{"tiles":[[2,2,2,2,2,2,2,2,0,1,0,2,2,2,2,2,2,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,2],[2,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2],[2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2]],"barrels":[],"chairs":[],"enemies":[],"healthPacks":[],"beerGlasses":[],"whiskeyBottles":[]}]]}

applyLevelSnapshot(DEFAULT_LEVEL);

// Load any saved edits over the default level before the first frame
// renders, so a refresh picks up right where editing left off.
loadPersistedLevel();

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = performance.now();

function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 1 / 30);
  lastTime = now;

  update(dt);
  render();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
