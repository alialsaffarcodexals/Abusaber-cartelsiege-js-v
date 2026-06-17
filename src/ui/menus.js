// ============================================================================
//  menus.js — front-end screens (doc 13/25): main menu, mission briefing,
//  pause, settings, between-floor store/upgrades, game-over, victory.
//  Renders into #overlay; wires buttons back to the Game controller.
// ============================================================================

import { WEAPONS, STORE, DIFFICULTY, FLOORS, SQUAD } from '../data/config.js';
import { Save } from '../core/save.js';
import { formatMoney } from '../core/utils.js';

export class Menus {
  constructor(game, root) {
    this.game = game;
    this.root = root;
  }

  _clear() { this.root.innerHTML = ''; this.root.style.display = 'flex'; }
  hide() { this.root.style.display = 'none'; this.root.innerHTML = ''; }

  _screen(cls) {
    const s = document.createElement('div');
    s.className = 'screen ' + (cls || '');
    this.root.appendChild(s);
    return s;
  }
  _btn(parent, label, onClick, cls) {
    const b = document.createElement('button');
    b.className = 'menu-btn ' + (cls || '');
    b.textContent = label;
    b.addEventListener('mouseenter', () => this.game.audio.uiHover());
    b.addEventListener('click', () => { this.game.audio.resume(); this.game.audio.uiClick(); onClick(); });
    parent.appendChild(b);
    return b;
  }
  _h(parent, tag, cls, html) {
    const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; parent.appendChild(e); return e;
  }

  // -------------------------------------------------------------------------
  mainMenu() {
    this._clear();
    const s = this._screen('main-menu');
    this._h(s, 'div', 'game-logo', 'ABU SABER');
    this._h(s, 'div', 'game-sub', 'CARTEL&nbsp;SIEGE');
    this._h(s, 'div', 'game-tag', 'A cinematic tactical FPS — seven floors, one cartel, no retreat.');

    const menu = this._h(s, 'div', 'menu-list');
    this._btn(menu, 'NEW GAME', () => this.difficultySelect());
    if (Save.hasSave()) {
      const d = Save.load();
      this._btn(menu, `CONTINUE — Floor ${d.floorIndex}`, () => this.game.continueGame());
    }
    this._btn(menu, 'SETTINGS', () => this.settings('main'));
    this._btn(menu, 'CONTROLS', () => this.controls('main'));
    this._btn(menu, 'CREDITS', () => this.credits());

    this._h(s, 'div', 'menu-foot', 'HTML / JS Edition · Three.js · Web Audio · v1.0');
    this.game.audio.setMusicState('menu');
  }

  difficultySelect() {
    this._clear();
    const s = this._screen('diff-select');
    this._h(s, 'h1', 'screen-title', 'SELECT DIFFICULTY');
    const grid = this._h(s, 'div', 'diff-grid');
    const order = ['easy', 'normal', 'hard', 'veteran'];
    const desc = {
      easy: 'More resources, forgiving enemies. For story-focused play.',
      normal: 'The intended experience. Balanced tactical combat.',
      hard: 'Smarter, deadlier enemies. Resources are scarce.',
      veteran: 'Maximum challenge. Every bullet counts.',
    };
    for (const id of order) {
      const card = this._h(grid, 'div', 'diff-card');
      this._h(card, 'div', 'diff-name', DIFFICULTY[id].label);
      this._h(card, 'div', 'diff-desc', desc[id]);
      card.addEventListener('mouseenter', () => this.game.audio.uiHover());
      card.addEventListener('click', () => { this.game.audio.uiConfirm(); this.squadSelect(id); });
    }
    this._btn(s, '← BACK', () => this.mainMenu(), 'ghost');
  }

  squadSelect(difficulty) {
    this._clear();
    const s = this._screen('diff-select');
    this._h(s, 'h1', 'screen-title', 'CHOOSE YOUR SQUAD');
    this._h(s, 'div', 'game-tag', 'Decide how many of your team deploy with you.');
    const grid = this._h(s, 'div', 'diff-grid');
    const opts = [
      { n: 0, name: 'Lone Wolf', desc: 'Go in alone — no squad, no backup. The hardest way to fight.' },
      { n: 1, name: '1 Companion', desc: `${SQUAD[0].name} deploys with you.` },
      { n: 2, name: '2 Companions', desc: `${SQUAD[0].name} and ${SQUAD[1].name} watch your back.` },
      { n: 3, name: 'Full Squad', desc: `All three — ${SQUAD.map((m) => m.name).join(', ')}.` },
    ];
    for (const o of opts) {
      const card = this._h(grid, 'div', 'diff-card');
      this._h(card, 'div', 'diff-name', o.name);
      this._h(card, 'div', 'diff-desc', o.desc);
      card.addEventListener('mouseenter', () => this.game.audio.uiHover());
      card.addEventListener('click', () => { this.game.audio.uiConfirm(); this.game.startNewGame(difficulty, o.n); });
    }
    this._btn(s, '← BACK', () => this.difficultySelect(), 'ghost');
  }

  // -------------------------------------------------------------------------
  briefing(floorDef, onContinue) {
    this._clear();
    const s = this._screen('briefing');
    this._h(s, 'div', 'brief-floor', 'FLOOR ' + floorDef.index);
    this._h(s, 'h1', 'brief-name', floorDef.name);
    this._h(s, 'div', 'brief-sub', floorDef.subtitle);
    const card = this._h(s, 'div', 'brief-card');
    this._h(card, 'div', 'brief-obj-label', 'OBJECTIVE');
    this._h(card, 'div', 'brief-obj', floorDef.objective);
    const intel = this._h(card, 'div', 'brief-intel');
    const roster = Object.entries(floorDef.roster).map(([k, v]) => `${v}× ${k}`).join(' · ');
    this._h(intel, 'div', 'intel-row', `<span>HOSTILE INTEL</span> ${roster}`);
    const sq = (this.game.squadState && this.game.squadState.length)
      ? this.game.squadState.map((m) => m.name).join(' · ') : 'Solo — no squad';
    this._h(intel, 'div', 'intel-row', `<span>SQUAD</span> ${sq}`);
    if (floorDef.boss) this._h(intel, 'div', 'intel-row boss-intel', `<span>WARNING</span> Abu Kashma is on this floor.`);
    this._btn(s, 'INSERT ▸', () => onContinue(), 'primary');
  }

  // -------------------------------------------------------------------------
  pause() {
    this._clear();
    const s = this._screen('pause');
    this._h(s, 'h1', 'screen-title', 'PAUSED');
    const menu = this._h(s, 'div', 'menu-list');
    this._btn(menu, 'RESUME', () => this.game.resumeFromPause());
    this._btn(menu, 'SETTINGS', () => this.settings('pause'));
    this._btn(menu, 'CONTROLS', () => this.controls('pause'));
    this._btn(menu, 'RESTART CHECKPOINT', () => this.game.restartCheckpoint());
    this._btn(menu, 'SAVE GAME', () => { this.game.saveGame(); this.game.hud.toast('GAME SAVED'); });
    this._btn(menu, 'QUIT TO MENU', () => this.game.quitToMenu(), 'danger');
  }

  // -------------------------------------------------------------------------
  settings(returnTo) {
    this._clear();
    const s = this._screen('settings');
    this._h(s, 'h1', 'screen-title', 'SETTINGS');
    const st = this.game.settings;
    const box = this._h(s, 'div', 'settings-box');

    const slider = (label, key, min, max, step, fmt, onInput) => {
      const row = this._h(box, 'div', 'set-row');
      this._h(row, 'div', 'set-label', label);
      const input = document.createElement('input');
      input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = st[key];
      input.className = 'set-slider';
      const val = this._h(row, 'div', 'set-val', fmt(st[key]));
      input.addEventListener('input', () => {
        st[key] = parseFloat(input.value);
        val.textContent = fmt(st[key]);
        onInput(st[key]);
      });
      row.appendChild(input); row.appendChild(val);
      return input;
    };

    slider('Master Volume', 'master', 0, 1, 0.01, (v) => Math.round(v * 100) + '%', (v) => this.game.audio.setVolume('master', v));
    slider('SFX Volume', 'sfx', 0, 1, 0.01, (v) => Math.round(v * 100) + '%', (v) => this.game.audio.setVolume('sfx', v));
    slider('Music Volume', 'music', 0, 1, 0.01, (v) => Math.round(v * 100) + '%', (v) => this.game.audio.setVolume('music', v));
    slider('UI Volume', 'ui', 0, 1, 0.01, (v) => Math.round(v * 100) + '%', (v) => this.game.audio.setVolume('ui', v));
    slider('Mouse Sensitivity', 'sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2), () => {});
    slider('Field of View', 'fov', 60, 100, 1, (v) => Math.round(v) + '°', (v) => { this.game.camera.fov = v; this.game.camera.updateProjectionMatrix(); });

    // toggles
    const toggleRow = (label, key, onChange) => {
      const row = this._h(box, 'div', 'set-row');
      this._h(row, 'div', 'set-label', label);
      const btn = document.createElement('button');
      btn.className = 'toggle ' + (st[key] ? 'on' : '');
      btn.textContent = st[key] ? 'ON' : 'OFF';
      btn.addEventListener('click', () => {
        st[key] = !st[key]; btn.classList.toggle('on', st[key]); btn.textContent = st[key] ? 'ON' : 'OFF';
        this.game.audio.uiClick(); onChange && onChange(st[key]);
      });
      row.appendChild(btn);
    };
    toggleRow('Invert Vertical Look', 'invertY');
    toggleRow('Subtitles', 'subtitles');
    toggleRow('Crouch Toggle (off = Hold)', 'crouchToggle');
    toggleRow('Lock Tab (confirm before closing)', 'lockScreen', () => this.game.applyLockScreen());

    this._btn(s, '← BACK', () => {
      Save.saveSettings(st);
      if (returnTo === 'pause') this.pause(); else this.mainMenu();
    }, 'ghost');
  }

  controls(returnTo) {
    this._clear();
    const s = this._screen('controls');
    this._h(s, 'h1', 'screen-title', 'CONTROLS');
    const list = this._h(s, 'div', 'controls-list');
    const rows = [
      ['Move', 'W A S D'], ['Look', 'Mouse'], ['Sprint', 'Shift'], ['Crouch', 'Ctrl / C'],
      ['Jump', 'Space'], ['Fire', 'Left Mouse'], ['Aim (ADS)', 'Right Mouse'], ['Reload', 'R'],
      ['Switch Weapon', '1–4 / Wheel'], ['Frag Grenade', 'G'], ['Flash Grenade', 'F'],
      ['Melee Knife', 'V'], ['Interact / Takedown', 'E'],
      ['Squad: Hold / Free Fire', 'H'], ['Inventory', 'Tab'], ['Pause', 'Esc'],
    ];
    for (const [a, b] of rows) {
      const r = this._h(list, 'div', 'ctrl-row');
      this._h(r, 'span', 'ctrl-act', a);
      this._h(r, 'span', 'ctrl-key', b);
    }
    this._btn(s, '← BACK', () => { if (returnTo === 'pause') this.pause(); else this.mainMenu(); }, 'ghost');
  }

  credits() {
    this._clear();
    const s = this._screen('credits');
    this._h(s, 'h1', 'screen-title', 'CREDITS');
    this._h(s, 'div', 'credits-body',
      `<p><b>Abu Saber: Cartel Siege</b> — HTML / JS Edition</p>
       <p>Ported from the Unity 6 design documents.</p>
       <p>Engine: Three.js (WebGL) · Audio: Web Audio + Mixkit (free license)</p>
       <p>Design docs: Game Design, Weapon, Enemy AI, Stealth, Level, Boss, Audio.</p>
       <p>Squad: Yusuf · Haider · Al-Shu'la — Villain: Abu Kashma</p>`);
    this._btn(s, '← BACK', () => this.mainMenu(), 'ghost');
  }

  // -------------------------------------------------------------------------
  //  STORE — between floors (doc 01 economy/upgrades)
  // -------------------------------------------------------------------------
  store(onClose) {
    this._clear();
    const p = this.game.player;
    const s = this._screen('store');
    this._h(s, 'h1', 'screen-title', 'RESUPPLY');
    const money = this._h(s, 'div', 'store-money', formatMoney(p.money));

    const cols = this._h(s, 'div', 'store-cols');
    const wCol = this._h(cols, 'div', 'store-col');
    this._h(wCol, 'h3', null, 'WEAPONS & AMMO');
    const uCol = this._h(cols, 'div', 'store-col');
    this._h(uCol, 'h3', null, 'UPGRADES');
    const sCol = this._h(cols, 'div', 'store-col');
    this._h(sCol, 'h3', null, 'SQUAD');

    const refresh = () => { money.textContent = formatMoney(p.money); this.game.hud.updateMoney(); };

    const buyRow = (parent, label, price, canBuy, doBuy, sub) => {
      const row = this._h(parent, 'div', 'buy-row');
      const info = this._h(row, 'div', 'buy-info');
      this._h(info, 'div', 'buy-label', label);
      if (sub) this._h(info, 'div', 'buy-sub', sub);
      const btn = document.createElement('button');
      btn.className = 'buy-btn';
      const setState = () => {
        const ok = canBuy();
        btn.textContent = ok === 'owned' ? 'OWNED' : ok === 'max' ? 'MAX' : formatMoney(price);
        btn.disabled = ok !== true;
        btn.classList.toggle('disabled', ok !== true);
      };
      btn.addEventListener('click', () => {
        if (canBuy() !== true) return;
        p.money -= price; doBuy(); this.game.audio.money(); refresh();
        // rebuild to refresh all states
        this.store(onClose);
      });
      row.appendChild(btn); setState();
      return row;
    };

    // weapons — buy, or sell owned ones back for a partial refund (CS2-style)
    for (const w of STORE.weapons) {
      const def = WEAPONS[w.id];
      if (p.inventory.includes(w.id)) {
        const refund = Math.round(w.price * 0.6);
        const row = this._h(wCol, 'div', 'buy-row');
        const info = this._h(row, 'div', 'buy-info');
        this._h(info, 'div', 'buy-label', def.name + ' (' + def.cls + ')');
        this._h(info, 'div', 'buy-sub', 'owned · refund ' + formatMoney(refund));
        const btn = document.createElement('button');
        btn.className = 'buy-btn sell-btn'; btn.textContent = 'SELL';
        btn.addEventListener('mouseenter', () => this.game.audio.uiHover());
        btn.addEventListener('click', () => { this.game.audio.uiClick(); this._sellWeapon(w.id, refund); this.store(onClose); });
        row.appendChild(btn);
      } else {
        buyRow(wCol, def.name + ' (' + def.cls + ')', w.price,
          () => p.money >= w.price ? true : false,
          () => p.giveWeapon(w.id), `DMG ${def.damage} · ${def.fireMode}`);
      }
    }
    buyRow(wCol, 'Ammo Refill (all weapons)', STORE.ammoPrice,
      () => p.money >= STORE.ammoPrice,
      () => { for (const id of p.inventory) p.ammo[id].reserve += WEAPONS[id].magazine * 2; this.game.hud.updateAmmo(); });
    buyRow(wCol, 'Armor Plate +50', STORE.armorPrice,
      () => p.money >= STORE.armorPrice ? true : false,
      () => p.addArmor(50));
    buyRow(wCol, 'Frag Grenade', STORE.fragPrice,
      () => p.grenades.frag >= 6 ? 'max' : (p.money >= STORE.fragPrice ? true : false),
      () => { p.grenades.frag++; this.game.hud.updateGrenades(); });
    buyRow(wCol, 'Flash Grenade', STORE.flashPrice,
      () => p.grenades.flash >= 6 ? 'max' : (p.money >= STORE.flashPrice ? true : false),
      () => { p.grenades.flash++; this.game.hud.updateGrenades(); });

    // upgrades
    for (const u of STORE.upgrades) {
      const lvl = p.upgrades[u.id] || 0;
      buyRow(uCol, u.label, u.price,
        () => lvl >= u.max ? 'max' : (p.money >= u.price ? true : false),
        () => {
          p.upgrades[u.id] = (p.upgrades[u.id] || 0) + 1;
          if (u.id === 'grenade') { p.grenades.frag++; p.grenades.flash++; this.game.hud.updateGrenades(); }
          if (u.id === 'armorCap') this.game.hud.updateVitals();
        }, `Level ${lvl}/${u.max}`);
    }

    // squad — heal living companions / revive the fallen (HP persists between floors)
    const sstate = this.game.squadState;
    const wounded = sstate.filter((m) => !m.dead && m.health < m.maxHealth);
    buyRow(sCol, 'Heal Squad to full', STORE.healSquad,
      () => wounded.length === 0 ? 'max' : (p.money >= STORE.healSquad ? true : false),
      () => { sstate.forEach((m) => { if (!m.dead) m.health = m.maxHealth; }); this.game.hud.updateSquad(); },
      wounded.length ? ('wounded: ' + wounded.map((m) => m.name).join(', ')) : 'all at full strength');
    for (const m of sstate) {
      if (!m.dead) continue;
      buyRow(sCol, 'Revive ' + m.name, STORE.revivePrice,
        () => p.money >= STORE.revivePrice ? true : false,
        () => { m.dead = false; m.health = Math.round(m.maxHealth * 0.5); this.game.hud.updateSquad(); },
        'returns at 50% HP');
    }
    if (!sstate.some((m) => m.dead) && wounded.length === 0) {
      this._h(sCol, 'div', 'buy-sub', 'Squad at full strength.');
    }

    this._btn(s, 'DEPLOY ▸', () => onClose(), 'primary');
  }

  _sellWeapon(id, refund) {
    const p = this.game.player;
    const idx = p.inventory.indexOf(id);
    if (idx < 0 || p.inventory.length <= 1) return;   // always keep at least one weapon
    p.inventory.splice(idx, 1);
    delete p.ammo[id];
    p.weaponIndex = Math.min(p.weaponIndex, p.inventory.length - 1);
    p.money += refund;
    p._buildViewModel();
    this.game.hud.updateMoney();
    this.game.hud.updateWeapon();
    this.game.audio.money();
  }

  // -------------------------------------------------------------------------
  //  INVENTORY (Tab) — manage / equip / drop weapons & grenades
  // -------------------------------------------------------------------------
  inventory(onClose) {
    this._clear();
    const p = this.game.player;
    const s = this._screen('inventory');
    this._h(s, 'h1', 'screen-title', 'INVENTORY');
    const res = this._h(s, 'div', 'inv-res');
    res.innerHTML = `<span>HP <b>${Math.ceil(p.health)}</b></span>` +
      `<span>ARMOR <b>${Math.ceil(p.armor)}</b></span>` +
      `<span class="cash">${formatMoney(p.money)}</span>`;

    this._h(s, 'div', 'inv-section', 'WEAPONS');
    const wgrid = this._h(s, 'div', 'inv-grid');
    p.inventory.forEach((id) => {
      const w = WEAPONS[id]; const a = p.ammo[id];
      const equipped = p.inventory[p.weaponIndex] === id;
      const card = this._h(wgrid, 'div', 'inv-card' + (equipped ? ' equipped' : ''));
      this._h(card, 'div', 'inv-name', w.name);
      this._h(card, 'div', 'inv-cls', w.cls);
      this._h(card, 'div', 'inv-ammo', a ? (a.mag + ' / ' + a.reserve) : '');
      const actions = this._h(card, 'div', 'inv-actions');
      const eq = this._h(actions, 'button', 'inv-btn', equipped ? 'EQUIPPED' : 'EQUIP');
      eq.disabled = equipped;
      eq.addEventListener('click', () => { this.game.player.switchTo(p.inventory.indexOf(id)); this.inventory(onClose); });
      if (p.inventory.length > 1) {
        const dp = this._h(actions, 'button', 'inv-btn drop', 'DROP');
        dp.addEventListener('click', () => { this.game.dropWeapon(id); this.inventory(onClose); });
      }
    });

    this._h(s, 'div', 'inv-section', 'GRENADES');
    const ggrid = this._h(s, 'div', 'inv-grid');
    [['frag', 'Frag Grenade'], ['flash', 'Flash Grenade']].forEach(([type, label]) => {
      const n = p.grenades[type] || 0;
      const card = this._h(ggrid, 'div', 'inv-card' + (n === 0 ? ' empty' : ''));
      this._h(card, 'div', 'inv-name', label);
      this._h(card, 'div', 'inv-ammo', '× ' + n);
      const actions = this._h(card, 'div', 'inv-actions');
      const dp = this._h(actions, 'button', 'inv-btn drop', 'DROP');
      dp.disabled = n === 0;
      dp.addEventListener('click', () => { if (this.game.dropGrenade(type)) this.inventory(onClose); });
    });

    this._h(s, 'div', 'inv-hint', 'Press Tab or Esc to close');
    this._btn(s, 'CLOSE', () => onClose(), 'primary');
  }

  // -------------------------------------------------------------------------
  floorComplete(floorDef, stats, onContinue) {
    this._clear();
    const s = this._screen('floor-complete');
    this._h(s, 'div', 'fc-label', 'FLOOR CLEARED');
    this._h(s, 'h1', 'fc-name', 'FLOOR ' + floorDef.index + ' — ' + floorDef.name);
    const grid = this._h(s, 'div', 'fc-stats');
    const stat = (k, v) => { const r = this._h(grid, 'div', 'fc-stat'); this._h(r, 'div', 'fc-k', k); this._h(r, 'div', 'fc-v', v); };
    stat('Kills', stats.kills);
    stat('Takedowns', stats.takedowns);
    stat('Cash Earned', formatMoney(stats.money));
    const sqTotal = this.game.squadState.length;
    stat('Squad Standing', sqTotal ? (this.game.squadState.filter((s) => !s.dead).length + '/' + sqTotal) : 'Solo');
    this._btn(s, 'RESUPPLY ▸', () => onContinue(), 'primary');
  }

  gameOver(onRetry, onMenu) {
    this._clear();
    const s = this._screen('game-over');
    this._h(s, 'h1', 'go-title', 'YOU DIED');
    this._h(s, 'div', 'go-sub', 'The siege is not over. Abu Saber falls — but the mission remains.');
    const menu = this._h(s, 'div', 'menu-list');
    this._btn(menu, 'RESTART CHECKPOINT', () => onRetry(), 'primary');
    this._btn(menu, 'QUIT TO MENU', () => onMenu(), 'danger');
  }

  victory(stats) {
    this._clear();
    const s = this._screen('victory');
    this._h(s, 'div', 'vic-label', 'MISSION COMPLETE');
    this._h(s, 'h1', 'vic-title', 'THE BUILDING IS FREE');
    this._h(s, 'div', 'vic-body',
      `Abu Kashma is dead. The cartel's grip on the building is broken.
       Abu Saber and his squad walk out into the morning light — the residents are safe.`);
    const grid = this._h(s, 'div', 'fc-stats');
    const stat = (k, v) => { const r = this._h(grid, 'div', 'fc-stat'); this._h(r, 'div', 'fc-k', k); this._h(r, 'div', 'fc-v', v); };
    stat('Total Kills', stats.kills);
    stat('Takedowns', stats.takedowns);
    stat('Cash Collected', formatMoney(stats.money));
    stat('Difficulty', DIFFICULTY[this.game.difficulty].label);
    this._btn(s, 'RETURN TO MENU', () => this.game.quitToMenu(), 'primary');
    this.game.audio.stingerVictory();
  }
}
