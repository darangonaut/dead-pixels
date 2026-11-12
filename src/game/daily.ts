import type { Carry } from './game';
import { NO_UPGRADES } from './shop';

/**
 * Denné mesto: každý deň jedno mesto (rovnaké pre všetkých), jedna mutácia dňa,
 * jeden pokus. Výsledky sa ukladajú do histórie.
 */
export type DailyMod = 'dark' | 'runners' | 'scarce' | 'brutes';
export const DAILY_MODS: readonly DailyMod[] = ['dark', 'runners', 'scarce', 'brutes'];

export interface DailySetup {
  /** Dátum `RRRR-MM-DD` (miestny čas hráča). */
  key: string;
  seed: number;
  level: number;
  mod: DailyMod;
  carry: Carry;
}

export interface DailyRecord {
  key: string;
  score: number;
  kills: number;
  /** Čas hry (s). */
  time: number;
  /** Dostal sa k heliportu. */
  done: boolean;
}

/** Dátum na kľúč dňa (miestny čas). */
export function dailyKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Stabilný 32-bitový hash textu (FNV-1a s domiešaním). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** Mesto dňa: úroveň 2–9 (rôzne štvrte), mutácia a pevná výbava podľa úrovne. */
export function dailySetup(key: string): DailySetup {
  const h = hash(`dead-pixels:${key}`);
  const level = 2 + (h % 8);
  const mod = DAILY_MODS[(h >>> 8) % DAILY_MODS.length]!;
  const up = Math.floor(level / 3);
  const scarce = mod === 'scarce';
  const carry: Carry = {
    weapon: 'shotgun',
    ammo: {
      crowbar: Infinity,
      pistol: Infinity,
      shotgun: scarce ? 12 : 24,
      smg: scarce ? 60 : 120,
      flamer: 0,
    },
    owned: ['crowbar', 'pistol', 'shotgun', 'smg'],
    score: 0,
    kills: 0,
    lives: 2,
    cash: 0,
    grenades: scarce ? 1 : 3,
    upgrades: { ...NO_UPGRADES, damage: up, health: up, flashlight: up, speed: Math.min(1, up) },
    battery: scarce ? 50 : 100,
  };
  return { key, seed: h ^ 0x0da1, level, mod, carry };
}

/** Nový alebo aktualizovaný záznam dňa (jeden na deň), zoradené od najnovšieho. */
export function upsertRecord(list: readonly DailyRecord[], record: DailyRecord): DailyRecord[] {
  return [record, ...list.filter((r) => r.key !== record.key)]
    .sort((a, b) => b.key.localeCompare(a.key))
    .slice(0, 60);
}

/** Načíta históriu; poškodené dáta = prázdna. */
export function parseRecords(text: string | null): DailyRecord[] {
  if (!text) return [];
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (r): r is DailyRecord =>
          !!r &&
          typeof r === 'object' &&
          typeof (r as DailyRecord).key === 'string' &&
          typeof (r as DailyRecord).score === 'number',
      )
      .map((r) => ({
        key: r.key,
        score: r.score,
        kills: Number(r.kills) || 0,
        time: Number(r.time) || 0,
        done: !!r.done,
      }));
  } catch {
    return [];
  }
}

/** Séria: koľko dní po sebe (končiac dneškom alebo včerajškom) je odohratých. */
export function streak(list: readonly DailyRecord[], today: string): number {
  const keys = new Set(list.map((r) => r.key));
  const day = new Date(`${today}T12:00:00`);
  if (!keys.has(today)) day.setDate(day.getDate() - 1);
  let n = 0;
  while (keys.has(dailyKey(day))) {
    n++;
    day.setDate(day.getDate() - 1);
  }
  return n;
}
