// ============================================================================
//  materials.js — procedural canvas textures + shared material factory.
//  Generates concrete/metal/carpet/tile maps at runtime (no image files).
// ============================================================================

import * as THREE from 'three';

function canvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function noiseCanvas(size, base, contrast, grain) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * grain;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// concrete with subtle cracks + stains
function concreteCanvas(size = 256) {
  const c = noiseCanvas(size, '#7a7770', 1, 36);
  const ctx = c.getContext('2d');
  // stains
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 10 + Math.random() * 50;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() > 0.5;
    g.addColorStop(0, dark ? 'rgba(40,38,34,0.25)' : 'rgba(150,148,140,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // cracks
  ctx.strokeStyle = 'rgba(30,28,26,0.5)';
  for (let i = 0; i < 5; i++) {
    ctx.lineWidth = 0.6 + Math.random();
    ctx.beginPath();
    let x = Math.random() * size, y = Math.random() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += (Math.random() - 0.5) * 50; y += (Math.random() - 0.5) * 50; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return c;
}

// floor tile grid
function tileCanvas(size = 256, lineCol = '#1c1c1e') {
  const c = noiseCanvas(size, '#5a5a5e', 1, 22);
  const ctx = c.getContext('2d');
  const n = 4;
  const step = size / n;
  ctx.strokeStyle = lineCol;
  ctx.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke();
  }
  return c;
}

// metal panel
function metalCanvas(size = 256) {
  const c = noiseCanvas(size, '#6c7076', 1, 18);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(20,22,24,0.6)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(0, i * size / 4); ctx.lineTo(size, i * size / 4); ctx.stroke();
  }
  // rivets
  ctx.fillStyle = 'rgba(30,32,34,0.8)';
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    ctx.beginPath(); ctx.arc(8 + i * size / 4, 8 + j * size / 4, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

// carpet (luxury floor 7)
function carpetCanvas(size = 256) {
  const c = noiseCanvas(size, '#3a2a32', 1, 14);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(180,150,90,0.12)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < size; i += 8) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke(); }
  return c;
}

function makeTex(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

let _cache = null;

export function getTextures() {
  if (_cache) return _cache;
  _cache = {
    concrete: concreteCanvas(256),
    tile: tileCanvas(256),
    metal: metalCanvas(256),
    carpet: carpetCanvas(256),
  };
  return _cache;
}

// brighten an albedo toward white so the texture map doesn't double-darken it
function lighten(hex, amt) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0xffffff), amt);
  return c;
}

// Material factory used by floor builder. mood selects the surface tint.
export function makeMaterials(palette, mood) {
  const tex = getTextures();
  const floorTexSrc = mood === 'boss' ? tex.carpet : (mood === 'intense' ? tex.metal : tex.concrete);
  const floorTex = makeTex(floorTexSrc, 8);
  const wallTex = makeTex(tex.concrete, 3);

  const floorMat = new THREE.MeshStandardMaterial({
    color: lighten(palette.floor, 0.35), map: floorTex, roughness: 0.92, metalness: 0.04,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: lighten(palette.wall, 0.28), map: wallTex, roughness: 0.85, metalness: 0.06,
  });
  const ceilMat = new THREE.MeshStandardMaterial({
    color: lighten(palette.wall, 0.12), roughness: 0.95, metalness: 0.02,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: palette.accent, roughness: 0.6, metalness: 0.3,
  });
  const coverMat = new THREE.MeshStandardMaterial({
    color: 0x3a3631, map: makeTex(tex.metal, 1), roughness: 0.7, metalness: 0.4,
  });
  const propMat = new THREE.MeshStandardMaterial({
    color: 0x2e2a26, roughness: 0.8, metalness: 0.1,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x88bbcc, roughness: 0.1, metalness: 0.0, transparent: true, opacity: 0.28,
  });
  return { floorMat, wallMat, ceilMat, accentMat, coverMat, propMat, glassMat };
}
