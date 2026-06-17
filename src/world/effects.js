// ============================================================================
//  effects.js — pooled visual FX: muzzle flash, tracers, impacts, blood,
//  explosions, flashbang flash, bullet decals.
//
//  PERFORMANCE: dynamic lights are drawn from a FIXED pre-allocated pool that
//  is added to the scene ONCE and never removed. Adding/removing a light from
//  a Three.js scene changes the light count, which forces a recompile of every
//  lit material's shader program (a ~200ms frame stall). Pooled lights stay in
//  the scene permanently (intensity 0 when idle), so the light count is
//  constant and no recompilation ever happens during combat.
// ============================================================================

import * as THREE from 'three';
import { rand } from '../core/utils.js';

const LIGHT_POOL_SIZE = 8;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.active = [];          // {update(dt)->bool alive, dispose()}
    this.decals = [];
    this.maxDecals = 60;

    // shared geometries / materials
    this._tracerGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 5);
    this._tracerGeo.translate(0, 0.5, 0);
    this._tracerMat = new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.9 });
    this._sparkGeo = new THREE.SphereGeometry(0.04, 4, 4);
    this._flashGeo = new THREE.PlaneGeometry(1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
    this._v = new THREE.Vector3();

    // fixed dynamic-light pool — added to the scene once, kept forever
    this._lightPool = [];
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 8, 2);
      light.position.set(0, -1000, 0); // parked underground while idle
      scene.add(light);
      this._lightPool.push({ light, age: 0, ttl: 0, peak: 0 });
    }
  }

  // Grab a free pooled light (or null if all are busy — the flash sprite still
  // renders, we just skip the dynamic light for this one).
  _acquireLight(color, peak, distance, pos, ttl) {
    for (const e of this._lightPool) {
      if (e.age >= e.ttl) {
        e.light.color.setHex(color);
        e.light.distance = distance;
        e.light.intensity = peak;
        e.light.position.copy(pos);
        e.peak = peak; e.age = 0; e.ttl = ttl;
        return e;
      }
    }
    return null;
  }

  _add(obj, tick, ttl) {
    this.scene.add(obj);
    let age = 0;
    this.active.push({
      update: (dt) => {
        age += dt;
        const t = age / ttl;
        const alive = tick(dt, age, t, obj);
        return alive !== false && age < ttl;
      },
      dispose: () => { this.scene.remove(obj); if (obj.geometry && obj.__owned) obj.geometry.dispose(); if (obj.material && obj.__owned) obj.material.dispose(); },
    });
    return obj;
  }

  muzzleFlash(pos, dir, color = 0xffcc66, scale = 1) {
    // bright point light from the pool (no scene add/remove)
    this._acquireLight(color, 9 * scale, 7, pos, 0.07);
    // flash sprite
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(this._flashGeo, mat); m.__owned = true;
    m.position.copy(pos);
    m.scale.setScalar(0.4 * scale + rand(0, 0.2));
    m.rotation.z = rand(0, Math.PI);
    this._add(m, (dt, age, t) => { mat.opacity = 0.95 * (1 - t); m.scale.multiplyScalar(1 + dt * 4); }, 0.06);
  }

  tracer(from, to, color = 0xffdd88) {
    this._v.subVectors(to, from);
    const len = this._v.length();
    if (len < 0.01) return;
    const mat = this._tracerMat.clone(); mat.color.setHex(color);
    const m = new THREE.Mesh(this._tracerGeo, mat); m.__owned = true;
    m.position.copy(from);
    m.scale.set(1, len, 1);
    m.quaternion.setFromUnitVectors(this._up, this._v.clone().normalize());
    this._add(m, (dt, age, t) => { mat.opacity = 0.9 * (1 - t); }, 0.08);
  }

  impact(pos, normal, kind = 'concrete') {
    const colors = { concrete: 0xbbb3a0, metal: 0xffe089, flesh: 0xaa1822, wood: 0x8a6a40 };
    const col = colors[kind] || colors.concrete;
    const n = kind === 'flesh' ? 8 : 6;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true });
      const s = new THREE.Mesh(this._sparkGeo, mat); s.__owned = true;
      s.position.copy(pos);
      const vel = new THREE.Vector3(
        normal.x + rand(-0.8, 0.8), normal.y + rand(0.2, 1.0), normal.z + rand(-0.8, 0.8)
      ).multiplyScalar(rand(2, 5));
      const ttl = rand(0.25, 0.5);
      this._add(s, (dt, age, t) => {
        vel.y -= 14 * dt;
        s.position.addScaledVector(vel, dt);
        mat.opacity = 1 - t;
        s.scale.setScalar(1 - t * 0.5);
      }, ttl);
    }
    if (kind !== 'flesh') this._decal(pos, normal, col);
  }

  blood(pos, dir) {
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x8a0f18, transparent: true });
      const s = new THREE.Mesh(this._sparkGeo, mat); s.__owned = true;
      s.position.copy(pos);
      const vel = new THREE.Vector3(dir.x + rand(-0.7, 0.7), rand(0.1, 1), dir.z + rand(-0.7, 0.7)).multiplyScalar(rand(2, 6));
      const ttl = rand(0.3, 0.6);
      this._add(s, (dt, age, t) => { vel.y -= 16 * dt; s.position.addScaledVector(vel, dt); mat.opacity = 1 - t; }, ttl);
    }
  }

  _decal(pos, normal, color) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const m = new THREE.Mesh(this._flashGeo, mat); m.__owned = true;
    m.position.copy(pos).addScaledVector(normal, 0.02);
    m.lookAt(this._v.copy(pos).add(normal));
    m.scale.setScalar(rand(0.12, 0.22));
    this.scene.add(m);
    this.decals.push(m);
    if (this.decals.length > this.maxDecals) {
      const old = this.decals.shift();
      this.scene.remove(old); old.material.dispose();
    }
  }

  explosion(pos) {
    // shockwave sphere
    const mat = new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const sph = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mat); sph.__owned = true;
    sph.position.copy(pos);
    this._add(sph, (dt, age, t) => { sph.scale.setScalar(0.5 + t * 7); mat.opacity = 0.9 * (1 - t); }, 0.4);
    // core flash
    const cmat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), cmat); core.__owned = true;
    core.position.copy(pos);
    this._add(core, (dt, age, t) => { core.scale.setScalar(1 + t * 2); cmat.opacity = 1 - t; }, 0.18);
    // light (pooled — no scene add/remove)
    this._acquireLight(0xffaa44, 20, 22, pos, 0.4);
    // debris
    for (let i = 0; i < 16; i++) {
      const dmat = new THREE.MeshBasicMaterial({ color: 0x553322, transparent: true });
      const d = new THREE.Mesh(this._sparkGeo, dmat); d.__owned = true;
      d.position.copy(pos);
      const vel = new THREE.Vector3(rand(-1, 1), rand(0.4, 1.4), rand(-1, 1)).multiplyScalar(rand(4, 11));
      this._add(d, (dt, age, t) => { vel.y -= 16 * dt; d.position.addScaledVector(vel, dt); dmat.opacity = 1 - t; }, rand(0.5, 0.9));
    }
    // smoke
    for (let i = 0; i < 6; i++) {
      const smat = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.5, depthWrite: false });
      const sm = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), smat); sm.__owned = true;
      sm.position.copy(pos).add(new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1)));
      const vy = rand(0.5, 1.2);
      this._add(sm, (dt, age, t) => { sm.position.y += vy * dt; sm.scale.setScalar(1 + t * 2); smat.opacity = 0.5 * (1 - t); }, 1.2);
    }
  }

  flashbangFlash(pos) {
    this._acquireLight(0xffffff, 40, 40, pos, 0.3);
  }

  update(dt) {
    // tick the pooled dynamic lights (intensity decay, no scene mutation)
    for (const e of this._lightPool) {
      if (e.age < e.ttl) {
        e.age += dt;
        const t = e.age / e.ttl;
        e.light.intensity = t >= 1 ? 0 : e.peak * (1 - t);
        if (e.age >= e.ttl) { e.light.intensity = 0; e.light.position.set(0, -1000, 0); }
      }
    }
    // tick mesh-based effects
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      if (!e.update(dt)) { e.dispose(); this.active.splice(i, 1); }
    }
  }

  clear() {
    for (const e of this.active) e.dispose();
    this.active.length = 0;
    for (const d of this.decals) { this.scene.remove(d); d.material.dispose(); }
    this.decals.length = 0;
    // reset pooled lights (keep them in the scene — do NOT remove)
    for (const e of this._lightPool) { e.age = e.ttl = 0; e.light.intensity = 0; e.light.position.set(0, -1000, 0); }
  }
}
