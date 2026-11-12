import { describe, expect, it } from 'vitest';
import {
  DAILY_MODS,
  dailyKey,
  dailySetup,
  parseRecords,
  streak,
  upsertRecord,
  type DailyRecord,
} from '@/game/daily';
import { Game, hordeComposition } from '@/game/game';

describe('denné mesto', () => {
  it('rovnaký deň = rovnaké mesto, iný deň iné; úrovne 2–9 a všetky mutácie sa striedajú', () => {
    const a = dailySetup('2026-11-12');
    expect(dailySetup('2026-11-12')).toEqual(a);
    expect(new Game(a.seed, a.level, a.carry, a.mod).map.tiles).toEqual(
      new Game(a.seed, a.level, a.carry, a.mod).map.tiles,
    );
    const days = Array.from({ length: 60 }, (_, i) =>
      dailySetup(dailyKey(new Date(2026, 0, 1 + i))),
    );
    expect(new Set(days.map((d) => d.seed)).size).toBe(60);
    expect(days.every((d) => d.level >= 2 && d.level <= 9)).toBe(true);
    for (const mod of DAILY_MODS) expect(days.some((d) => d.mod === mod)).toBe(true);
  });

  it('kľúč dňa je miestny dátum RRRR-MM-DD', () => {
    expect(dailyKey(new Date(2026, 10, 2, 23, 59))).toBe('2026-11-02');
  });

  it('mutácie: bez prúdu, bežci, obri, nedostatok', () => {
    const { seed, carry } = dailySetup('2026-11-12');
    expect(new Game(seed, 4, carry, 'dark').lampsPower).toBe(0);
    expect(new Game(seed, 4, carry, null).lampsPower).toBe(1);
    const scarce = dailySetup('x');
    const s = { ...scarce.carry, battery: 50 };
    expect(new Game(seed, 4, s, 'scarce').player.battery).toBe(50);
    // Zloženie hordy podľa mutácie (cez súkromnú metódu).
    const mutate = (g: Game) =>
      (g as unknown as { mutate: (c: ReturnType<typeof hordeComposition>) => unknown }).mutate(
        hordeComposition(4),
      ) as ReturnType<typeof hordeComposition>;
    const base = hordeComposition(4);
    expect(mutate(new Game(seed, 4, carry, 'runners')).runner).toBeGreaterThan(base.runner);
    expect(mutate(new Game(seed, 4, carry, 'brutes')).brute).toBe(base.brute + 2);
  });

  it('história: jeden záznam na deň, od najnovšieho; séria dní po sebe', () => {
    const rec = (key: string, score = 10): DailyRecord => ({
      key,
      score,
      kills: 1,
      time: 60,
      done: false,
    });
    let list = upsertRecord([], rec('2026-11-10'));
    list = upsertRecord(list, rec('2026-11-12', 0));
    list = upsertRecord(list, rec('2026-11-11'));
    list = upsertRecord(list, rec('2026-11-12', 900));
    expect(list.map((r) => r.key)).toEqual(['2026-11-12', '2026-11-11', '2026-11-10']);
    expect(list[0]!.score).toBe(900);
    expect(streak(list, '2026-11-12')).toBe(3);
    expect(streak(list, '2026-11-13')).toBe(3); // dnes ešte nehral
    expect(streak(list, '2026-11-15')).toBe(0);
    expect(parseRecords(JSON.stringify(list))).toEqual(list);
    expect(parseRecords('{zlé')).toEqual([]);
    expect(parseRecords('[{"key":1}]')).toEqual([]);
  });
});
