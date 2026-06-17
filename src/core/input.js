// ============================================================================
//  input.js — keyboard, mouse, pointer-lock. Event-driven, polled by player.
// ============================================================================

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.justPressed = new Set();
    this.mouseDown = [false, false, false];
    this.mouseJustDown = [false, false, false];
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 1.0;
    this._listeners = {};

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      const code = e.code;
      if (!this.keys.has(code)) this.justPressed.add(code);
      this.keys.add(code);
      this._emit('key', code);
      // prevent browser scrolling on space / arrows while playing
      if (this.locked && ['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(code)) e.preventDefault();
    };
    this._onKeyUp = (e) => { this.keys.delete(e.code); };
    this._onMouseDown = (e) => {
      if (!this.enabled || !this.locked) return;
      this.mouseDown[e.button] = true;
      this.mouseJustDown[e.button] = true;
    };
    this._onMouseUp = (e) => { this.mouseDown[e.button] = false; };
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.dx += e.movementX * this.sensitivity;
      this.dy += e.movementY * this.sensitivity;
    };
    this._onWheel = (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      this._emit('lockchange', this.locked);
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  on(evt, cb) { (this._listeners[evt] ||= []).push(cb); }
  _emit(evt, data) { (this._listeners[evt] || []).forEach((cb) => cb(data)); }

  requestLock() {
    if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  }
  exitLock() {
    if (document.exitPointerLock) document.exitPointerLock();
  }

  isDown(code) { return this.keys.has(code); }
  pressed(code) { return this.justPressed.has(code); }
  mouse(btn) { return this.mouseDown[btn]; }
  mousePressed(btn) { return this.mouseJustDown[btn]; }

  // consume per-frame deltas; call at end of update tick
  consume() {
    const r = { dx: this.dx, dy: this.dy, wheel: this.wheel };
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.justPressed.clear();
    this.mouseJustDown = [false, false, false];
    return r;
  }

  clearMomentary() {
    this.justPressed.clear();
    this.mouseJustDown = [false, false, false];
    this.dx = 0; this.dy = 0; this.wheel = 0;
  }
}
