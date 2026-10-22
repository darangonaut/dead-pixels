import { describe, expect, it } from 'vitest';
import { FlowField, UNREACHABLE } from '@/game/flowfield';
import { castRay, lineOfSight, moveCircle, visibilityFan } from '@/game/geometry';
import { Game, hordeComposition, type Input } from '@/game/game';
import {
  districtOf,
  FINAL_LEVEL,
  generateLevel,
  isSolid,
  setGate,
  Tile,
  TILE,
  tileAt,
} from '@/game/map';

const idle: Input = {
  moveX: 0,
  moveY: 0,
  aim: null,
  firing: false,
  switchWeapon: null,
  selectWeapon: null,
};

const tileIndex = (map: ReturnType<typeof generateLevel>, x: number, y: number) =>
  Math.floor(y / TILE) * map.width + Math.floor(x / TILE);

/** Políčko vo vnútri úseku (stred), kam sa dá postaviť. */
function insideRoom(game: Game, index: number) {
  const room = game.map.rooms[index]!;
  for (let r = 0; r < 10; r++)
    for (let y = room.y0 + 2; y <= room.y1 - 2; y++)
      for (let x = room.x0 + 2; x <= room.x1 - 2; x++)
        if (!isSolid(game.map, x, y)) return { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE };
  throw new Error('úsek bez voľného miesta');
}

describe('úroveň', () => {
  it.each([1, 3, 5, 6, 8, 10])(
    'úroveň %i: deterministická, úseky sú prepojené až k heliportu',
    (level) => {
      const a = generateLevel(11, level);
      expect(generateLevel(11, level).tiles).toEqual(a.tiles);
      expect(a.rooms).toHaveLength(Math.min(12, 5 + level));
      expect(a.rooms[0]!.encounter).toBe('start');
      expect(a.rooms.at(-1)!.encounter).toBe('exit');
      expect(
        a.rooms.filter((r) => r.encounter === 'horde' || r.encounter === 'boss').length,
      ).toBeGreaterThanOrEqual(1);
      expect(isSolid(a, Math.floor(a.spawn.x / TILE), Math.floor(a.spawn.y / TILE))).toBe(false);
      // So všetkými bránami otvorenými vedie cesta zo štartu k heliportu.
      for (const g of a.gates) setGate(a, g.id, true);
      const flow = new FlowField(a);
      flow.update(a.exit.x, a.exit.y);
      expect(flow.dist[tileIndex(a, a.spawn.x, a.spawn.y)]).not.toBe(UNREACHABLE);
      // Každý vstup do úseku je dostupný.
      for (const room of a.rooms)
        expect(flow.dist[tileIndex(a, room.entry.x, room.entry.y)]).not.toBe(UNREACHABLE);
    },
  );

  it('štvrte: mesto, nemocnica, metro, základňa; boss každú piatu úroveň', () => {
    expect([1, 4, 7, 10, 11].map(districtOf)).toEqual([
      'city',
      'hospital',
      'metro',
      'base',
      'city',
    ]);
    const hospital = generateLevel(2, 5);
    expect(hospital.district).toBe('hospital');
    expect(hospital.rooms.at(-2)!.encounter).toBe('boss');
    expect(hospital.gates[hospital.rooms.at(-2)!.doorOut!]!.open).toBe(false);
    expect(hospital.tiles.some((t) => t === Tile.WhiteFloor)).toBe(true);
    const metro = generateLevel(2, 8);
    expect(metro.tiles.some((t) => t === Tile.Track)).toBe(true);
    expect(generateLevel(2, 4).rooms.some((r) => r.encounter === 'boss')).toBe(false);
  });

  it('brána von z hordy je na začiatku zavretá, mreže prepúšťajú svetlo', () => {
    const map = generateLevel(4, 2);
    const horde = map.rooms.find((r) => r.encounter === 'horde')!;
    const gate = map.gates[horde.doorOut!]!;
    expect(gate.open).toBe(false);
    const [first] = gate.tiles;
    const tx = first! % map.width;
    const ty = Math.floor(first! / map.width);
    expect(tileAt(map, tx, ty)).toBe(Tile.Gate);
    expect(isSolid(map, tx, ty)).toBe(true);
  });
});

describe('geometria', () => {
  const map = generateLevel(3);
  const at = map.spawn;

  it('lúč sa zastaví o stenu a viditeľnosť je polygón', () => {
    expect(castRay(map, at.x, at.y, 1, 0, 4000, isSolid)).toBeLessThan(4000);
    const fan = visibilityFan(map, at.x, at.y, 150, 0, Math.PI / 3, 20);
    expect(fan.length).toBe(2 + 21 * 2);
    expect(lineOfSight(map, at, at)).toBe(true);
  });

  it('kruh sa nedá zatlačiť do steny', () => {
    const pos = { x: at.x, y: at.y };
    for (let i = 0; i < 400; i++) moveCircle(map, pos, 5, 0, -3);
    expect(isSolid(map, Math.floor(pos.x / TILE), Math.floor(pos.y / TILE))).toBe(false);
  });
});

describe('hra', () => {
  it('hordy rastú s úrovňou', () => {
    const total = (c: ReturnType<typeof hordeComposition>) =>
      c.walker + c.runner + c.brute + c.exploder + c.spitter;
    expect(total(hordeComposition(4))).toBeGreaterThan(total(hordeComposition(1)));
    expect(hordeComposition(1).brute).toBe(0);
    expect(hordeComposition(4).brute).toBeGreaterThan(0);
    expect(hordeComposition(2).exploder).toBe(0);
    expect(hordeComposition(3).exploder).toBeGreaterThan(0);
    expect(hordeComposition(4).spitter).toBe(0);
    expect(hordeComposition(6).spitter).toBeGreaterThan(0);
  });

  it('nafúknutá zombie pri hráčovi vybuchne a zraní hráča aj zombie okolo', () => {
    const game = new Game(5, 3);
    const p = game.player;
    const walker = game.spawnZombie('walker', p.x - 14, p.y);
    walker.hp = 3;
    game.spawnZombie('exploder', p.x + 8, p.y);
    game.update(1 / 60, idle);
    const events = game.takeEvents();
    expect(events.some((e) => e.type === 'explode')).toBe(true);
    expect(p.hp).toBeLessThan(game.maxHp);
    expect(walker.hp).toBeLessThan(3);
  });

  it('pľujúca zombie pľuje kyselinu, ktorá hráča zasiahne', () => {
    const game = new Game(5, 6);
    const p = game.player;
    let spitter = null;
    for (const [dx, dy] of [
      [100, 0],
      [-100, 0],
      [0, 100],
      [0, -100],
    ] as const)
      if (castRay(game.map, p.x, p.y, Math.sign(dx), Math.sign(dy), 100) >= 100) {
        spitter = game.spawnZombie('spitter', p.x + dx, p.y + dy);
        break;
      }
    if (!spitter) return;
    spitter.timer = 0;
    let spat = false;
    for (let i = 0; i < 120 && p.hp === game.maxHp; i++) {
      game.update(1 / 60, idle);
      if (game.takeEvents().some((e) => e.type === 'spit')) spat = true;
    }
    expect(spat).toBe(true);
    expect(p.hp).toBeLessThan(game.maxHp);
  });

  it('boss sa objaví v úseku pred heliportom a má veľa života', () => {
    const game = new Game(3, 5);
    const index = game.map.rooms.findIndex((r) => r.encounter === 'boss');
    Object.assign(game.player, insideRoom(game, index));
    game.update(1 / 60, idle);
    expect(game.takeEvents().some((e) => e.type === 'boss')).toBe(true);
    expect(game.boss).not.toBeNull();
    expect(game.boss!.hp).toBeGreaterThan(150);
  });

  it('vstup do hordy zavrie bránu za hráčom, po vyčistení sa brány otvoria', () => {
    const game = new Game(4, 2);
    const index = game.map.rooms.findIndex((r) => r.encounter === 'horde');
    const room = game.map.rooms[index]!;
    Object.assign(game.player, insideRoom(game, index));
    game.update(1 / 60, idle);
    const events = game.takeEvents();
    expect(events.some((e) => e.type === 'horde')).toBe(true);
    expect(game.map.gates[room.doorIn!]!.open).toBe(false);
    expect(game.checkpoint).toBe(index);
    // Všetky zombie hordy „zastrelené“ hneď po objavení.
    for (let i = 0; i < 60 * 40 && game.hordeRemaining !== null; i++) {
      game.zombies = game.zombies.filter((z) => z.room !== index);
      game.update(1 / 60, idle);
    }
    expect(game.hordeRemaining).toBeNull();
    expect(game.map.gates[room.doorIn!]!.open).toBe(true);
    expect(game.map.gates[room.doorOut!]!.open).toBe(true);
    expect(game.takeEvents().some((e) => e.type === 'cleared')).toBe(true);
  });

  it('smrť vráti hráča na kontrolný bod, po poslednom živote hra skončí', () => {
    const game = new Game(9);
    const p = game.player;
    p.hp = 1;
    game.spawnZombie('brute', p.x + 4, p.y);
    for (let i = 0; i < 60 * 5 && game.lives === 3; i++) game.update(1 / 60, idle);
    expect(game.lives).toBe(2);
    for (let i = 0; i < 60 * 3; i++) game.update(1 / 60, idle);
    expect(p.hp).toBe(game.maxHp);
    expect(
      Math.hypot(p.x - game.map.rooms[0]!.entry.x, p.y - game.map.rooms[0]!.entry.y),
    ).toBeLessThan(1);
    game.lives = 1;
    p.hp = 1;
    p.hurt = 0;
    for (let i = 0; i < 6; i++) game.spawnZombie('brute', p.x + 4, p.y + 2);
    for (let i = 0; i < 60 * 10 && !game.over; i++) game.update(1 / 60, idle);
    expect(game.over).toBe(true);
  });

  it('posledná úroveň: heliport znamená útek (koniec príbehu)', () => {
    const game = new Game(7, FINAL_LEVEL);
    const last = game.map.rooms.length - 1;
    Object.assign(game.player, insideRoom(game, last));
    game.update(1 / 60, idle);
    Object.assign(game.player, { x: game.map.exit.x, y: game.map.exit.y });
    game.update(1 / 60, idle);
    const done = game.takeEvents().find((e) => e.type === 'levelComplete');
    expect(done).toMatchObject({ final: true });
  });

  it('heliport dokončí úroveň a výbava prejde do ďalšej', () => {
    const game = new Game(7, 1);
    game.player.owned.push('shotgun');
    game.player.ammo.shotgun = 12;
    game.score = 500;
    const last = game.map.rooms.length - 1;
    Object.assign(game.player, insideRoom(game, last));
    game.update(1 / 60, idle);
    Object.assign(game.player, { x: game.map.exit.x, y: game.map.exit.y });
    game.update(1 / 60, idle);
    expect(game.complete).toBe(true);
    expect(game.takeEvents().some((e) => e.type === 'levelComplete')).toBe(true);
    const next = new Game(7, 2, game.carry());
    expect(next.level).toBe(2);
    expect(next.player.owned).toContain('shotgun');
    expect(next.player.ammo.shotgun).toBe(12);
    expect(next.score).toBe(500);
    expect(next.lives).toBe(4);
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
});
