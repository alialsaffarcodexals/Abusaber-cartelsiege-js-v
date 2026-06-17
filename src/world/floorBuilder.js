// ============================================================================
//  floorBuilder.js — procedural building-floor generator (doc 12).
//  Produces meshes, wall colliders, spawn/loot/civilian points, interactables,
//  lights, an exit zone and a player spawn for a given floor definition.
// ============================================================================

import * as THREE from 'three';
import { AABB, makeRng, rand, randInt } from '../core/utils.js';
import { makeMaterials } from './materials.js';

const WALL_H = 3.3;
const WALL_T = 0.32;
const DOOR_W = 2.6;

export function buildFloor(def) {
  const rng = makeRng(def.index * 9173 + 17);
  const R = (a, b) => a + rng() * (b - a);
  const RI = (a, b) => Math.floor(R(a, b + 1));

  const mats = makeMaterials(def.palette, def.mood);
  const group = new THREE.Group();
  const colliders = [];     // wall AABBs (block movement + LoS)
  const lowColliders = [];  // cover AABBs (block movement, partial LoS)
  const enemySpawns = [];
  const lootSpawns = [];
  const civilianSpots = [];
  const interactables = [];
  const lights = [];
  const navPoints = [];

  const W = def.size.w;
  const D = def.size.d;
  const halfW = W / 2;
  const bounds = { minX: -halfW, maxX: halfW, minZ: 0, maxZ: D };

  // --- helper: add a box mesh + optional collider --------------------------
  function addBox(x, y, z, sx, sy, sz, mat, collide = 'none') {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = collide !== 'none';
    m.receiveShadow = true;
    group.add(m);
    if (collide === 'wall') colliders.push(new AABB(x, z, sx / 2, sz / 2));
    else if (collide === 'cover') lowColliders.push(new AABB(x, z, sx / 2, sz / 2));
    return m;
  }

  // --- floor + ceiling -----------------------------------------------------
  const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(W, 0.4, D), mats.floorMat);
  floorMesh.position.set(0, -0.2, D / 2);
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  const ceil = new THREE.Mesh(new THREE.BoxGeometry(W, 0.3, D), mats.ceilMat);
  ceil.position.set(0, WALL_H + 0.15, D / 2);
  group.add(ceil);

  // --- perimeter walls -----------------------------------------------------
  addBox(0, WALL_H / 2, 0, W, WALL_H, WALL_T, mats.wallMat, 'wall');          // back (entrance side, with door gap handled by entrance opening below)
  addBox(0, WALL_H / 2, D, W, WALL_H, WALL_T, mats.wallMat, 'wall');          // front (far)
  addBox(-halfW, WALL_H / 2, D / 2, WALL_T, WALL_H, D, mats.wallMat, 'wall'); // left
  addBox(halfW, WALL_H / 2, D / 2, WALL_T, WALL_H, D, mats.wallMat, 'wall');  // right

  // --- internal cross-walls dividing the floor into rooms ------------------
  const roomCount = def.rooms;
  const bandDepth = D / roomCount;
  const roomCenters = [];
  for (let i = 1; i < roomCount; i++) {
    const z = i * bandDepth;
    // door gap position alternates / random
    const gapX = R(-halfW + DOOR_W, halfW - DOOR_W);
    buildWallWithGap(z, gapX);
  }
  for (let i = 0; i < roomCount; i++) {
    roomCenters.push({ x: R(-halfW * 0.4, halfW * 0.4), z: i * bandDepth + bandDepth / 2 });
  }

  function buildWallWithGap(z, gapX) {
    const leftLen = (gapX - DOOR_W / 2) - (-halfW);
    const rightLen = (halfW) - (gapX + DOOR_W / 2);
    if (leftLen > 0.2) {
      const cx = -halfW + leftLen / 2;
      addBox(cx, WALL_H / 2, z, leftLen, WALL_H, WALL_T, mats.wallMat, 'wall');
    }
    if (rightLen > 0.2) {
      const cx = halfW - rightLen / 2;
      addBox(cx, WALL_H / 2, z, rightLen, WALL_H, WALL_T, mats.wallMat, 'wall');
    }
    // door frame accent + header
    addBox(gapX, WALL_H - 0.25, z, DOOR_W + 0.4, 0.5, WALL_T + 0.05, mats.accentMat, 'none');
    // light over each doorway
    placeCeilingLight(gapX, z, def.palette.light, def.palette.lightI * 0.7);
  }

  // --- rooms: cover, props, partial walls, lights --------------------------
  for (let i = 0; i < roomCount; i++) {
    const z0 = i * bandDepth + 1.2;
    const z1 = (i + 1) * bandDepth - 1.2;
    const cz = (z0 + z1) / 2;

    // one ceiling light per room (kept lean for forward-rendering perf)
    placeCeilingLight(R(-halfW * 0.3, halfW * 0.3), cz, def.palette.light, def.palette.lightI);

    if (i === 0) {
      // entrance room — light switch + nav
      navPoints.push({ x: 0, z: cz });
      continue;
    }

    // partial divider wall for some rooms (flanking cover). Kept short so a
    // walkable lane always remains at BOTH ends — it must never seal a room.
    if (rng() < 0.5) {
      const interior = z1 - z0;            // room interior depth
      if (interior > 4.5) {
        const px = R(-halfW * 0.35, halfW * 0.35);
        const segLen = Math.min(R(1.6, 3.0), interior - 2.4); // >=1.2m clear each end
        addBox(px, WALL_H / 2, cz, WALL_T, WALL_H, segLen, mats.wallMat, 'wall');
      }
    }

    // cover crates / pillars
    const coverN = RI(2, 4);
    for (let c = 0; c < coverN; c++) {
      const x = R(-halfW + 1.6, halfW - 1.6);
      const z = R(z0 + 0.5, z1 - 0.5);
      const kind = rng();
      if (kind < 0.5) {
        const s = R(0.9, 1.4);
        addBox(x, s / 2, z, s, s, s, mats.coverMat, 'cover');
        navPoints.push({ x: x + (rng() < 0.5 ? -1.6 : 1.6), z, cover: true });
      } else if (kind < 0.8) {
        // long crate / barricade
        const lx = R(1.6, 2.6);
        addBox(x, 0.55, z, lx, 1.1, 0.7, mats.coverMat, 'cover');
        navPoints.push({ x, z: z + 1.4, cover: true });
      } else {
        // pillar
        addBox(x, WALL_H / 2, z, 0.7, WALL_H, 0.7, mats.accentMat, 'cover');
      }
    }

    // furniture / decorative props (non-blocking small)
    const propN = RI(2, 5);
    for (let p = 0; p < propN; p++) {
      const x = R(-halfW + 1, halfW - 1);
      const z = R(z0, z1);
      addProp(x, z);
    }

    // wall sconce for mood (single side to keep light count lean)
    if (rng() < 0.45) placeWallSconce((rng() < 0.5 ? -1 : 1) * (halfW - WALL_T), cz + R(-2, 2), def.palette.accent);

    // enemy spawn(s) for this room — added later by roster distribution
    navPoints.push({ x: roomCenters[i].x, z: cz });
    enemySpawns.push({ x: R(-halfW * 0.6, halfW * 0.6), z: R(z0, z1), room: i });

    // loot + civilian candidate spots
    lootSpawns.push({ x: R(-halfW * 0.7, halfW * 0.7), z: R(z0, z1) });
    if (i >= 1) civilianSpots.push({ x: R(-halfW * 0.7, halfW * 0.7), z: R(z0, z1), room: i });
  }

  function addProp(x, z) {
    const t = rng();
    if (t < 0.3) {
      // table
      addBox(x, 0.45, z, R(1, 1.6), 0.12, R(0.7, 1), mats.propMat, 'none');
      addBox(x, 0.22, z, R(0.9, 1.4), 0.44, R(0.6, 0.9), mats.propMat, 'none');
    } else if (t < 0.55) {
      // barrel
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 12), mats.coverMat);
      m.position.set(x, 0.45, z); m.castShadow = true; m.receiveShadow = true; group.add(m);
    } else if (t < 0.75) {
      // crate stack
      addBox(x, 0.3, z, 0.6, 0.6, 0.6, mats.propMat, 'none');
    } else if (t < 0.9) {
      // shelf against feel
      addBox(x, 1.0, z, R(0.5, 0.8), 2.0, 0.4, mats.propMat, 'none');
    } else {
      // debris pile
      for (let k = 0; k < 3; k++) addBox(x + R(-0.4, 0.4), 0.12, z + R(-0.4, 0.4), R(0.2, 0.5), R(0.1, 0.3), R(0.2, 0.5), mats.propMat, 'none');
    }
  }

  function placeCeilingLight(x, z, color, intensity) {
    // fixture
    const fix = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 0.6 }));
    fix.position.set(x, WALL_H - 0.06, z);
    group.add(fix);
    const baseI = intensity * 9;
    const light = new THREE.PointLight(color, baseI, 23, 1.6);
    light.position.set(x, WALL_H - 0.3, z);
    group.add(light);
    lights.push({ light, fixture: fix, baseIntensity: baseI, color });
  }

  function placeWallSconce(x, z, color) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 1.2 }));
    m.position.set(x, 2.2, z);
    group.add(m);
    const l = new THREE.PointLight(color, 2.0, 6, 2);
    l.position.set(x, 2.2, z);
    group.add(l);
    lights.push({ light: l, fixture: m, baseIntensity: 2.0, color });
  }

  // --- entrance opening in back wall (visual) + player spawn ---------------
  // yaw = PI so the player faces +Z (into the floor, toward the exit)
  const playerSpawn = { x: 0, z: 2.4, yaw: Math.PI };

  // --- exit zone at the far end --------------------------------------------
  const exitX = 0;
  const exitZ = D - 1.6;
  const exitMarker = new THREE.Mesh(
    new THREE.BoxGeometry(DOOR_W, 0.05, 1.4),
    new THREE.MeshStandardMaterial({ color: 0x2aff88, emissive: 0x1aff66, emissiveIntensity: 0.9, transparent: true, opacity: 0.55 })
  );
  exitMarker.position.set(exitX, 0.03, exitZ);
  group.add(exitMarker);
  // glowing exit doorway frame
  addBox(exitX, WALL_H / 2, D - WALL_T, DOOR_W + 0.5, WALL_H, 0.1,
    new THREE.MeshStandardMaterial({ color: 0x113322, emissive: 0x22ff88, emissiveIntensity: 0.5 }), 'none');
  const exitLight = new THREE.PointLight(0x2aff88, 4, 10, 2);
  exitLight.position.set(exitX, 2.4, exitZ);
  group.add(exitLight);
  const exit = { x: exitX, z: exitZ, aabb: new AABB(exitX, exitZ, DOOR_W / 2 + 0.3, 1.0), marker: exitMarker, light: exitLight };

  // --- interactables: light switches per room, alarm on alarm floors -------
  interactables.push({ type: 'lights', x: -halfW + 0.5, z: 4, label: 'Toggle Lights', state: true });
  if (def.alarm) {
    const az = D * 0.4;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x551111, emissive: 0xff2222, emissiveIntensity: 1.0 }));
    panel.position.set(halfW - 0.4, 1.5, az);
    group.add(panel);
    interactables.push({ type: 'alarm', x: halfW - 0.9, z: az, label: 'Disable Alarm', mesh: panel, done: false });
  }

  // --- ambient fill lighting (hemisphere + ambient) ------------------------
  const amb = new THREE.AmbientLight(0x6a6c78, 0.6);
  group.add(amb);
  const hemi = new THREE.HemisphereLight(def.palette.light, def.palette.floor, 0.55);
  hemi.position.set(0, WALL_H, D / 2);
  group.add(hemi);

  return {
    group, colliders, lowColliders, enemySpawns, lootSpawns, civilianSpots,
    interactables, lights, navPoints, playerSpawn, exit, bounds, ambient: amb, hemi,
  };
}
