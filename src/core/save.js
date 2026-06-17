// ============================================================================
//  save.js — settings + save-slot persistence via localStorage (doc 20)
// ============================================================================

const SETTINGS_KEY = 'abusaber.settings.v1';
const SAVE_KEY = 'abusaber.save.v1';

const DEFAULT_SETTINGS = {
  master: 0.9,
  sfx: 1.0,
  music: 0.55,
  ui: 0.8,
  sensitivity: 1.0,
  fov: 75,
  invertY: false,
  difficulty: 'normal',
  subtitles: true,
  crouchToggle: false,   // false = hold to crouch, true = press to toggle
  lockScreen: false,     // confirm before the tab can close/navigate (guards Ctrl+W etc.)
};

export const Save = {
  loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  },
  saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
  },

  hasSave() {
    return !!localStorage.getItem(SAVE_KEY);
  },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },
  save(data) {
    try {
      data.timestamp = Date.now();
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch (e) { return false; }
  },
  clear() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  },
};
