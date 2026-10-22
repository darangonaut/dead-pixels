import type { Carry } from './game';
import { NO_UPGRADES } from './shop';

/** Uložený postup: začiatok poslednej úrovne s výbavou. */
export interface SaveData {
  version: 1;
  seed: number;
  level: number;
  carry: Carry;
  savedAt: string;
}

/** JSON nevie Infinity (pištoľ) — ukladá sa ako null. */
export function serializeSave(save: SaveData): string {
  return JSON.stringify(save, (_, v) => (v === Infinity ? null : v));
}

/** Načíta uložený postup; poškodené alebo neznáme dáta vráti ako null. */
export function parseSave(text: string | null): SaveData | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Partial<SaveData>;
    if (
      raw.version !== 1 ||
      typeof raw.level !== 'number' ||
      !raw.carry ||
      typeof raw.seed !== 'number'
    )
      return null;
    const c = raw.carry;
    const carry: Carry = {
      weapon: c.weapon ?? 'pistol',
      ammo: {
        pistol: Infinity,
        shotgun: c.ammo?.shotgun ?? 0,
        smg: c.ammo?.smg ?? 0,
        flamer: c.ammo?.flamer ?? 0,
      },
      owned: Array.isArray(c.owned) && c.owned.length > 0 ? c.owned : ['pistol'],
      score: c.score ?? 0,
      kills: c.kills ?? 0,
      lives: c.lives ?? 3,
      cash: c.cash ?? 0,
      grenades: c.grenades ?? 2,
      upgrades: { ...NO_UPGRADES, ...c.upgrades },
    };
    return { version: 1, seed: raw.seed, level: raw.level, carry, savedAt: raw.savedAt ?? '' };
  } catch {
    return null;
  }
}
