import { FlowField, UNREACHABLE } from './flowfield';
import { castRay, lineOfSight, moveCircle, type Vec } from './geometry';
import { generateCity, isSolid, TILE, type CityMap } from './map';
import { createRng } from './rng';
import { SpatialHash } from './spatial';
import { WEAPON_ORDER, WEAPONS, type WeaponId } from './weapons';

export type ZombieKind = 'walker' | 'runner' | 'brute';

export interface Zombie {
  id: number;
  kind: ZombieKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  angle: number;
  /** Čas do ďalšieho úderu (s). */
  cooldown: number;
  /** Po zásahu krátko zakolíše (s). */
  stagger: number;
  /** Fáza animácie chôdze. */
  step: number;
}

export interface Pickup {
  id: number;
  kind: 'ammo' | 'health' | 'weapon';
  weapon?: WeaponId;
  x: number;
  y: number;
  age: number;
}

export interface Player {
  x: number;
  y: number;
  angle: number;
  hp: number;
  weapon: WeaponId;
  ammo: Record<WeaponId, number>;
  owned: WeaponId[];
  cooldown: number;
  /** Krátka nezraniteľnosť po zásahu (s). */
  hurt: number;
  step: number;
}

export interface Input {
  /** Pohyb (-1..1). */
  moveX: number;
  moveY: number;
  /** Smer mierenia (uhol v radiánoch) alebo null = nemeniť. */
  aim: number | null;
  firing: boolean;
  /** Prepnutie zbrane: +1 / -1 / priamo index, alebo null. */
  switchWeapon: number | null;
  selectWeapon: number | null;
}

export type GameEvent =
  | { type: 'shot'; weapon: WeaponId; x: number; y: number; angle: number; hits: Vec[] }
  | { type: 'hit'; x: number; y: number; angle: number; kind: ZombieKind }
  | { type: 'kill'; x: number; y: number; angle: number; kind: ZombieKind }
  | { type: 'hurt'; x: number; y: number }
  | { type: 'pickup'; kind: Pickup['kind']; weapon?: WeaponId }
  | { type: 'wave'; wave: number }
  | { type: 'groan'; x: number; y: number; kind: ZombieKind }
  | { type: 'gameover' };

export const PLAYER_RADIUS = 5;
const PLAYER_SPEED = 72;
const ZOMBIE_RADIUS = 5;
const MAX_HP = 100;

export const ZOMBIES: Readonly<
  Record<ZombieKind, { hp: number; speed: number; damage: number; score: number; radius: number }>
> = {
  walker: { hp: 3, speed: 24, damage: 10, score: 10, radius: ZOMBIE_RADIUS },
  runner: { hp: 2, speed: 58, damage: 7, score: 15, radius: ZOMBIE_RADIUS - 1 },
  brute: { hp: 14, speed: 18, damage: 25, score: 50, radius: ZOMBIE_RADIUS + 3 },
};

/** Zloženie vlny: počet a podiely druhov rastú s číslom vlny. */
export function waveComposition(wave: number): Record<ZombieKind, number> {
  const total = 8 + wave * 6;
  const runners = Math.floor(total * Math.min(0.45, 0.05 + wave * 0.06));
  const brutes = wave >= 3 ? Math.floor(wave / 2) : 0;
  return { walker: total - runners - brutes, runner: runners, brute: brutes };
}

/**
 * Celý herný stav a simulácia (bez grafiky). Renderer a zvuk reagujú na `events`.
 */
export class Game {
  readonly map: CityMap;
  readonly player: Player;
  zombies: Zombie[] = [];
  pickups: Pickup[] = [];
  readonly flow: FlowField;
  wave = 0;
  score = 0;
  kills = 0;
  time = 0;
  over = false;
  /** Odpočet do ďalšej vlny (s); počas vlny 0. */
  intermission = 3;
  private toSpawn: ZombieKind[] = [];
  private spawnTimer = 0;
  private nextId = 1;
  private events: GameEvent[] = [];
  private readonly rng: () => number;
  private readonly hash = new SpatialHash<Zombie>(32);
  private readonly nearby: Zombie[] = [];
  private flowTimer = 0;
  private groanTimer = 2;

  constructor(seed: number) {
    this.rng = createRng(seed ^ 0x51ed);
    this.map = generateCity(seed);
    this.flow = new FlowField(this.map);
    this.player = {
      x: this.map.spawn.x,
      y: this.map.spawn.y,
      angle: 0,
      hp: MAX_HP,
      weapon: 'pistol',
      ammo: { pistol: Infinity, shotgun: 0, smg: 0 },
      owned: ['pistol'],
      cooldown: 0,
      hurt: 0,
      step: 0,
    };
    this.flow.update(this.player.x, this.player.y);
  }

  takeEvents(): GameEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  update(dt: number, input: Input): void {
    if (this.over) return;
    this.time += dt;
    this.hash.rebuild(this.zombies);
    this.updatePlayer(dt, input);
    this.flowTimer -= dt;
    if (this.flowTimer <= 0) {
      this.flowTimer = 0.2;
      this.flow.update(this.player.x, this.player.y);
    }
    this.updateWaves(dt);
    this.updateZombies(dt);
    this.updatePickups(dt);
  }

  // --- Hráč ---

  private updatePlayer(dt: number, input: Input): void {
    const p = this.player;
    let mx = input.moveX;
    let my = input.moveY;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    if (len > 0.05) p.step += dt * 10 * Math.min(1, len);
    moveCircle(this.map, p, PLAYER_RADIUS, mx * PLAYER_SPEED * dt, my * PLAYER_SPEED * dt);
    if (input.aim !== null) p.angle = input.aim;
    p.hurt = Math.max(0, p.hurt - dt);

    if (input.selectWeapon !== null) {
      const id = WEAPON_ORDER[input.selectWeapon];
      if (id && p.owned.includes(id)) p.weapon = id;
    }
    if (input.switchWeapon !== null && p.owned.length > 1) {
      const i = p.owned.indexOf(p.weapon);
      p.weapon = p.owned[(i + input.switchWeapon + p.owned.length) % p.owned.length]!;
    }
    // Prázdna zbraň: späť na pištoľ.
    if (p.ammo[p.weapon] <= 0) p.weapon = 'pistol';

    p.cooldown = Math.max(0, p.cooldown - dt);
    if (input.firing && p.cooldown === 0) this.fire();
  }

  private fire(): void {
    const p = this.player;
    const weapon = WEAPONS[p.weapon];
    p.cooldown = 1 / weapon.rate;
    if (Number.isFinite(p.ammo[p.weapon])) p.ammo[p.weapon]--;
    const muzzle = { x: p.x + Math.cos(p.angle) * 7, y: p.y + Math.sin(p.angle) * 7 };
    const hits: Vec[] = [];
    for (let i = 0; i < weapon.pellets; i++) {
      const angle = p.angle + (this.rng() - 0.5) * weapon.spread;
      hits.push(this.hitscan(muzzle, angle, weapon.range, weapon.damage, weapon.knockback));
    }
    this.events.push({
      type: 'shot',
      weapon: p.weapon,
      x: muzzle.x,
      y: muzzle.y,
      angle: p.angle,
      hits,
    });
  }

  /** Strela: prvá zombie na lúči do steny. Vráti bod dopadu. */
  private hitscan(from: Vec, angle: number, range: number, damage: number, knockback: number): Vec {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const wall = castRay(this.map, from.x, from.y, dx, dy, range);
    let best: Zombie | null = null;
    let bestT = wall;
    for (const z of this.hash.near(
      from.x + (dx * wall) / 2,
      from.y + (dy * wall) / 2,
      wall / 2 + 10,
      this.nearby,
    )) {
      if (z.hp <= 0) continue; // už zabitá iným brokom
      const r = ZOMBIES[z.kind].radius + 1;
      // Priesečník lúča s kruhom.
      const ox = z.x - from.x;
      const oy = z.y - from.y;
      const t = ox * dx + oy * dy;
      if (t < 0 || t > bestT) continue;
      const d2 = ox * ox + oy * oy - t * t;
      if (d2 > r * r) continue;
      best = z;
      bestT = t;
    }
    if (best) {
      best.hp -= damage;
      best.stagger = 0.12;
      best.vx += dx * knockback * 20;
      best.vy += dy * knockback * 20;
      if (best.hp <= 0) this.killZombie(best, angle);
      else this.events.push({ type: 'hit', x: best.x, y: best.y, angle, kind: best.kind });
    }
    return { x: from.x + dx * bestT, y: from.y + dy * bestT };
  }

  private killZombie(z: Zombie, angle: number): void {
    this.zombies = this.zombies.filter((other) => other !== z);
    this.kills++;
    this.score += ZOMBIES[z.kind].score * (1 + Math.floor(this.wave / 3));
    this.events.push({ type: 'kill', x: z.x, y: z.y, angle, kind: z.kind });
    // Občas niečo vypadne.
    const roll = this.rng();
    const dropChance = z.kind === 'brute' ? 1 : 0.08;
    if (roll < dropChance) {
      const p = this.player;
      const missing = WEAPON_ORDER.find((w) => !p.owned.includes(w));
      const kind: Pickup['kind'] =
        missing && this.rng() < 0.35
          ? 'weapon'
          : p.hp < MAX_HP * 0.6 && this.rng() < 0.4
            ? 'health'
            : 'ammo';
      this.pickups.push({
        id: this.nextId++,
        kind,
        weapon: kind === 'weapon' ? missing : undefined,
        x: z.x,
        y: z.y,
        age: 0,
      });
    }
  }

  // --- Vlny ---

  private updateWaves(dt: number): void {
    if (this.intermission > 0) {
      this.intermission -= dt;
      if (this.intermission <= 0) {
        this.intermission = 0;
        this.wave++;
        const comp = waveComposition(this.wave);
        this.toSpawn = [];
        for (const kind of ['walker', 'runner', 'brute'] as const)
          for (let i = 0; i < comp[kind]; i++) this.toSpawn.push(kind);
        // Premiešať poradie.
        for (let i = this.toSpawn.length - 1; i > 0; i--) {
          const j = Math.floor(this.rng() * (i + 1));
          [this.toSpawn[i], this.toSpawn[j]] = [this.toSpawn[j]!, this.toSpawn[i]!];
        }
        this.events.push({ type: 'wave', wave: this.wave });
      }
      return;
    }
    if (this.toSpawn.length > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = Math.max(0.15, 0.9 - this.wave * 0.06);
        const kind = this.toSpawn.pop()!;
        const at = this.spawnPoint();
        if (at) this.spawnZombie(kind, at.x, at.y);
        else this.toSpawn.push(kind);
      }
    } else if (this.zombies.length === 0) {
      this.intermission = 6;
    }
  }

  /** Miesto zrodu: dostupné políčko ďaleko od hráča a mimo jeho výhľadu. */
  private spawnPoint(): Vec | null {
    const { width, height } = this.map;
    for (let attempt = 0; attempt < 40; attempt++) {
      const tx = Math.floor(this.rng() * width);
      const ty = Math.floor(this.rng() * height);
      if (isSolid(this.map, tx, ty)) continue;
      const d = this.flow.dist[ty * width + tx]!;
      if (d === UNREACHABLE || d < 16 || d > 45) continue;
      const at = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      if (
        lineOfSight(this.map, this.player, at) &&
        Math.hypot(at.x - this.player.x, at.y - this.player.y) < 260
      )
        continue;
      return at;
    }
    return null;
  }

  spawnZombie(kind: ZombieKind, x: number, y: number): Zombie {
    const z: Zombie = {
      id: this.nextId++,
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      hp: ZOMBIES[kind].hp,
      angle: 0,
      cooldown: 0,
      stagger: 0,
      step: this.rng() * 10,
    };
    this.zombies.push(z);
    return z;
  }

  // --- Zombie ---

  private updateZombies(dt: number): void {
    const p = this.player;
    this.groanTimer -= dt;
    for (const z of this.zombies) {
      const def = ZOMBIES[z.kind];
      const toX = p.x - z.x;
      const toY = p.y - z.y;
      const dist = Math.hypot(toX, toY);
      // Blízko a na dohľad: rovno k hráčovi, inak po mape vzdialeností.
      let dir: Vec | null =
        dist < 70 && lineOfSight(this.map, z, p)
          ? { x: toX / dist, y: toY / dist }
          : this.flow.direction(z.x, z.y);
      if (!dir && dist > 0) dir = { x: toX / dist, y: toY / dist };
      let ax = 0;
      let ay = 0;
      if (dir) {
        ax = dir.x;
        ay = dir.y;
      }
      // Oddeľovanie od ostatných (horda sa rozprestrie).
      for (const o of this.hash.near(z.x, z.y, 14, this.nearby)) {
        if (o === z) continue;
        const ox = z.x - o.x;
        const oy = z.y - o.y;
        const d = Math.hypot(ox, oy);
        const min = def.radius + ZOMBIES[o.kind].radius;
        if (d > 0 && d < min) {
          ax += (ox / d) * (min - d) * 0.25;
          ay += (oy / d) * (min - d) * 0.25;
        }
      }
      const speed = z.stagger > 0 ? def.speed * 0.2 : def.speed;
      z.stagger = Math.max(0, z.stagger - dt);
      // Odhodenie postupne doznieva.
      z.vx *= Math.exp(-10 * dt);
      z.vy *= Math.exp(-10 * dt);
      moveCircle(this.map, z, def.radius, (ax * speed + z.vx) * dt, (ay * speed + z.vy) * dt);
      if (dir) z.angle = Math.atan2(dir.y, dir.x);
      z.step += dt * speed * 0.25;

      // Útok.
      z.cooldown = Math.max(0, z.cooldown - dt);
      if (dist < def.radius + PLAYER_RADIUS + 2 && z.cooldown === 0) {
        z.cooldown = 0.8;
        if (p.hurt === 0) {
          p.hp -= def.damage;
          p.hurt = 0.35;
          this.events.push({ type: 'hurt', x: p.x, y: p.y });
          if (p.hp <= 0) {
            p.hp = 0;
            this.over = true;
            this.events.push({ type: 'gameover' });
          }
        }
      }
      if (this.groanTimer <= 0 && dist < 220 && this.rng() < 0.05) {
        this.groanTimer = 1.2 + this.rng() * 2;
        this.events.push({ type: 'groan', x: z.x, y: z.y, kind: z.kind });
      }
    }
  }

  // --- Predmety ---

  private updatePickups(dt: number): void {
    const p = this.player;
    for (const item of this.pickups) item.age += dt;
    this.pickups = this.pickups.filter((item) => {
      if (item.age > 30) return false;
      if (Math.hypot(item.x - p.x, item.y - p.y) > 11) return true;
      if (item.kind === 'health') p.hp = Math.min(MAX_HP, p.hp + 35);
      else if (item.kind === 'weapon' && item.weapon) {
        if (!p.owned.includes(item.weapon)) p.owned.push(item.weapon);
        p.ammo[item.weapon] += WEAPONS[item.weapon].ammoPack;
        p.weapon = item.weapon;
      } else {
        // Náboje do zbraní, ktoré hráč má (okrem pištole).
        for (const w of p.owned)
          if (w !== 'pistol') p.ammo[w] += Math.ceil(WEAPONS[w].ammoPack / 2);
        if (p.owned.length === 1) this.score += 25;
      }
      this.events.push({ type: 'pickup', kind: item.kind, weapon: item.weapon });
      return false;
    });
  }

  get maxHp(): number {
    return MAX_HP;
  }

  /** Zostávajúce zombie vo vlne (na scéne + čakajúce). */
  get remaining(): number {
    return this.zombies.length + this.toSpawn.length;
  }
}
