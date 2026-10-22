import { describe, expect, it } from 'vitest';
import { castRay } from '@/game/geometry';
import { Game, type Carry, type Input } from '@/game/game';
import { Tile, TILE } from '@/game/map';
import { parseSave, serializeSave } from '@/game/save';
import { buy, maxHpFor, NO_UPGRADES, shopItems } from '@/game/shop';

const idle: Input = {
  moveX: 0,
  moveY: 0,
  aim: null,
  firing: false,
  switchWeapon: null,
  selectWeapon: null,
};

const baseCarry = (): Carry => ({
  weapon: 'pistol',
  ammo: { pistol: Infinity, shotgun: 0, smg: 0, flamer: 0 },
  owned: ['pistol'],
  score: 0,
  kills: 0,
  lives: 3,
  cash: 500,
  grenades: 2,
  upgrades: { ...NO_UPGRADES },
});

/** Voľný smer od hráča (aspoň `dist` px bez prekážky). */
function freeDirection(game: Game, dist: number): number | null {
  const p = game.player;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    if (castRay(game.map, p.x, p.y, Math.cos(a), Math.sin(a), dist + 10) >= dist + 10) return a;
  }
  return null;
}

describe('obchod', () => {
  it('kúpa zbrane, nábojov, granátov a vylepšení odpočíta peniaze', () => {
    let carry = baseCarry();
    carry = buy(carry, 2, 'weapon:shotgun')!;
    expect(carry.owned).toContain('shotgun');
    expect(carry.ammo.shotgun).toBeGreaterThan(0);
    expect(carry.cash).toBe(350);
    carry = buy(carry, 2, 'up:health')!;
    expect(carry.upgrades.health).toBe(1);
    expect(maxHpFor(carry.upgrades)).toBe(120);
    carry = buy(carry, 2, 'grenades')!;
    expect(carry.grenades).toBe(5);
    // Plameňomet až od 4. úrovne, bez peňazí sa nedá kúpiť nič.
    expect(shopItems(carry, 2).some((i) => i.id === 'weapon:flamer')).toBe(false);
    expect(shopItems(carry, 4).some((i) => i.id === 'weapon:flamer')).toBe(true);
    expect(buy({ ...carry, cash: 0 }, 4, 'weapon:flamer')).toBeNull();
  });

  it('vylepšenia platia v hre (zdravie, baterka)', () => {
    const carry = { ...baseCarry(), upgrades: { ...NO_UPGRADES, health: 2, flashlight: 2 } };
    const game = new Game(4, 2, carry);
    expect(game.maxHp).toBe(140);
    expect(game.player.hp).toBe(140);
    expect(game.flashlightScale).toBeCloseTo(1.3);
  });
});

describe('uloženie postupu', () => {
  it('uloží a načíta výbavu (aj nekonečné náboje pištole)', () => {
    const carry = { ...baseCarry(), owned: ['pistol', 'smg'] as Carry['owned'], cash: 77 };
    carry.ammo.smg = 42;
    const text = serializeSave({ version: 1, seed: 9, level: 4, carry, savedAt: 'x' });
    const save = parseSave(text)!;
    expect(save.level).toBe(4);
    expect(save.carry.ammo.pistol).toBe(Infinity);
    expect(save.carry.ammo.smg).toBe(42);
    expect(save.carry.cash).toBe(77);
    expect(parseSave('{nezmysel')).toBeNull();
    expect(parseSave(null)).toBeNull();
  });
});

describe('výbušniny a oheň', () => {
  it('granát vybuchne a zabije zombie v okolí', () => {
    const game = new Game(5, 2);
    const a = freeDirection(game, 90);
    if (a === null) return;
    const p = game.player;
    p.angle = a;
    const z = game.spawnZombie('walker', p.x + Math.cos(a) * 80, p.y + Math.sin(a) * 80);
    z.aware = false;
    const before = p.grenades;
    game.update(1 / 60, { ...idle, throwGrenade: true, throwDistance: 80 });
    expect(p.grenades).toBe(before - 1);
    let exploded = false;
    for (let i = 0; i < 120; i++) {
      game.update(1 / 60, idle);
      if (game.takeEvents().some((e) => e.type === 'explode')) exploded = true;
    }
    expect(exploded).toBe(true);
    expect(game.zombies.includes(z)).toBe(false);
  });

  it('plameňomet zapáli zombie, ktorá potom dohorí', () => {
    const game = new Game(5, 4);
    const a = freeDirection(game, 40);
    if (a === null) return;
    const p = game.player;
    p.owned.push('flamer');
    p.ammo.flamer = 50;
    p.weapon = 'flamer';
    const z = game.spawnZombie('walker', p.x + Math.cos(a) * 30, p.y + Math.sin(a) * 30);
    game.update(1 / 60, { ...idle, aim: a, firing: true });
    expect(z.burn).toBeGreaterThan(0);
    expect(game.takeEvents().some((e) => e.type === 'flame')).toBe(true);
    z.x = p.x + Math.cos(a + Math.PI) * 300; // utečie, ale horí ďalej
    for (let i = 0; i < 60 * 3 && game.zombies.includes(z); i++) game.update(1 / 60, idle);
    expect(game.zombies.includes(z)).toBe(false);
  });

  it('zastrelený sud vybuchne a zmizne z mapy', () => {
    const game = new Game(6, 3);
    const map = game.map;
    const p = game.player;
    // Sud postavený priamo pred hráča.
    const a = freeDirection(game, 50);
    if (a === null) return;
    const tx = Math.floor((p.x + Math.cos(a) * 40) / TILE);
    const ty = Math.floor((p.y + Math.sin(a) * 40) / TILE);
    const i = ty * map.width + tx;
    map.variant[i] = map.tiles[i]!;
    map.tiles[i] = Tile.Barrel;
    const aim = Math.atan2((ty + 0.5) * TILE - p.y, (tx + 0.5) * TILE - p.x);
    let exploded = false;
    for (let k = 0; k < 60 && !exploded; k++) {
      game.update(1 / 60, { ...idle, aim, firing: true });
      if (game.takeEvents().some((e) => e.type === 'explode')) exploded = true;
    }
    expect(exploded).toBe(true);
    expect(map.tiles[i]).not.toBe(Tile.Barrel);
  });

  it('úrovne obsahujú sudy a peniaze', () => {
    const game = new Game(8, 3);
    expect(game.map.tiles.some((t) => t === Tile.Barrel)).toBe(true);
    expect(game.pickups.some((p) => p.kind === 'cash')).toBe(true);
  });
});
