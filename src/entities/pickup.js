// ============================================================================
//  pickup.js — world loot: ammo, armor, medkits, cash, weapons (doc 09/01).
//  Resource pickups auto-collect on proximity; weapons require an interact.
// ============================================================================

import * as THREE from 'three';
import { LOOT, WEAPONS } from '../data/config.js';
import { rand, randInt, dist2D } from '../core/utils.js';

const VISUAL = {
  ammo: { color: 0xe0c020, label: 'Ammo' },
  armor: { color: 0x3a8aff, label: 'Armor' },
  health: { color: 0x35d05a, label: 'Medkit' },
  money: { color: 0x2ad17a, label: 'Cash' },
  weapon: { color: 0xff8844, label: 'Weapon' },
  frag: { color: 0xff4422, label: 'Frag Grenade' },
  flash: { color: 0x88ccff, label: 'Flash Grenade' },
};

export class Pickup {
  constructor(game, type, x, z, opts = {}) {
    this.game = game;
    this.type = type;
    this.opts = opts;
    this.collected = false;
    this.pos = new THREE.Vector3(x, 0.6, z);
    const v = VISUAL[type] || VISUAL.ammo;
    this.color = v.color;
    this.label = opts.weaponId ? WEAPONS[opts.weaponId].name : v.label;

    const grp = new THREE.Group();
    let geo;
    if (type === 'weapon') geo = new THREE.BoxGeometry(0.5, 0.16, 0.16);
    else if (type === 'health') geo = new THREE.BoxGeometry(0.3, 0.3, 0.12);
    else if (type === 'money') geo = new THREE.BoxGeometry(0.28, 0.16, 0.04);
    else geo = new THREE.BoxGeometry(0.26, 0.26, 0.26);
    // Strong emissive (instead of a per-pickup PointLight) keeps the pickup
    // glowing without changing the scene light count — adding a light at
    // runtime (e.g. loot dropped on a kill) forces a shader recompile stall.
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: v.color, emissive: v.color, emissiveIntensity: 1.0, roughness: 0.4, metalness: 0.3 }));
    mesh.castShadow = true;
    grp.add(mesh);
    // glow ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 18), new THREE.MeshBasicMaterial({ color: v.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -0.55;
    grp.add(ring);
    grp.position.copy(this.pos);
    game.scene.add(grp);
    this.group = grp;
    this.mesh = mesh;
    this._t = rand(0, 10);

    this.requiresInteract = (type === 'weapon');
  }

  update(dt) {
    if (this.collected) return false;
    this._t += dt;
    this.mesh.rotation.y += dt * 1.5;
    this.group.position.y = 0.6 + Math.sin(this._t * 2) * 0.1;
    if (!this.requiresInteract) {
      const p = this.game.player;
      if (dist2D(this.pos.x, this.pos.z, p.pos.x, p.pos.z) < 1.3) this.collect();
    }
    return !this.collected;
  }

  collect() {
    if (this.collected) return;
    const p = this.game.player;
    let msg = null;
    switch (this.type) {
      case 'ammo': {
        const w = p.weapon; const a = p.ammo[p.weaponId];
        a.reserve = Math.min(w.reserve * 2, a.reserve + Math.round(w.magazine * 1.5));
        // also top all weapons a little
        for (const id of p.inventory) { p.ammo[id].reserve += Math.round(WEAPONS[id].magazine * 0.5); }
        msg = '+ Ammo'; this.game.audio.pickup(); p.game.hud.updateAmmo();
        break;
      }
      case 'armor': p.addArmor(LOOT.armorPack.amount); msg = '+ Armor'; this.game.audio.pickup(); break;
      case 'health': p.heal(LOOT.health.amount); msg = '+ Health'; this.game.audio.pickup(); break;
      case 'money': {
        const amt = this.opts.amount || randInt(LOOT.money.amount[0], LOOT.money.amount[1]);
        p.addMoney(amt); msg = '+ ' + ('$' + amt); this.game.audio.money();
        break;
      }
      case 'frag': p.grenades.frag = Math.min(p.grenades.frag + 1, 6); msg = '+ Frag'; this.game.audio.pickup(); p.game.hud.updateGrenades(); break;
      case 'flash': p.grenades.flash = Math.min(p.grenades.flash + 1, 6); msg = '+ Flash'; this.game.audio.pickup(); p.game.hud.updateGrenades(); break;
      case 'weapon': {
        const got = p.giveWeapon(this.opts.weaponId);
        msg = (got ? '+ ' : '+ Ammo: ') + WEAPONS[this.opts.weaponId].name; this.game.audio.pickup();
        break;
      }
    }
    if (msg) this.game.hud.toast(msg);
    this.collected = true;
    this.game.scene.remove(this.group);
  }

  dispose() { this.game.scene.remove(this.group); }
}
