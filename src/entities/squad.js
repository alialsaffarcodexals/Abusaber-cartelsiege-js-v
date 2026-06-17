// ============================================================================
//  squad.js — AI companions (doc 03/11). They follow Abu Saber, engage
//  visible hostiles and take cover.
//
//  Persistence/permadeath: each companion's HP lives in a shared `state` object
//  (owned by Game.squadState) that carries across floors. If HP reaches 0 the
//  companion DIES permanently and is not re-spawned on later floors.
//  Hold-fire: a squad-wide toggle (Squad.holdFire) makes them cease fire and
//  just follow until weapons are freed again.
// ============================================================================

import * as THREE from 'three';
import { WEAPONS } from '../data/config.js';
import { clamp, lerp, rand, randInt, damp, deg2rad, dist2D, segmentBlocked, resolveCircleAABBs } from '../core/utils.js';
import { buildCharacter } from './models.js';

const CALLOUTS = {
  contact: ['Contact front!', 'Enemy spotted!', 'Tango, eleven o’clock!', 'They see us — open fire!'],
  kill: ['Target down!', 'Got one!', 'Hostile neutralized!', 'Tango down!'],
  reload: ['Reloading!', 'Cover me, reloading!', 'Mag out!'],
  hold: ['Holding fire.', 'Weapons tight.', 'Standing by.'],
  free: ['Weapons free!', 'Engaging!', 'Opening fire!'],
  hurt: ['I’m hit!', 'Taking fire!', 'Pinned down!'],
  death: ['Aaagh… they got me…', 'I’m down for good…', 'Tell them… we held the line…'],
  support: ['I’ve got your back!', 'Right behind you, boss.', 'On your six.', 'Covering you.',
    'Moving up with you.', 'Stay sharp — we’re with you.', 'I’ve got the rear, push up.'],
  lowhp: ['You’re hit — fall back, boss!', 'Cover the boss!', 'Get to cover, we’ll hold the line!'],
  cover: ['They’re on you, boss!', 'Get them off him!', 'Suppressing — hang on!', 'I’ve got him, boss!'],
};

export class Companion {
  constructor(game, def, index, state) {
    this.game = game;
    this.def = def;
    this.index = index;
    this.state = state;                 // shared, persisted across floors
    this.weapon = WEAPONS[def.weapon];
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.radius = 0.36;
    this.maxHealth = state.maxHealth;
    this.health = state.health;         // carried over from previous floors
    this.alive = !state.dead;
    this.fireTimer = rand(0, 1);
    this.burstLeft = 0;
    this.reloadTimer = 0;
    this.ammoInMag = this.weapon.magazine;
    this.target = null;
    this.repositionTimer = 0;
    this.animPhase = rand(0, 10);
    this._lastMoveSpeed = 0;
    this._calloutCd = 0;
    this._supportCd = rand(5, 12);   // periodic supportive comms chatter

    const m = buildCharacter({ color: def.color, headColor: def.headColor, scale: 1.02, weaponColor: this.weapon.color });
    this.model = m.root;
    this.parts = m.parts;
    game.scene.add(this.model);

    // friendly marker
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.26, 4),
      new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.9 }));
    marker.rotation.x = Math.PI; marker.position.y = 2.2;
    this.model.add(marker);
    this.marker = marker;

    this._tmp = new THREE.Vector3();
  }

  spawnAt(x, z) {
    this.pos.set(x, 0, z);
    this.model.position.copy(this.pos);
    // health is NOT reset — it persists from the shared state
  }

  _followPoint() {
    const p = this.game.player;
    const back = 2.2 + this.index * 0.4;
    const side = (this.index % 2 === 0 ? 1 : -1) * (1.4 + this.index * 0.3);
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const fwdX = -sin, fwdZ = -cos;
    const rightX = cos, rightZ = -sin;
    return { x: p.pos.x - fwdX * back + rightX * side, z: p.pos.z - fwdZ * back + rightZ * side };
  }

  update(dt) {
    if (!this.alive) return;
    if (this._calloutCd > 0) this._calloutCd -= dt;
    if (this.reloadTimer > 0) { this.reloadTimer -= dt; if (this.reloadTimer <= 0) this.ammoInMag = this.weapon.magazine; }

    // periodic supportive comms ("I've got your back", "On your six", …)
    this._supportCd -= dt;
    if (this._supportCd <= 0) {
      this._supportCd = rand(16, 26);
      const lowHp = this.game.player.health / this.game.player.maxHealth < 0.35;
      this._callout(lowHp ? 'lowhp' : 'support');
    }

    let moveSpeed = 0;
    const holdFire = this.game.squad.holdFire;

    if (holdFire) {
      // weapons tight: stay close to the player, do not engage
      this.target = null;
      const fp = this._followPoint();
      const d = dist2D(this.pos.x, this.pos.z, fp.x, fp.z);
      if (d > 1.4) moveSpeed = this._moveToward(dt, fp, d > 6 ? 5 : 3.2);
      else this._faceToward(this.game.player.pos.x - Math.sin(this.game.player.yaw) * 4, this.game.player.pos.z - Math.cos(this.game.player.yaw) * 4, dt, 4);
      this.model.position.set(this.pos.x, 0, this.pos.z);
      this._updateAnim(dt, moveSpeed);
      return;
    }

    // acquire target
    this._acquireTarget();

    if (this.target) {
      const t = this.target;
      const dist = dist2D(this.pos.x, this.pos.z, t.pos.x, t.pos.z);
      this._faceToward(t.pos.x, t.pos.z, dt, 7);
      this.repositionTimer -= dt;
      const distToPlayer = dist2D(this.pos.x, this.pos.z, this.game.player.pos.x, this.game.player.pos.z);
      let dest = null;
      if (dist > 16) dest = { x: t.pos.x, z: t.pos.z };
      else if (distToPlayer > 9) dest = this._followPoint();
      else if (this.repositionTimer <= 0) { this.repositionTimer = rand(2, 4); dest = { x: this.pos.x + rand(-2, 2), z: this.pos.z + rand(-2, 2) }; }
      if (dest) moveSpeed = this._moveToward(dt, dest, 3.2);
      if (this.reloadTimer <= 0) this._tryFire(dt, t, dist);
    } else {
      const fp = this._followPoint();
      const d = dist2D(this.pos.x, this.pos.z, fp.x, fp.z);
      if (d > 1.6) moveSpeed = this._moveToward(dt, fp, d > 6 ? 5 : 3.2);
      else this._faceToward(this.game.player.pos.x - Math.sin(this.game.player.yaw) * 4, this.game.player.pos.z - Math.cos(this.game.player.yaw) * 4, dt, 4);
    }

    this.model.position.set(this.pos.x, 0, this.pos.z);
    this._updateAnim(dt, moveSpeed);
  }

  _acquireTarget() {
    if (this.target && !this.target.alive) this.target = null;
    if (this.target && this.target.alive) {
      if (dist2D(this.pos.x, this.pos.z, this.target.pos.x, this.target.pos.z) < 24) return;
    }
    let best = null, bestD = Infinity;
    for (const e of this.game.enemies) {
      if (!e.alive) continue;
      const d = dist2D(this.pos.x, this.pos.z, e.pos.x, e.pos.z);
      if (d > 24) continue;
      if (segmentBlocked(this.pos.x, this.pos.z, e.pos.x, e.pos.z, this.game.floor.colliders)) continue;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best && !this.target) this._callout('contact');
    this.target = best;
  }

  _tryFire(dt, enemy, dist) {
    if (segmentBlocked(this.pos.x, this.pos.z, enemy.pos.x, enemy.pos.z, this.game.floor.colliders)) return;
    if (this.ammoInMag <= 0) { this.reloadTimer = this.weapon.reloadTime; this._callout('reload'); return; }
    if (this.burstLeft > 0) {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) { this._shoot(enemy, dist); this.fireTimer = 60 / this.weapon.rpm; }
      return;
    }
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) { this.burstLeft = randInt(2, 4); this._shoot(enemy, dist); this.fireTimer = 60 / this.weapon.rpm; }
  }

  _shoot(enemy, dist) {
    this.burstLeft--;
    this.ammoInMag--;
    if (this.burstLeft <= 0) this.fireTimer = rand(0.5, 1.4);
    const mp = this._tmp.set(this.pos.x - Math.sin(this.yaw) * 0.5, 1.4, this.pos.z - Math.cos(this.yaw) * 0.5);
    const tp = new THREE.Vector3(enemy.pos.x, 1.3, enemy.pos.z);
    this.game.effects.muzzleFlash(mp, tp.clone().sub(mp).normalize(), 0x88ddff, 1);
    this.game.effects.tracer(mp, tp, 0x88ccff);
    this.game.audio.gunshot(this.weapon.sound, this.pos.x, this.pos.z, { volMult: 0.7 });
    this.game.emitNoise(this.pos.x, this.pos.z, this.weapon.noiseRadius * 0.7, 'gunshot'); // alert nearby enemies
    let chance = this.def.accuracy * clamp(1.2 - dist / 30, 0.2, 1);
    if (rand(0, 1) < chance) {
      const w = this.weapon;
      let dmg = w.damage * (w.pellets > 1 ? 3 : 1);
      if (dist > w.falloffStart) {
        const t = clamp((dist - w.falloffStart) / (w.falloffEnd - w.falloffStart), 0, 1);
        dmg *= lerp(1, w.minDamageMult, t);
      }
      enemy.takeDamage(Math.round(dmg), rand(0, 1) < 0.12 ? 'head' : 'chest', null, 'squad');
      if (!enemy.alive) this._callout('kill');
    }
  }

  _moveToward(dt, target, speed) {
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) { this._lastMoveSpeed = 0; return 0; }
    let ux = dx / d, uz = dz / d;
    let nx = this.pos.x + ux * speed * dt;
    let nz = this.pos.z + uz * speed * dt;
    const r = resolveCircleAABBs(nx, nz, this.radius, this.game.allColliders());
    nx = r.x; nz = r.z;
    const moved = dist2D(nx, nz, this.pos.x, this.pos.z);
    this.pos.x = nx; this.pos.z = nz;
    if (!this.target) this._faceToward(target.x, target.z, dt, 6);
    const b = this.game.floor.bounds;
    this.pos.x = clamp(this.pos.x, b.minX + this.radius, b.maxX - this.radius);
    this.pos.z = clamp(this.pos.z, b.minZ + this.radius, b.maxZ - this.radius);
    this._lastMoveSpeed = moved / dt;
    return this._lastMoveSpeed;
  }

  _faceToward(x, z, dt, rate) {
    const target = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
    let diff = target - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * clamp(rate * dt, 0, 1);
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.health -= amount;
    if (this.health < 0) this.health = 0;
    this.state.health = this.health;
    if (this.health > 0 && this._calloutCd <= 0) this._callout('hurt');
    this.game.hud.updateSquad();
    if (this.health <= 0) this.die();
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.state.dead = true;
    this.state.health = 0;
    // collapse the model — stays as a body on this floor, never re-spawns
    this.model.rotation.z = rand(-1.3, 1.3);
    this.parts.torso.rotation.x = 1.2;
    this.model.position.y = 0.1;
    this.marker.visible = false;
    this._calloutCd = 0;
    this._callout('death');
    this.game.audio.impact('flesh', this.pos.x, this.pos.z);
    this.game.hud.updateSquad();
    this.game.hud.toast(this.def.name.toUpperCase() + ' HAS FALLEN');
  }

  _callout(kind) {
    if (this._calloutCd > 0 && kind !== 'death') return;
    this._calloutCd = 3;
    const lines = CALLOUTS[kind];
    const line = lines[randInt(0, lines.length - 1)];
    this.game.hud.subtitle(this.def.name, line);
    // spoken over the radio (comms beep + friendly voice)
    this.game.audio.speakAlly(line);
  }

  _updateAnim(dt, speed) {
    this.model.rotation.y = this.yaw;
    const moving = speed > 0.3;
    this.animPhase += dt * (moving ? 8 : 1);
    const swing = moving ? Math.sin(this.animPhase) * 0.5 : 0;
    this.parts.legL.rotation.x = swing;
    this.parts.legR.rotation.x = -swing;
    if (this.target && !this.game.squad.holdFire) {
      this.parts.arms.rotation.x = lerp(this.parts.arms.rotation.x, -0.1, 0.2);
    } else {
      this.parts.arms.rotation.x = lerp(this.parts.arms.rotation.x, 0.2, 0.1);
    }
  }

  dispose() { this.game.scene.remove(this.model); }
}

export class Squad {
  constructor(game) {
    this.game = game;
    this.members = [];
    this.holdFire = false;
  }
  // state: array of { id, name, health, maxHealth, dead } persisted on Game
  spawn(defs, x, z, state) {
    this.dispose();
    defs.forEach((d, i) => {
      const st = state.find((s) => s.id === d.id);
      if (!st || st.dead) return;             // permadeath: don't re-spawn the fallen
      const c = new Companion(this.game, d, i, st);
      c.spawnAt(x + (i - 1) * 1.5, z - 1.5 - i * 0.5);
      this.members.push(c);
    });
  }
  update(dt) { for (const m of this.members) m.update(dt); }
  aliveCount() { return this.members.filter((m) => m.alive).length; }
  // a squadmate calls out when the player is taking fire ("They're on you, boss!")
  reactToPlayerHurt() { const m = this.members.find((c) => c.alive); if (m) m._callout('cover'); }
  dispose() { for (const m of this.members) m.dispose(); this.members = []; }
}
