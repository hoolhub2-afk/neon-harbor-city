// Neon Harbor — keyboard and mouse input. Tracks held keys, edge-triggered presses
// (E to enter a car, Space to punch, R to reload), mouse drag for camera orbit and
// clicks to shoot. The game reads this, never the DOM events directly.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();   // edge-triggered: consumed by the game each frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseDown = false;
    this.clicked = false;       // a fresh mouse click this frame
    this.dragging = false;
    this.enabled = true;
    this._lastX = 0;
    this._lastY = 0;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });

    canvas.addEventListener('mousedown', (e) => {
      this.mouseDown = true; this.dragging = false;
      this._lastX = e.clientX; this._lastY = e.clientY;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.mouseDown) return;
      const dx = e.clientX - this._lastX, dy = e.clientY - this._lastY;
      this._lastX = e.clientX; this._lastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.dragging = true;
      this.mouseDX += dx; this.mouseDY += dy;
    });
    window.addEventListener('mouseup', () => {
      if (this.mouseDown && !this.dragging) this.clicked = true;
      this.mouseDown = false;
    });
    // Touch: one finger drag orbits, tap shoots / interacts.
    canvas.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this._lastX = t.clientX; this._lastY = t.clientY; this.dragging = false;
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      const t = e.changedTouches[0];
      this.mouseDX += t.clientX - this._lastX; this.mouseDY += t.clientY - this._lastY;
      this._lastX = t.clientX; this._lastY = t.clientY; this.dragging = true;
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchend', () => { if (!this.dragging) this.clicked = true; }, { passive: true });
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  // WASD / arrow movement vector in camera space: x = strafe, y = forward.
  moveVector() {
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    const len = Math.hypot(x, y);
    if (len > 0) { x /= len; y /= len; }
    return { x, y };
  }

  // Driving input: throttle -1..1, steering -1..1.
  driveVector() {
    let throttle = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) throttle += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) throttle -= 1;
    let steer = 0;
    if (this.down('KeyA') || this.down('ArrowLeft')) steer += 1;
    if (this.down('KeyD') || this.down('ArrowRight')) steer -= 1;
    return { throttle, steer };
  }

  consumeMouse() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  }

  // Call at the end of each frame: edge triggers live for exactly one frame.
  endFrame() {
    this.pressed.clear();
    this.clicked = false;
  }
}
