import { describe, expect, it } from 'vitest';
import { FlowField, UNREACHABLE } from '@/game/flowfield';
import { castRay, lineOfSight, moveCircle, visibilityFan } from '@/game/geometry';
import { Game, waveComposition, type Input } from '@/game/game';
import { generateCity, isSolid, Tile, TILE, tileAt } from '@/game/map';

const idle: Input = {
  moveX: 0,
  moveY: 0,
  aim: null,
  firing: false,
  switchWeapon: null,
  selectWeapon: null,
};

describe('mesto', () => {
  it('je deterministické a štart je voľný a prepojený s väčšinou ulíc', () => {
    const a = generateCity(7);
    const b = generateCity(7);
    expect(a.tiles).toEqual(b.tiles);
    const sx = Math.floor(a.spawn.x / TILE);
    const sy = Math.floor(a.spawn.y / TILE);
    expect(isSolid(a, sx, sy)).toBe(false);
    const flow = new FlowField(a);
    flow.update(a.spawn.x, a.spawn.y);
    let free = 0;
    let reachable = 0;
    for (let i = 0; i < a.tiles.length; i++) {
      if (isSolid(a, i % a.width, Math.floor(i / a.width))) continue;
      free++;
      if (flow.dist[i] !== UNREACHABLE) reachable++;
    }
    expect(reachable / free).toBeGreaterThan(0.9);
    expect(a.lamps.length).toBeGreaterThan(5);
  });

  it('okraj mapy je stena', () => {
    const map = generateCity(1);
    expect(tileAt(map, -1, 0)).toBe(Tile.Building);
    expect(isSolid(map, map.width, 3)).toBe(true);
  });
});

describe('geometria', () => {
  const map = generateCity(3);
  const at = map.spawn;

  it('lúč sa zastaví o budovu a viditeľnosť je polygón', () => {
    const d = castRay(map, at.x, at.y, 1, 0, 2000);
    expect(d).toBeLessThan(2000);
    const fan = visibilityFan(map, at.x, at.y, 150, 0, Math.PI / 3, 20);
    expect(fan.length).toBe(2 + 21 * 2);
    expect(lineOfSight(map, at, at)).toBe(true);
  });

  it('kruh sa nedá zatlačiť do steny', () => {
    const pos = { x: at.x, y: at.y };
    for (let i = 0; i < 400; i++) moveCircle(map, pos, 5, 3, 0);
    const tx = Math.floor((pos.x + 5) / TILE);
    expect(isSolid(map, Math.floor(pos.x / TILE), Math.floor(pos.y / TILE))).toBe(false);
    expect(isSolid(map, tx + 1, Math.floor(pos.y / TILE)) || pos.x > at.x).toBe(true);
  });
});

describe('hra', () => {
  it('vlny rastú a pribúdajú bežci aj obri', () => {
    const w1 = waveComposition(1);
    const w5 = waveComposition(5);
    const total = (w: typeof w1) => w.walker + w.runner + w.brute;
    expect(total(w5)).toBeGreaterThan(total(w1));
    expect(w5.runner).toBeGreaterThan(w1.runner);
    expect(w1.brute).toBe(0);
    expect(w5.brute).toBeGreaterThan(0);
  });

  it('prvá vlna príde po odpočte, zombie idú k hráčovi a dá sa ich zastreliť', () => {
    const game = new Game(5);
    for (let i = 0; i < 4 * 60; i++) game.update(1 / 60, idle);
    expect(game.wave).toBe(1);
    expect(game.takeEvents().some((e) => e.type === 'wave')).toBe(true);
    // Zombie priamo pred hráčom: pištoľ ju po pár výstreloch zloží.
    game.zombies = [];
    const p = game.player;
    const z = game.spawnZombie('walker', p.x + 30, p.y);
    if (castRay(game.map, p.x, p.y, 1, 0, 40) < 30) return; // stena hneď vedľa štartu
    const shoot: Input = { ...idle, aim: 0, firing: true };
    for (let i = 0; i < 120 && game.zombies.includes(z); i++) game.update(1 / 60, shoot);
    expect(game.zombies.includes(z)).toBe(false);
    expect(game.kills).toBe(1);
    expect(game.takeEvents().some((e) => e.type === 'kill')).toBe(true);
  });

  it('brokovnica zabije každú zombie najviac raz', () => {
    const game = new Game(5);
    const p = game.player;
    if (castRay(game.map, p.x, p.y, 1, 0, 40) < 30) return;
    p.owned.push('shotgun');
    p.ammo.shotgun = 10;
    p.weapon = 'shotgun';
    game.spawnZombie('runner', p.x + 20, p.y);
    game.update(1 / 60, { ...idle, aim: 0, firing: true });
    expect(game.kills).toBe(1);
    expect(game.takeEvents().filter((e) => e.type === 'kill')).toHaveLength(1);
  });

  it('zombie pri hráčovi ubližuje a hra skončí', () => {
    const game = new Game(9);
    const p = game.player;
    for (let i = 0; i < 6; i++) game.spawnZombie('brute', p.x + 4, p.y + 4);
    for (let i = 0; i < 60 * 20 && !game.over; i++) game.update(1 / 60, idle);
    expect(game.over).toBe(true);
    expect(p.hp).toBe(0);
  });
});
