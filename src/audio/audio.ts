import type { GameEvent } from '@/game/game';

/**
 * Zvuky generované v prehliadači (Web Audio): výstrely, zásahy, zombie, predmety
 * a temný ambient. Žiadne zvukové súbory.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** Prehliadač povolí zvuk až po interakcii hráča. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    const length = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.ambient();
  }

  /** Pauza: zastaví všetky zvuky (aj ambient). */
  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  private burst(duration: number, freq: number, gain: number, q = 1, delay = 0): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5, duration + 0.05);
  }

  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    duration: number,
    gain: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  /** Temný ambient: dva rozladené nízke tóny a šum vetra. */
  private ambient(): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0.06;
    g.connect(this.master!);
    for (const f of [55, 55.7, 82.4]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 180;
      osc.connect(lp).connect(g);
      osc.start();
    }
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 400;
    bp.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0.5;
    wind.connect(bp).connect(wg).connect(g);
    wind.start();
  }

  play(events: GameEvent[], listener: { x: number; y: number }): void {
    if (!this.ctx || this.muted) return;
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          if (e.weapon === 'shotgun') {
            this.burst(0.35, 1800, 0.9, 0.7);
            this.tone('sine', 120, 40, 0.25, 0.5);
          } else if (e.weapon === 'smg') this.burst(0.07, 3000, 0.35);
          else {
            this.burst(0.14, 2600, 0.55);
            this.tone('square', 220, 60, 0.06, 0.08);
          }
          break;
        case 'hit':
          this.burst(0.06, 600, 0.25, 2);
          break;
        case 'kill':
          this.burst(0.18, 400, 0.35, 3);
          this.tone('sawtooth', 160, 60, 0.2, 0.08);
          break;
        case 'hurt':
          this.tone('square', 180, 80, 0.18, 0.18);
          this.burst(0.12, 900, 0.3);
          break;
        case 'groan': {
          const d = Math.hypot(e.x - listener.x, e.y - listener.y);
          const vol = Math.max(0, 1 - d / 240) * (e.kind === 'brute' ? 0.3 : 0.18);
          if (vol <= 0.01) break;
          const base = e.kind === 'brute' ? 70 : e.kind === 'runner' ? 160 : 110;
          this.tone('sawtooth', base * (0.9 + Math.random() * 0.2), base * 0.7, 0.7, vol);
          break;
        }
        case 'pickup':
          this.tone('square', 520, 880, 0.12, 0.12);
          break;
        case 'horde':
          // Rev hordy: nízky hukot a šum.
          this.tone('sawtooth', 90, 45, 1.4, 0.25);
          this.tone('sawtooth', 70, 38, 1.6, 0.18);
          this.burst(1.2, 260, 0.25, 1, 0.1);
          break;
        case 'gate':
          // Kovové zabuchnutie / zaškrípanie mreží.
          this.tone('square', e.open ? 300 : 140, e.open ? 520 : 70, 0.25, 0.12);
          this.burst(0.2, 1200, 0.3, 4);
          break;
        case 'cleared':
          this.tone('square', 392, 392, 0.12, 0.1);
          setTimeout(() => this.ctx && this.tone('square', 523, 523, 0.2, 0.1), 130);
          break;
        case 'levelComplete':
          this.tone('square', 392, 784, 0.6, 0.12);
          this.burst(1.5, 300, 0.2, 2);
          break;
        case 'explode':
          this.burst(0.8, 500, 1.0, 0.8);
          this.tone('sine', 90, 30, 0.6, 0.6);
          break;
        case 'spit':
          this.burst(0.12, 1800, 0.18, 6);
          break;
        case 'splash':
          this.burst(0.1, 900, 0.12, 3);
          break;
        case 'boss':
          this.tone('sawtooth', 70, 35, 2.2, 0.4);
          this.tone('square', 55, 30, 2.4, 0.2);
          break;
        case 'bossWindup':
          this.tone('sawtooth', 60, 140, 0.6, 0.3);
          break;
        case 'bossStun':
          this.burst(0.4, 400, 0.7, 1);
          break;
        case 'died':
          this.tone('sawtooth', 220, 50, 1.2, 0.25);
          break;
        case 'gameover':
          this.tone('sawtooth', 200, 30, 1.8, 0.3);
          break;
        default:
      }
    }
  }
}
