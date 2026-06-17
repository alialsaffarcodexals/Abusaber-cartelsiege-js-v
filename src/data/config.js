// ============================================================================
//  Abu Saber: Cartel Siege — HTML/JS Edition
//  config.js — Single source of truth for tuned gameplay values.
//  Values mirror the Unity design docs (docs/01,09,10,12,13,15,19,24,25)
//  and the original ScriptableObject assets (Assets/_TestSetup/Configs).
// ============================================================================

export const PLAYER = {
  maxHealth: 100,
  maxArmor: 100,
  healthRegenDelay: 6.0,      // seconds out of combat before regen kicks in
  healthRegenPerSec: 8.0,
  // Movement (mirrors PlayerMovementConfig.asset)
  walkSpeed: 4.5,
  sprintSpeed: 7.0,
  crouchSpeed: 2.2,
  groundAccel: 14,
  groundDecel: 18,
  airControl: 0.35,
  jumpHeight: 1.1,
  gravity: -19.62,
  standEyeHeight: 1.65,
  crouchEyeHeight: 1.05,
  radius: 0.34,
  // Look
  mouseSensitivity: 0.0022,
  pitchClamp: Math.PI / 2 - 0.05,
  // Interaction
  interactRange: 2.6,
  takedownRange: 1.8,
  // Melee
  meleeDamage: 65,
  meleeRange: 2.2,
  meleeCooldown: 0.6,
};

// Grenades ------------------------------------------------------------------
export const GRENADES = {
  frag: {
    name: 'Frag',
    fuse: 1.8,
    radius: 6.0,
    maxDamage: 130,
    throwForce: 14,
    startCount: 2,
    maxCount: 4,
  },
  flash: {
    name: 'Flash',
    fuse: 1.4,
    radius: 9.0,
    blindDuration: 3.2,
    throwForce: 15,
    startCount: 2,
    maxCount: 4,
  },
};

// Weapons -------------------------------------------------------------------
// fireMode: 'auto' | 'semi' | 'burst'
// Damage falloff: full damage until falloffStart, linearly down to
// minDamageMultiplier at falloffEnd.
export const WEAPONS = {
  m16: {
    id: 'm16', name: 'M16', cls: 'Assault Rifle', fireMode: 'burst', reticle: 'holo',
    rpm: 800, burstCount: 3, burstCooldown: 0.22,
    damage: 26, range: 120, falloffStart: 20, falloffEnd: 60, minDamageMult: 0.6,
    hipSpread: 1.2, adsSpread: 0.2, adsFov: 52, adsMoveMult: 0.55,
    magazine: 30, reserve: 90, reloadTime: 2.2, equipTime: 0.45,
    recoilV: 0.6, recoilH: 0.25, adsRecoilMult: 0.5,
    noiseRadius: 30, pellets: 1, color: 0x2b2f33,
    sound: { type: 'rifle', freq: 220, snap: 1700, dur: 0.16, vol: 0.85 },
  },
  ak: {
    id: 'ak', name: 'AK-Platform', cls: 'Assault Rifle', fireMode: 'auto', reticle: 'cross',
    rpm: 600, burstCount: 0, burstCooldown: 0,
    damage: 34, range: 110, falloffStart: 18, falloffEnd: 55, minDamageMult: 0.6,
    hipSpread: 2.4, adsSpread: 0.6, adsFov: 54, adsMoveMult: 0.6,
    magazine: 30, reserve: 90, reloadTime: 2.6, equipTime: 0.5,
    recoilV: 1.0, recoilH: 0.5, adsRecoilMult: 0.6,
    noiseRadius: 34, pellets: 1, color: 0x4a3526,
    sound: { type: 'rifle', freq: 150, snap: 1300, dur: 0.19, vol: 0.95 },
  },
  mp5: {
    id: 'mp5', name: 'MP5', cls: 'SMG', fireMode: 'auto', reticle: 'dot',
    rpm: 900, burstCount: 0, burstCooldown: 0,
    damage: 18, range: 60, falloffStart: 10, falloffEnd: 30, minDamageMult: 0.5,
    hipSpread: 1.8, adsSpread: 0.5, adsFov: 58, adsMoveMult: 0.7,
    magazine: 30, reserve: 120, reloadTime: 2.0, equipTime: 0.4,
    recoilV: 0.4, recoilH: 0.2, adsRecoilMult: 0.5,
    noiseRadius: 24, pellets: 1, color: 0x1f2326,
    sound: { type: 'smg', freq: 260, snap: 2100, dur: 0.11, vol: 0.7 },
  },
  shotgun: {
    id: 'shotgun', name: 'Shotgun', cls: 'Shotgun', fireMode: 'semi', reticle: 'spread',
    rpm: 90, burstCount: 0, burstCooldown: 0,
    damage: 15, range: 28, falloffStart: 6, falloffEnd: 18, minDamageMult: 0.25,
    hipSpread: 5.5, adsSpread: 3.5, adsFov: 60, adsMoveMult: 0.6,
    magazine: 7, reserve: 35, reloadTime: 3.4, equipTime: 0.55,
    recoilV: 2.4, recoilH: 0.6, adsRecoilMult: 0.8,
    noiseRadius: 36, pellets: 9, color: 0x3a2c1e,
    sound: { type: 'shotgun', freq: 90, snap: 900, dur: 0.28, vol: 1.0 },
  },
  dmr: {
    id: 'dmr', name: 'DMR', cls: 'Marksman', fireMode: 'semi', reticle: 'sniper',
    rpm: 280, burstCount: 0, burstCooldown: 0,
    damage: 62, range: 180, falloffStart: 60, falloffEnd: 160, minDamageMult: 0.85,
    hipSpread: 2.0, adsSpread: 0.05, adsFov: 38, adsMoveMult: 0.4,
    magazine: 12, reserve: 48, reloadTime: 2.8, equipTime: 0.6,
    recoilV: 1.6, recoilH: 0.3, adsRecoilMult: 0.55,
    noiseRadius: 40, pellets: 1, color: 0x2a3326,
    sound: { type: 'rifle', freq: 120, snap: 1500, dur: 0.24, vol: 1.0 },
  },
  pistol: {
    id: 'pistol', name: 'Pistol', cls: 'Sidearm', fireMode: 'semi', reticle: 'pistol',
    rpm: 360, burstCount: 0, burstCooldown: 0,
    damage: 22, range: 50, falloffStart: 14, falloffEnd: 36, minDamageMult: 0.6,
    hipSpread: 1.6, adsSpread: 0.4, adsFov: 55, adsMoveMult: 0.85,
    magazine: 15, reserve: 60, reloadTime: 1.6, equipTime: 0.3,
    recoilV: 0.7, recoilH: 0.3, adsRecoilMult: 0.5,
    noiseRadius: 20, pellets: 1, color: 0x26292c,
    sound: { type: 'pistol', freq: 200, snap: 1900, dur: 0.12, vol: 0.7 },
  },
};

// Hit-location multipliers (doc 09)
export const HIT_MULT = { head: 2.0, chest: 1.0, limb: 0.7 };

// Enemy archetypes (doc 03/10) ---------------------------------------------
export const ENEMIES = {
  foot: {
    id: 'foot', name: 'Foot Soldier', health: 70, armor: 0,
    weapon: 'pistol', moveSpeed: 2.6, color: 0x8a5e44, headColor: 0xd8a77a,
    viewDistance: 16, viewAngle: 110, reaction: 0.55, aimError: 4.2,
    fireBurst: [2, 4], money: 20, threat: 1,
  },
  gunman: {
    id: 'gunman', name: 'Armed Enforcer', health: 100, armor: 25,
    weapon: 'ak', moveSpeed: 2.8, color: 0x53627a, headColor: 0xcf9b72,
    viewDistance: 18, viewAngle: 110, reaction: 0.42, aimError: 3.4,
    fireBurst: [3, 5], money: 35, threat: 2,
  },
  elite: {
    id: 'elite', name: 'Elite Enforcer', health: 130, armor: 50,
    weapon: 'm16', moveSpeed: 3.2, color: 0x3e4a60, headColor: 0xc89568,
    viewDistance: 20, viewAngle: 100, reaction: 0.3, aimError: 2.4,
    fireBurst: [3, 6], money: 60, threat: 3, grenades: true,
  },
  heavy: {
    id: 'heavy', name: 'Heavy Unit', health: 240, armor: 90,
    weapon: 'shotgun', moveSpeed: 1.9, color: 0x6a5236, headColor: 0xb98a5e,
    viewDistance: 15, viewAngle: 100, reaction: 0.5, aimError: 4.0,
    fireBurst: [1, 1], money: 90, threat: 4, big: true,
  },
  sniper: {
    id: 'sniper', name: 'Sniper Unit', health: 80, armor: 10,
    weapon: 'dmr', moveSpeed: 2.4, color: 0x4a5a38, headColor: 0xc89568,
    viewDistance: 40, viewAngle: 60, reaction: 0.7, aimError: 1.3,
    fireBurst: [1, 1], money: 70, threat: 3, sniper: true,
  },
};

// Squad companions (doc 03) -------------------------------------------------
// Companions are tanky (HP persists across floors; permadeath if it hits 0).
export const SQUAD = [
  { id: 'yusuf', name: 'Yusuf', weapon: 'm16', color: 0xe8e3d8, headColor: 0x7a5236, health: 400, accuracy: 0.82 },
  { id: 'haider', name: 'Haider', weapon: 'shotgun', color: 0x35502f, headColor: 0x8a5e3c, health: 500, accuracy: 0.7 },
  { id: 'shula', name: "Al-Shu'la", weapon: 'ak', color: 0x4a4a52, headColor: 0xd8b48a, health: 350, accuracy: 0.85 },
];

// Difficulty modifiers (doc 01/10) -----------------------------------------
export const DIFFICULTY = {
  easy:    { label: 'Easy',    enemyDmg: 0.6, enemyReaction: 1.5, enemyAim: 1.6, lootMult: 1.4, regen: 1.5 },
  normal:  { label: 'Normal',  enemyDmg: 1.0, enemyReaction: 1.0, enemyAim: 1.0, lootMult: 1.0, regen: 1.0 },
  hard:    { label: 'Hard',    enemyDmg: 1.35, enemyReaction: 0.7, enemyAim: 0.7, lootMult: 0.75, regen: 0.7 },
  veteran: { label: 'Veteran', enemyDmg: 1.7, enemyReaction: 0.5, enemyAim: 0.55, lootMult: 0.55, regen: 0.4 },
};

// Floor catalog (doc 12) — 7 floors + boss ---------------------------------
// palette: { floor, wall, accent, fog, ambient, light } hex
// roster: enemy archetype counts. loot: pickup counts.
export const FLOORS = [
  {
    index: 1, name: 'Entry Level', subtitle: 'Damaged residential corridors',
    objective: 'Breach the building and clear the entry floor',
    size: { w: 34, d: 46 }, rooms: 5,
    palette: { floor: 0x2b2722, wall: 0x4a443c, accent: 0x6b5a3f, fog: 0x14110d, ambient: 0x2a2620, light: 0xffe6b0, lightI: 0.9 },
    roster: { foot: 5 }, loot: { ammo: 3, armor: 1, money: 2 },
    civilians: 2, mood: 'tutorial',
  },
  {
    index: 2, name: 'Residential Chaos', subtitle: 'Civilians hide under occupation',
    objective: 'Move through the apartments and reach the stairwell',
    size: { w: 36, d: 50 }, rooms: 6,
    palette: { floor: 0x2a2520, wall: 0x47423a, accent: 0x7a5a3a, fog: 0x12100c, ambient: 0x29241e, light: 0xffd99a, lightI: 0.85 },
    roster: { foot: 5, gunman: 2 }, loot: { ammo: 3, armor: 1, money: 3 },
    civilians: 3, mood: 'tutorial',
  },
  {
    index: 3, name: 'Controlled Territory', subtitle: 'The cartel asserts control',
    objective: 'Disable the alarm and clear cartel resistance',
    size: { w: 40, d: 54 }, rooms: 6,
    palette: { floor: 0x24262a, wall: 0x3c4148, accent: 0x8a4a3a, fog: 0x0e1014, ambient: 0x23262b, light: 0xfff0d8, lightI: 0.8 },
    roster: { foot: 4, gunman: 5 }, loot: { ammo: 4, armor: 2, money: 3 },
    civilians: 1, mood: 'tactical', alarm: true,
  },
  {
    index: 4, name: 'Security Zone', subtitle: 'A defensive stronghold',
    objective: 'Push through the security checkpoints',
    size: { w: 42, d: 56 }, rooms: 7,
    palette: { floor: 0x201a1a, wall: 0x3a2c2c, accent: 0xaa2e2e, fog: 0x180a0a, ambient: 0x281a1a, light: 0xff5a4a, lightI: 0.7 },
    roster: { gunman: 5, elite: 3 }, loot: { ammo: 4, armor: 2, money: 4 },
    civilians: 0, mood: 'tactical',
  },
  {
    index: 5, name: 'Militarized Zone', subtitle: 'Cartel militarization complete',
    objective: 'Survive the ambush and clear the armory',
    size: { w: 44, d: 60 }, rooms: 7,
    palette: { floor: 0x1c1f22, wall: 0x33393f, accent: 0x3a7a6a, fog: 0x0c0f11, ambient: 0x20262a, light: 0xbfeede, lightI: 0.75 },
    roster: { gunman: 4, elite: 4, heavy: 2 }, loot: { ammo: 5, armor: 3, money: 4 },
    civilians: 0, mood: 'intense',
  },
  {
    index: 6, name: 'Command Preparation', subtitle: 'Approach to the leadership area',
    objective: 'Clear the command floor — trust nothing',
    size: { w: 46, d: 62 }, rooms: 8,
    palette: { floor: 0x18191c, wall: 0x2c3036, accent: 0x6a5aaa, fog: 0x0a0b0e, ambient: 0x1c2026, light: 0xcfc4ff, lightI: 0.7 },
    roster: { elite: 5, heavy: 3, sniper: 2 }, loot: { ammo: 5, armor: 3, money: 5 },
    civilians: 0, mood: 'intense',
  },
  {
    index: 7, name: 'Cartel Headquarters', subtitle: 'The final stronghold of Abu Kashma',
    objective: 'Eliminate the boss bodyguards, then face Abu Kashma',
    size: { w: 52, d: 66 }, rooms: 5,
    palette: { floor: 0x14161c, wall: 0x232838, accent: 0xc9a23a, fog: 0x06070c, ambient: 0x1a1d2a, light: 0xffe9a8, lightI: 0.95 },
    roster: { elite: 6, heavy: 2 }, loot: { ammo: 4, armor: 3, money: 5 },
    civilians: 0, mood: 'boss', boss: true,
  },
];

// Boss — Abu Kashma (doc 24) -----------------------------------------------
export const BOSS = {
  name: 'Abu Kashma', health: 1400, armor: 200,
  weapon: 'dmr', moveSpeed: 3.4, color: 0x1a1a22, headColor: 0xc89a68,
  phase2At: 0.7, phase3At: 0.3,
  reinforceInterval: 16, reinforceCount: 2,
  aimError: 2.0, money: 500,
  lines: {
    intro: 'You made it all the way here… impressive.',
    phase2: 'This building was never yours.',
    phase3: "Enough games. Let's end this properly.",
    death: 'Impossible…',
  },
};

// Loot / pickups ------------------------------------------------------------
export const LOOT = {
  ammoPack: { type: 'ammo', amount: 0.5, label: 'Ammo' },   // 50% of a reserve top-up
  armorPack: { type: 'armor', amount: 50, label: 'Armor' },
  health: { type: 'health', amount: 40, label: 'Medkit' },
  money: { type: 'money', amount: [40, 120], label: 'Cash' },
};

// Economy — store prices ----------------------------------------------------
export const STORE = {
  weapons: [
    { id: 'mp5', price: 350 },
    { id: 'shotgun', price: 500 },
    { id: 'dmr', price: 800 },
    { id: 'ak', price: 450 },
  ],
  upgrades: [
    { id: 'armorCap', label: 'Armor +25 max', price: 300, max: 3 },
    { id: 'damage', label: 'Weapon damage +10%', price: 400, max: 4 },
    { id: 'reload', label: 'Reload speed +15%', price: 300, max: 3 },
    { id: 'grenade', label: 'Grenade capacity +1', price: 250, max: 2 },
  ],
  fragPrice: 120,
  flashPrice: 100,
  ammoPrice: 80,
  armorPrice: 150,
  healSquad: 200,    // heal all living companions to full
  revivePrice: 400,  // bring a fallen companion back at 50% HP
};

export const NOISE = {
  // detection contribution radius multipliers
  crouchWalk: 3, walk: 9, sprint: 16, gunshotMult: 1.0, melee: 4,
};
