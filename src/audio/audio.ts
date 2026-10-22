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
  // --- Hudba ---
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private intensity = 0;
  private nextIntensity = 0;
  private step = 0;
  private nextTime = 0;

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

  /**
   * Dynamická hudba: 0 = pokoj (basa a riedke tóny), 1 = horda (bicie, basové ostinato),
   * 2 = boss (aj virbel a rýchle arpeggio). Zmena sa prejaví na začiatku taktu.
   */
  setIntensity(level: 0 | 1 | 2): void {
    this.nextIntensity = level;
  }

  /** Zapne / vypne hudbu (počas hry áno, v menu nie). */
  music(on: boolean): void {
    if (!this.ctx) return;
    if (on && this.musicTimer === null) {
      this.musicGain ??= this.ctx.createGain();
      this.musicGain.gain.value = 0.32;
      this.musicGain.connect(this.master!);
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.1;
      this.musicTimer = window.setInterval(() => this.schedule(), 40);
    } else if (!on && this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private schedule(): void {
    const ctx = this.ctx!;
    const bpm = [92, 126, 142][this.intensity]!;
    const sixteenth = 60 / bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.15) {
      const s = this.step % 16;
      if (s === 0) this.intensity = this.nextIntensity;
      this.playStep(s, this.nextTime, Math.floor(this.step / 16));
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  private note(
    type: OscillatorType,
    freq: number,
    t: number,
    duration: number,
    gain: number,
    filter = 0,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    let out: AudioNode = osc;
    if (filter) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = filter;
      osc.connect(lp);
      out = lp;
    }
    out.connect(g).connect(this.musicGain!);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  private drum(kind: 'kick' | 'hat' | 'snare', t: number): void {
    const ctx = this.ctx!;
    if (kind === 'kick') {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.8, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(g).connect(this.musicGain!);
      osc.start(t);
      osc.stop(t + 0.25);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7000 : 1800;
    const g = ctx.createGain();
    const len = kind === 'hat' ? 0.04 : 0.15;
    g.gain.setValueAtTime(kind === 'hat' ? 0.15 : 0.45, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f).connect(g).connect(this.musicGain!);
    src.start(t, Math.random() * 0.5, len + 0.02);
  }

  /** Jeden šestnástinový krok: A mol, temné tóny. */
  private playStep(s: number, t: number, bar: number): void {
    const A1 = 55;
    const level = this.intensity;
    if (level === 0) {
      // Pokoj: dlhá basa na začiatku taktu, občas vzdialený tón.
      if (s === 0) this.note('sawtooth', bar % 4 === 3 ? A1 * 1.189 : A1, t, 2.4, 0.18, 220);
      if (s === 8 && bar % 2 === 1)
        this.note('triangle', [440, 523, 659, 392][bar % 4]!, t, 1.2, 0.05);
      return;
    }
    // Horda / boss: bicie a basové ostinato.
    if (s % 4 === 0) this.drum('kick', t);
    if (s % 2 === 0) this.drum('hat', t);
    const bass = [A1, A1, A1 * 1.189, A1, A1, A1 * 1.335, A1 * 1.189, A1][s % 8]!;
    if (s % 2 === 0) this.note('square', bass, t, 0.18, 0.16, 500);
    if (level === 2) {
      if (s === 4 || s === 12) this.drum('snare', t);
      const arp = [440, 523, 659, 880, 659, 523][s % 6]!;
      this.note('square', arp, t, 0.08, 0.04, 2500);
    }
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
