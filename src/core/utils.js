// ============================================================================
//  utils.js — math helpers, RNG, small shared utilities
// ============================================================================

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const TAU = Math.PI * 2;
export const deg2rad = (d) => (d * Math.PI) / 180;
export const rad2deg = (r) => (r * 180) / Math.PI;

// frame-rate independent exponential smoothing factor
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// approach a toward b by maxDelta
export function approach(a, b, maxDelta) {
  if (a < b) return Math.min(a + maxDelta, b);
  if (a > b) return Math.max(a - maxDelta, b);
  return b;
}

// Mulberry32 seeded RNG — deterministic floor variety
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatMoney(n) {
  return '$' + Math.floor(n).toLocaleString('en-US');
}

// AABB (centerX, centerZ, halfW, halfD) on the XZ plane
export class AABB {
  constructor(cx, cz, hw, hd) {
    this.cx = cx; this.cz = cz; this.hw = hw; this.hd = hd;
  }
  get minX() { return this.cx - this.hw; }
  get maxX() { return this.cx + this.hw; }
  get minZ() { return this.cz - this.hd; }
  get maxZ() { return this.cz + this.hd; }
  containsPoint(x, z) {
    return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ;
  }
}

// Resolve a circle (player/enemy) of given radius against a list of AABBs.
// Mutates and returns {x, z}. Axis-separated push-out.
export function resolveCircleAABBs(x, z, r, boxes) {
  for (const b of boxes) {
    const nearestX = clamp(x, b.minX, b.maxX);
    const nearestZ = clamp(z, b.minZ, b.maxZ);
    let dx = x - nearestX;
    let dz = z - nearestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < r * r) {
      if (distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const push = r - dist;
        x += (dx / dist) * push;
        z += (dz / dist) * push;
      } else {
        // center inside box — push out along the smallest penetration axis
        const penLeft = x - b.minX;
        const penRight = b.maxX - x;
        const penDown = z - b.minZ;
        const penUp = b.maxZ - z;
        const m = Math.min(penLeft, penRight, penDown, penUp);
        if (m === penLeft) x = b.minX - r;
        else if (m === penRight) x = b.maxX + r;
        else if (m === penDown) z = b.minZ - r;
        else z = b.maxZ + r;
      }
    }
  }
  return { x, z };
}

// Segment vs AABB list — returns true if the XZ segment is blocked by a wall.
// Used for line-of-sight checks against wall colliders.
export function segmentBlocked(x0, z0, x1, z1, boxes) {
  for (const b of boxes) {
    if (segIntersectsAABB(x0, z0, x1, z1, b)) return true;
  }
  return false;
}

function segIntersectsAABB(x0, z0, x1, z1, b) {
  // Liang–Barsky clipping
  const dx = x1 - x0, dz = z1 - z0;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dz, dz];
  const q = [x0 - b.minX, b.maxX - x0, z0 - b.minZ, b.maxZ - z0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return true;
}

export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}
