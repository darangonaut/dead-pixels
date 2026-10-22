import { drawZombie } from '@/render/sprites';
import { pixelNoise } from '@/render/PixelCanvas';
import type { ZombieKind } from '@/game/game';

interface Walker {
  kind: ZombieKind;
  x: number;
  y: number;
  speed: number;
  dir: 1 | -1;
  step: number;
}

/**
 * Živé pozadie úvodnej obrazovky: nočná ulica, hojdajúci sa kužeľ baterky, ktorý
 * prechádza cez logo, a občas zombie, ktorá prejde cez obrazovku.
 */
export class TitleScene {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private dark = document.createElement('canvas');
  private darkCtx = this.dark.getContext('2d')!;
  private ground: HTMLCanvasElement | null = null;
  private frames = new Map<string, HTMLCanvasElement>();
  private walkers: Walker[] = [];
  private nextWalker = 1.5;
  private time = 0;
  private raf = 0;
  private last = 0;
  private scale = 3;
  private running = false;

  constructor(
    host: HTMLElement,
    private readonly logoImg: HTMLImageElement,
    private readonly logo: HTMLCanvasElement,
  ) {
    this.canvas.className = 'title-bg';
    host.prepend(this.canvas);
    for (const kind of ['walker', 'runner', 'brute'] as const)
      for (const f of [0, 1]) this.frames.set(`${kind}${f}`, drawZombie(kind, f).toCanvas());
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = this.dark.width = Math.round(w * dpr);
    this.canvas.height = this.dark.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.scale = Math.max(2, Math.round(Math.min(w, h) / 200)) * dpr;
    this.ground = this.paintGround();
  }

  /** Statická ulica v malom rozlíšení (zväčšuje sa po celých pixeloch). */
  private paintGround(): HTMLCanvasElement {
    const w = Math.ceil(this.canvas.width / this.scale);
    const h = Math.ceil(this.canvas.height / this.scale);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    const img = g.createImageData(w, h);
    const roadTop = Math.floor(h * 0.55);
    const roadBottom = Math.floor(h * 0.85);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const n = pixelNoise(x, y, 7);
        let color: number;
        if (y < roadTop - 10 || y > roadBottom + 10)
          color = 0x2a2830; // budovy / tma
        else if (y < roadTop || y > roadBottom)
          color = (x + (y % 2) * 8) % 16 === 0 ? 0x6a6f7c : 0x7d8290; // chodník
        else color = n < 0.05 ? 0x2a2d35 : n > 0.97 ? 0x40454f : 0x343842; // asfalt
        if (y === Math.floor((roadTop + roadBottom) / 2) && x % 12 < 6) color = 0xb59a3c;
        if (y === roadTop || y === roadBottom) color = 0x595d68;
        const i = (y * w + x) * 4;
        img.data[i] = (color >> 16) & 255;
        img.data[i + 1] = (color >> 8) & 255;
        img.data[i + 2] = color & 255;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    return c;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.canvas.style.display = 'block';
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.update(Math.min(0.1, (now - this.last) / 1000));
      this.last = now;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.canvas.style.display = 'none';
  }

  private update(dt: number): void {
    this.time += dt;
    this.nextWalker -= dt;
    const h = this.canvas.height / this.scale;
    const w = this.canvas.width / this.scale;
    if (this.nextWalker <= 0 && this.walkers.length < 3) {
      this.nextWalker = 4 + Math.random() * 6;
      const roll = Math.random();
      const kind: ZombieKind = roll < 0.15 ? 'runner' : roll < 0.25 ? 'brute' : 'walker';
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      this.walkers.push({
        kind,
        dir,
        x: dir === 1 ? -20 : w + 20,
        y: h * (0.6 + Math.random() * 0.22),
        speed: kind === 'runner' ? 45 : kind === 'brute' ? 12 : 16,
        step: 0,
      });
    }
    for (const z of this.walkers) {
      z.x += z.dir * z.speed * dt;
      z.step += dt * z.speed * 0.25;
    }
    this.walkers = this.walkers.filter((z) => z.x > -40 && z.x < w + 40);
  }

  private draw(): void {
    const { ctx, scale } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.imageSmoothingEnabled = false;
    if (this.ground)
      ctx.drawImage(this.ground, 0, 0, this.ground.width * scale, this.ground.height * scale);

    // Zombie (otočené v smere chôdze, kolíšu sa).
    for (const z of this.walkers) {
      const frame = this.frames.get(`${z.kind}${Math.floor(z.step) % 2}`)!;
      ctx.save();
      ctx.translate(Math.round(z.x * scale), Math.round(z.y * scale));
      ctx.rotate((z.dir === 1 ? 0 : Math.PI) + Math.sin(z.step * 2) * 0.08);
      ctx.drawImage(
        frame,
        (-frame.width / 2) * scale,
        (-frame.height / 2) * scale,
        frame.width * scale,
        frame.height * scale,
      );
      ctx.restore();
    }

    // Logo na mieste obrázka v rozložení (obrázok samotný je skrytý).
    const dpr = W / window.innerWidth;
    const r = this.logoImg.getBoundingClientRect();
    ctx.drawImage(this.logo, r.left * dpr, r.top * dpr, r.width * dpr, r.height * dpr);

    // Tma s kužeľom baterky: svieti zdola a pomaly sa hojdá cez logo.
    const d = this.darkCtx;
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, W, H);
    d.fillStyle = 'rgba(4, 3, 10, 0.9)';
    d.fillRect(0, 0, W, H);
    d.globalCompositeOperation = 'destination-out';
    const ox = W * 0.5 + Math.sin(this.time * 0.23) * W * 0.18;
    const oy = H * 1.05;
    const angle = -Math.PI / 2 + Math.sin(this.time * 0.6) * 0.55;
    const spread = 0.42;
    const reach = H * 1.15;
    const grad = d.createRadialGradient(ox, oy, 0, ox, oy, reach);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.75, 'rgba(0,0,0,0.85)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    d.fillStyle = grad;
    d.beginPath();
    d.moveTo(ox, oy);
    d.arc(ox, oy, reach, angle - spread / 2, angle + spread / 2);
    d.closePath();
    d.fill();
    // Mäkký okraj kužeľa (širší, slabší).
    d.globalAlpha = 0.35;
    d.beginPath();
    d.moveTo(ox, oy);
    d.arc(ox, oy, reach, angle - spread * 0.75, angle + spread * 0.75);
    d.closePath();
    d.fill();
    d.globalAlpha = 1;
    // Blikajúca lampa vľavo.
    const lampOn = Math.sin(this.time * 17) + Math.sin(this.time * 5.3) > -0.9;
    if (lampOn) {
      const lx = W * 0.14;
      const ly = H * 0.52;
      const lg = d.createRadialGradient(lx, ly, 0, lx, ly, H * 0.22);
      lg.addColorStop(0, 'rgba(0,0,0,0.75)');
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = lg;
      d.fillRect(0, 0, W, H);
    }
    ctx.drawImage(this.dark, 0, 0);
  }
}
