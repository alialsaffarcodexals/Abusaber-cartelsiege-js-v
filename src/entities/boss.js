// ============================================================================
//  boss.js — Abu Kashma, the final boss (doc 24). Three-phase encounter with
//  escalating aggression and periodic elite reinforcements. Extends Enemy.
// ============================================================================

import * as THREE from 'three';
import { Enemy } from './enemy.js';
import { BOSS } from '../data/config.js';
import { lerp, rand, clamp } from '../core/utils.js';

export class Boss extends Enemy {
  constructor(game, x, z) {
    const arch = {
      id: 'boss', name: BOSS.name, health: BOSS.health, armor: BOSS.armor,
      weapon: BOSS.weapon, moveSpeed: BOSS.moveSpeed, color: BOSS.color, headColor: BOSS.headColor,
      viewDistance: 32, viewAngle: 130, reaction: 0.35, aimError: BOSS.aimError,
      fireBurst: [3, 6], money: BOSS.money, big: false,
    };
    super(game, arch, x, z);
    this.isBoss = true;
    this.phase = 1;
    this.reinforceTimer = BOSS.reinforceInterval;
    this.preferredRange = 14;

    // luxurious styling — gold accents + sunglasses
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a23a, roughness: 0.25, metalness: 0.9, emissive: 0x4a3a10, emissiveIntensity: 0.4 });
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 12), gold);
    crown.rotation.x = Math.PI / 2; crown.position.y = 0.78;
    this.parts.torso.add(crown);
    this.model.scale.setScalar(1.08);
    // bigger detection-proof: boss starts already "aware" once triggered

    // boss aura light
    this.aura = new THREE.PointLight(0xc9a23a, 3, 8, 2);
    this.aura.position.y = 1.4;
    this.model.add(this.aura);

    this.dormant = true;   // inactive until bodyguards are cleared
    this._introDone = false;
  }

  trigger() {
    this.dormant = false;
    this.detection = 1;
    this._setLastSeen(this.game.player.pos.x, this.game.player.pos.z);
    this._enterCombat();
    this.game.hud.showBoss(this.arch.name, 1);
    this.game.hud.subtitle(this.arch.name, BOSS.lines.intro);
    this.game.audio.setMusicState('boss');
  }

  update(dt) {
    if (this.dormant) {
      // stand guard at the far end, slowly facing the player, but inactive
      this._faceToward(this.game.player.pos.x, this.game.player.pos.z, dt, 1.2);
      this.model.position.set(this.pos.x, 0, this.pos.z);
      this._updateAnim(dt, 0);
      this.aura.intensity = 2 + Math.sin(this.game.time * 2) * 0.4;
      return;
    }
    super.update(dt);
    if (!this.alive) return;

    // phase transitions
    const frac = this.health / this.maxHealth;
    if (this.phase === 1 && frac <= BOSS.phase2At) this._toPhase(2);
    else if (this.phase === 2 && frac <= BOSS.phase3At) this._toPhase(3);

    // reinforcements during combat
    if (this.state === 4 /* COMBAT */) {
      this.reinforceTimer -= dt;
      if (this.reinforceTimer <= 0) {
        const interval = BOSS.reinforceInterval / this.phase;
        this.reinforceTimer = interval;
        this.game.spawnBossReinforcements(BOSS.reinforceCount + this.phase - 1);
        this.game.hud.subtitle(this.arch.name, 'Finish them.');
      }
    }

    if (this.game.hud) this.game.hud.updateBoss(clamp(frac, 0, 1));
    this.aura.intensity = 3 + Math.sin(this.game.time * 4) * 0.6;
  }

  _toPhase(n) {
    this.phase = n;
    if (n === 2) {
      this.preferredRange = 9;
      this.aimError *= 0.8;
      this.arch.moveSpeed *= 1.2;
      this.game.hud.subtitle(this.arch.name, BOSS.lines.phase2);
      this.reinforceTimer = 2;
    } else if (n === 3) {
      this.preferredRange = 5;
      this.aimError *= 0.7;
      this.arch.moveSpeed *= 1.3;
      this.arch.fireBurst = [4, 8];
      this.game.hud.subtitle(this.arch.name, BOSS.lines.phase3);
      this.reinforceTimer = 2;
      this.aura.color.setHex(0xff3322);
    }
    this.game.audio.uiAlert();
    // brief light flicker event
    this.game.floor.flickerLights?.(1.2);
  }

  die(source = 'player', silent = false) {
    if (!this.alive) return;
    this.alive = false;
    this.state = 5;
    this.indicator.visible = false;
    this.healthBar.visible = false;
    this.model.rotation.z = 1.4;
    this.parts.torso.rotation.x = 1.2;
    this.aura.intensity = 0;
    for (const m of this._regionMeshes) m.userData.enemy = null;
    this.game.hud.subtitle(this.arch.name, BOSS.lines.death);
    this.game.audio.explosion(this.pos.x, this.pos.z);
    this.game.onBossDefeated(this);
  }
}
