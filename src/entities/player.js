// ============================================================================
//  player.js — first-person controller: movement+collision, look, weapons
//  (fire modes, reload, ADS, recoil, spread, ammo, switching), grenades,
//  melee, takedowns, interaction, health/armor, stealth noise.
// ============================================================================

import * as THREE from 'three';
import { PLAYER, WEAPONS, GRENADES, HIT_MULT, NOISE } from '../data/config.js';
import { clamp, lerp, rand, damp, resolveCircleAABBs, deg2rad } from '../core/utils.js';
import { buildViewModel } from './models.js';

export class Player {
  constructor(game) {
    this.game = game;
    this.camera = game.camera;
    this.audio = game.audio;

    this.pos = new THREE.Vector3(0, 0, 0);    // feet
    this.vel = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.eyeHeight = PLAYER.standEyeHeight;
    this.crouching = false;
    this.sprinting = false;
    this.grounded = true;
    this.radius = PLAYER.radius;

    this.maxHealth = PLAYER.maxHealth;
    this.health = PLAYER.maxHealth;
    this.maxArmor = PLAYER.maxArmor;
    this.armor = 0;
    this.alive = true;
    this.lastDamageTime = -999;
    this.money = 0;

    // upgrades
    this.upgrades = { armorCap: 0, damage: 0, reload: 0, grenade: 0 };

    // weapons
    this.inventory = ['m16', 'pistol'];
    this.ammo = {};
    this.weaponIndex = 0;
    this._initAmmo();

    // grenades
    this.grenades = { frag: GRENADES.frag.startCount, flash: GRENADES.flash.startCount };
    this.selectedGrenade = 'frag';

    // firing state
    this.fireCooldown = 0;
    this.burstRemaining = 0;
    this.burstCooldownTimer = 0;
    this.triggerHeld = false;
    this.semiLatch = false;
    this.reloading = false;
    this.reloadTimer = 0;
    this.equipTimer = 0;
    this.ads = false;
    this.adsAmount = 0;
    this.spreadBloom = 0;

    // recoil & camera fx
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.bobTime = 0;
    this.bobAmount = 0;
    this.trauma = 0;          // screen shake
    this.flashBlind = 0;      // flashbang 0..1

    // melee
    this.meleeCooldown = 0;
    this.meleeAnim = 0;

    // noise / footsteps
    this.footTimer = 0;
    this.stepDist = 0;

    // viewmodel
    this.vmGroup = new THREE.Group();
    this.camera.add(this.vmGroup);
    this.viewModel = null;
    this.muzzle = null;
    this.vmRecoil = 0;
    this.vmKick = new THREE.Vector3();
    this._buildViewModel();

    // interaction
    this.lookTarget = null;     // current interactable in view
    this._tmpV = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();
  }

  _initAmmo() {
    for (const id of this.inventory) {
      const w = WEAPONS[id];
      this.ammo[id] = { mag: w.magazine, reserve: w.reserve };
    }
  }

  get weaponId() { return this.inventory[this.weaponIndex]; }
  get weapon() { return WEAPONS[this.weaponId]; }

  spawn(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw || 0;
    this.pitch = 0;
    this.crouching = false;
    this._updateCamera();
  }

  _buildViewModel() {
    if (this.viewModel) this.vmGroup.remove(this.viewModel.group);
    const vm = buildViewModel(this.weapon);
    this.viewModel = vm;
    this.muzzle = vm.muzzle;
    // start at the hip pose so the weapon never flashes through screen-centre
    // for a frame before _updateViewModel lerps it into place
    vm.group.position.set(0.2, -0.17, -0.5);
    this.vmGroup.add(vm.group);
    // cache unique materials so we can fade the weapon out during ADS
    this._vmMats = [];
    vm.group.traverse((o) => { if (o.isMesh && o.material && !this._vmMats.includes(o.material)) this._vmMats.push(o.material); });
  }

  // -------------------------------------------------------------------------
  reset(full = true) {
    this.health = this.maxHealth;
    this.armor = full ? this.armor : this.armor;
    this.alive = true;
    this.reloading = false;
    this.flashBlind = 0;
    this.trauma = 0;
    this.recoilPitch = this.recoilYaw = 0;
  }

  giveWeapon(id) {
    if (!WEAPONS[id]) return false;
    if (!this.inventory.includes(id)) {
      this.inventory.push(id);
      this.ammo[id] = { mag: WEAPONS[id].magazine, reserve: WEAPONS[id].reserve };
      this.switchTo(this.inventory.length - 1);
      return true;
    } else {
      // refill some ammo
      this.ammo[id].reserve = Math.min(WEAPONS[id].reserve * 2, this.ammo[id].reserve + WEAPONS[id].magazine);
      return false;
    }
  }

  switchTo(index) {
    if (index < 0 || index >= this.inventory.length || index === this.weaponIndex) return;
    this.weaponIndex = index;
    this.reloading = false;
    this.equipTimer = this.weapon.equipTime;
    this.burstRemaining = 0;
    this._buildViewModel();
    this.audio.weaponSwitch();
    this.game.hud.updateWeapon();
  }

  cycleWeapon(dir) {
    let i = (this.weaponIndex + dir + this.inventory.length) % this.inventory.length;
    this.switchTo(i);
  }

  // -------------------------------------------------------------------------
  //  UPDATE
  // -------------------------------------------------------------------------
  update(dt, input) {
    if (!this.alive) { this._updateCamera(); return; }

    // --- look ---
    const sens = PLAYER.mouseSensitivity * (this.game.settings.sensitivity || 1) * (this.ads ? 0.55 : 1);
    this.yaw -= input.dx * sens;
    const invert = this.game.settings.invertY ? -1 : 1;
    this.pitch -= input.dy * sens * invert;
    this.pitch = clamp(this.pitch, -PLAYER.pitchClamp, PLAYER.pitchClamp);

    // --- movement intent ---
    let ix = 0, iz = 0;
    if (input.isDown('KeyW')) iz += 1;
    if (input.isDown('KeyS')) iz -= 1;
    if (input.isDown('KeyA')) ix -= 1;
    if (input.isDown('KeyD')) ix += 1;
    const moving = ix !== 0 || iz !== 0;

    // crouch: hold mode (default) or toggle mode (settings.crouchToggle)
    if (this.game.settings.crouchToggle) {
      if (input.pressed('ControlLeft') || input.pressed('KeyC')) this.crouching = !this.crouching;
    } else {
      this.crouching = input.isDown('ControlLeft') || input.isDown('KeyC');
    }
    this.sprinting = input.isDown('ShiftLeft') && iz > 0 && !this.crouching && !this.ads;

    let speed = PLAYER.walkSpeed;
    if (this.crouching) speed = PLAYER.crouchSpeed;
    else if (this.sprinting) speed = PLAYER.sprintSpeed;
    if (this.ads) speed *= this.weapon.adsMoveMult;

    // desired velocity in world space
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward = (-sin, -cos)? We use yaw about Y with -Z forward.
    const fwdX = -sin, fwdZ = -cos;
    const rightX = cos, rightZ = -sin;
    let dvx = (fwdX * iz + rightX * ix);
    let dvz = (fwdZ * iz + rightZ * ix);
    const len = Math.hypot(dvx, dvz);
    if (len > 0) { dvx = dvx / len * speed; dvz = dvz / len * speed; }

    const accel = moving ? PLAYER.groundAccel : PLAYER.groundDecel;
    this.vel.x = lerp(this.vel.x, dvx, damp(accel, dt));
    this.vel.z = lerp(this.vel.z, dvz, damp(accel, dt));

    // gravity / jump
    this.vel.y += PLAYER.gravity * dt;
    if (this.grounded && input.pressed('Space') && !this.crouching) {
      this.vel.y = Math.sqrt(-2 * PLAYER.gravity * PLAYER.jumpHeight);
      this.grounded = false;
    }

    // integrate
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // ground
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.grounded = true; }
    else this.grounded = false;

    // collisions vs walls + cover
    const boxes = this.game.allColliders();
    const r = resolveCircleAABBs(this.pos.x, this.pos.z, this.radius, boxes);
    this.pos.x = r.x; this.pos.z = r.z;
    // clamp to floor bounds
    const b = this.game.floor.bounds;
    this.pos.x = clamp(this.pos.x, b.minX + this.radius, b.maxX - this.radius);
    this.pos.z = clamp(this.pos.z, b.minZ + this.radius, b.maxZ - this.radius);

    // crouch eye height
    const targetEye = this.crouching ? PLAYER.crouchEyeHeight : PLAYER.standEyeHeight;
    this.eyeHeight = lerp(this.eyeHeight, targetEye, damp(10, dt));

    // --- ADS ---
    const wantADS = input.mouse(2) && !this.reloading && !this.sprinting;
    this.ads = wantADS;
    this.adsAmount = lerp(this.adsAmount, this.ads ? 1 : 0, damp(12, dt));

    // --- weapon timers ---
    if (this.equipTimer > 0) this.equipTimer -= dt;
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.burstCooldownTimer > 0) this.burstCooldownTimer -= dt;
    if (this.meleeCooldown > 0) this.meleeCooldown -= dt;

    // reload
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this._finishReload();
    }
    if (input.pressed('KeyR')) this.startReload();

    // weapon switching
    if (input.pressed('Digit1')) this.switchTo(0);
    if (input.pressed('Digit2')) this.switchTo(1);
    if (input.pressed('Digit3')) this.switchTo(2);
    if (input.pressed('Digit4')) this.switchTo(3);
    if (input.wheel !== 0) this.cycleWeapon(input.wheel > 0 ? 1 : -1);

    // grenade select + throw
    if (input.pressed('KeyG')) this.throwGrenade('frag');
    if (input.pressed('KeyF')) this.throwGrenade('flash');

    // melee
    if (input.pressed('KeyV')) this.melee();

    // squad command: toggle hold-fire / weapons-free
    if (input.pressed('KeyH')) this.game.toggleSquadHoldFire();

    // firing
    this._handleFire(dt, input, moving);

    // bloom + recoil recovery
    const bloomDecay = this.ads ? 6 : 4;
    this.spreadBloom = Math.max(0, this.spreadBloom - bloomDecay * dt);
    this.recoilPitch = lerp(this.recoilPitch, 0, damp(8, dt));
    this.recoilYaw = lerp(this.recoilYaw, 0, damp(8, dt));
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    this.meleeAnim = Math.max(0, this.meleeAnim - dt * 4);
    this.vmRecoil = lerp(this.vmRecoil, 0, damp(10, dt));

    // flashbang recovery
    if (this.flashBlind > 0) this.flashBlind = Math.max(0, this.flashBlind - dt / 3.2);

    // --- footsteps (real looping walk/run) + per-step noise emission ---
    const horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    let footState = null;
    if (this.grounded && horizSpeed > 0.6) {
      footState = this.sprinting ? 'run' : (this.crouching ? 'crouch' : 'walk');
      this.stepDist += horizSpeed * dt;
      const stepLen = this.sprinting ? 1.7 : (this.crouching ? 2.4 : 2.0);
      if (this.stepDist > stepLen) {
        this.stepDist = 0;
        let nr = NOISE.walk;
        if (this.crouching) nr = NOISE.crouchWalk;
        else if (this.sprinting) nr = NOISE.sprint;
        this.game.emitNoise(this.pos.x, this.pos.z, nr, 'player');
        this.bobAmount = 1;
      }
    }
    this.audio.footMove(footState);
    this.bobTime += horizSpeed * dt * 2;
    this.bobAmount = lerp(this.bobAmount, horizSpeed > 0.5 ? 1 : 0, damp(6, dt));

    // health regen
    this._regen(dt);

    // interaction
    this._updateInteraction(input);

    // low health audio cue
    if (this.health > 0 && this.health < 30) {
      this._lowHpTimer = (this._lowHpTimer || 0) - dt;
      if (this._lowHpTimer <= 0) { this._lowHpTimer = 1.0; this.audio.lowHealthBeat(); }
    }

    this._updateCamera();
    this._updateViewModel(dt, horizSpeed);
  }

  // -------------------------------------------------------------------------
  _handleFire(dt, input, moving) {
    const w = this.weapon;
    const ammo = this.ammo[this.weaponId];
    const canAct = !this.reloading && this.equipTimer <= 0;
    const wantFire = input.mouse(0);

    // burst continuation
    if (this.burstRemaining > 0 && this.burstCooldownTimer <= 0 && this.fireCooldown <= 0 && canAct) {
      if (ammo.mag > 0) { this._fireOne(); this.burstRemaining--; this.fireCooldown = 60 / w.rpm; }
      else { this.burstRemaining = 0; }
      return;
    }

    if (!wantFire) { this.semiLatch = false; return; }
    if (!canAct) return;
    if (this.fireCooldown > 0 || this.burstCooldownTimer > 0) return;

    if (ammo.mag <= 0) {
      if (!this.semiLatch) { this.audio.emptyClick(); this.semiLatch = true; this.startReload(); }
      return;
    }

    if (w.fireMode === 'semi') {
      if (this.semiLatch) return;
      this.semiLatch = true;
      this._fireOne();
      this.fireCooldown = 60 / w.rpm;
    } else if (w.fireMode === 'burst') {
      this.semiLatch = true;
      const n = Math.min(w.burstCount, ammo.mag);
      this.burstRemaining = n - 1;
      this._fireOne();
      this.fireCooldown = 60 / w.rpm;
      this.burstCooldownTimer = (n - 1) * (60 / w.rpm) + w.burstCooldown;
    } else { // auto
      this._fireOne();
      this.fireCooldown = 60 / w.rpm;
    }
  }

  _fireOne() {
    const w = this.weapon;
    const ammo = this.ammo[this.weaponId];
    ammo.mag--;

    // origin & direction from camera
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const baseDir = new THREE.Vector3();
    this.camera.getWorldDirection(baseDir);

    // spread
    let spread = this.ads ? w.adsSpread : w.hipSpread;
    spread += this.spreadBloom;
    if (Math.hypot(this.vel.x, this.vel.z) > 1) spread += this.ads ? 0.3 : 0.8;
    if (!this.grounded) spread += 2;

    // muzzle world position (tracer origin)
    const mp = new THREE.Vector3();
    this.muzzle.getWorldPosition(mp);

    const dmgMult = 1 + this.upgrades.damage * 0.1;
    const pellets = w.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      const dir = this._applySpread(baseDir, spread);
      this.game.resolveShot(origin, dir, w, {
        shooter: 'player', damageMult: dmgMult, range: w.range, muzzlePos: mp,
      });
    }

    // muzzle flash at viewmodel muzzle
    this.game.effects.muzzleFlash(mp, baseDir, 0xffcc66, w.cls === 'Shotgun' ? 1.5 : 1);

    // audio + noise
    this.audio.gunshot(w.sound, this.pos.x, this.pos.z, { volMult: 1 });
    this.game.emitNoise(this.pos.x, this.pos.z, w.noiseRadius * NOISE.gunshotMult, 'gunshot');

    // recoil
    const adsMult = this.ads ? w.adsRecoilMult : 1;
    this.recoilPitch += deg2rad(w.recoilV) * adsMult;
    this.recoilYaw += deg2rad(rand(-w.recoilH, w.recoilH)) * adsMult;
    this.spreadBloom = Math.min(this.spreadBloom + spread * 0.4 + 0.3, 6);
    this.trauma = Math.min(1, this.trauma + (w.cls === 'Shotgun' ? 0.45 : 0.18));
    this.vmRecoil = Math.min(this.vmRecoil + 1, 2);

    this.game.hud.updateAmmo();
  }

  _applySpread(baseDir, spreadDeg) {
    if (spreadDeg <= 0.0001) return baseDir.clone();
    const rad = deg2rad(spreadDeg);
    // random small rotation in cone
    const a = rand(0, Math.PI * 2);
    const m = Math.sqrt(rand(0, 1)) * rad;
    // build orthonormal basis
    const dir = baseDir.clone();
    const up = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, dir).normalize();
    dir.addScaledVector(right, Math.cos(a) * Math.tan(m));
    dir.addScaledVector(realUp, Math.sin(a) * Math.tan(m));
    return dir.normalize();
  }

  startReload() {
    const w = this.weapon;
    const ammo = this.ammo[this.weaponId];
    if (this.reloading || ammo.mag >= w.magazine || ammo.reserve <= 0) return;
    this.reloading = true;
    const speed = 1 - this.upgrades.reload * 0.15;
    this.reloadTimer = w.reloadTime * speed;
    this.burstRemaining = 0;
    this.audio.reloadSequence(this.reloadTimer, w.cls);
    this.game.hud.setReload(true);
  }

  _finishReload() {
    const w = this.weapon;
    const ammo = this.ammo[this.weaponId];
    const need = w.magazine - ammo.mag;
    const take = Math.min(need, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
    this.reloading = false;
    this.game.hud.setReload(false);
    this.game.hud.updateAmmo();
  }

  // -------------------------------------------------------------------------
  melee() {
    if (this.meleeCooldown > 0) return;
    this.meleeCooldown = PLAYER.meleeCooldown;
    this.meleeAnim = 1;
    this.audio.melee();
    // hit check
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    const hit = this.game.meleeHit(this.pos, dir, PLAYER.meleeRange);
    if (hit) {
      hit.takeDamage(PLAYER.meleeDamage, 'chest', dir, 'player');
      this.game.hud.hitMarker(false);
    }
    this.game.emitNoise(this.pos.x, this.pos.z, NOISE.melee, 'melee');
  }

  throwGrenade(type) {
    if (this.grenades[type] <= 0) { this.audio.uiBack(); return; }
    this.grenades[type]--;
    const origin = new THREE.Vector3(); this.camera.getWorldPosition(origin);
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    this.game.spawnGrenade(type, origin, dir, 'player');
    this.game.hud.updateGrenades();
    this.audio.beep(300, 0.05, 0.12, 'triangle', this.audio.sfxBus);
  }

  // -------------------------------------------------------------------------
  _updateInteraction(input) {
    this.lookTarget = this.game.findInteractable(this);
    if (this.lookTarget) this.game.hud.showPrompt(this.lookTarget.label, this.lookTarget.key || 'E');
    else this.game.hud.hidePrompt();
    if (input.pressed('KeyE') && this.lookTarget) {
      this.lookTarget.action();
    }
  }

  // -------------------------------------------------------------------------
  takeDamage(amount, region = 'chest', dir = null, source = 'enemy') {
    if (!this.alive) return;
    this.lastDamageTime = this.game.time;
    let dmg = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.65);
      this.armor -= absorbed;
      dmg -= absorbed;
      if (this.armor <= 0) { this.armor = 0; this.game.hud.armorBreak(); }
    }
    this.health -= dmg;
    this.trauma = Math.min(1, this.trauma + 0.3);
    this.audio.damage();
    this.game.hud.damageFlash(dir, this.pos, this.yaw);
    this.game.hud.updateVitals();
    // pain grunt + squad reaction ("They're on you, boss!"), throttled
    if (this.health > 0 && this.game.time - (this._lastHurtVoice || 0) > 1.2) {
      this._lastHurtVoice = this.game.time;
      this.audio.playerHurt();
      if (Math.random() < 0.4) this.game.squad.reactToPlayerHurt();
    }
    if (this.health <= 0) { this.health = 0; this.die(); }
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
    this.game.hud.updateVitals();
  }
  addArmor(amount) {
    const cap = this.maxArmor + this.upgrades.armorCap * 25;
    this.armor = Math.min(cap, this.armor + amount);
    this.game.hud.updateVitals();
  }
  addMoney(amount) {
    this.money += amount;
    this.game.hud.updateMoney();
  }

  _regen(dt) {
    if (this.game.time - this.lastDamageTime < PLAYER.healthRegenDelay) return;
    if (this.health < this.maxHealth) {
      const rate = PLAYER.healthRegenPerSec * (this.game.diffMod.regen || 1);
      this.health = Math.min(this.maxHealth, this.health + rate * dt);
      this.game.hud.updateVitals();
    }
  }

  die() {
    this.alive = false;
    this.audio.beep(90, 0.6, 0.3, 'sine', this.audio.sfxBus);
    this.game.onPlayerDeath();
  }

  applyFlashBlind(intensity) {
    this.flashBlind = Math.max(this.flashBlind, intensity);
  }

  // -------------------------------------------------------------------------
  _updateCamera() {
    this.camera.position.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
    // view bob
    const bobX = Math.cos(this.bobTime) * 0.018 * this.bobAmount;
    const bobY = Math.abs(Math.sin(this.bobTime)) * 0.022 * this.bobAmount;
    // screen shake from trauma
    const sh = this.trauma * this.trauma;
    const shakeP = (Math.random() - 0.5) * 0.05 * sh;
    const shakeY = (Math.random() - 0.5) * 0.05 * sh;
    const euler = new THREE.Euler(
      this.pitch + this.recoilPitch + bobY * 0.4 + shakeP,
      this.yaw + this.recoilYaw + bobX * 0.5 + shakeY,
      Math.sin(this.bobTime) * 0.006 * this.bobAmount,
      'YXZ'
    );
    this.camera.quaternion.setFromEuler(euler);
    // FOV (ADS zoom)
    const baseFov = this.game.settings.fov || 75;
    const targetFov = lerp(baseFov, this.weapon.adsFov, this.adsAmount);
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }
  }

  _updateViewModel(dt, horizSpeed) {
    const g = this.viewModel.group;
    // base hip position
    const adsT = this.adsAmount;
    const hipPos = new THREE.Vector3(0.2, -0.17, -0.5);
    const adsPos = new THREE.Vector3(0.0, -0.105, -0.34);
    const target = hipPos.clone().lerp(adsPos, adsT);
    // sway from look
    const swayX = clamp(-this.recoilYaw * 2, -0.05, 0.05);
    // bob
    const bobX = Math.cos(this.bobTime) * 0.012 * this.bobAmount * (1 - adsT);
    const bobY = Math.abs(Math.sin(this.bobTime)) * 0.014 * this.bobAmount * (1 - adsT);
    target.x += bobX + swayX;
    target.y += bobY - this.vmRecoil * 0.02;
    target.z += this.vmRecoil * 0.05;
    g.position.lerp(target, damp(16, dt));
    // recoil rotation + melee
    g.rotation.x = lerp(g.rotation.x, -this.vmRecoil * 0.12 + (this.reloading ? 0.5 : 0), damp(14, dt));
    g.rotation.z = lerp(g.rotation.z, this.meleeAnim * 0.6, damp(18, dt));
    g.rotation.y = lerp(g.rotation.y, this.meleeAnim * -0.5, damp(18, dt));

    // fade the weapon out while aiming so it never blocks the centre of the
    // screen — the clean ADS reticle (HUD) provides the aim point instead
    const gunOpacity = clamp(1 - this.adsAmount * 1.2, 0, 1);
    if (this._vmMats) for (const m of this._vmMats) m.opacity = gunOpacity;
    g.visible = gunOpacity > 0.02;
  }

  // current crosshair spread in screen terms
  getCrosshairSpread() {
    let s = this.ads ? this.weapon.adsSpread : this.weapon.hipSpread;
    s += this.spreadBloom;
    if (Math.hypot(this.vel.x, this.vel.z) > 1) s += 0.6;
    return s;
  }

  serialize() {
    return {
      health: this.health, armor: this.armor, money: this.money,
      inventory: this.inventory, ammo: this.ammo, weaponIndex: this.weaponIndex,
      grenades: this.grenades, upgrades: this.upgrades,
    };
  }
  deserialize(d) {
    this.health = d.health; this.armor = d.armor; this.money = d.money;
    this.inventory = d.inventory; this.ammo = d.ammo; this.weaponIndex = d.weaponIndex || 0;
    this.grenades = d.grenades; this.upgrades = d.upgrades || this.upgrades;
    this._buildViewModel();
  }

  // Detach this player's view-model from the camera. MUST be called before the
  // owning Game replaces `this.player` with a new Player, otherwise the old
  // view-model stays parented to the camera at origin and obstructs the centre
  // of the screen (a black blob that follows the view).
  dispose() {
    if (this.viewModel && this.viewModel.group) {
      this.vmGroup.remove(this.viewModel.group);
      this.viewModel.group.traverse((o) => {
        if (o.isMesh) { o.geometry?.dispose?.(); if (o.material) o.material.dispose?.(); }
      });
    }
    if (this.vmGroup && this.vmGroup.parent) this.vmGroup.parent.remove(this.vmGroup);
    this.viewModel = null;
  }
}
