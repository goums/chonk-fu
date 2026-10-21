// Keyboard + mouse input for the human player. The agent harness bypasses this and writes Intents.
export interface Intent {
  moveX: number; // camera-relative strafe (-1..1)
  moveZ: number; // camera-relative forward (-1..1)
  run: boolean;
  jump: boolean;
  punch: boolean;
  kick: boolean;
  belly: boolean;
  interact: boolean;
  /** optional heading to face (agent harness: face a target while moving) */
  face?: number | null;
}
export const emptyIntent = (): Intent => ({ moveX: 0, moveZ: 0, run: false, jump: false, punch: false, kick: false, belly: false, interact: false });

export class Input {
  keys = new Set<string>();
  private pressed = new Set<string>();
  /** accumulated mouse drag for the camera */
  look = { dx: 0, dy: 0, wheel: 0 };
  private mouseDown = new Set<number>();
  private clicks = new Set<number>();

  constructor(el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      this.mouseDown.add(e.button);
      this.lockedBefore = document.pointerLockElement === el;
      this.clicks.add(e.button);
      if (document.pointerLockElement !== el && e.button === 0 && this.wantsLock) el.requestPointerLock?.();
    });
    addEventListener('pointerup', (e) => this.mouseDown.delete(e.button));
    addEventListener('pointermove', (e) => {
      if (document.pointerLockElement === el || this.mouseDown.has(2) || this.mouseDown.has(0)) {
        this.look.dx += e.movementX;
        this.look.dy += e.movementY;
      }
    });
    el.addEventListener('wheel', (e) => {
      this.look.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }
  wantsLock = true;
  private lockedBefore = false;

  /** true once per key press */
  hit(code: string) {
    return this.pressed.has(code);
  }
  intent(): Intent {
    const k = (c: string) => this.keys.has(c);
    const i = emptyIntent();
    i.moveZ = (k('KeyW') || k('ArrowUp') || k('KeyZ') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    i.moveX = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') || k('KeyQ') ? 1 : 0);
    i.run = !(k('ShiftLeft') || k('ShiftRight')); // running is the default, Shift walks
    i.jump = this.hit('Space');
    i.punch = this.hit('KeyJ') || (this.clicks.has(0) && this.lockedBefore);
    i.kick = this.hit('KeyK') || (this.clicks.has(2) && document.pointerLockElement != null);
    i.belly = this.hit('KeyL');
    i.interact = this.hit('KeyE') || this.hit('Enter');
    return i;
  }
  endFrame() {
    this.pressed.clear();
    this.clicks.clear();
  }
}
