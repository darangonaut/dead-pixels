import { describe, expect, it } from 'vitest';
import { Game, type GameEvent, type Input } from '@/game/game';

const idle: Input = {
  moveX: 0,
  moveY: 0,
  aim: null,
  firing: false,
  switchWeapon: null,
  selectWeapon: null,
};

/** Odsimuluje `seconds` sekúnd a vráti všetky udalosti. */
function run(game: Game, seconds: number, input: Input = idle): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    game.update(1 / 60, input);
    events.push(...game.takeEvents());
  }
  return events;
}

/** Hra (seed, úroveň), ktorá spĺňa podmienku. */
function findGame(level: number, ok: (g: Game) => boolean): Game {
  for (let seed = 1; seed < 200; seed++) {
    const g = new Game(seed, level);
    if (ok(g)) return g;
  }
  throw new Error('nenašla sa vhodná úroveň');
}

describe('falošný mŕtvy', () => {
  it('každá úroveň má aspoň jedného, od 4. úrovne viac', () => {
    for (let seed = 1; seed <= 10; seed++) {
      expect(new Game(seed, 2).lurkers.length).toBeGreaterThanOrEqual(1);
      expect(new Game(seed, 6).lurkers.length).toBeGreaterThanOrEqual(1);
    }
    expect(new Game(3, 6).lurkers.length).toBeLessThanOrEqual(2);
  });

  it('leží bez pohybu, šklbne sa a vstane, keď ho hráč obíde chrbtom', () => {
    const game = findGame(3, (g) => g.lurkers.length > 0);
    const l = game.lurkers[0]!;
    const room = game.map.rooms[l.room]!;
    const p = game.player;
    p.hp = 1e6;
    // Hráč pri vstupe do úseku (úsek sa spustí, falošný mŕtvy sa položí).
    p.x = room.entry.x;
    p.y = room.entry.y;
    game.room = l.room - 1;
    run(game, 0.1);
    game.zombies = game.zombies.filter((z) => z.lurker !== undefined);
    const z = game.zombies.find((z) => z.lurker === 0)!;
    expect(z.state).toBe('lying');
    // Hráč 80 px od neho, otočený k nemu: šklbne sa, ale nevstane a nepohne sa.
    const a = Math.atan2(room.entry.y - l.y, room.entry.x - l.x);
    p.x = l.x + Math.cos(a) * 80;
    p.y = l.y + Math.sin(a) * 80;
    p.angle = a + Math.PI;
    const events = run(game, 6);
    expect(events.some((e) => e.type === 'twitch')).toBe(true);
    expect(z.state).toBe('lying');
    expect(Math.hypot(z.x - l.x, z.y - l.y)).toBeLessThan(0.01);
    // Prejde okolo a otočí sa chrbtom: vstane a schmatne ho.
    p.x = l.x + Math.cos(a) * 12;
    p.y = l.y + Math.sin(a) * 12;
    p.angle = a;
    const rise = run(game, 1);
    expect(rise.some((e) => e.type === 'lurkerRise')).toBe(true);
    expect(rise.some((e) => e.type === 'grab')).toBe(true);
    expect(z.state).toBe('normal');
    expect(z.aware).toBe(true);
    expect(l.done).toBe(true);
  });

  it('výstrel ho prebudí okamžite', () => {
    const game = findGame(2, (g) => g.lurkers.length > 0);
    const l = game.lurkers[0]!;
    const room = game.map.rooms[l.room]!;
    game.player.x = room.entry.x;
    game.player.y = room.entry.y;
    game.room = l.room - 1;
    run(game, 0.1);
    const z = game.zombies.find((z) => z.lurker === 0)!;
    z.hp -= 1;
    const events = run(game, 0.5);
    expect(events.some((e) => e.type === 'lurkerRise')).toBe(true);
    expect(z.state).toBe('normal');
  });
});

describe('výpadok prúdu', () => {
  it('na 2. úrovni vždy, nie v úseku s falošným mŕtvym', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = new Game(seed, 2);
      expect(g.outage).not.toBeNull();
      expect(g.lurkers.some((l) => l.room === g.outage!.room)).toBe(false);
    }
    expect(new Game(1, 1).outage).toBeNull();
  });

  it('lampy zablikajú a zhasnú, ozve sa krik, brány sa zavrú a príde horda; po nej sa prúd vráti', () => {
    const game = findGame(2, (g) => g.outage !== null);
    const o = game.outage!;
    const room = game.map.rooms[o.room]!;
    const p = game.player;
    p.hp = 1e6;
    p.x = room.entry.x;
    p.y = room.entry.y;
    game.room = o.room - 1;
    run(game, 0.1);
    expect(game.lampsPower).toBe(1);
    // Hráč prejde do stredu úseku.
    p.x = ((room.x0 + room.x1 + 1) / 2) * 16;
    p.y = ((room.y0 + room.y1 + 1) / 2) * 16;
    const events = run(game, 5);
    const types = events.map((e) => e.type);
    expect(types).toContain('powerFlicker');
    expect(types).toContain('blackout');
    expect(types).toContain('scream');
    expect(types).toContain('horde');
    expect(types.indexOf('blackout')).toBeLessThan(types.indexOf('scream'));
    expect(game.lampsPower).toBe(0);
    expect(game.map.gates[room.doorIn!]!.open).toBe(false);
    expect(game.hordeRemaining).toBeGreaterThan(0);
    // Horda zmizne (akoby ju hráč postrieľal): prúd sa vráti a brány sa otvoria.
    const after: GameEvent[] = [];
    for (let t = 0; t < 30 && game.outage!.phase !== 'done'; t += 1 / 60) {
      game.zombies = [];
      game.update(1 / 60, idle);
      after.push(...game.takeEvents());
    }
    expect(after.some((e) => e.type === 'powerBack')).toBe(true);
    expect(game.lampsPower).toBe(1);
    expect(game.map.gates[room.doorIn!]!.open).toBe(true);
    expect(game.map.gates[room.doorOut!]!.open).toBe(true);
  });
});
