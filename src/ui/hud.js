// ============================================================================
//  hud.js — tactical HUD (doc 13): health/armor, ammo, grenades, objective,
//  minimap radar, squad status, hit markers, damage feedback, interaction
//  prompts, subtitles, boss bar, stealth detection meter, flashbang overlay.
//  Builds its own DOM under #hud; driven by event-style update calls.
// ============================================================================

import { clamp, formatMoney, dist2D } from '../core/utils.js';
import { WEAPONS } from '../data/config.js';

export class HUD {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this._build();
    this._damageDir = 0;
    this._damageAlpha = 0;
    this._flash = 0;
    this._hitTimer = 0;
    this._toastTimer = 0;
    this._subTimer = 0;
  }

  _el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    (parent || this.root).appendChild(e);
    return e;
  }

  _build() {
    this.root.innerHTML = '';
    // vignettes / overlays
    this.lowHp = this._el('div', 'hud-vignette hud-lowhp');
    this.dmgVignette = this._el('div', 'hud-vignette hud-dmg');
    this.flashOverlay = this._el('div', 'hud-flash');
    this.dmgArrow = this._el('div', 'hud-dmg-arrow');

    // crosshair
    this.crosshair = this._el('div', 'crosshair');
    ['top', 'bottom', 'left', 'right'].forEach((d) => {
      this['ch_' + d] = this._el('div', 'ch-line ch-' + d, this.crosshair);
    });
    this.chDot = this._el('div', 'ch-dot', this.crosshair);
    this.hitMarkerEl = this._el('div', 'hit-marker', this.crosshair);
    this.hitMarkerEl.innerHTML = '<span></span><span></span><span></span><span></span>';

    // ADS reticle — each weapon has its own unique scope (built per weapon).
    // Surroundings stay fully visible (no opaque overlay) except a faint edge
    // vignette on the sniper scope.
    this.adsReticle = this._el('div', 'ads-reticle');
    this.adsReticle.style.opacity = 0;
    this._reticleType = null;

    // detection / stealth meter
    this.detectWrap = this._el('div', 'detect-meter');
    this.detectEye = this._el('div', 'detect-eye', this.detectWrap, '◉');
    this.detectBar = this._el('div', 'detect-bar', this.detectWrap);
    this.detectFill = this._el('div', 'detect-fill', this.detectBar);

    // interaction prompt
    this.prompt = this._el('div', 'prompt');
    this.prompt.style.display = 'none';

    // objective (top center)
    this.objective = this._el('div', 'objective');
    this.objTitle = this._el('div', 'obj-title', this.objective, 'OBJECTIVE');
    this.objText = this._el('div', 'obj-text', this.objective, '');
    this.objProgress = this._el('div', 'obj-progress', this.objective, '');

    // boss bar
    this.bossWrap = this._el('div', 'boss-bar');
    this.bossName = this._el('div', 'boss-name', this.bossWrap, '');
    this.bossTrack = this._el('div', 'boss-track', this.bossWrap);
    this.bossFill = this._el('div', 'boss-fill', this.bossTrack);
    this.bossWrap.style.display = 'none';

    // vitals (bottom-left)
    this.vitals = this._el('div', 'vitals');
    const hpRow = this._el('div', 'stat-row', this.vitals);
    this._el('div', 'stat-label', hpRow, 'HP');
    this.hpBar = this._el('div', 'stat-bar', hpRow);
    this.hpFill = this._el('div', 'stat-fill hp-fill', this.hpBar);
    this.hpText = this._el('div', 'stat-val', hpRow, '100');
    const arRow = this._el('div', 'stat-row', this.vitals);
    this._el('div', 'stat-label', arRow, 'AR');
    this.arBar = this._el('div', 'stat-bar', arRow);
    this.arFill = this._el('div', 'stat-fill ar-fill', this.arBar);
    this.arText = this._el('div', 'stat-val', arRow, '0');

    // ammo (bottom-right)
    this.ammoBox = this._el('div', 'ammo-box');
    this.weaponName = this._el('div', 'weapon-name', this.ammoBox, 'M16');
    this.fireModeEl = this._el('div', 'fire-mode', this.ammoBox, 'BURST');
    const ammoRow = this._el('div', 'ammo-row', this.ammoBox);
    this.ammoMag = this._el('span', 'ammo-mag', ammoRow, '30');
    this._el('span', 'ammo-sep', ammoRow, '/');
    this.ammoReserve = this._el('span', 'ammo-reserve', ammoRow, '90');
    this.reloadHint = this._el('div', 'reload-hint', this.ammoBox, '');

    // weapon hotbar (bottom-centre) — owned weapons, active highlighted
    this.hotbar = this._el('div', 'hotbar');

    // grenades + money (above ammo)
    this.utilBox = this._el('div', 'util-box');
    this.fragEl = this._el('div', 'util-item', this.utilBox, '<span class="util-ico frag">✸</span><span class="util-n">2</span>');
    this.flashEl = this._el('div', 'util-item', this.utilBox, '<span class="util-ico flash">✦</span><span class="util-n">2</span>');
    this.moneyEl = this._el('div', 'util-item money', this.utilBox, '<span class="util-ico">$</span><span class="util-n">0</span>');

    // minimap (top-right)
    this.miniWrap = this._el('div', 'minimap');
    this.miniCanvas = this._el('canvas', 'mini-canvas', this.miniWrap);
    this.miniCanvas.width = 200; this.miniCanvas.height = 200;
    this.miniCtx = this.miniCanvas.getContext('2d');
    this.floorLabel = this._el('div', 'floor-label', this.miniWrap, 'FLOOR 1');

    // squad status (left)
    this.squadBox = this._el('div', 'squad-box');

    // subtitle (bottom center)
    this.subtitleEl = this._el('div', 'subtitle');
    this.subtitleEl.style.opacity = 0;

    // toast (center)
    this.toastEl = this._el('div', 'toast');
    this.toastEl.style.opacity = 0;

    // alarm banner
    this.alarmEl = this._el('div', 'alarm-banner', this.root, 'ALARM TRIGGERED');
    this.alarmEl.style.display = 'none';
  }

  // -------------------------------------------------------------------------
  // squadState: persisted array of { name, health, maxHealth, dead }
  buildSquad(squadState) {
    this.squadBox.innerHTML = '';
    this.squadEls = squadState.map((s) => {
      const row = this._el('div', 'squad-member', this.squadBox);
      const name = this._el('div', 'sq-name', row, s.name);
      const bar = this._el('div', 'sq-bar', row);
      const fill = this._el('div', 'sq-fill', bar);
      return { row, fill, name, state: s };
    });
  }

  updateSquad() {
    if (!this.squadEls) return;
    for (const e of this.squadEls) {
      const s = e.state;
      const frac = clamp(s.health / s.maxHealth, 0, 1);
      e.fill.style.width = (frac * 100) + '%';
      e.row.classList.toggle('dead', !!s.dead);
      e.fill.style.background = frac > 0.4 ? '#4aa3ff' : '#ffaa33';
    }
  }

  // -------------------------------------------------------------------------
  updateVitals() {
    const p = this.game.player;
    const hpFrac = clamp(p.health / p.maxHealth, 0, 1);
    this.hpFill.style.width = (hpFrac * 100) + '%';
    this.hpText.textContent = Math.ceil(p.health);
    this.hpFill.style.background = hpFrac > 0.5 ? 'linear-gradient(90deg,#2ad15a,#7af0a0)' : hpFrac > 0.25 ? 'linear-gradient(90deg,#e0c020,#ffe060)' : 'linear-gradient(90deg,#e03020,#ff6050)';
    const arCap = p.maxArmor + p.upgrades.armorCap * 25;
    const arFrac = clamp(p.armor / arCap, 0, 1);
    this.arFill.style.width = (arFrac * 100) + '%';
    this.arText.textContent = Math.ceil(p.armor);
  }

  updateAmmo() {
    const p = this.game.player;
    const a = p.ammo[p.weaponId];
    this.ammoMag.textContent = a.mag;
    this.ammoReserve.textContent = a.reserve;
    this.ammoMag.classList.toggle('low', a.mag <= p.weapon.magazine * 0.25);
  }

  updateWeapon() {
    const p = this.game.player;
    this.weaponName.textContent = p.weapon.name;
    this.fireModeEl.textContent = p.weapon.fireMode.toUpperCase();
    this._buildReticle(p.weapon);
    this._buildHotbar();
    this.updateAmmo();
  }

  // weapon hotbar — one slot per owned weapon, the equipped one highlighted
  _buildHotbar() {
    const p = this.game.player;
    this.hotbar.innerHTML = '';
    p.inventory.forEach((id, i) => {
      const w = WEAPONS[id];
      const slot = this._el('div', 'hb-slot' + (i === p.weaponIndex ? ' active' : ''), this.hotbar);
      this._el('span', 'hb-key', slot, String(i + 1));
      this._el('span', 'hb-name', slot, w.name);
      this._el('span', 'hb-cls', slot, w.cls);
    });
  }

  // Build the unique ADS reticle for the current weapon.
  _buildReticle(weapon) {
    const type = (weapon && weapon.reticle) || 'cross';
    if (type === this._reticleType) return;
    this._reticleType = type;
    let marks = '';
    switch (type) {
      case 'holo': // M16 — holographic ring + post + dot
        marks = '<div class="ring"></div><div class="post"></div><div class="dot"></div>'; break;
      case 'cross': // AK — bold crosshair + outer ticks
        marks = '<div class="v1"></div><div class="v2"></div><div class="h1"></div><div class="h2"></div><div class="dot"></div>'; break;
      case 'dot': // MP5 — red-dot sight
        marks = '<div class="ring"></div><div class="dot"></div>'; break;
      case 'spread': // Shotgun — pellet-spread ring + outer pellets
        marks = '<div class="circle"></div><span class="p pt"></span><span class="p pb"></span><span class="p pl"></span><span class="p pr"></span><div class="dot"></div>'; break;
      case 'sniper': // DMR — mil-dot sniper crosshair
        marks = '<div class="vt"></div><div class="vb"></div><div class="hl"></div><div class="hr"></div>' +
                '<span class="md mt"></span><span class="md mb"></span><span class="md ml"></span><span class="md mr"></span><div class="dot"></div>'; break;
      case 'pistol': // Pistol — 3-dot iron sights
        marks = '<span class="d dl"></span><span class="d dc"></span><span class="d dr"></span>'; break;
    }
    const vignette = type === 'sniper' ? '<div class="ads-vignette"></div>' : '';
    this.adsReticle.className = 'ads-reticle reticle-' + type;
    this.adsReticle.innerHTML = vignette + '<div class="r-anchor">' + marks + '</div>';
  }

  setReload(on) {
    this.reloadHint.textContent = on ? 'RELOADING…' : '';
    this.reloadHint.style.opacity = on ? 1 : 0;
  }

  updateGrenades() {
    const p = this.game.player;
    this.fragEl.querySelector('.util-n').textContent = p.grenades.frag;
    this.flashEl.querySelector('.util-n').textContent = p.grenades.flash;
  }
  updateMoney() {
    this.moneyEl.querySelector('.util-n').textContent = Math.floor(this.game.player.money);
  }

  setObjective(text, progress) {
    this.objText.textContent = text;
    this.objProgress.textContent = progress || '';
    this.objective.classList.remove('pulse'); void this.objective.offsetWidth; this.objective.classList.add('pulse');
  }
  setObjectiveProgress(progress) { this.objProgress.textContent = progress || ''; }

  setFloor(n, name) { this.floorLabel.textContent = 'FLOOR ' + n + ' — ' + name.toUpperCase(); }

  // -------------------------------------------------------------------------
  hitMarker(headshot, kill) {
    this.hitMarkerEl.classList.remove('show', 'head', 'kill');
    void this.hitMarkerEl.offsetWidth;
    this.hitMarkerEl.classList.add('show');
    if (headshot) this.hitMarkerEl.classList.add('head');
    if (kill) this.hitMarkerEl.classList.add('kill');
    this._hitTimer = 0.25;
  }

  damageFlash(dir, playerPos, yaw) {
    this._damageAlpha = 1;
    if (dir) {
      // angle of incoming relative to facing
      const incoming = Math.atan2(dir.x, dir.z);
      this._damageDir = incoming - yaw;
    }
  }
  armorBreak() {
    this.toast('ARMOR BROKEN');
    this.game.audio.beep(300, 0.2, 0.3, 'sawtooth', this.game.audio.sfxBus);
  }

  flashbang(intensity) { this._flash = Math.max(this._flash, intensity); }

  showPrompt(label, key) {
    this.prompt.style.display = 'flex';
    this.prompt.innerHTML = `<span class="key">${key}</span><span class="ptxt">${label}</span>`;
  }
  hidePrompt() { this.prompt.style.display = 'none'; }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = 1;
    this.toastEl.classList.remove('anim'); void this.toastEl.offsetWidth; this.toastEl.classList.add('anim');
    this._toastTimer = 1.8;
  }

  subtitle(speaker, line) {
    if (!this.game.settings.subtitles) return;
    this.subtitleEl.innerHTML = `<span class="spk">${speaker}:</span> ${line}`;
    this.subtitleEl.style.opacity = 1;
    this._subTimer = 3.2;
  }

  showAlarm(on) {
    this.alarmEl.style.display = on ? 'block' : 'none';
  }

  // boss bar
  showBoss(name, frac) {
    this.bossWrap.style.display = 'block';
    this.bossName.textContent = name;
    this.bossFill.style.width = (frac * 100) + '%';
  }
  updateBoss(frac) { this.bossFill.style.width = (clamp(frac, 0, 1) * 100) + '%'; }
  hideBoss() { this.bossWrap.style.display = 'none'; }

  setVisible(v) { this.root.style.display = v ? 'block' : 'none'; }

  // -------------------------------------------------------------------------
  //  PER-FRAME UPDATE
  // -------------------------------------------------------------------------
  update(dt) {
    const p = this.game.player;

    // crosshair spread
    const spread = p.getCrosshairSpread ? p.getCrosshairSpread() : 1;
    const gap = clamp(6 + spread * 5, 5, 60);
    this.ch_top.style.transform = `translate(-50%, ${-gap}px)`;
    this.ch_bottom.style.transform = `translate(-50%, ${gap}px)`;
    this.ch_left.style.transform = `translate(${-gap}px, -50%)`;
    this.ch_right.style.transform = `translate(${gap}px, -50%)`;
    // hand off from the hip crosshair to the clean ADS reticle while aiming
    const ads = p.adsAmount || 0;
    this.crosshair.style.display = ads > 0.45 ? 'none' : 'block';
    this.adsReticle.style.opacity = ads > 0.12 ? clamp((ads - 0.12) / 0.5, 0, 1) : 0;

    // hit marker fade
    if (this._hitTimer > 0) { this._hitTimer -= dt; if (this._hitTimer <= 0) this.hitMarkerEl.classList.remove('show'); }

    // damage vignette
    if (this._damageAlpha > 0) {
      this._damageAlpha = Math.max(0, this._damageAlpha - dt * 1.6);
      this.dmgVignette.style.opacity = this._damageAlpha * 0.85;
      this.dmgArrow.style.opacity = this._damageAlpha;
      this.dmgArrow.style.transform = `translate(-50%,-50%) rotate(${this._damageDir}rad) translateY(-120px)`;
    } else { this.dmgVignette.style.opacity = 0; this.dmgArrow.style.opacity = 0; }

    // low health pulse
    const hpFrac = p.health / p.maxHealth;
    if (hpFrac < 0.3 && p.alive) {
      const pulse = 0.35 + Math.sin(this.game.time * 6) * 0.25;
      this.lowHp.style.opacity = (0.3 - hpFrac) / 0.3 * pulse;
    } else this.lowHp.style.opacity = 0;

    // flashbang
    const blind = Math.max(this._flash, p.flashBlind || 0);
    this.flashOverlay.style.opacity = clamp(blind, 0, 1);
    this._flash = Math.max(0, this._flash - dt * 0.5);

    // toast / subtitle timers
    if (this._toastTimer > 0) { this._toastTimer -= dt; if (this._toastTimer <= 0) this.toastEl.style.opacity = 0; }
    if (this._subTimer > 0) { this._subTimer -= dt; if (this._subTimer <= 0) this.subtitleEl.style.opacity = 0; }

    // stealth detection meter — highest nearby enemy awareness (when not in open combat)
    let maxDet = 0, anyCombat = false;
    for (const e of this.game.enemies) {
      if (!e.alive) continue;
      if (e.state === 4) anyCombat = true;
      if (e.detection > maxDet) maxDet = e.detection;
    }
    if (anyCombat) {
      this.detectWrap.style.opacity = 0;
    } else if (maxDet > 0.05) {
      this.detectWrap.style.opacity = 1;
      this.detectFill.style.width = (maxDet * 100) + '%';
      this.detectFill.style.background = maxDet > 0.75 ? '#ff3322' : maxDet > 0.4 ? '#ff9922' : '#ffe033';
      this.detectEye.style.color = maxDet > 0.4 ? '#ff5522' : '#ffe033';
    } else this.detectWrap.style.opacity = 0;

    this._drawMinimap();
  }

  _drawMinimap() {
    const ctx = this.miniCtx;
    const W = 200, H = 200, cx = W / 2, cy = H / 2;
    ctx.clearRect(0, 0, W, H);
    // circular clip
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, 96, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(8,12,16,0.82)'; ctx.fillRect(0, 0, W, H);

    const p = this.game.player;
    const scale = 4.0; // world units to px
    const yaw = p.yaw;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);

    const toMap = (wx, wz) => {
      let dx = wx - p.pos.x, dz = wz - p.pos.z;
      // rotate so player faces up
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      return { x: cx + rx * scale, y: cy + rz * scale };
    };

    // walls (faint)
    ctx.strokeStyle = 'rgba(120,150,170,0.25)';
    ctx.lineWidth = 2;
    for (const b of this.game.floor.colliders) {
      const a = toMap(b.minX, b.minZ), c = toMap(b.maxX, b.maxZ);
      ctx.strokeRect(Math.min(a.x, c.x), Math.min(a.y, c.y), Math.abs(c.x - a.x), Math.abs(c.y - a.y));
    }

    // exit
    if (this.game.floor.exit) {
      const e = toMap(this.game.floor.exit.x, this.game.floor.exit.z);
      ctx.fillStyle = '#2aff88';
      ctx.beginPath(); ctx.arc(e.x, e.y, 4, 0, Math.PI * 2); ctx.fill();
    }
    // pickups
    ctx.fillStyle = '#ffd24a';
    for (const pk of this.game.pickups) {
      if (pk.collected) continue;
      const m = toMap(pk.pos.x, pk.pos.z);
      ctx.fillRect(m.x - 1.5, m.y - 1.5, 3, 3);
    }
    // squad
    for (const c of this.game.squad.members) {
      if (!c.alive) continue;
      const m = toMap(c.pos.x, c.pos.z);
      ctx.fillStyle = c.downed ? '#ff5544' : '#4aa3ff';
      ctx.beginPath(); ctx.arc(m.x, m.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    // enemies (only if detected / in combat)
    for (const e of this.game.enemies) {
      if (!e.alive) continue;
      const shown = e.state >= 2 || e.detection > 0.4 || dist2D(e.pos.x, e.pos.z, p.pos.x, p.pos.z) < 8;
      if (!shown) continue;
      const m = toMap(e.pos.x, e.pos.z);
      ctx.fillStyle = e.isBoss ? '#ffcc33' : '#ff3322';
      ctx.beginPath(); ctx.arc(m.x, m.y, e.isBoss ? 5 : 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // player arrow (center, facing up)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6); ctx.lineTo(cx - 4, cy + 5); ctx.lineTo(cx + 4, cy + 5);
    ctx.closePath(); ctx.fill();

    // ring
    ctx.strokeStyle = 'rgba(160,190,210,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 96, 0, Math.PI * 2); ctx.stroke();
  }
}
