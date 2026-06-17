// ============================================================================
//  models.js — builds stylised humanoid characters and weapon meshes from
//  Three.js primitives (no external 3D assets). Exposes animatable parts.
// ============================================================================

import * as THREE from 'three';

function mat(color, rough = 0.7, metal = 0.1, emissive = 0x000000) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive });
}

// Build a humanoid. opts: { color, headColor, scale, weaponColor }
export function buildCharacter(opts = {}) {
  const scale = opts.scale || 1;
  const bodyColor = opts.color ?? 0x445566;
  const headColor = opts.headColor ?? 0xc89568;
  // self-illumination (a brightened tint of the base) keeps characters readable
  // in dim tactical lighting where overhead point-lights only graze their fronts
  const white = new THREE.Color(0xffffff);
  const bodyMat = mat(bodyColor, 0.7, 0.12);
  bodyMat.emissive = new THREE.Color(bodyColor).lerp(white, 0.25); bodyMat.emissiveIntensity = 0.9;
  const headMat = mat(headColor, 0.6, 0.0);
  headMat.emissive = new THREE.Color(headColor).lerp(white, 0.15); headMat.emissiveIntensity = 0.8;
  const gearMat = mat(0x40444c, 0.55, 0.3);
  gearMat.emissive = new THREE.Color(0x5a5e68); gearMat.emissiveIntensity = 0.8;

  const root = new THREE.Group();

  // hips/torso pivot
  const torso = new THREE.Group();
  torso.position.y = 0.95 * scale;
  root.add(torso);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.62 * scale, 0.62 * scale, 0.36 * scale), bodyMat);
  chest.position.y = 0.18 * scale; chest.castShadow = true;
  torso.add(chest);

  // tactical vest accent
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.64 * scale, 0.42 * scale, 0.4 * scale), gearMat);
  vest.position.y = 0.16 * scale; vest.castShadow = true;
  torso.add(vest);

  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.5 * scale, 0.32 * scale, 0.34 * scale), bodyMat);
  pelvis.position.y = -0.22 * scale; pelvis.castShadow = true;
  torso.add(pelvis);

  // head + simple face
  const headGrp = new THREE.Group();
  headGrp.position.y = 0.62 * scale;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18 * scale, 12, 10), headMat);
  head.castShadow = true;
  headGrp.add(head);
  // cap / hair
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.185 * scale, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), gearMat);
  cap.position.y = 0.02 * scale; headGrp.add(cap);
  torso.add(headGrp);

  // arm group (aims weapon) — pivots at shoulders
  const arms = new THREE.Group();
  arms.position.set(0, 0.3 * scale, 0);
  torso.add(arms);

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16 * scale, 0.5 * scale, 0.16 * scale), bodyMat);
  armL.position.set(-0.34 * scale, -0.05 * scale, 0.05 * scale);
  armL.castShadow = true; arms.add(armL);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.16 * scale, 0.5 * scale, 0.16 * scale), bodyMat);
  armR.position.set(0.3 * scale, -0.1 * scale, 0.18 * scale);
  armR.rotation.x = -1.1; armR.castShadow = true; arms.add(armR);

  // weapon held forward in arms
  const weapon = buildWeaponModel(opts.weaponColor ?? 0x222222, scale * 0.9);
  weapon.position.set(0.18 * scale, -0.12 * scale, 0.34 * scale);
  arms.add(weapon);

  // legs
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18 * scale, 0.86 * scale, 0.2 * scale), gearMat);
  legL.geometry.translate(0, -0.43 * scale, 0);
  legL.position.set(-0.14 * scale, 0.7 * scale, 0); legL.castShadow = true;
  root.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.18 * scale, 0.86 * scale, 0.2 * scale), gearMat);
  legR.geometry.translate(0, -0.43 * scale, 0);
  legR.position.set(0.14 * scale, 0.7 * scale, 0); legR.castShadow = true;
  root.add(legR);

  return { root, parts: { torso, headGrp, arms, legL, legR, weapon, chest }, scale };
}

// Weapon model for held / world use
export function buildWeaponModel(color = 0x222222, scale = 1) {
  const g = new THREE.Group();
  const body = mat(color, 0.5, 0.4);
  const dark = mat(0x111111, 0.4, 0.5);

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.5), body);
  receiver.castShadow = true; g.add(receiver);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 8), dark);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, 0.42); g.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.1), dark);
  mag.position.set(0, -0.13, 0.05); g.add(mag);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.22), body);
  stock.position.set(0, -0.02, -0.32); g.add(stock);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.06), dark);
  sight.position.set(0, 0.09, 0.05); g.add(sight);
  g.scale.setScalar(scale);
  return g;
}

// First-person view-model: arms + detailed weapon attached to camera space.
// Built into an inner group rotated 180° so the barrel points -Z (forward).
export function buildViewModel(weaponDef) {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.rotation.y = Math.PI;
  root.add(g);
  const skin = mat(0xb07a4a, 0.6, 0.0);
  const glove = mat(0x15171a, 0.5, 0.2);
  const body = mat(weaponDef.color, 0.45, 0.45);
  const dark = mat(0x0e0e10, 0.35, 0.55);
  const accent = mat(0x222426, 0.4, 0.5);

  // proportions per weapon class
  const cls = weaponDef.cls;
  let barrelLen = 0.5, recLen = 0.42;
  if (cls === 'SMG' || cls === 'Sidearm') { barrelLen = 0.28; recLen = 0.3; }
  if (cls === 'Shotgun') { barrelLen = 0.55; recLen = 0.4; }
  if (cls === 'Marksman') { barrelLen = 0.7; recLen = 0.5; }

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, recLen), body);
  g.add(receiver);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, barrelLen, 10), dark);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.025, recLen / 2 + barrelLen / 2 - 0.05);
  g.add(barrel);
  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, barrelLen * 0.6), accent);
  handguard.position.set(0, -0.01, recLen / 2 + barrelLen * 0.25);
  g.add(handguard);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.12), dark);
  mag.position.set(0, -0.2, 0.02); mag.rotation.x = 0.18;
  g.add(mag);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), accent);
  grip.position.set(0, -0.16, -0.16); grip.rotation.x = -0.35;
  g.add(grip);
  if (cls !== 'Sidearm') {
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.26), body);
    stock.position.set(0, -0.02, -recLen / 2 - 0.12);
    g.add(stock);
  }
  // sights
  const rear = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.05), dark);
  rear.position.set(0, 0.1, -0.08); g.add(rear);
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.04), dark);
  front.position.set(0, 0.1, recLen / 2 + barrelLen * 0.5); g.add(front);
  if (cls === 'Marksman') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.26, 12), dark);
    scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.12, 0.02); g.add(scope);
  }

  // hands
  const handR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.12), glove);
  handR.position.set(0, -0.13, -0.15); g.add(handR);
  const foreArmR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.26), skin);
  foreArmR.position.set(0.02, -0.2, -0.3); foreArmR.rotation.x = 0.5; g.add(foreArmR);
  const handL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.11), glove);
  handL.position.set(0, -0.06, recLen / 2 + barrelLen * 0.25); g.add(handL);
  const foreArmL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.24), skin);
  foreArmL.position.set(-0.06, -0.16, 0.14); foreArmL.rotation.set(0.6, 0.2, 0.2); g.add(foreArmL);

  // muzzle reference point (world-space queried by player)
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.025, recLen / 2 + barrelLen - 0.02);
  g.add(muzzle);

  root.scale.setScalar(1.15);
  // transparent so the view-model can fade out while aiming down sights
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; o.renderOrder = 999; if (o.material) { o.material.depthTest = true; o.material.transparent = true; } } });
  return { group: root, muzzle };
}
