import { describe, expect, it } from 'vitest';
import { castRay } from '@/game/geometry';
import { ALARM_TIME, Game, type GameEvent, type Input } from '@/game/game';
import { carHasAlarm, carHead, isSolid, Tile, TILE, tileAt } from '@/game/map';

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

/** Auto s alarmom a miesto, odkiaľ naň hráč vidí (voľná čiara 2–4 políčka). */
function carTarget(game: Game) {
  const m = game.map;
  for (let ty = 1; ty < m.height - 1; ty++)
    for (let tx = 1; tx < m.width - 1; tx++) {
      const head = carHead(m, tx, ty);
      if (head === null || !carHasAlarm(m, head) || m.roomOf[ty * m.width + tx]! < 0) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        for (let d = 2; d <= 4; d++) {
          const sx = tx + dx * d;
          const sy = ty + dy * d;
          if (isSolid(m, sx, sy) || m.roomOf[sy * m.width + sx]! < 0) continue;
          const from = { x: (sx + 0.5) * TILE, y: (sy + 0.5) * TILE };
          const target = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
          const a = Math.atan2(target.y - from.y, target.x - from.x);
          const free = castRay(m, from.x, from.y, Math.cos(a), Math.sin(a), 80);
          // Lúč musí doletieť až k autu (pred ním nič iné).
          const hit = {
            x: from.x + Math.cos(a) * (free + 1),
            y: from.y + Math.sin(a) * (free + 1),
          };
          if (tileAt(m, Math.floor(hit.x / TILE), Math.floor(hit.y / TILE)) !== Tile.Car) continue;
          if (carHead(m, Math.floor(hit.x / TILE), Math.floor(hit.y / TILE)) !== head) continue;
          return { head, from, angle: a, room: m.roomOf[sy * m.width + sx]! };
        }
    }
  return null;
}

describe('alarm auta', () => {
  it('výstrel do auta spustí alarm, zbehnú sa zombie a idú k autu; auto húka len raz', () => {
    const game = findGame(3, (g) => carTarget(g) !== null);
    const target = carTarget(game)!;
    const p = game.player;
    p.hp = 1e6;
    p.x = target.from.x;
    p.y = target.from.y;
    game.room = -1;
    run(game, 0.05);
    game.zombies = [];
    const before = game.zombies.length;
    const fire: Input = { ...idle, aim: target.angle, firing: true };
    game.update(1 / 60, fire);
    const events = game.takeEvents();
    expect(events.some((e) => e.type === 'alarm')).toBe(true);
    expect(game.alarms).toHaveLength(1);
    expect(game.alarms[0]!.tile).toBe(target.head);
    // Pribehli ďalšie zombie (v tichom úseku) a všetky v dosahu idú k autu.
    if (game.map.rooms[game.room]!.encounter !== 'horde') {
      expect(game.zombies.length).toBeGreaterThan(before);
      const alarm = game.alarms[0]!;
      const far = game.zombies.map((z) => Math.hypot(z.x - alarm.x, z.y - alarm.y));
      run(game, 1.5);
      const near = game.zombies.map((z) => Math.hypot(z.x - alarm.x, z.y - alarm.y));
      expect(near.reduce((a, b) => a + b, 0)).toBeLessThan(far.reduce((a, b) => a + b, 0));
    }
    // Druhý výstrel do toho istého auta nový alarm nespustí.
    game.player.cooldown = 0;
    game.update(1 / 60, fire);
    expect(game.takeEvents().some((e) => e.type === 'alarm')).toBe(false);
    // Po čase alarm stíchne.
    game.zombies = [];
    const rest = run(game, ALARM_TIME);
    expect(rest.some((e) => e.type === 'alarmEnd')).toBe(true);
    expect(game.alarms).toHaveLength(0);
  });

  it('vyhorené autá alarm nemajú, zvyšné zhruba polovica', () => {
    const game = new Game(7, 3);
    const m = game.map;
    let cars = 0;
    let withAlarm = 0;
    for (let i = 0; i < m.tiles.length; i++) {
      if (m.tiles[i] !== Tile.Car || m.variant[i]! & 0x20) continue;
      cars++;
      if (carHasAlarm(m, i)) withAlarm++;
    }
    expect(cars).toBeGreaterThan(0);
    expect(withAlarm).toBeLessThan(cars);
  });
});

/** Hráča postaví do úseku preživšieho a potom pred okno (vo vzdialenosti `d`). */
function approachSurvivor(game: Game, d: number): GameEvent[] {
  const sv = game.survivor!;
  const room = game.map.rooms[sv.room]!;
  const p = game.player;
  p.hp = 1e6;
  p.x = room.entry.x;
  p.y = room.entry.y;
  game.room = sv.room - 1;
  const events = run(game, 0.05);
  game.zombies = [];
  const front = game.survivorFront!;
  p.x = front.x + sv.dirX * d;
  p.y = front.y + sv.dirY * d;
  return [...events, ...run(game, 0.5)];
}

describe('preživší v okne', () => {
  it('na 1. úrovni je vždy a nie je to pasca; okno je v stene pri voľnom mieste', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = new Game(seed, 1);
      const sv = g.survivor!;
      expect(sv).not.toBeNull();
      expect(sv.trap).toBe(false);
      expect(tileAt(g.map, Math.floor(sv.x / TILE), Math.floor(sv.y / TILE))).toBe(Tile.Building);
      const f = g.survivorFront!;
      expect(isSolid(g.map, Math.floor(f.x / TILE), Math.floor(f.y / TILE))).toBe(false);
    }
  });

  it('volá o pomoc a pri okne hodí zásoby', () => {
    const game = findGame(1, (g) => g.survivor !== null);
    const call = approachSurvivor(game, 90);
    expect(call.some((e) => e.type === 'survivorCall' && e.first)).toBe(true);
    const before = game.pickups.length;
    const gift = approachSurvivor(game, 30);
    expect(gift.some((e) => e.type === 'survivorGift')).toBe(true);
    expect(game.pickups.length).toBe(before + 3);
    expect(game.survivor!.phase).toBe('gift');
  });

  it('pasca: z okna sa vyvalí skupina zombie', () => {
    const game = findGame(4, (g) => g.survivor !== null);
    game.survivor!.trap = true;
    approachSurvivor(game, 90);
    const events = approachSurvivor(game, 0);
    expect(events.some((e) => e.type === 'survivorTrap')).toBe(true);
    run(game, 3);
    const front = game.survivorFront!;
    const near = game.zombies.filter((z) => Math.hypot(z.x - front.x, z.y - front.y) < 120);
    expect(near.length).toBeGreaterThanOrEqual(4);
  });
});
