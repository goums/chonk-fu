// Keyboard + mouse input for the human player. The agent harness bypasses this and writes Intents.
//
// Controls: WASD / ZQSD / arrows move (run by default), hold Shift to sprint, hold Alt or toggle C to walk,
// Space jumps (splash-hop out of deep water), J or a left click punches (J, J, J = jab, cross, kick),
// K or a right click belly bumps (L still works), Enter talks / advances dialog.
// The mouse never gets captured: dragging with the left or right button held orbits the camera, the
// wheel zooms; a click (press + release without moving) is the punch / belly bump.
export interface Intent {
  moveX: number; // camera-relative strafe (-1..1)
  moveZ: number; // camera-relative forward (-1..1)
  /** run (true) or walk (false) */
  run: boolean;
  /** sprint (overrides run / walk) */
  sprint?: boolean;
  jump: boolean;
  punch: boolean;
  /** standalone kick (agent harness only; players kick as the third hit of the J combo) */
  kick: boolean;
  belly: boolean;
  interact: boolean;
  /** optional heading to face (agent harness: face a target while moving) */
  face?: number | null;
}
export const emptyIntent = (): Intent => ({ moveX: 0, moveZ: 0, run: false, jump: false, punch: false, kick: false, belly: false, interact: false });

/** a press shorter than this (ms) without moving more than CLICK_PX is a click, anything else a drag */
const CLICK_MS = 400;
const CLICK_PX = 5;

export class Input {
  keys = new Set<string>();
  private pressed = new Set<string>();
  /** accumulated mouse drag for the camera; held = a drag is in progress */
  look = { dx: 0, dy: 0, wheel: 0, held: false };
  /** walk mode, toggled with C */
  walkToggle = false;
  private press: { id: number; button: number; x: number; y: number; t: number; moved: boolean } | null = null;
  private clicks = new Set<number>();

  constructor(el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'KeyC' && !e.repeat) this.walkToggle = !this.walkToggle;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'AltLeft', 'AltRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.endPress();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (this.press) return; // chorded buttons: the first one owns the gesture
      this.press = { id: e.pointerId, button: e.button, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      // keep receiving the drag outside the canvas; this is not a pointer lock, the cursor stays free
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.press;
      if (!p || e.pointerId !== p.id) return;
      if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_PX) p.moved = true;
      if (p.moved) {
        this.look.dx += e.movementX;
        this.look.dy += e.movementY;
      }
      this.look.held = p.moved;
    });
    el.addEventListener('pointerup', (e) => {
      const p = this.press;
      if (!p || e.pointerId !== p.id) return;
      if (!p.moved && performance.now() - p.t < CLICK_MS) this.clicks.add(p.button);
      this.endPress();
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    });
    el.addEventListener('pointercancel', () => this.endPress());
    el.addEventListener('lostpointercapture', (e) => {
      if (this.press && e.pointerId === this.press.id) this.endPress();
    });
    el.addEventListener('wheel', (e) => {
      this.look.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  private endPress() {
    this.press = null;
    this.look.held = false;
  }

  /** true once per key press */
  hit(code: string) {
    return this.pressed.has(code);
  }
  intent(): Intent {
    const k = (c: string) => this.keys.has(c);
    const i = emptyIntent();
    i.moveZ = (k('KeyW') || k('ArrowUp') || k('KeyZ') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    i.moveX = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') || k('KeyQ') ? 1 : 0);
    i.sprint = k('ShiftLeft') || k('ShiftRight');
    const walk = this.walkToggle !== (k('AltLeft') || k('AltRight')); // Alt walks, or runs while walk mode is on
    i.run = !walk;
    i.jump = this.hit('Space');
    i.punch = this.hit('KeyJ') || this.clicks.has(0);
    i.kick = false;
    i.belly = this.hit('KeyK') || this.hit('KeyL') || this.clicks.has(2);
    i.interact = this.hit('Enter') || this.hit('NumpadEnter');
    return i;
  }
  endFrame() {
    this.pressed.clear();
    this.clicks.clear();
  }
}
