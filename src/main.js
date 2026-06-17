// ============================================================================
//  main.js — bootstrap: builds the Game, runs the fixed render loop, manages
//  the loading screen, audio unlock gesture, and pointer-lock hint.
// ============================================================================

import { Game } from './game.js';

const canvas = document.getElementById('game-canvas');
const hudRoot = document.getElementById('hud');
const overlayRoot = document.getElementById('overlay');
const loading = document.getElementById('loading');
const lockHint = document.getElementById('lock-hint');

let game;
try {
  game = new Game(canvas, hudRoot, overlayRoot);
  window.__game = game;
} catch (err) {
  loading.innerHTML = '<div class="load-logo">ERROR</div><div class="load-tip">' + err.message + '</div>';
  console.error(err);
  throw err;
}

// fade out loading screen, show menu
setTimeout(() => {
  loading.classList.add('hidden');
  game.boot();
}, 600);

// Unlock the Web Audio context on the first user gesture, start menu music.
function unlockAudio() {
  game.audio.init();
  game.audio.resume();
  if (game.state === 'menu') game.audio.setMusicState('menu');
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
}
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// Pointer-lock hint visibility
game.input.on('lockchange', () => updateLockHint());
function updateLockHint() {
  const show = game.state === 'playing' && !game.input.locked;
  lockHint.classList.toggle('show', show);
}
setInterval(updateLockHint, 250);

// ---- main loop --------------------------------------------------------------
let last = performance.now();
let acc = 0;
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1; // guard against tab-switch spikes
  try {
    game.update(dt);
    game.render();
  } catch (err) {
    console.error('Frame error:', err);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
