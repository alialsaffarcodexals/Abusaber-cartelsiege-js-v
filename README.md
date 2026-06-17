# 🎮 Abu Saber: Cartel Siege — HTML / JS Edition

A browser-native port of the **Abu Saber: Cartel Siege** tactical FPS, rebuilt
from the Unity design documents using **Three.js (WebGL)** and a fully
**procedural Web Audio** engine. No build step, no external asset downloads —
everything (geometry, characters, textures, sound) is generated at runtime.

> This is the standalone HTML/JS version of the project. The Unity 6 project in
> the repository root is unaffected.

---

## ▶️ How to run

The game uses ES modules, so it must be served over HTTP (not opened from
`file://`). From this folder:

```bash
# Option A — the bundled no-cache dev server (Python 3)
python server.py 8080

# Option B — any static server
python -m http.server 8080
# or:  npx serve .
```

Then open **http://localhost:8080** and click **NEW GAME**.

A modern desktop browser (Chrome / Edge / Firefox) with WebGL2 is recommended.
The game requests **pointer lock** — click the canvas to capture the mouse,
press **Esc** to pause / release.

---

## 🕹 Controls

| Action | Key |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Look | Mouse |
| Sprint | `Shift` |
| Crouch | `Ctrl` / `C` |
| Jump | `Space` |
| Fire | Left Mouse |
| Aim (ADS) | Right Mouse |
| Reload | `R` |
| Switch weapon | `1`–`4` / Mouse Wheel |
| Frag grenade | `G` |
| Flash grenade | `F` |
| Melee knife | `V` |
| Interact / Takedown | `E` |
| Squad: hold / free fire | `H` |
| Inventory | `Tab` |
| Pause | `Esc` |

---

## ✨ Features (faithful to the design docs)

**Combat (doc 09, 21)**
- 6 weapons — M16, AK-Platform, MP5, Shotgun, DMR, Pistol — each with unique
  fire mode (semi / auto / burst), RPM, recoil, spread, damage falloff, ammo
  and reload behaviour.
- Hit-location damage: **head ×2.0**, chest ×1.0, limbs ×0.7. Armour absorbs
  before health. Dynamic crosshair, ADS zoom, recoil & screen shake.
- Frag & flash grenades with bouncing physics; flashbang blinds player *and*
  enemies. Combat knife melee + **silent stealth takedowns**.

**Enemy AI (doc 10, 22)**
- Finite-state machine: Idle → Patrol → Suspicious → Investigate → Combat →
  Dead, with vision cones, line-of-sight, hearing/noise propagation and a
  detection meter.
- 5 archetypes (Foot Soldier, Armed Enforcer, Elite, Heavy, Sniper) plus the
  boss. Cover-seeking, strafing, flanking, reaction delay, fair aim-error,
  squad communication, elite grenade usage.

**Squad (doc 03, 11)** — Yusuf, Haider and Al-Shu'la fight alongside you,
take cover, can be downed and revived, and call out contacts.

**Stealth (doc 15)** — noise from movement/gunfire, vision/lighting detection,
takedowns on unaware enemies, an alarm system with reinforcements (Floor 3+).

**Progression (doc 01, 12, 25)** — 7 themed floors (Entry → Cartel HQ) with
distinct palettes, lighting moods, rosters and objectives, a between-floor
**resupply store** (weapons, ammo, armour, grenades, upgrades), economy
(kills/loot award cash), checkpoints and a localStorage save system.

**Boss (doc 24)** — Abu Kashma: a 3-phase encounter (Control → Aggression →
Desperation) with escalating aggression, periodic elite reinforcements and a
dedicated boss health bar, culminating in the ending sequence.

**HUD (doc 13)** — health/armour, ammo, grenades, money, objective tracker,
circular minimap radar, squad status, hit markers, directional damage
indicators, low-health vignette, subtitles, interaction prompts.

**Audio (doc 19)** — hybrid: procedural spatialised gunfire (unique per weapon),
explosions, flashbangs, melee, UI and alarm, layered with real license-free
samples — looping walk/run footsteps, reload, weapon-switch handling, shotgun
pump, dry-fire, and enemy hurt/attack/death vocals. Enemies bark spoken English
lines ("Reloading!", "Contact!", "Frag out!"…) and your squad answers back over
the radio with a comms beep ("I've got your back", "On your six", "Covering
you"…) via the Web Speech API.
Streamed music with per-level / combat / boss tracks that crossfade.
Music & SFX from Mixkit (free license, no attribution required).

---

## 🏗 Architecture

```
index.html            shell + loading screen
styles/main.css       cinematic tactical UI
lib/three.module.min.js   vendored Three.js r160
src/
  main.js             bootstrap + render loop
  game.js             controller: state machine, floor flow, combat resolution
  data/config.js      single source of truth for all tuned values
  core/               utils, input (pointer lock), audio engine, save
  world/              materials, procedural floor builder, FX (tracers/blast)
  entities/           player, enemy AI, squad, boss, grenade, pickup, models
  ui/                 HUD, menus
```

Design goals mirror the original: **modular, event-driven, no per-frame
allocation in hot paths, performance-first.** Each system traces back to its
numbered design doc in `../docs/`.

---

## 📦 Status

Complete, playable vertical-to-finale build: all 7 floors, the boss encounter,
and the full menu / progression / save flow are implemented and verified.

Engine: Three.js (WebGL) · Audio: Web Audio API · No build tooling required.
