import type { Input } from '@/game/game';

interface Stick {
  id: number | null;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

/**
 * Ovládanie: WASD / šípky + myš (mierenie, streľba, koliesko = zbraň), alebo dotyk —
 * ľavá polovica obrazovky = pohyb, pravá = mierenie a streľba (dve virtuálne páčky).
 */
export class Controls {
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, down: false, active: false };
  private wheel = 0;
  private select: number | null = null;
  private move: Stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  private aim: Stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  private lastAim = 0;
  touchMode = false;
  private cleanup: (() => void)[] = [];
  /** Volá sa pri prvom dotyku (zobrazí páčky). */
  onTouchMode: () => void = () => {};

  constructor(
    surface: HTMLElement,
    private readonly sticks: { move: HTMLElement; aim: HTMLElement },
  ) {
    const on = <K extends keyof WindowEventMap>(
      target: Window | HTMLElement,
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, options);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(window, 'keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key >= '1' && e.key <= '3') this.select = Number(e.key) - 1;
      if (e.key.toLowerCase() === 'q') this.wheel = -1;
      if (e.key.toLowerCase() === 'e') this.wheel = 1;
    });
    on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    on(window, 'blur', () => {
      this.keys.clear();
      this.mouse.down = false;
    });
    on(surface, 'pointerdown', (e) => {
      if (e.pointerType === 'touch') return this.touchStart(e);
      this.mouse.active = true;
      this.mouse.down = e.button === 0;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    on(window, 'pointermove', (e) => {
      if (e.pointerType === 'touch') return this.touchMove(e);
      this.mouse.active = true;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    on(window, 'pointerup', (e) => {
      if (e.pointerType === 'touch') return this.touchEnd(e);
      if (e.button === 0) this.mouse.down = false;
    });
    on(window, 'pointercancel', (e) => this.touchEnd(e));
    on(surface, 'wheel', (e) => (this.wheel = Math.sign(e.deltaY)), { passive: true });
    on(surface, 'contextmenu', (e) => e.preventDefault());
  }

  private touchStart(e: PointerEvent): void {
    if (!this.touchMode) {
      this.touchMode = true;
      this.onTouchMode();
    }
    const stick = e.clientX < window.innerWidth / 2 ? this.move : this.aim;
    if (stick.id !== null) return;
    stick.id = e.pointerId;
    stick.ox = stick.x = e.clientX;
    stick.oy = stick.y = e.clientY;
    this.drawStick(stick);
  }

  private touchMove(e: PointerEvent): void {
    for (const stick of [this.move, this.aim]) {
      if (stick.id !== e.pointerId) continue;
      stick.x = e.clientX;
      stick.y = e.clientY;
      this.drawStick(stick);
    }
  }

  private touchEnd(e: PointerEvent): void {
    for (const stick of [this.move, this.aim]) {
      if (stick.id !== e.pointerId) continue;
      stick.id = null;
      this.drawStick(stick);
    }
  }

  private static readonly RADIUS = 48;

  /** Vychýlenie páčky (-1..1) a či je aktívna. */
  private deflection(stick: Stick): { x: number; y: number; amount: number } {
    if (stick.id === null) return { x: 0, y: 0, amount: 0 };
    const dx = stick.x - stick.ox;
    const dy = stick.y - stick.oy;
    const len = Math.hypot(dx, dy);
    const amount = Math.min(1, len / Controls.RADIUS);
    return len < 1
      ? { x: 0, y: 0, amount: 0 }
      : { x: (dx / len) * amount, y: (dy / len) * amount, amount };
  }

  private drawStick(stick: Stick): void {
    const el = stick === this.move ? this.sticks.move : this.sticks.aim;
    if (stick.id === null) {
      el.style.display = 'none';
      return;
    }
    const d = this.deflection(stick);
    el.style.display = 'block';
    el.style.left = `${stick.ox}px`;
    el.style.top = `${stick.oy}px`;
    const knob = el.firstElementChild as HTMLElement | null;
    if (knob)
      knob.style.transform = `translate(${d.x * Controls.RADIUS}px, ${d.y * Controls.RADIUS}px)`;
  }

  /** Aktuálny stav ovládania; `toWorld` prevedie polohu myši na svet (mierenie). */
  read(
    player: { x: number; y: number },
    toWorld: (x: number, y: number) => { x: number; y: number },
  ): Input {
    let moveX = 0;
    let moveY = 0;
    let aim: number | null = null;
    let firing = false;
    if (this.touchMode) {
      const m = this.deflection(this.move);
      moveX = m.x;
      moveY = m.y;
      const a = this.deflection(this.aim);
      if (a.amount > 0.2) {
        aim = Math.atan2(a.y, a.x);
        this.lastAim = aim;
      } else if (m.amount > 0.3 && this.aim.id === null) {
        // Bez mierenia sa hráč pozerá smerom pohybu.
        aim = Math.atan2(m.y, m.x);
      } else aim = this.lastAim;
      firing = a.amount > 0.45;
    }
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) moveX -= 1;
    if (k.has('d') || k.has('arrowright')) moveX += 1;
    if (k.has('w') || k.has('arrowup')) moveY -= 1;
    if (k.has('s') || k.has('arrowdown')) moveY += 1;
    if (this.mouse.active && !this.touchMode) {
      const target = toWorld(this.mouse.x, this.mouse.y);
      aim = Math.atan2(target.y - player.y, target.x - player.x);
      firing = this.mouse.down || k.has(' ');
    }
    const input: Input = {
      moveX,
      moveY,
      aim,
      firing,
      switchWeapon: this.wheel !== 0 ? this.wheel : null,
      selectWeapon: this.select,
    };
    this.wheel = 0;
    this.select = null;
    return input;
  }

  /** Uvoľní všetky klávesy, tlačidlá a páčky (po pauze nič neostane „zaseknuté“). */
  reset(): void {
    this.keys.clear();
    this.mouse.down = false;
    for (const stick of [this.move, this.aim]) {
      stick.id = null;
      this.drawStick(stick);
    }
  }

  /** Dotykové tlačidlo zbrane. */
  nextWeapon(): void {
    this.wheel = 1;
  }

  destroy(): void {
    this.cleanup.forEach((fn) => fn());
  }
}
