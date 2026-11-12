import { describe, expect, it } from 'vitest';
import { castRay, lineOfSight } from '@/game/geometry';
import { Tile, TILE } from '@/game/map';
import { BATTERY_LOW, Game, type Carry, type GameEvent, type Input } from '@/game/game';
import { parseSave, serializeSave } from '@/game/save';
import { buy, NO_UPGRADES } from '@/game/shop';

const idle: Input = {
  moveX: 0,
  moveY: 0,
  aim: null,
  firing: false,
  switchWeapon: null,
  selectWeapon: null,
};

/** Voľný smer od hráča (aspoň `dist` px bez prekážky). */
function freeDirection(game: Game, dist: number): number {
  const p = game.player;
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    if (castRay(game.map, p.x, p.y, Math.cos(a), Math.sin(a), dist + 10) >= dist + 10) return a;
  }
  throw new Error('hráč nemá voľný smer');
}

/** Hra s voľným priestorom aspoň `dist` px od štartu a ten smer. */
function openGame(dist: number, level = 2): { game: Game; a: number } {
  for (let seed = 1; seed < 40; seed++) {
    const game = new Game(seed, level);
    try {
      return { game, a: freeDirection(game, dist) };
    } catch {
      // ďalšie semienko
    }
  }
  throw new Error('nenašla sa hra s voľným priestorom');
}

function step(game: Game, input: Input, seconds = 1 / 60): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    game.update(1 / 60, input);
    events.push(...game.takeEvents());
  }
  return events;
}

const at = (game: Game, a: number, d: number) => ({
  x: game.player.x + Math.cos(a) * d,
  y: game.player.y + Math.sin(a) * d,
});

describe('hluk', () => {
  it('výstrel z pištole: blízke zombie zbystria, vzdialenejšie prídu preskúmať, ďaleké nič', () => {
    const { game, a } = openGame(210);
    const p = game.player;
    p.light = false;
    const spawn = (d: number) => {
      const pos = at(game, a, d);
      const z = game.spawnZombie('walker', pos.x, pos.y);
      z.aware = false;
      return z;
    };
    const near = spawn(50);
    const mid = spawn(120);
    const far = spawn(200);
    // Strieľa opačným smerom (zombie za chrbtom).
    const events = step(game, { ...idle, aim: a + Math.PI, firing: true });
    expect(events.some((e) => e.type === 'noise' && e.radius === 150)).toBe(true);
    expect(near.aware).toBe(true);
    expect(mid.aware).toBe(false);
    expect(mid.lure).not.toBeNull();
    expect(far.aware).toBe(false);
    expect(far.lure).toBeNull();
  });

  it('pajcer je tichý a nič netušiacu zombie zloží jedným úderom', () => {
    const { game, a } = openGame(130);
    const p = game.player;
    p.light = false;
    p.weapon = 'crowbar';
    expect(p.owned).toContain('crowbar');
    const pos = at(game, a, 120);
    const listener = game.spawnZombie('walker', pos.x, pos.y);
    listener.aware = false;
    const close = at(game, a, 14);
    const victim = game.spawnZombie('walker', close.x, close.y);
    victim.aware = false;
    const scoreBefore = game.score;
    const events = step(game, { ...idle, aim: a, firing: true });
    expect(events.some((e) => e.type === 'takedown')).toBe(true);
    expect(events.some((e) => e.type === 'noise')).toBe(false);
    expect(game.zombies.includes(victim)).toBe(false);
    expect(game.score).toBeGreaterThan(scoreBefore);
    expect(listener.aware).toBe(false);
    expect(listener.lure).toBeNull();
  });

  it('obra pajcer nezloží naraz, len zraní', () => {
    const { game, a } = openGame(40);
    const p = game.player;
    p.weapon = 'crowbar';
    const pos = at(game, a, 16);
    const brute = game.spawnZombie('brute', pos.x, pos.y);
    step(game, { ...idle, aim: a, firing: true });
    expect(game.zombies.includes(brute)).toBe(true);
    expect(brute.hp).toBeLessThan(brute.maxHp);
  });

  it('kroky počuť aj cez stenu, plíženie je tiché', () => {
    // Medzi hráča a zombie postavíme stenu (3 políčka naprieč), takže ho nevidí.
    const { game, a } = openGame(60);
    const p = game.player;
    const map = game.map;
    const wall = at(game, a, 20);
    const wx = Math.floor(wall.x / TILE);
    const wy = Math.floor(wall.y / TILE);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const i = (wy + dy) * map.width + wx + dx;
        const tx = wx + dx;
        const ty = wy + dy;
        if (Math.hypot((tx + 0.5) * TILE - p.x, (ty + 0.5) * TILE - p.y) > 12)
          map.tiles[i] = Tile.Building;
      }
    map.revision++;
    const { x, y } = at(game, a, 40);
    expect(lineOfSight(map, p, { x, y })).toBe(false);
    const z = game.spawnZombie('walker', x, y);
    z.aware = false;
    z.wander = 99;
    z.angle = a + Math.PI; // tlačí sa do steny, zostane blízko
    const home = { x: p.x, y: p.y };
    // Prešľapuje na mieste: plíženie nič, normálne kroky ju prilákajú.
    for (let i = 0; i < 10; i++) {
      step(game, { ...idle, moveX: 0.2, sneak: true }, 0.05);
      p.x = home.x;
      p.y = home.y;
    }
    expect(z.lure).toBeNull();
    expect(z.aware).toBe(false);
    for (let i = 0; i < 10; i++) {
      step(game, { ...idle, moveX: 0.2 }, 0.05);
      p.x = home.x;
      p.y = home.y;
    }
    expect(z.lure !== null || z.aware).toBe(true);
  });
});

describe('zbadanie', () => {
  it('v tme a pri plížení si zombie hráča všimne len zblízka, svetlo do tváre zďaleka', () => {
    const { game, a } = openGame(170);
    const p = game.player;
    p.light = false;
    const pos = at(game, a, 50);
    const z = game.spawnZombie('walker', pos.x, pos.y);
    z.aware = false;
    z.wander = 99;
    z.angle = a; // odchádza od hráča
    step(game, { ...idle, aim: a, sneak: true }, 0.2);
    expect(z.aware).toBe(false);
    // Zapne baterku a posvieti jej do tváre zo 150 px.
    p.light = true;
    const far = at(game, a, 150);
    z.x = far.x;
    z.y = far.y;
    step(game, { ...idle, aim: a }, 0.1);
    expect(z.aware).toBe(true);
  });
});

describe('baterka', () => {
  it('batéria sa míňa len pri svietení, slabá ohlási varovanie, vybitá ešte slabo svieti', () => {
    const game = new Game(3, 1);
    const p = game.player;
    expect(p.battery).toBe(100);
    expect(game.flashlightPower).toBe(1);
    step(game, idle, 2);
    expect(p.battery).toBeLessThan(100);
    const before = p.battery;
    const off = step(game, { ...idle, toggleLight: true });
    expect(off.some((e) => e.type === 'light' && !e.on)).toBe(true);
    expect(game.flashlightPower).toBe(0);
    step(game, idle, 2);
    expect(p.battery).toBeCloseTo(before, 1);
    step(game, { ...idle, toggleLight: true });
    p.battery = BATTERY_LOW + 0.01;
    const low = step(game, idle, 0.5);
    expect(low.some((e) => e.type === 'batteryLow')).toBe(true);
    expect(game.flashlightPower).toBeLessThan(1);
    p.battery = 0;
    expect(game.flashlightPower).toBeCloseTo(0.35);
  });

  it('batérie sa dajú nájsť, kúpiť a prenášajú sa do ďalšej úrovne', () => {
    const game = new Game(3, 1);
    const p = game.player;
    p.battery = 10;
    game.pickups.push({ id: 999, kind: 'battery', x: p.x, y: p.y, age: 0, permanent: true });
    const events = step(game, idle);
    expect(events.some((e) => e.type === 'pickup' && e.kind === 'battery')).toBe(true);
    expect(p.battery).toBeGreaterThan(50);
    const carry = game.carry();
    expect(new Game(3, 2, { ...carry, battery: 20 }).player.battery).toBe(50);
    const bought = buy({ ...carry, battery: 20, cash: 100 }, 2, 'batteries')!;
    expect(bought.battery).toBe(65);
    expect(buy({ ...carry, battery: 100, cash: 100 }, 2, 'batteries')).toBeNull();
    // Batérie sa vyskytujú v úrovniach.
    const levels = [1, 2, 3, 4].map((l) => new Game(7, l));
    expect(levels.some((g) => g.pickups.some((i) => i.kind === 'battery'))).toBe(true);
  });

  it('sústredený lúč oslepí zombie pred hráčom, stojí batériu a má dobíjanie', () => {
    const { game, a } = openGame(100);
    const p = game.player;
    p.hp = 1e6;
    const pos = at(game, a, 70);
    const z = game.spawnZombie('runner', pos.x, pos.y);
    const behindPos = at(game, a + Math.PI, 40);
    const behind = game.spawnZombie('walker', behindPos.x, behindPos.y);
    const battery = p.battery;
    const events = step(game, { ...idle, aim: a, focus: true });
    expect(events.some((e) => e.type === 'focus')).toBe(true);
    expect(p.battery).toBeLessThanOrEqual(battery - 12);
    expect(z.blind).toBeGreaterThan(0);
    expect(behind.blind).toBe(0);
    // Oslepená sa nepribližuje.
    const d0 = Math.hypot(z.x - p.x, z.y - p.y);
    step(game, { ...idle, aim: a }, 1);
    expect(Math.hypot(z.x - p.x, z.y - p.y)).toBeGreaterThan(d0 - 2);
    // Hneď znova nejde.
    const again = step(game, { ...idle, aim: a, focus: true });
    expect(again.some((e) => e.type === 'focus')).toBe(false);
  });
});

describe('ukladanie', () => {
  it('batéria sa uloží; staré uloženie bez pajcera a batérie sa doplní', () => {
    const carry: Carry = {
      weapon: 'pistol',
      ammo: { crowbar: Infinity, pistol: Infinity, shotgun: 0, smg: 0, flamer: 0 },
      owned: ['pistol'],
      score: 0,
      kills: 0,
      lives: 3,
      cash: 0,
      grenades: 2,
      upgrades: { ...NO_UPGRADES },
      battery: 33,
    };
    const save = parseSave(serializeSave({ version: 1, seed: 5, level: 2, carry, savedAt: '' }))!;
    expect(save.carry.battery).toBe(33);
    const old = parseSave(
      JSON.stringify({
        version: 1,
        seed: 5,
        level: 2,
        carry: { ...carry, battery: undefined, ammo: { shotgun: 3 } },
      }),
    )!;
    expect(old.carry.battery).toBe(100);
    const game = new Game(5, 2, old.carry);
    expect(game.player.owned).toContain('crowbar');
    expect(game.player.ammo.crowbar).toBe(Infinity);
  });
});

describe('plaziace sa zombie', () => {
  it('silný zásah občas odtrhne nohy: zombie sa plazí pomalšie a ďalší zásah ju dorazí', () => {
    const { game, a } = openGame(60, 3);
    const p = game.player;
    p.hp = 1e6;
    p.owned.push('shotgun');
    p.ammo.shotgun = 999;
    p.weapon = 'shotgun';
    let crawler = null;
    for (let i = 0; i < 80 && !crawler; i++) {
      const pos = at(game, a, 40);
      const z = game.spawnZombie('walker', pos.x, pos.y);
      z.hp = 0.5;
      p.cooldown = 0;
      const events = step(game, { ...idle, aim: a, firing: true });
      if (events.some((e) => e.type === 'dismember')) crawler = z;
      else game.zombies = game.zombies.filter((o) => o !== z);
    }
    expect(crawler).not.toBeNull();
    const z = crawler!;
    expect(z.crawl).toBe(true);
    expect(game.zombies.includes(z)).toBe(true);
    // Plazí sa pomalšie ako chodec.
    const walker = game.spawnZombie('walker', z.x, z.y + 1);
    game.zombies = [z, walker];
    const d0 = Math.hypot(z.x - p.x, z.y - p.y);
    const w0 = Math.hypot(walker.x - p.x, walker.y - p.y);
    step(game, idle, 0.6);
    expect(d0 - Math.hypot(z.x - p.x, z.y - p.y)).toBeLessThan(
      w0 - Math.hypot(walker.x - p.x, walker.y - p.y),
    );
    // Pištoľ ju dorazí.
    game.zombies = game.zombies.filter((o) => o !== walker);
    p.weapon = 'pistol';
    p.cooldown = 0;
    const kills = game.kills;
    const aim = Math.atan2(z.y - p.y, z.x - p.x);
    for (let i = 0; i < 30 && game.zombies.includes(z); i++)
      step(game, { ...idle, aim, firing: true }, 0.25);
    expect(game.zombies.includes(z)).toBe(false);
    expect(game.kills).toBeGreaterThan(kills);
  });
});
