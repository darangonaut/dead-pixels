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
