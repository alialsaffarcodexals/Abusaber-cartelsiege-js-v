// ============================================================================
//  grenade.js — thrown frag / flash grenades with bouncing physics, fuse,
//  and area effects (doc 09). Used by the player, elites and the boss.
// ============================================================================

import * as THREE from 'three';
import { GRENADES } from '../data/config.js';
import { clamp, rand, dist2D, segmentBlocked } from '../core/utils.js';

export class Grenade {
  constructor(game, type, origin, dir, owner) {
    this.game = game;
    this.type = type;
    this.cfg = GRENADES[type];
    this.owner = owner;       // 'player' | 'enemy'
    this.fuse = this.cfg.fuse;
    this.exploded = false;
    this.vel = dir.clone().normalize().multiplyScalar(this.cfg.throwForce);
    this.vel.y += 3.5;
    this.pos = origin.clone();

    const col = type === 'frag' ? 0x3a4a2a : 0x9a9a9a;
    // telegraph via blinking EMISSIVE (not a scene light — adding/removing a
    // light at runtime forces a full shader recompile / frame stall).
    this._blinkColor = type === 'frag' ? 0xff4422 : 0x88ccff;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 8),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.4, emissive: this._blinkColor, emissiveIntensity: 0.6 })
    );
    this.mesh.position.copy(this.pos);
    this.mesh.castShadow = true;
    game.scene.add(this.mesh);
    this._blink = 0;
  }

  update(dt) {
    if (this.exploded) return false;
    this.fuse -= dt;
    this._blink += dt;
    this.mesh.material.emissiveIntensity = Math.sin(this._blink * 18) > 0 ? 1.6 : 0.3;

    // physics
    this.vel.y += -19.62 * dt;
    this.pos.addScaledVector(this.vel, dt);

    // floor bounce
    if (this.pos.y < 0.1) {
      this.pos.y = 0.1;
      this.vel.y *= -0.45;
      this.vel.x *= 0.7; this.vel.z *= 0.7;
      if (Math.abs(this.vel.y) < 0.6) this.vel.y = 0;
    }
    // wall collision (simple reflect against AABBs)
    for (const b of this.game.floor.colliders) {
      if (this.pos.x > b.minX - 0.1 && this.pos.x < b.maxX + 0.1 && this.pos.z > b.minZ - 0.1 && this.pos.z < b.maxZ + 0.1) {
        // push out on the smaller axis & reflect
        const penX = Math.min(this.pos.x - (b.minX - 0.1), (b.maxX + 0.1) - this.pos.x);
        const penZ = Math.min(this.pos.z - (b.minZ - 0.1), (b.maxZ + 0.1) - this.pos.z);
        if (penX < penZ) { this.vel.x *= -0.5; this.pos.x += this.pos.x < b.cx ? -penX : penX; }
        else { this.vel.z *= -0.5; this.pos.z += this.pos.z < b.cz ? -penZ : penZ; }
      }
    }

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.x += dt * 6; this.mesh.rotation.y += dt * 4;

    if (this.fuse <= 0) { this.explode(); return false; }
    return true;
  }

  explode() {
    this.exploded = true;
    this.game.scene.remove(this.mesh);
    const x = this.pos.x, z = this.pos.z;
    this.game.emitNoise(x, z, this.cfg.radius * 2.5, 'explosion');

    if (this.type === 'frag') {
      this.game.effects.explosion(this.pos.clone());
      this.game.audio.explosion(x, z);
      this._areaDamage();
    } else {
      this.game.effects.flashbangFlash(this.pos.clone());
      this.game.audio.flashbang(x, z);
      this._flashEffect();
    }
  }

  _areaDamage() {
    const R = this.cfg.radius;
    const apply = (ent, ex, ez, takeFn) => {
      const d = dist2D(x0, z0, ex, ez);
      if (d > R) return;
      // walls reduce but don't fully block frag
      let blocked = segmentBlocked(x0, z0, ex, ez, this.game.floor.colliders);
      const falloff = 1 - d / R;
      let dmg = this.cfg.maxDamage * falloff * falloff;
      if (blocked) dmg *= 0.35;
      if (dmg > 1) takeFn(Math.round(dmg));
    };
    const x0 = this.pos.x, z0 = this.pos.z;
    // enemies
    for (const e of this.game.enemies) {
      if (!e.alive) continue;
      apply(e, e.pos.x, e.pos.z, (d) => e.takeDamage(d, 'chest', null, 'grenade'));
    }
    // player (friendly fire from own/enemy grenade)
    const p = this.game.player;
    if (p.alive) apply(p, p.pos.x, p.pos.z, (d) => p.takeDamage(d, 'chest', null, 'grenade'));
    // companions
    for (const c of this.game.squad.members) {
      if (c.alive && !c.downed) apply(c, c.pos.x, c.pos.z, (d) => c.takeDamage(d));
    }
  }

  _flashEffect() {
    const R = this.cfg.radius;
    const x0 = this.pos.x, z0 = this.pos.z;
    // player
    const p = this.game.player;
    const dP = dist2D(x0, z0, p.pos.x, p.pos.z);
    if (dP < R && !segmentBlocked(x0, z0, p.pos.x, p.pos.z, this.game.floor.colliders)) {
      // intensity by distance + whether looking toward it
      const dir = new THREE.Vector3(x0 - p.pos.x, 0, z0 - p.pos.z).normalize();
      const fwd = new THREE.Vector3(); p.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
      const facing = clamp(dir.dot(fwd), -1, 1);
      const intensity = clamp((1 - dP / R) * (0.5 + facing * 0.5), 0, 1);
      p.applyFlashBlind(intensity);
      this.game.hud.flashbang(intensity);
    }
    // enemies — blind them so stealth/escape is possible
    for (const e of this.game.enemies) {
      if (!e.alive) continue;
      const d = dist2D(x0, z0, e.pos.x, e.pos.z);
      if (d < R && !segmentBlocked(x0, z0, e.pos.x, e.pos.z, this.game.floor.colliders)) {
        e.flashBlind = Math.max(e.flashBlind, this.cfg.blindDuration * (1 - d / R));
      }
    }
  }
}
