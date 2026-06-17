// ============================================================================
//  enemy.js — cartel enemy unit: FSM (Idle/Patrol/Suspicious/Investigate/
//  Combat/Dead), vision+hearing perception, cover-seeking combat with fair
//  aim error & reaction delay, steering navigation, stealth-takedown target.
//  Mirrors doc 10 (Enemy AI) and AIPerceptionConfig values.
// ============================================================================

import * as THREE from 'three';
import { WEAPONS } from '../data/config.js';
import { clamp, lerp, rand, randInt, pick, damp, deg2rad, dist2D, segmentBlocked, resolveCircleAABBs } from '../core/utils.js';
import { buildCharacter } from './models.js';

const STATE = { IDLE: 0, PATROL: 1, SUSPICIOUS: 2, INVESTIGATE: 3, COMBAT: 4, DEAD: 5 };

export class Enemy {
  constructor(game, arch, x, z) {
    this.game = game;
    this.arch = arch;
    this.weapon = WEAPONS[arch.weapon];
    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = rand(0, Math.PI * 2);
    this.radius = arch.big ? 0.5 : 0.36;
    // Guarantee a valid, reachable spawn. Bounds/collision are only corrected
    // while moving, so an idle enemy spawned out of bounds or inside a wall
    // would stay there — visible on the minimap but unreachable in 3D.
    if (this.game.floor) this._snapToValidSpawn();

    this.maxHealth = arch.health;
    this.health = arch.health;
    this.armor = arch.armor;
    this.alive = true;

    this.state = STATE.IDLE;
    this.detection = 0;          // 0..1 awareness of player
    this.lastSeen = new THREE.Vector3(x, 0, z);
    this.hasLastSeen = false;
    this.memoryTimer = 0;
    this.reactionTimer = 0;
    this.fireTimer = 0;
    this.burstLeft = 0;
    this.repositionTimer = rand(2, 5);
    this.moveTarget = null;
    this.strafeDir = rand(-1, 1) > 0 ? 1 : -1;
    this.stuckTimer = 0;
    this.alerted = false;
    this.hasGrenades = !!arch.grenades;
    this.grenadeCd = rand(7, 13);
    this.ammoInMag = this.weapon.magazine;
    this.reloadTimer = 0;
    this.flinch = 0;
    this.flashBlind = 0;
    this.isBoss = false;
    this._stepTimer = rand(0, 0.4);   // spatialised footstep cadence
    this._hurtCd = 0;                 // hurt-grunt cooldown
    this.combatTarget = null;         // player or a squadmate
    this._retargetTimer = 0;

    // perception tuning
    this.viewDistance = arch.viewDistance;
    this.viewAngle = deg2rad(arch.viewAngle);
    this.reaction = arch.reaction;
    this.aimError = arch.aimError;

    // preferred engagement distance
    this.preferredRange = arch.sniper ? 26 : (arch.big ? 6 : 11);

    // model
    const m = buildCharacter({
      color: arch.color, headColor: arch.headColor,
      scale: arch.big ? 1.25 : 1, weaponColor: this.weapon.color,
    });
    this.model = m.root;
    this.parts = m.parts;
    this.model.position.copy(this.pos);
    game.scene.add(this.model);

    // tag hit regions for raycasting
    this._tagRegions();

    // detection indicator
    this.indicator = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.13),
      new THREE.MeshBasicMaterial({ color: 0xffdd33, transparent: true, opacity: 0 })
    );
    this.indicator.position.y = (arch.big ? 2.3 : 1.95);
    this.model.add(this.indicator);

    // health bar billboard
    this._makeHealthBar();

    this.muzzleLocal = new THREE.Vector3(0.25, 1.35, 0.4);
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._tmp3 = new THREE.Vector3();
    this.animPhase = rand(0, 10);
  }

  // Clamp inside the floor bounds (clear of the far wall / exit recess) and
  // push out of any wall or cover the spawn landed inside.
  _snapToValidSpawn() {
    const b = this.game.floor.bounds;
    const m = this.radius + 0.6;
    let x = clamp(this.pos.x, b.minX + m, b.maxX - m);
    let z = clamp(this.pos.z, b.minZ + m, b.maxZ - m - 2);
    for (let i = 0; i < 2; i++) {
      const r = resolveCircleAABBs(x, z, this.radius + 0.05, this.game.allColliders());
      x = r.x; z = r.z;
    }
    x = clamp(x, b.minX + m, b.maxX - m);
    z = clamp(z, b.minZ + m, b.maxZ - m - 2);
    this.pos.set(x, 0, z);
  }

  _tagRegions() {
    const set = (mesh, region) => { if (mesh) { mesh.userData.enemy = this; mesh.userData.region = region; this._regionMeshes.push(mesh); } };
    this._regionMeshes = [];
    set(this.parts.headGrp.children[0], 'head');
    set(this.parts.chest, 'chest');
    // torso group as chest too
    this.parts.torso.traverse((o) => { if (o.isMesh && !o.userData.region) { o.userData.enemy = this; o.userData.region = 'chest'; this._regionMeshes.push(o); } });
    [this.parts.legL, this.parts.legR].forEach((l) => set(l, 'limb'));
  }

  _makeHealthBar() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 8;
    this._hbCanvas = c; this._hbCtx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    this._hbTex = tex;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    this.healthBar = new THREE.Sprite(mat);
    this.healthBar.scale.set(0.9, 0.12, 1);
    this.healthBar.position.y = (this.arch.big ? 2.55 : 2.2);
    this.healthBar.visible = false;
    this.model.add(this.healthBar);
    this._drawHealthBar();
  }
  _drawHealthBar() {
    const ctx = this._hbCtx;
    ctx.clearRect(0, 0, 64, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, 64, 8);
    const frac = clamp(this.health / this.maxHealth, 0, 1);
    ctx.fillStyle = frac > 0.5 ? '#3ad15a' : frac > 0.25 ? '#e0c020' : '#e03020';
    ctx.fillRect(1, 1, 62 * frac, 6);
    this._hbTex.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  get isTakedownable() {
    return this.alive && (this.state === STATE.IDLE || this.state === STATE.PATROL || this.state === STATE.SUSPICIOUS) && !this.alerted;
  }

  // -------------------------------------------------------------------------
  //  PERCEPTION
  // -------------------------------------------------------------------------
  _canSeePlayer() {
    const p = this.game.player;
    if (!p.alive) return false;
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > this.viewDistance) return false;
    // angle check (skip if very close = peripheral)
    if (dist > 2.5) {
      const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
      const dot = (dx * fwdX + dz * fwdZ) / (dist || 1);
      const ang = Math.acos(clamp(dot, -1, 1));
      if (ang > this.viewAngle / 2) return false;
    }
    // line of sight vs walls
    if (segmentBlocked(this.pos.x, this.pos.z, p.pos.x, p.pos.z, this.game.floor.colliders)) return false;
    return true;
  }

  hearNoise(x, z, radius, source) {
    if (!this.alive || this.state === STATE.COMBAT) return;
    const d = dist2D(this.pos.x, this.pos.z, x, z);
    if (d > radius) return;
    // closer + louder = more suspicion
    const strength = (1 - d / radius);
    if (source === 'gunshot' || source === 'explosion') {
      this.detection = Math.min(1, this.detection + strength * 0.8);
      this._setLastSeen(x, z);
      if (this.detection > 0.4 && this.state < STATE.INVESTIGATE) this._enterInvestigate();
    } else {
      this.detection = Math.min(0.6, this.detection + strength * 0.25);
      this._setLastSeen(x, z);
      if (this.detection > 0.15 && this.state < STATE.SUSPICIOUS) this._enterSuspicious();
    }
  }

  _setLastSeen(x, z) {
    this.lastSeen.set(x, 0, z);
    this.hasLastSeen = true;
    this.memoryTimer = 4;
  }

  // -------------------------------------------------------------------------
  //  FSM TRANSITIONS
  // -------------------------------------------------------------------------
  _enterSuspicious() { if (this.state < STATE.SUSPICIOUS) { this.state = STATE.SUSPICIOUS; } }
  _enterInvestigate() {
    this.state = STATE.INVESTIGATE;
    this.moveTarget = this.hasLastSeen ? { x: this.lastSeen.x, z: this.lastSeen.z } : this._pickNavPoint();
    if (rand(0, 1) < 0.5) this._bark('search');
  }
  _enterCombat() {
    if (this.state === STATE.COMBAT) return;
    this.state = STATE.COMBAT;
    this.reactionTimer = this.reaction * (this.game.diffMod.enemyReaction || 1);
    this.alerted = true;
    this.game.onEnemyAlerted(this);
    this.game.audio.enemyAttack(this.pos.x, this.pos.z);
    this._bark('contact');
  }

  alertTo(x, z) {
    // squad communication: get told where the player is
    if (!this.alive || this.state === STATE.COMBAT) return;
    this._setLastSeen(x, z);
    this.detection = Math.max(this.detection, 0.55);
    if (this.state < STATE.INVESTIGATE) this._enterInvestigate();
  }

  // -------------------------------------------------------------------------
  //  UPDATE (called staggered by game scheduler, dt is real elapsed)
  // -------------------------------------------------------------------------
  update(dt) {
    if (!this.alive) { this._updateAnim(dt, 0); return; }

    if (this.flinch > 0) this.flinch -= dt;
    if (this.flashBlind > 0) this.flashBlind -= dt;
    if (this._hurtCd > 0) this._hurtCd -= dt;
    if (this.reloadTimer > 0) { this.reloadTimer -= dt; if (this.reloadTimer <= 0) this.ammoInMag = this.weapon.magazine; }
    if (this.memoryTimer > 0) this.memoryTimer -= dt;

    const canSee = (this.flashBlind <= 0) && this._canSeePlayer();
    const p = this.game.player;

    // detection accumulation
    if (canSee) {
      const dist = dist2D(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
      const distFactor = lerp(1.0, 0.25, clamp(dist / this.viewDistance, 0, 1));
      let light = 1.0;
      if (!this.game.floor.lightsOn) light = 0.5;
      if (p.crouching) light *= 0.7;
      const moveBonus = Math.hypot(p.vel.x, p.vel.z) > 3 ? 1.6 : 1.0;
      this.detection = Math.min(1, this.detection + 1.3 * distFactor * light * moveBonus * dt);
      if (dist < 2.5) this.detection = 1;
      this._setLastSeen(p.pos.x, p.pos.z);
    } else if (this.state !== STATE.COMBAT) {
      this.detection = Math.max(0, this.detection - 0.35 * dt);
    }

    // state escalation
    if (this.state !== STATE.COMBAT) {
      if (this.detection >= 0.75) this._enterCombat();
      else if (this.detection >= 0.4 && this.state < STATE.INVESTIGATE) this._enterInvestigate();
      else if (this.detection >= 0.15 && this.state < STATE.SUSPICIOUS) this._enterSuspicious();
    }

    switch (this.state) {
      case STATE.IDLE: this._updateIdle(dt); break;
      case STATE.PATROL: this._updatePatrol(dt); break;
      case STATE.SUSPICIOUS: this._updateSuspicious(dt, canSee); break;
      case STATE.INVESTIGATE: this._updateInvestigate(dt, canSee); break;
      case STATE.COMBAT: this._updateCombat(dt, canSee); break;
    }

    // indicator
    this._updateIndicator();
    this.healthBar.visible = this.health < this.maxHealth && this.alive;

    // apply position to model
    this.model.position.set(this.pos.x, 0, this.pos.z);
    const speed = this._lastMoveSpeed || 0;
    this._updateAnim(dt, speed);

    // spatialised footsteps while moving
    if (speed > 0.6) {
      this._stepTimer -= dt;
      if (this._stepTimer <= 0) {
        this._stepTimer = this.arch.big ? 0.5 : 0.38;
        this.game.audio.footstep(this.arch.big ? 0.7 : 0.45, this.pos.x, this.pos.z);
      }
    }
  }

  // random spoken combat bark (Web Speech API); globally throttled in the engine
  _bark(kind) {
    if (this.isBoss) return;            // the boss has its own scripted dialogue
    const pools = {
      contact: ['Contact!', 'There he is!', 'Open fire!', 'I see him!', 'Target spotted!'],
      reload: ['Reloading!', 'Cover me!', 'Mag out!'],
      grenade: ['Frag out!', 'Grenade!', 'Fire in the hole!'],
      search: ['Where did he go?', 'Check the area!', 'Find him!'],
    };
    const p = pools[kind]; if (!p) return;
    this.game.audio.speak(p[Math.floor(Math.random() * p.length)], this.pos.x, this.pos.z);
  }

  _updateIdle(dt) {
    this._lastMoveSpeed = 0;
    // occasional turn
    this.repositionTimer -= dt;
    if (this.repositionTimer <= 0) {
      this.repositionTimer = rand(3, 7);
      if (rand(0, 1) < 0.5) { this.state = STATE.PATROL; this.moveTarget = this._pickNavPoint(); }
      else this.yaw += rand(-1.5, 1.5);
    }
  }

  _updatePatrol(dt) {
    if (!this.moveTarget) { this.moveTarget = this._pickNavPoint(); }
    const reached = this._moveToward(dt, this.moveTarget, this.arch.moveSpeed * 0.6);
    if (reached) { this.state = STATE.IDLE; this.repositionTimer = rand(2, 5); this.moveTarget = null; }
  }

  _updateSuspicious(dt, canSee) {
    this._lastMoveSpeed = 0;
    // face last seen / noise
    if (this.hasLastSeen) this._faceToward(this.lastSeen.x, this.lastSeen.z, dt, 4);
    // escalate to investigate after brief pause
    this._susTimer = (this._susTimer || rand(0.8, 1.6)) - dt;
    if (this._susTimer <= 0) { this._susTimer = null; this._enterInvestigate(); }
    if (this.detection < 0.15) { this.state = STATE.IDLE; }
  }

  _updateInvestigate(dt, canSee) {
    if (!this.moveTarget) this.moveTarget = this.hasLastSeen ? { x: this.lastSeen.x, z: this.lastSeen.z } : this._pickNavPoint();
    const reached = this._moveToward(dt, this.moveTarget, this.arch.moveSpeed * 0.8);
    if (reached) {
      // look around then give up
      this._faceToward(this.pos.x + rand(-1, 1), this.pos.z + rand(-1, 1), dt, 3);
      this._investTimer = (this._investTimer || rand(2, 4)) - dt;
      if (this._investTimer <= 0) {
        this._investTimer = null;
        this.moveTarget = null;
        if (this.detection < 0.4) { this.state = STATE.IDLE; this.detection *= 0.5; this.hasLastSeen = false; }
        else { this.moveTarget = this._pickNavPoint(); }
      }
    }
  }

  _updateCombat(dt, canSeePlayer) {
    // choose / refresh who to engage — the player OR a visible squadmate
    this._retargetTimer -= dt;
    if (this._retargetTimer <= 0 || !this.combatTarget || !this.combatTarget.alive) {
      this.combatTarget = this._pickCombatTarget();
      this._retargetTimer = rand(2.5, 5);
    }
    const target = this.combatTarget || this.game.player;
    const canSee = target && target.alive && this._losTo(target.pos) && this._inRange(target.pos);
    const dist = target ? dist2D(this.pos.x, this.pos.z, target.pos.x, target.pos.z) : 99;

    if (canSee) { this._setLastSeen(target.pos.x, target.pos.z); this.memoryTimer = 4; }

    // lost everyone → investigate the last known position
    if (!canSee && this.memoryTimer <= 0) {
      this.state = STATE.INVESTIGATE;
      this.moveTarget = this.hasLastSeen ? { x: this.lastSeen.x, z: this.lastSeen.z } : this._pickNavPoint();
      this.detection = 0.5;
      return;
    }

    // face the target (or last seen)
    const tx = canSee ? target.pos.x : this.lastSeen.x;
    const tz = canSee ? target.pos.z : this.lastSeen.z;
    this._faceToward(tx, tz, dt, 7);

    // reaction delay before first shot
    if (this.reactionTimer > 0) { this.reactionTimer -= dt; this._lastMoveSpeed = 0; return; }

    // movement: maintain preferred range, strafe, use cover
    this.repositionTimer -= dt;
    let desired = null;
    if (dist > this.preferredRange * 1.3 || (!canSee && this.memoryTimer > 0)) {
      desired = { x: tx, z: tz };
    } else if (dist < this.preferredRange * 0.6 && !this.arch.big) {
      const ux = (this.pos.x - tx) / (dist || 1), uz = (this.pos.z - tz) / (dist || 1);
      desired = { x: this.pos.x + ux * 4, z: this.pos.z + uz * 4 };
    } else if (this.repositionTimer <= 0) {
      this.repositionTimer = rand(1.5, 3.5);
      this.strafeDir *= -1;
      const cover = this._findCoverNear(tx, tz);
      desired = cover || this._strafeTarget(tx, tz, dist);
    }
    if (desired) {
      const reached = this._moveToward(dt, desired, this.arch.moveSpeed * (this.arch.big ? 0.8 : 1.0));
      if (reached) this.moveTarget = null;
    } else { this._lastMoveSpeed = 0; this.moveTarget = null; }

    // firing at the chosen target (player or squadmate)
    if (canSee && this.reloadTimer <= 0) this._tryFire(dt, target, dist);

    // grenade usage (elites/boss): when the target is behind cover but known
    if (this.hasGrenades) {
      this.grenadeCd -= dt;
      if (this.grenadeCd <= 0 && !canSee && this.hasLastSeen && this.memoryTimer > 0 &&
          dist2D(this.pos.x, this.pos.z, this.lastSeen.x, this.lastSeen.z) < 20) {
        this._throwGrenade();
        this.grenadeCd = rand(11, 18);
      }
    }
  }

  _throwGrenade() {
    const mp = this._muzzleWorld().clone(); mp.y = 1.4;
    const dir = new THREE.Vector3(this.lastSeen.x - mp.x, 2.5, this.lastSeen.z - mp.z).normalize();
    this.game.spawnGrenade('frag', mp, dir, 'enemy');
    this.game.hud.subtitle(this.arch.name, 'Frag out!');
    this._bark('grenade');
  }

  _losTo(pos) { return !segmentBlocked(this.pos.x, this.pos.z, pos.x, pos.z, this.game.floor.colliders); }
  _inRange(pos) { return dist2D(this.pos.x, this.pos.z, pos.x, pos.z) <= this.viewDistance * 1.25; }

  // pick the player or a visible squadmate to engage (weighted toward closest)
  _pickCombatTarget() {
    const cands = [];
    const p = this.game.player;
    if (p.alive && this._losTo(p.pos) && this._inRange(p.pos)) cands.push(p);
    for (const c of this.game.squad.members) {
      if (c.alive && this._losTo(c.pos) && this._inRange(c.pos)) cands.push(c);
    }
    if (cands.length === 0) return (this.combatTarget && this.combatTarget.alive) ? this.combatTarget : p;
    cands.sort((a, b) => dist2D(this.pos.x, this.pos.z, a.pos.x, a.pos.z) - dist2D(this.pos.x, this.pos.z, b.pos.x, b.pos.z));
    if (cands.length === 1 || Math.random() < 0.55) return cands[0];
    return cands[randInt(1, cands.length - 1)];
  }

  _tryFire(dt, target, dist) {
    if (this.ammoInMag <= 0) { this.reloadTimer = this.weapon.reloadTime; this._bark('reload'); return; }
    if (this.burstLeft > 0) {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) { this._shoot(target, dist); this.fireTimer = 60 / this.weapon.rpm; }
      return;
    }
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      const [a, b] = this.arch.fireBurst;
      this.burstLeft = randInt(a, b);
      this._shoot(target, dist);
      this.fireTimer = 60 / this.weapon.rpm;
    }
  }

  _shoot(target, dist) {
    this.burstLeft--;
    this.ammoInMag--;
    if (this.burstLeft <= 0) this.fireTimer = rand(0.6, 1.6); // inter-burst pause

    const isPlayer = (target === this.game.player);
    const mp = this._muzzleWorld();
    const aimY = isPlayer ? (target.pos.y + target.eyeHeight * 0.6) : 1.3;
    const targetPos = this._tmp2.set(target.pos.x, aimY, target.pos.z);

    // aim error: grows with distance + target movement; difficulty scales
    let err = this.aimError * (this.game.diffMod.enemyAim || 1);
    err *= 1 + dist / 30;
    const tgtSpeed = isPlayer ? Math.hypot(target.vel.x, target.vel.z) : (target._lastMoveSpeed || 0);
    if (tgtSpeed > 3) err *= 1.5;
    if (this.flinch > 0) err *= 1.8;
    const errRad = deg2rad(err);

    const dir = targetPos.clone().sub(mp).normalize();
    const ax = rand(-errRad, errRad), ay = rand(-errRad, errRad);
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    dir.addScaledVector(right, Math.tan(ax)).addScaledVector(up, Math.tan(ay)).normalize();

    const endPoint = mp.clone().addScaledVector(dir, dist + 2);          // tracer end
    // occlusion is judged against the target itself, not the 2m overshoot —
    // otherwise a wall just behind the target would wrongly discard the shot
    const blocked = segmentBlocked(mp.x, mp.z, targetPos.x, targetPos.z, this.game.floor.colliders);

    // effects + audio
    this.game.effects.muzzleFlash(mp, dir, 0xffbb55, this.arch.big ? 1.4 : 1);
    this.game.effects.tracer(mp, endPoint, 0xffaa55);
    this.game.audio.gunshot(this.weapon.sound, this.pos.x, this.pos.z, { volMult: 0.85 });
    this.game.emitNoise(this.pos.x, this.pos.z, this.weapon.noiseRadius, 'gunshot');

    if (blocked) return;

    // hit determination — angular miss distance at the target
    const toT = targetPos.clone().sub(mp);
    const projLen = toT.dot(dir);
    const closest = mp.clone().addScaledVector(dir, projLen);
    const miss = closest.distanceTo(targetPos);
    const w = this.weapon;
    if (miss < 0.55) {
      let dmg = w.damage * (w.pellets > 1 ? Math.max(1, Math.round(w.pellets * 0.4)) : 1);
      if (dist > w.falloffStart) {
        const t = clamp((dist - w.falloffStart) / (w.falloffEnd - w.falloffStart), 0, 1);
        dmg *= lerp(1, w.minDamageMult, t);
      }
      dmg = Math.round(dmg * (this.game.diffMod.enemyDmg || 1));
      const ddir = new THREE.Vector3(target.pos.x - this.pos.x, 0, target.pos.z - this.pos.z).normalize();
      if (isPlayer) {
        const region = miss < 0.18 && rand(0, 1) < 0.15 ? 'head' : 'chest';
        target.takeDamage(dmg, region, ddir, this.arch.id);
      } else {
        target.takeDamage(dmg);
      }
      this.game.effects.impact(targetPos, ddir.clone().negate(), 'flesh');
    } else if (isPlayer) {
      // a shot that misses the player can still catch an exposed squadmate
      this._maybeHitCompanion(mp, dir, dist);
    }
  }

  // damage a companion standing in this shot's line of fire
  _maybeHitCompanion(mp, dir, dist) {
    for (const c of this.game.squad.members) {
      if (!c.alive) continue;
      const cp = this._tmp3.set(c.pos.x, 1.3, c.pos.z);
      const proj = (cp.x - mp.x) * dir.x + (cp.y - mp.y) * dir.y + (cp.z - mp.z) * dir.z;
      if (proj <= 0) continue;
      const d = Math.hypot(mp.x + dir.x * proj - cp.x, mp.y + dir.y * proj - cp.y, mp.z + dir.z * proj - cp.z);
      if (d < 0.5 && !segmentBlocked(mp.x, mp.z, c.pos.x, c.pos.z, this.game.floor.colliders)) {
        const w = this.weapon;
        let dmg = w.damage * (w.pellets > 1 ? Math.max(1, Math.round(w.pellets * 0.4)) : 1) * (this.game.diffMod.enemyDmg || 1);
        c.takeDamage(Math.round(dmg));
        this.game.effects.impact(cp, dir.clone().negate(), 'flesh');
        break;
      }
    }
  }

  _muzzleWorld() {
    // approximate muzzle in front of chest at aim height
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    return this._tmp.set(this.pos.x + fwdX * 0.5, 1.35, this.pos.z + fwdZ * 0.5);
  }

  // -------------------------------------------------------------------------
  //  NAVIGATION / STEERING
  // -------------------------------------------------------------------------
  _moveToward(dt, target, speed) {
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) { this._lastMoveSpeed = 0; return true; }
    let ux = dx / d, uz = dz / d;
    // separation from other enemies
    const sep = this._separation();
    ux += sep.x; uz += sep.z;
    const nl = Math.hypot(ux, uz) || 1; ux /= nl; uz /= nl;

    let nx = this.pos.x + ux * speed * dt;
    let nz = this.pos.z + uz * speed * dt;
    // wall avoidance: resolve
    const boxes = this.game.allColliders();
    const before = nx + nz;
    const r = resolveCircleAABBs(nx, nz, this.radius, boxes);
    nx = r.x; nz = r.z;
    const moved = dist2D(nx, nz, this.pos.x, this.pos.z);
    this.pos.x = nx; this.pos.z = nz;
    // face movement direction (combat faces target instead)
    if (this.state !== STATE.COMBAT) this._faceToward(target.x, target.z, dt, 5);
    this._lastMoveSpeed = moved / dt;
    // stuck detection
    if (moved < speed * dt * 0.25) { this.stuckTimer += dt; if (this.stuckTimer > 0.8) { this.stuckTimer = 0; this.moveTarget = this._pickNavPoint(); } }
    else this.stuckTimer = 0;
    // bounds
    const b = this.game.floor.bounds;
    this.pos.x = clamp(this.pos.x, b.minX + this.radius, b.maxX - this.radius);
    this.pos.z = clamp(this.pos.z, b.minZ + this.radius, b.maxZ - this.radius);
    return false;
  }

  _separation() {
    let sx = 0, sz = 0;
    for (const e of this.game.enemies) {
      if (e === this || !e.alive) continue;
      const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 1.4) { sx += dx / d * (1.4 - d); sz += dz / d * (1.4 - d); }
    }
    return { x: sx * 0.6, z: sz * 0.6 };
  }

  _faceToward(x, z, dt, rate) {
    const target = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
    let diff = target - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * clamp(rate * dt, 0, 1);
  }

  _pickNavPoint() {
    const np = this.game.floor.navPoints;
    if (np.length === 0) return { x: this.pos.x + rand(-3, 3), z: clamp(this.pos.z + rand(-4, 4), 2, this.game.floor.bounds.maxZ - 2) };
    const p = pick(np);
    return { x: p.x, z: p.z };
  }

  _findCoverNear(tx, tz) {
    const np = this.game.floor.navPoints.filter((n) => n.cover);
    let best = null, bestScore = -Infinity;
    for (const n of np) {
      const dEnemy = dist2D(this.pos.x, this.pos.z, n.x, n.z);
      if (dEnemy > 10) continue;
      const dThreat = dist2D(n.x, n.z, tx, tz);
      const score = dThreat - dEnemy * 0.4;
      if (score > bestScore && dThreat > 4) { bestScore = score; best = n; }
    }
    return best ? { x: best.x, z: best.z } : null;
  }

  _strafeTarget(tx, tz, dist) {
    const ang = Math.atan2(this.pos.z - tz, this.pos.x - tx) + this.strafeDir * 0.6;
    return { x: tx + Math.cos(ang) * dist, z: tz + Math.sin(ang) * dist };
  }

  // -------------------------------------------------------------------------
  //  DAMAGE / DEATH / TAKEDOWN
  // -------------------------------------------------------------------------
  takeDamage(amount, region = 'chest', dir = null, source = 'player') {
    if (!this.alive) return;
    let dmg = amount;
    if (this.armor > 0) {
      const absorb = Math.min(this.armor, dmg * 0.5);
      this.armor -= absorb; dmg -= absorb;
    }
    this.health -= dmg;
    this.flinch = 0.4;
    this._drawHealthBar();
    if (this.health > 0 && this._hurtCd <= 0) { this._hurtCd = 0.7; this.game.audio.enemyHurt(this.pos.x, this.pos.z); }
    // becoming hit fully alerts + tells squad
    if (this.state !== STATE.COMBAT) { this.detection = 1; this._setLastSeen(this.game.player.pos.x, this.game.player.pos.z); this._enterCombat(); }
    if (this.health <= 0) this.die(source);
  }

  takedown() {
    if (!this.alive) return;
    this.die('takedown', true);
  }

  die(source = 'player', silent = false) {
    if (!this.alive) return;
    this.alive = false;
    this.state = STATE.DEAD;
    this.indicator.visible = false;
    this.healthBar.visible = false;
    // collapse the model
    this.model.rotation.z = rand(-1.4, 1.4);
    this.model.rotation.x = rand(-0.3, 0.3);
    this.model.position.y = 0.1;
    this.parts.torso.rotation.x = 1.2;
    // disable hit regions
    for (const m of this._regionMeshes) { m.userData.enemy = null; }
    // blood + death cry (a silent takedown stays quiet)
    if (!silent) this.game.effects.blood(this._tmp.set(this.pos.x, 1.2, this.pos.z), new THREE.Vector3(rand(-1, 1), 0.5, rand(-1, 1)));
    this.game.audio.impact('flesh', this.pos.x, this.pos.z);
    if (!silent) this.game.audio.enemyDeath(this.pos.x, this.pos.z);
    this.game.onEnemyKilled(this, source, silent);
  }

  // -------------------------------------------------------------------------
  _updateIndicator() {
    let col = 0xffdd33, op = 0;
    if (this.state === STATE.SUSPICIOUS) { op = 0.6; col = 0xffdd33; }
    else if (this.state === STATE.INVESTIGATE) { op = 0.85; col = 0xffaa22; }
    else if (this.state === STATE.COMBAT) { op = 0; }
    this.indicator.material.opacity = lerp(this.indicator.material.opacity, op, 0.2);
    this.indicator.material.color.setHex(col);
    this.indicator.rotation.y += 0.05;
    // billboard the health bar handled by sprite automatically
  }

  _updateAnim(dt, speed) {
    if (!this.alive) {
      // settle
      return;
    }
    this.model.rotation.y = this.yaw;
    // leg walk swing
    const moving = speed > 0.3;
    this.animPhase += dt * (moving ? 8 : 1);
    const swing = moving ? Math.sin(this.animPhase) * 0.5 : 0;
    if (this.parts.legL) this.parts.legL.rotation.x = swing;
    if (this.parts.legR) this.parts.legR.rotation.x = -swing;
    // aim arms toward player when in combat
    if (this.state === STATE.COMBAT) {
      const p = this.game.player;
      const dist = dist2D(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
      const dy = (p.pos.y + p.eyeHeight) - 1.35;
      const pitch = -Math.atan2(dy, Math.max(1, dist));
      this.parts.arms.rotation.x = lerp(this.parts.arms.rotation.x, pitch, 0.2);
    } else {
      this.parts.arms.rotation.x = lerp(this.parts.arms.rotation.x, 0.2, 0.1);
    }
    // flinch lean
    if (this.flinch > 0) this.parts.torso.rotation.z = Math.sin(this.flinch * 30) * 0.05;
    else this.parts.torso.rotation.z = lerp(this.parts.torso.rotation.z, 0, 0.2);
  }

  dispose() {
    this.game.scene.remove(this.model);
    this.model.traverse((o) => { if (o.isMesh) { o.geometry.dispose?.(); } });
  }
}

export { STATE as ENEMY_STATE };
