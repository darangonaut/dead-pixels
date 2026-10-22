import { FlowField } from './flowfield';
import { castRay, lineOfSight, moveCircle, type Vec } from './geometry';
import {
  generateLevel,
  isSolid,
  setGate,
  Tile,
  TILE,
  tileAt,
  type CityMap,
  type Room,
} from './map';
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
  /** Zbadala hráča (inak sa pomaly túla). */
  aware: boolean;
  /** Úsek, v ktorom vznikla (pri návrate na kontrolný bod sa zruší). */
  room: number;
  wander: number;
}

export interface Pickup {
  id: number;
  kind: 'ammo' | 'health' | 'weapon';
  weapon?: WeaponId;
  x: number;
  y: number;
  age: number;
  /** Položené pri generovaní úrovne — nezmizne. */
  permanent: boolean;
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

/** Čo si hráč nesie do ďalšej úrovne. */
export interface Carry {
  weapon: WeaponId;
  ammo: Record<WeaponId, number>;
  owned: WeaponId[];
  score: number;
  kills: number;
  lives: number;
}

export interface Input {
  /** Pohyb (-1..1). */
  moveX: number;
  moveY: number;
  /** Smer mierenia (uhol v radiánoch) alebo null = nemeniť. */
  aim: number | null;
  firing: boolean;
  /** Prepnutie zbrane: +1 / -1, alebo null. */
  switchWeapon: number | null;
  selectWeapon: number | null;
}

export type GameEvent =
  | { type: 'shot'; weapon: WeaponId; x: number; y: number; angle: number; hits: Vec[] }
  | { type: 'hit'; x: number; y: number; angle: number; kind: ZombieKind }
  | { type: 'kill'; x: number; y: number; angle: number; kind: ZombieKind }
  | { type: 'hurt'; x: number; y: number }
  | { type: 'pickup'; kind: Pickup['kind']; weapon?: WeaponId }
  | { type: 'groan'; x: number; y: number; kind: ZombieKind }
  | { type: 'room'; room: number }
  | { type: 'horde'; room: number }
  | { type: 'cleared'; room: number }
  | { type: 'gate'; gate: number; open: boolean }
  | { type: 'died'; lives: number }
  | { type: 'respawn' }
  | { type: 'levelComplete'; level: number }
  | { type: 'gameover' };

export const PLAYER_RADIUS = 5;
const PLAYER_SPEED = 72;
const ZOMBIE_RADIUS = 5;
const MAX_HP = 100;
const AWARE_RANGE = 150;
const RESPAWN_DELAY = 1.6;

export const ZOMBIES: Readonly<
  Record<ZombieKind, { hp: number; speed: number; damage: number; score: number; radius: number }>
> = {
  walker: { hp: 3, speed: 24, damage: 10, score: 10, radius: ZOMBIE_RADIUS },
  runner: { hp: 2, speed: 58, damage: 7, score: 15, radius: ZOMBIE_RADIUS - 1 },
  brute: { hp: 14, speed: 18, damage: 25, score: 50, radius: ZOMBIE_RADIUS + 3 },
};

/** Zloženie hordy v úseku podľa úrovne. */
export function hordeComposition(level: number): Record<ZombieKind, number> {
  const total = 10 + level * 4;
  const runners = Math.floor(total * Math.min(0.45, 0.1 + level * 0.07));
  const brutes = level >= 2 ? Math.floor(level / 2) : 0;
  return { walker: total - runners - brutes, runner: runners, brute: brutes };
}

/**
 * Celý herný stav a simulácia jednej úrovne (bez grafiky). Renderer a zvuk reagujú
 * na `events`.
 */
export class Game {
  readonly map: CityMap;
  readonly player: Player;
  readonly level: number;
  zombies: Zombie[] = [];
  pickups: Pickup[] = [];
  readonly flow: FlowField;
  score: number;
  kills: number;
  lives: number;
  time = 0;
  over = false;
  complete = false;
  /** Úsek, v ktorom hráč práve je, a posledný kontrolný bod. */
  room = 0;
  checkpoint = 0;
  /** Úseky, ktorých udalosť už prebehla (horda vyčistená, túlavé zombie vypustené). */
  private started = new Set<number>();
  private cleared = new Set<number>();
  /** Odpočet do návratu na kontrolný bod po smrti (s). */
  respawn = 0;
  private hordeQueue: ZombieKind[] = [];
  private hordeRoom = -1;
  private spawnTimer = 0;
  private nextId = 1;
  private events: GameEvent[] = [];
  private readonly rng: () => number;
  private readonly hash = new SpatialHash<Zombie>(32);
  private readonly nearby: Zombie[] = [];
  private flowTimer = 0;
  private groanTimer = 2;

  constructor(seed: number, level = 1, carry?: Carry) {
    this.level = level;
    this.rng = createRng(seed ^ 0x51ed ^ level);
    this.map = generateLevel(seed, level);
    this.flow = new FlowField(this.map);
    this.score = carry?.score ?? 0;
    this.kills = carry?.kills ?? 0;
    this.lives = carry?.lives ?? 3;
    this.player = {
      x: this.map.spawn.x,
      y: this.map.spawn.y,
      angle: 0,
      hp: MAX_HP,
      weapon: carry?.weapon ?? 'pistol',
      ammo: carry ? { ...carry.ammo } : { pistol: Infinity, shotgun: 0, smg: 0 },
      owned: carry ? [...carry.owned] : ['pistol'],
      cooldown: 0,
      hurt: 0,
      step: 0,
    };
    // Zásoby položené v úsekoch.
    for (const room of this.map.rooms)
      for (const item of room.loot)
        this.pickups.push({
          id: this.nextId++,
          kind: item.kind,
          x: item.x,
          y: item.y,
          age: 0,
          permanent: true,
        });
    this.flow.update(this.player.x, this.player.y);
  }

  /** Stav na prenesenie do ďalšej úrovne (+1 život za dokončenie). */
  carry(): Carry {
    const p = this.player;
    return {
      weapon: p.weapon,
      ammo: { ...p.ammo },
      owned: [...p.owned],
      score: this.score,
      kills: this.kills,
      lives: this.lives + 1,
    };
  }

  takeEvents(): GameEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  get currentRoom(): Room {
    return this.map.rooms[this.room]!;
  }

  update(dt: number, input: Input): void {
    if (this.over || this.complete) return;
    this.time += dt;
    if (this.respawn > 0) {
      this.respawn -= dt;
      if (this.respawn <= 0) this.returnToCheckpoint();
      return;
    }
    this.hash.rebuild(this.zombies);
    this.updatePlayer(dt, input);
    this.updateRoom();
    this.flowTimer -= dt;
    if (this.flowTimer <= 0) {
      this.flowTimer = 0.2;
      this.flow.update(this.player.x, this.player.y);
    }
    this.updateHorde(dt);
    this.updateZombies(dt);
    this.updatePickups(dt);
    // Cieľ: heliport.
    const exit = this.map.exit;
    if (
      this.room === this.map.rooms.length - 1 &&
      Math.hypot(this.player.x - exit.x, this.player.y - exit.y) < 26
    ) {
      this.complete = true;
      this.events.push({ type: 'levelComplete', level: this.level });
    }
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
    // Výstrel prebudí zombie v okolí.
    for (const z of this.hash.near(p.x, p.y, 120, this.nearby)) z.aware = true;
  }

  /** Strela: prvá zombie na lúči do steny. Vráti bod dopadu. */
  private hitscan(from: Vec, angle: number, range: number, damage: number, knockback: number): Vec {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const wall = castRay(this.map, from.x, from.y, dx, dy, range, isSolidForBullets);
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
      best.aware = true;
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
    this.score += ZOMBIES[z.kind].score * this.level;
    this.events.push({ type: 'kill', x: z.x, y: z.y, angle, kind: z.kind });
    const dropChance = z.kind === 'brute' ? 1 : 0.07;
    if (this.rng() < dropChance) this.drop(z.x, z.y);
  }

  private drop(x: number, y: number): void {
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
      x,
      y,
      age: 0,
      permanent: false,
    });
  }

  // --- Úseky: vstup, horda, kontrolný bod ---

  private updateRoom(): void {
    const { map, player } = this;
    const tx = Math.floor(player.x / TILE);
    const ty = Math.floor(player.y / TILE);
    const index = map.roomOf[ty * map.width + tx] ?? -1;
    if (index < 0 || index === this.room) return;
    const room = map.rooms[index]!;
    // Do úseku sa počíta až za bránou (nie na prahu).
    if (tx < room.x0 || tx > room.x1 || ty < room.y0 || ty > room.y1) return;
    this.room = index;
    this.events.push({ type: 'room', room: index });
    if (index > this.checkpoint) this.checkpoint = index;
    this.startRoom(room);
  }

  /** Spustí udalosť úseku (raz): vypustí túlavé zombie, pri horde zavrie bránu za hráčom. */
  private startRoom(room: Room): void {
    if (this.started.has(room.index)) return;
    this.started.add(room.index);
    for (const r of room.roamers) {
      const z = this.spawnZombie(r.kind, r.x, r.y, room.index);
      z.aware = false;
    }
    if (room.encounter === 'horde' && !this.cleared.has(room.index)) {
      if (room.doorIn !== null) this.setGate(room.doorIn, false);
      const comp = hordeComposition(this.level);
      this.hordeQueue = [];
      for (const kind of ['walker', 'runner', 'brute'] as const)
        for (let i = 0; i < comp[kind]; i++) this.hordeQueue.push(kind);
      for (let i = this.hordeQueue.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [this.hordeQueue[i], this.hordeQueue[j]] = [this.hordeQueue[j]!, this.hordeQueue[i]!];
      }
      this.hordeRoom = room.index;
      this.spawnTimer = 1;
      this.events.push({ type: 'horde', room: room.index });
    }
  }

  private setGate(id: number, open: boolean): void {
    if (this.map.gates[id]?.open === open) return;
    setGate(this.map, id, open);
    this.events.push({ type: 'gate', gate: id, open });
  }

  private updateHorde(dt: number): void {
    if (this.hordeRoom < 0) return;
    const room = this.map.rooms[this.hordeRoom]!;
    if (this.hordeQueue.length > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = Math.max(0.25, 0.8 - this.level * 0.05);
        const kind = this.hordeQueue.pop()!;
        const at = this.spawnPoint(room);
        if (at) this.spawnZombie(kind, at.x, at.y, room.index).aware = true;
        else this.hordeQueue.push(kind);
      }
      return;
    }
    if (this.zombies.some((z) => z.room === room.index)) return;
    // Úsek vyčistený: brány sa otvoria a v strede zostane odmena.
    this.cleared.add(room.index);
    this.hordeRoom = -1;
    if (room.doorIn !== null) this.setGate(room.doorIn, true);
    if (room.doorOut !== null) this.setGate(room.doorOut, true);
    const cx = ((room.x0 + room.x1 + 1) / 2) * TILE;
    const cy = ((room.y0 + room.y1 + 1) / 2) * TILE;
    this.drop(cx, cy);
    this.score += 100 * this.level;
    this.events.push({ type: 'cleared', room: room.index });
  }

  /** Miesto zrodu hordy: voľné políčko v úseku ďaleko od hráča, najlepšie mimo dohľadu. */
  private spawnPoint(room: Room): Vec | null {
    let fallback: Vec | null = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const tx = room.x0 + Math.floor(this.rng() * (room.x1 - room.x0 + 1));
      const ty = room.y0 + Math.floor(this.rng() * (room.y1 - room.y0 + 1));
      if (isSolid(this.map, tx, ty)) continue;
      const at = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      const d = Math.hypot(at.x - this.player.x, at.y - this.player.y);
      if (d < 90) continue;
      fallback ??= at;
      if (!lineOfSight(this.map, this.player, at)) return at;
    }
    return fallback;
  }

  spawnZombie(kind: ZombieKind, x: number, y: number, room = this.room): Zombie {
    const z: Zombie = {
      id: this.nextId++,
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      hp: ZOMBIES[kind].hp,
      angle: this.rng() * Math.PI * 2,
      cooldown: 0,
      stagger: 0,
      step: this.rng() * 10,
      aware: true,
      room,
      wander: 0,
    };
    this.zombies.push(z);
    return z;
  }

  // --- Smrť a kontrolný bod ---

  private die(): void {
    this.lives--;
    this.events.push({ type: 'died', lives: this.lives });
    if (this.lives <= 0) {
      this.over = true;
      this.events.push({ type: 'gameover' });
      return;
    }
    this.respawn = RESPAWN_DELAY;
  }

  /** Návrat na začiatok úseku s kontrolným bodom: úsek sa obnoví, zombie v ňom zmiznú. */
  private returnToCheckpoint(): void {
    const room = this.map.rooms[this.checkpoint]!;
    const p = this.player;
    p.hp = MAX_HP;
    p.hurt = 1;
    p.x = room.entry.x;
    p.y = room.entry.y;
    this.score = Math.floor(this.score * 0.85);
    // Zombie z tohto a ďalších úsekov preč; úsek začne odznova.
    this.zombies = this.zombies.filter((z) => z.room < this.checkpoint);
    for (const r of this.map.rooms)
      if (r.index >= this.checkpoint) {
        this.started.delete(r.index);
        if (!this.cleared.has(r.index) && r.encounter === 'horde') {
          if (r.doorIn !== null) this.setGate(r.doorIn, true);
          if (r.doorOut !== null) this.setGate(r.doorOut, false);
        }
      }
    this.hordeQueue = [];
    this.hordeRoom = -1;
    this.room = -1;
    this.flow.targetTile = -1;
    this.updateRoom();
    this.events.push({ type: 'respawn' });
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
      if (!z.aware && dist < AWARE_RANGE && lineOfSight(this.map, z, p)) z.aware = true;
      let ax = 0;
      let ay = 0;
      let speed = def.speed;
      if (z.aware) {
        // Blízko a na dohľad: rovno k hráčovi, inak po mape vzdialeností.
        let dir: Vec | null =
          dist < 70 && lineOfSight(this.map, z, p)
            ? { x: toX / dist, y: toY / dist }
            : this.flow.direction(z.x, z.y);
        if (!dir && dist > 0) dir = { x: toX / dist, y: toY / dist };
        if (dir) {
          ax = dir.x;
          ay = dir.y;
          z.angle = Math.atan2(dir.y, dir.x);
        }
      } else {
        // Túlanie: pomaly jedným smerom, občas zmena.
        z.wander -= dt;
        if (z.wander <= 0) {
          z.wander = 1.5 + this.rng() * 3;
          z.angle = this.rng() < 0.3 ? z.angle : this.rng() * Math.PI * 2;
        }
        ax = Math.cos(z.angle);
        ay = Math.sin(z.angle);
        speed *= 0.35;
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
      if (z.stagger > 0) speed *= 0.2;
      z.stagger = Math.max(0, z.stagger - dt);
      z.vx *= Math.exp(-10 * dt);
      z.vy *= Math.exp(-10 * dt);
      moveCircle(this.map, z, def.radius, (ax * speed + z.vx) * dt, (ay * speed + z.vy) * dt);
      z.step += dt * speed * 0.25;

      // Útok.
      z.cooldown = Math.max(0, z.cooldown - dt);
      if (dist < def.radius + PLAYER_RADIUS + 2 && z.cooldown === 0 && this.respawn <= 0) {
        z.cooldown = 0.8;
        z.aware = true;
        if (p.hurt === 0) {
          p.hp -= def.damage;
          p.hurt = 0.35;
          this.events.push({ type: 'hurt', x: p.x, y: p.y });
          if (p.hp <= 0) {
            p.hp = 0;
            this.die();
            return;
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
      if (!item.permanent && item.age > 30) return false;
      if (Math.hypot(item.x - p.x, item.y - p.y) > 11) return true;
      if (item.kind === 'health') {
        if (p.hp >= MAX_HP) return true; // plné zdravie: nechať na neskôr
        p.hp = Math.min(MAX_HP, p.hp + 35);
      } else if (item.kind === 'weapon' && item.weapon) {
        if (!p.owned.includes(item.weapon)) p.owned.push(item.weapon);
        p.ammo[item.weapon] += WEAPONS[item.weapon].ammoPack;
        p.weapon = item.weapon;
      } else {
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

  /** Zombie zostávajúce v aktívnej horde (na scéne + čakajúce), inak null. */
  get hordeRemaining(): number | null {
    if (this.hordeRoom < 0) return null;
    return this.hordeQueue.length + this.zombies.filter((z) => z.room === this.hordeRoom).length;
  }

  /** Kam ísť ďalej: otvorená výstupná brána aktuálneho úseku alebo heliport. */
  get objective(): Vec | null {
    const room = this.map.rooms[this.room];
    if (!room) return null;
    if (room.encounter === 'exit') return this.map.exit;
    if (room.doorOut === null) return null;
    const gate = this.map.gates[room.doorOut]!;
    return gate.open ? gate : null;
  }
}

/** Strely zastavia pevné prekážky okrem stromov a lámp (tie sú tenké). */
function isSolidForBullets(map: CityMap, tx: number, ty: number): boolean {
  return isSolid(map, tx, ty) && !isThin(map, tx, ty);
}

function isThin(map: CityMap, tx: number, ty: number): boolean {
  const t = tileAt(map, tx, ty);
  // Cez stromy, lampy a mreže brány sa dá strieľať.
  return t === Tile.Tree || t === Tile.Lamp || t === Tile.Gate;
}
