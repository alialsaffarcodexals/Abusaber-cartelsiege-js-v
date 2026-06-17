// ============================================================================
//  game.js — central controller. Owns the renderer/scene/camera, the game
//  state machine, floor loading, combat resolution, AI orchestration,
//  objectives, economy, save/load, and the front-end flow.
// ============================================================================

import * as THREE from 'three';
import { PLAYER, WEAPONS, ENEMIES, SQUAD, DIFFICULTY, FLOORS, HIT_MULT, BOSS, NOISE } from './data/config.js';
import { clamp, rand, randInt, dist2D, pick } from './core/utils.js';
import { AudioEngine } from './core/audio.js';
import { Input } from './core/input.js';
import { Save } from './core/save.js';
import { Effects } from './world/effects.js';
import { buildFloor } from './world/floorBuilder.js';
import { Player } from './entities/player.js';
import { Enemy } from './entities/enemy.js';
import { Boss } from './entities/boss.js';
import { Squad } from './entities/squad.js';
import { Grenade } from './entities/grenade.js';
import { Pickup } from './entities/pickup.js';
import { HUD } from './ui/hud.js';
import { Menus } from './ui/menus.js';

const STATE = { LOADING: 'loading', MENU: 'menu', BRIEFING: 'briefing', PLAYING: 'playing', PAUSED: 'paused', STORE: 'store', INVENTORY: 'inventory', GAMEOVER: 'gameover', VICTORY: 'victory' };

export class Game {
  constructor(canvas, hudRoot, overlayRoot) {
    this.canvas = canvas;
    this.state = STATE.LOADING;
    this.time = 0;

    // settings
    this.settings = Save.loadSettings();
    this.difficulty = this.settings.difficulty || 'normal';
    this.diffMod = DIFFICULTY[this.difficulty];

    // renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false; // rich multi-point lighting instead (perf)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov || 75, window.innerWidth / window.innerHeight, 0.05, 400);
    this.scene.add(this.camera);

    // weapon/near fill light so the viewmodel & immediate surroundings stay readable
    // (in front of the camera, in camera-local space, lighting the held weapon)
    this.viewLight = new THREE.PointLight(0xfff2e2, 1.1, 9, 2);
    this.viewLight.position.set(0.15, 0.0, -0.4);
    this.camera.add(this.viewLight);

    // systems
    this.audio = new AudioEngine();
    this.input = new Input(canvas);
    this.effects = new Effects(this.scene);
    this.hud = new HUD(this, hudRoot);
    this.menus = new Menus(this, overlayRoot);

    // entities
    this.player = new Player(this);
    this.squad = new Squad(this);
    this.enemies = [];
    this.grenades = [];
    this.pickups = [];

    this.floor = null;
    this.floorIndex = 1;
    this.boss = null;
    this.bossSpawned = false;

    // stats
    this.stats = { kills: 0, takedowns: 0, money: 0 };
    this.objectiveComplete = false;
    this.alarmActive = false;

    this._raycaster = new THREE.Raycaster();
    this.worldMeshes = [];

    this._bindEvents();
    this.hud.setVisible(false);
  }

  _bindEvents() {
    window.addEventListener('resize', () => this._onResize());
    this.input.on('lockchange', (locked) => {
      if (!locked && this.state === STATE.PLAYING) this.pause();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        if (this.state === STATE.PLAYING || this.state === STATE.INVENTORY) { e.preventDefault(); this.toggleInventory(); }
        return;
      }
      if (e.code === 'Escape') {
        if (this.state === STATE.PLAYING) this.pause();
        else if (this.state === STATE.PAUSED) this.resumeFromPause();
        else if (this.state === STATE.INVENTORY) this.toggleInventory();
      }
    });
    // click canvas to re-lock when playing
    this.canvas.addEventListener('click', () => {
      if (this.state === STATE.PLAYING && !this.input.locked) this.input.requestLock();
    });
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // -------------------------------------------------------------------------
  //  FLOW
  // -------------------------------------------------------------------------
  boot() {
    this.state = STATE.MENU;
    this.applyLockScreen();
    this.menus.mainMenu();
  }

  // Tab lock: when enabled, intercept tab close / navigation / refresh
  // (Ctrl+W, Ctrl+R, F5, etc.) with the browser's leave-confirmation, so the
  // player can't accidentally quit the game. Browsers reserve these shortcuts
  // and won't let JS silently swallow them, so a confirm prompt is the guard.
  applyLockScreen() {
    if (this.settings.lockScreen) {
      if (!this._beforeUnload) {
        this._beforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
        window.addEventListener('beforeunload', this._beforeUnload);
      }
    } else if (this._beforeUnload) {
      window.removeEventListener('beforeunload', this._beforeUnload);
      this._beforeUnload = null;
    }
  }

  startNewGame(difficulty, squadSize = 3) {
    this.audio.init(); this.audio.resume();
    this.difficulty = difficulty;
    this.settings.difficulty = difficulty;
    this.diffMod = DIFFICULTY[difficulty];
    Save.saveSettings(this.settings);
    this.stats = { kills: 0, takedowns: 0, money: 0 };
    this.squadSize = squadSize;
    this.squadState = this._freshSquadState(squadSize);
    // reset player (detach the previous one's view-model from the camera first)
    if (this.player) this.player.dispose();
    this.player = new Player(this);
    this.player.money = 0;
    this.floorIndex = 1;
    this._beginFloor(1, true);
  }

  // persistent squad roster state (HP carries across floors; dead stays dead).
  // n = how many companions deploy (0 = solo … 3 = full squad).
  _freshSquadState(n = 3) {
    return SQUAD.slice(0, Math.max(0, Math.min(3, n))).map((d) => ({ id: d.id, name: d.name, health: d.health, maxHealth: d.health, dead: false }));
  }

  toggleSquadHoldFire() {
    this.squad.holdFire = !this.squad.holdFire;
    const on = this.squad.holdFire;
    this.hud.toast(on ? 'SQUAD: HOLD FIRE' : 'SQUAD: WEAPONS FREE');
    const m = this.squad.members.find((c) => c.alive);
    if (m) this.hud.subtitle(m.def.name, on ? 'Holding fire.' : 'Weapons free!');
    this.audio.uiClick();
  }

  continueGame() {
    this.audio.init(); this.audio.resume();
    const data = Save.load();
    if (!data) { this.startNewGame('normal'); return; }
    this.difficulty = data.difficulty || 'normal';
    this.diffMod = DIFFICULTY[this.difficulty];
    this.stats = data.stats || { kills: 0, takedowns: 0, money: 0 };
    this.squadState = data.squadState || this._freshSquadState();
    this.squadSize = this.squadState.length;
    if (this.player) this.player.dispose();
    this.player = new Player(this);
    this.player.deserialize(data.player);
    this.floorIndex = data.floorIndex;
    this._beginFloor(this.floorIndex, true);
  }

  _beginFloor(index, briefing) {
    this.floorIndex = index;
    const def = FLOORS[index - 1];
    this.state = STATE.BRIEFING;
    this.input.exitLock();
    this.hud.setVisible(false);
    if (briefing) {
      this.menus.briefing(def, () => this._loadFloor(def));
    } else {
      this._loadFloor(def);
    }
  }

  _loadFloor(def) {
    this._clearFloor();
    this.objectiveComplete = false;
    this.bossSpawned = false;
    this.boss = null;
    this.alarmActive = false;
    this.hud.showAlarm(false);
    this.audio.stopAlarm();
    this.hud.hideBoss();

    // build geometry
    const f = buildFloor(def);
    this.floor = f;
    this.floor.def = def;
    this.floor.lightsOn = true;
    this.scene.add(f.group);

    // fog + background
    this.scene.fog = new THREE.Fog(def.palette.fog, 8, Math.max(def.size.w, def.size.d) * 1.4);
    this.scene.background = new THREE.Color(def.palette.fog);

    // cache world meshes for raycasting (solids only)
    this.worldMeshes = [];
    f.group.traverse((o) => {
      if (o.isMesh && !o.material.transparent) this.worldMeshes.push(o);
    });

    // attach light helpers
    this._attachFloorLightControls(f);

    // player spawn
    this.player.spawn(f.playerSpawn.x, f.playerSpawn.z, f.playerSpawn.yaw);
    this.player.reset(false);

    // squad — spawn only the survivors, with HP carried over from prior floors
    if (!this.squadState) this.squadState = this._freshSquadState();
    this.squad.holdFire = false;
    this.squad.spawn(SQUAD, f.playerSpawn.x, f.playerSpawn.z + 1.5, this.squadState);
    this.hud.buildSquad(this.squadState);
    this.hud.updateSquad();

    // enemies from roster
    this._spawnRoster(def);

    // loot
    this._spawnLoot(def, f);

    // boss (floor 7) — dormant until bodyguards cleared
    if (def.boss) {
      this.boss = new Boss(this, 0, def.size.d - 5);
      this.enemies.push(this.boss);
    }

    // objective
    this._initObjective(def);

    // HUD
    this.hud.setVisible(true);
    this.hud.setFloor(def.index, def.name);
    this.hud.updateVitals();
    this.hud.updateWeapon();
    this.hud.updateGrenades();
    this.hud.updateMoney();
    this.hud.setObjective(def.objective, '');

    // audio — per-level music track
    this.audio.startAmbient();
    this.audio.setFloor(def.index);
    this.audio.setMusicState('calm');

    // start play
    this.state = STATE.PLAYING;
    this.menus.hide();
    this.input.requestLock();
    this.hud.toast('FLOOR ' + def.index + ' — ' + def.name.toUpperCase());
    // autosave at floor entry (checkpoint)
    this.saveGame();
    this._checkpoint = { player: this.player.serialize(), floorIndex: this.floorIndex, stats: { ...this.stats }, squadState: this.squadState.map((s) => ({ ...s })) };
  }

  _spawnRoster(def) {
    const spawns = [...this.floor.enemySpawns];
    // shuffle
    for (let i = spawns.length - 1; i > 0; i--) { const j = randInt(0, i); [spawns[i], spawns[j]] = [spawns[j], spawns[i]]; }
    let si = 0;
    for (const [type, count] of Object.entries(def.roster)) {
      for (let c = 0; c < count; c++) {
        const sp = spawns[si % spawns.length] || { x: rand(-5, 5), z: def.size.d * 0.6 };
        si++;
        // keep enemies away from the immediate entrance
        let z = Math.max(sp.z, 8);
        const e = new Enemy(this, ENEMIES[type], sp.x + rand(-1.5, 1.5), z + rand(-1.5, 1.5));
        // floors 1-2 start idle/patrol; later floors more alert
        if (def.index >= 4) e.state = 1; // patrol
        this.enemies.push(e);
      }
    }
    this.floor.totalHostiles = this.enemies.filter((e) => !e.isBoss).length;
  }

  _spawnLoot(def, f) {
    const slots = [...f.lootSpawns];
    for (let i = slots.length - 1; i > 0; i--) { const j = randInt(0, i); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    let i = 0;
    const place = (type, opts) => {
      const s = slots[i % slots.length]; i++;
      if (!s) return;
      this.pickups.push(new Pickup(this, type, s.x, s.z, opts || {}));
    };
    const loot = def.loot;
    for (let a = 0; a < (loot.ammo || 0); a++) place('ammo');
    for (let a = 0; a < (loot.armor || 0); a++) place('armor');
    for (let a = 0; a < (loot.money || 0); a++) place('money', { amount: randInt(40, 120) });
    place('health');
    if (def.index >= 2) place('frag');
    if (def.index >= 3) place('flash');
    // a weapon pickup appears on some floors
    if (def.index === 2) place('weapon', { weaponId: 'mp5' });
    if (def.index === 3) place('weapon', { weaponId: 'ak' });
    if (def.index === 4) place('weapon', { weaponId: 'shotgun' });
    if (def.index === 5) place('weapon', { weaponId: 'dmr' });
  }

  _attachFloorLightControls(f) {
    f.toggleLights = () => {
      f.lightsOn = !f.lightsOn;
      for (const l of f.lights) {
        l.light.intensity = f.lightsOn ? l.baseIntensity : l.baseIntensity * 0.08;
        if (l.fixture && l.fixture.material.emissiveIntensity !== undefined)
          l.fixture.material.emissiveIntensity = f.lightsOn ? 0.6 : 0.05;
      }
      if (f.ambient) f.ambient.intensity = f.lightsOn ? 0.85 : 0.22;
      if (f.hemi) f.hemi.intensity = f.lightsOn ? 0.5 : 0.14;
      this.audio.beep(220, 0.05, 0.15, 'square', this.audio.sfxBus);
    };
    f.flickerLights = (duration) => {
      let t = 0;
      const iv = setInterval(() => {
        t += 0.08;
        const on = Math.random() > 0.4;
        for (const l of f.lights) l.light.intensity = on ? l.baseIntensity : l.baseIntensity * 0.1;
        if (t >= duration) { clearInterval(iv); for (const l of f.lights) l.light.intensity = f.lightsOn ? l.baseIntensity : l.baseIntensity * 0.08; }
      }, 80);
    };
  }

  _clearFloor() {
    if (this.floor) { this.scene.remove(this.floor.group); this.floor = null; }
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
    for (const p of this.pickups) p.dispose();
    this.pickups = [];
    for (const g of this.grenades) this.scene.remove(g.mesh);
    this.grenades = [];
    this.squad.dispose();
    this.effects.clear();
  }

  // -------------------------------------------------------------------------
  //  OBJECTIVES
  // -------------------------------------------------------------------------
  _initObjective(def) {
    this.objective = {
      def,
      requireAlarm: !!def.alarm,
      alarmDisabled: !def.alarm,
      isBoss: !!def.boss,
      bossTriggered: false,
    };
    this._updateObjectiveUI();
  }

  _updateObjectiveUI() {
    const remaining = this.enemies.filter((e) => e.alive && !e.isBoss).length;
    const o = this.objective;
    if (o.isBoss) {
      if (!o.bossTriggered) this.hud.setObjective('Eliminate the boss bodyguards', `Hostiles: ${remaining}`);
      else this.hud.setObjective('Defeat Abu Kashma', '');
    } else if (o.requireAlarm && !o.alarmDisabled) {
      this.hud.setObjective('Disable the alarm, then clear the floor', `Hostiles: ${remaining}`);
    } else if (!this.objectiveComplete) {
      this.hud.setObjective(o.def.objective, `Hostiles: ${remaining}`);
    }
  }

  _checkObjective() {
    const o = this.objective;
    const remaining = this.enemies.filter((e) => e.alive && !e.isBoss).length;

    if (o.isBoss) {
      if (!o.bossTriggered && remaining === 0) {
        o.bossTriggered = true;
        this.boss.trigger();
        this.bossSpawned = true;
        this.hud.setObjective('Defeat Abu Kashma', '');
        this.hud.toast('ABU KASHMA APPROACHES');
      }
      this._updateObjectiveUI();
      return; // victory handled by onBossDefeated
    }

    if (o.requireAlarm && !o.alarmDisabled) { this._updateObjectiveUI(); return; }

    if (remaining === 0 && !this.objectiveComplete) {
      this.objectiveComplete = true;
      this.hud.setObjective('Floor cleared — reach the exit', '✓');
      this.hud.toast('FLOOR CLEARED — REACH THE EXIT');
      this.audio.objective();
      this.audio.setMusicState('calm');
      // squad callout
      const m = this.squad.members.find((c) => c.alive && !c.downed);
      if (m) this.hud.subtitle(m.def.name, 'Area secure. Move to the stairwell.');
    } else {
      this._updateObjectiveUI();
    }
  }

  disableAlarm() {
    if (this.objective.alarmDisabled) return;
    this.objective.alarmDisabled = true;
    this.alarmActive = false;
    this.hud.showAlarm(false);
    this.audio.stopAlarm();
    this.hud.toast('ALARM DISABLED');
    this.audio.objective();
    this._checkObjective();
  }

  // -------------------------------------------------------------------------
  //  COMBAT RESOLUTION
  // -------------------------------------------------------------------------
  resolveShot(origin, dir, weapon, opts = {}) {
    const range = opts.range || weapon.range;
    this._raycaster.set(origin, dir);
    this._raycaster.far = range;

    // enemy region meshes (alive only matter for damage; dead still block)
    const enemyMeshes = [];
    for (const e of this.enemies) { if (e._regionMeshes) for (const m of e._regionMeshes) enemyMeshes.push(m); }

    const eHits = this._raycaster.intersectObjects(enemyMeshes, false);
    const wHits = this._raycaster.intersectObjects(this.worldMeshes, false);

    let hit = null, isEnemy = false;
    const e0 = eHits[0], w0 = wHits[0];
    if (e0 && (!w0 || e0.distance <= w0.distance)) { hit = e0; isEnemy = true; }
    else if (w0) { hit = w0; }

    const muzzle = opts.muzzlePos || origin;
    if (!hit) {
      const end = origin.clone().addScaledVector(dir, range);
      this.effects.tracer(muzzle, end, opts.shooter === 'player' ? 0xffe0a0 : 0xffaa55);
      return null;
    }

    this.effects.tracer(muzzle, hit.point, opts.shooter === 'player' ? 0xffe0a0 : 0xffaa55);

    if (isEnemy && hit.object.userData.enemy && hit.object.userData.enemy.alive) {
      const enemy = hit.object.userData.enemy;
      const region = hit.object.userData.region || 'chest';
      let dmg = weapon.damage * (HIT_MULT[region] || 1) * (opts.damageMult || 1);
      const d = origin.distanceTo(hit.point);
      if (d > weapon.falloffStart) {
        const t = clamp((d - weapon.falloffStart) / (weapon.falloffEnd - weapon.falloffStart), 0, 1);
        dmg *= (1 - t) + t * weapon.minDamageMult;
      }
      dmg = Math.round(dmg);
      const wasAlive = enemy.alive;
      enemy.takeDamage(dmg, region, dir, opts.shooter);
      this.effects.blood(hit.point, dir);
      this.audio.impact('flesh', hit.point.x, hit.point.z);
      if (opts.shooter === 'player') {
        const killed = wasAlive && !enemy.alive;
        this.hud.hitMarker(region === 'head', killed);
        if (region === 'head') this.audio.headshot(); else this.audio.hitmarker();
        if (killed) this.audio.kill();
      }
    } else {
      // world impact
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
      const kind = hit.object.material.metalness > 0.3 ? 'metal' : 'concrete';
      this.effects.impact(hit.point, n, kind);
      this.audio.impact(kind, hit.point.x, hit.point.z);
    }
    return hit;
  }

  meleeHit(pos, dir, range) {
    let best = null, bestD = range;
    const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      const dot = (dx * flat.x + dz * flat.z) / (d || 1);
      if (dot < 0.4) continue; // must be in front
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  spawnGrenade(type, origin, dir, owner) {
    this.grenades.push(new Grenade(this, type, origin, dir, owner));
  }

  emitNoise(x, z, radius, source) {
    for (const e of this.enemies) e.hearNoise(x, z, radius, source);
  }

  // -------------------------------------------------------------------------
  //  AI EVENTS
  // -------------------------------------------------------------------------
  onEnemyAlerted(enemy) {
    if (this.audio.musicState !== 'boss') this.audio.setMusicState('combat');
    // squad comms: alert nearby enemies to the player's last seen position
    for (const e of this.enemies) {
      if (e === enemy || !e.alive) continue;
      if (dist2D(e.pos.x, e.pos.z, enemy.pos.x, enemy.pos.z) < 16) e.alertTo(enemy.lastSeen.x, enemy.lastSeen.z);
    }
    // alarm escalation on alarm floors
    if (this.objective && this.objective.requireAlarm && !this.objective.alarmDisabled && !this.alarmActive) {
      this._triggerAlarm();
    }
  }

  _triggerAlarm() {
    this.alarmActive = true;
    this.hud.showAlarm(true);
    this.audio.startAlarm();
    this.hud.subtitle('Yusuf', 'They hit the alarm — kill the panel, fast!');
    this._reinforceTimer = 12;
  }

  onEnemyKilled(enemy, source, silent) {
    if (enemy.isBoss) return; // handled separately
    this.stats.kills++;
    if (source === 'takedown') this.stats.takedowns++;
    // economy
    const reward = Math.round((enemy.arch.money || 20) * (this.diffMod.lootMult || 1));
    this.player.addMoney(reward);
    this.stats.money += reward;
    // loot drop chance
    if (rand(0, 1) < 0.28) {
      const roll = rand(0, 1);
      const type = roll < 0.5 ? 'ammo' : roll < 0.8 ? 'armor' : 'health';
      this.pickups.push(new Pickup(this, type, enemy.pos.x, enemy.pos.z));
    }
    this._checkObjective();
  }

  spawnBossReinforcements(n) {
    const def = this.floor.def;
    for (let i = 0; i < n; i++) {
      const ang = rand(0, Math.PI * 2);
      const x = clamp(this.boss.pos.x + Math.cos(ang) * 6, this.floor.bounds.minX + 2, this.floor.bounds.maxX - 2);
      const z = clamp(this.boss.pos.z + Math.sin(ang) * 6, 6, this.floor.bounds.maxZ - 2);
      const e = new Enemy(this, ENEMIES.elite, x, z);
      e.detection = 1; e._enterCombat();
      this.enemies.push(e);
    }
    this.hud.toast('REINFORCEMENTS');
  }

  spawnAlarmReinforcements() {
    for (let i = 0; i < 2; i++) {
      const sp = pick(this.floor.enemySpawns);
      const e = new Enemy(this, ENEMIES.gunman, sp.x, Math.max(sp.z, 10));
      e.detection = 0.6; e.alertTo(this.player.pos.x, this.player.pos.z);
      this.enemies.push(e);
    }
    this.floor.totalHostiles += 2;
    this.hud.toast('REINFORCEMENTS INBOUND');
  }

  onBossDefeated(boss) {
    this.stats.kills++;
    const reward = BOSS.money;
    this.player.addMoney(reward); this.stats.money += reward;
    this.audio.stopAlarm();
    this.hud.hideBoss();
    // cinematic beat then victory
    setTimeout(() => this._victory(), 3200);
    // clear remaining enemies dramatically
    for (const e of this.enemies) { if (e.alive && !e.isBoss) e.die('boss', true); }
    this.hud.subtitle('Yusuf', 'It’s over, boss. The building is ours.');
  }

  onPlayerDeath() {
    this.state = STATE.GAMEOVER;
    this.input.exitLock();
    this.audio.setMusicState('calm');
    this.audio.stopAlarm();
    setTimeout(() => {
      this.menus.gameOver(() => this.restartCheckpoint(), () => this.quitToMenu());
    }, 1400);
  }

  // -------------------------------------------------------------------------
  //  INTERACTION
  // -------------------------------------------------------------------------
  findInteractable(player) {
    const px = player.pos.x, pz = player.pos.z;
    const candidates = [];

    // exit (only when objective complete)
    if (this.objectiveComplete && this.floor.exit) {
      const d = dist2D(px, pz, this.floor.exit.x, this.floor.exit.z);
      if (d < 2.6) candidates.push({ d, label: this.floorIndex >= 7 ? 'Confront the boss' : 'Proceed to next floor', key: 'E', action: () => this._reachExit() });
    }

    // takedown — unaware enemy
    for (const e of this.enemies) {
      if (!e.isTakedownable) continue;
      const d = dist2D(px, pz, e.pos.x, e.pos.z);
      if (d < PLAYER.takedownRange) candidates.push({ d: d - 0.5, label: 'Silent Takedown', key: 'E', action: () => this._doTakedown(e) });
    }

    // weapon pickups
    for (const pk of this.pickups) {
      if (pk.collected || !pk.requiresInteract) continue;
      const d = dist2D(px, pz, pk.pos.x, pk.pos.z);
      if (d < PLAYER.interactRange) candidates.push({ d, label: 'Pick up ' + pk.label, key: 'E', action: () => pk.collect() });
    }

    // floor interactables
    for (const it of this.floor.interactables) {
      const d = dist2D(px, pz, it.x, it.z);
      if (d > PLAYER.interactRange) continue;
      if (it.type === 'lights') candidates.push({ d, label: 'Toggle Lights', key: 'E', action: () => this.floor.toggleLights() });
      else if (it.type === 'alarm' && !this.objective.alarmDisabled) candidates.push({ d, label: 'Disable Alarm', key: 'E', action: () => { this.disableAlarm(); if (it.mesh) it.mesh.material.emissive.setHex(0x113322); } });
    }

    candidates.sort((a, b) => a.d - b.d);
    return candidates[0] || null;
  }

  _doTakedown(enemy) {
    enemy.takedown();
    this.audio.takedown();
    this.hud.toast('TAKEDOWN');
    this.onEnemyKilled(enemy, 'takedown', true);
  }

  _reachExit() {
    if (this.floorIndex >= 7) return; // boss floor uses bodyguard-clear flow
    this._floorComplete();
  }

  _floorComplete() {
    this.state = STATE.STORE;
    this.input.exitLock();
    this.audio.setMusicState('menu');
    const def = this.floor.def;
    const floorStats = { kills: this.stats.kills, takedowns: this.stats.takedowns, money: this.stats.money };
    this.menus.floorComplete(def, floorStats, () => {
      this.menus.store(() => {
        this.floorIndex++;
        this.saveGame();
        this._beginFloor(this.floorIndex, true);
      });
    });
  }

  _victory() {
    this.state = STATE.VICTORY;
    this.input.exitLock();
    this.hud.setVisible(false);
    Save.clear();
    this.menus.victory(this.stats);
  }

  // -------------------------------------------------------------------------
  //  PAUSE / SAVE
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  //  INVENTORY (Tab) — manage / drop weapons & grenades
  // -------------------------------------------------------------------------
  toggleInventory() {
    if (this.state === STATE.PLAYING) {
      this.state = STATE.INVENTORY;
      this.input.exitLock();
      this.audio.invOpen();
      this.menus.inventory(() => this.closeInventory());
    } else if (this.state === STATE.INVENTORY) {
      this.closeInventory();
    }
  }
  closeInventory() {
    if (this.state !== STATE.INVENTORY) return;
    this.state = STATE.PLAYING;
    this.menus.hide();
    this.audio.invClose();
    this.input.requestLock();
  }

  dropWeapon(id) {
    const p = this.player;
    if (p.inventory.length <= 1) return false;          // keep at least one
    const idx = p.inventory.indexOf(id); if (idx < 0) return false;
    p.inventory.splice(idx, 1);
    delete p.ammo[id];
    p.weaponIndex = Math.min(p.weaponIndex, p.inventory.length - 1);
    p._buildViewModel();
    this._dropPickupInFront('weapon', { weaponId: id });
    this.hud.updateWeapon();
    this.audio.itemDrop();
    return true;
  }
  dropGrenade(type) {
    const p = this.player;
    if ((p.grenades[type] || 0) <= 0) return false;
    p.grenades[type]--;
    this.hud.updateGrenades();
    this._dropPickupInFront(type, {});
    this.audio.itemDrop();
    return true;
  }
  _dropPickupInFront(type, opts) {
    const p = this.player;
    const fwdX = -Math.sin(p.yaw), fwdZ = -Math.cos(p.yaw);
    this.pickups.push(new Pickup(this, type, p.pos.x + fwdX * 2.0, p.pos.z + fwdZ * 2.0, opts));
  }

  pause() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.input.exitLock();
    this.menus.pause();
  }
  resumeFromPause() {
    if (this.state !== STATE.PAUSED) return;
    this.state = STATE.PLAYING;
    this.menus.hide();
    this.input.requestLock();
  }
  restartCheckpoint() {
    this.menus.hide();
    if (this._checkpoint) {
      this.stats = { ...this._checkpoint.stats };
      this.squadState = this._checkpoint.squadState.map((s) => ({ ...s }));
      if (this.player) this.player.dispose();
      this.player = new Player(this);
      this.player.deserialize(this._checkpoint.player);
      this.floorIndex = this._checkpoint.floorIndex;
    }
    this._beginFloor(this.floorIndex, false);
  }
  quitToMenu() {
    this._clearFloor();
    this.state = STATE.MENU;
    this.hud.setVisible(false);
    this.input.exitLock();
    this.audio.stopAlarm();
    this.audio.stopAmbient();
    this.menus.mainMenu();
  }
  saveGame() {
    Save.save({
      player: this.player.serialize(),
      floorIndex: this.floorIndex,
      difficulty: this.difficulty,
      stats: this.stats,
      squadState: this.squadState,
    });
  }

  // -------------------------------------------------------------------------
  allColliders() {
    if (!this._colliderCache || this._colliderFloor !== this.floor) {
      this._colliderCache = [...this.floor.colliders, ...this.floor.lowColliders];
      this._colliderFloor = this.floor;
    }
    return this._colliderCache;
  }

  // -------------------------------------------------------------------------
  //  MAIN UPDATE
  // -------------------------------------------------------------------------
  update(dt) {
    dt = Math.min(dt, 0.05);
    if (this.state === STATE.PLAYING) {
      this.time += dt;

      // listener for spatial audio
      const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
      this.audio.setListener(this.player.pos, fwd);
      this.input.sensitivity = 1;

      const inputView = this._inputView();
      this.player.update(dt, inputView);
      this.squad.update(dt);
      for (const e of this.enemies) e.update(dt);

      // grenades
      for (let i = this.grenades.length - 1; i >= 0; i--) {
        if (!this.grenades[i].update(dt)) this.grenades.splice(i, 1);
      }
      // pickups
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        if (!this.pickups[i].update(dt)) this.pickups.splice(i, 1);
      }

      // alarm reinforcements
      if (this.alarmActive && !this.objective.alarmDisabled) {
        this._reinforceTimer -= dt;
        if (this._reinforceTimer <= 0) { this._reinforceTimer = 14; this.spawnAlarmReinforcements(); this._checkObjective(); }
      }

      this.effects.update(dt);
      this.hud.update(dt);

      // exit marker pulse
      if (this.floor.exit && this.objectiveComplete) {
        this.floor.exit.marker.material.opacity = 0.4 + Math.sin(this.time * 4) * 0.25;
      }

      this.input.consume();
    } else {
      // not in active play — silence the looping footsteps
      this.audio.stopFootsteps();
      this.input.clearMomentary();
    }
  }

  // wrap input with helper methods the player expects
  _inputView() {
    const i = this.input;
    return {
      dx: i.dx, dy: i.dy, wheel: i.wheel,
      isDown: (c) => i.isDown(c),
      pressed: (c) => i.pressed(c),
      mouse: (b) => i.mouse(b),
      mousePressed: (b) => i.mousePressed(b),
    };
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
