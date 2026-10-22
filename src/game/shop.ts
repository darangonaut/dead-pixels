import type { Carry } from './game';
import { WEAPONS, type WeaponId } from './weapons';

export type UpgradeId = 'damage' | 'flashlight' | 'health' | 'speed';
export type Upgrades = Record<UpgradeId, number>;

export const NO_UPGRADES: Upgrades = { damage: 0, flashlight: 0, health: 0, speed: 0 };

/** Vylepšenia: najvyššia úroveň a cena ďalšej úrovne. */
export const UPGRADES: Readonly<
  Record<UpgradeId, { max: number; cost: (level: number) => number }>
> = {
  damage: { max: 5, cost: (l) => 120 + l * 90 },
  flashlight: { max: 4, cost: (l) => 80 + l * 60 },
  health: { max: 5, cost: (l) => 100 + l * 80 },
  speed: { max: 3, cost: (l) => 110 + l * 90 },
};

/** Účinok vylepšení. */
export const damageFactor = (u: Upgrades) => 1 + u.damage * 0.15;
export const flashlightFactor = (u: Upgrades) => 1 + u.flashlight * 0.15;
export const maxHpFor = (u: Upgrades) => 100 + u.health * 20;
export const speedFactor = (u: Upgrades) => 1 + u.speed * 0.08;

const WEAPON_PRICE: Partial<Record<WeaponId, number>> = { shotgun: 150, smg: 220, flamer: 320 };
const AMMO_PRICE: Partial<Record<WeaponId, number>> = { shotgun: 40, smg: 45, flamer: 55 };
const GRENADES_PRICE = 60;
const GRENADES_PACK = 3;
export const MAX_GRENADES = 9;

export type ShopItemId = `weapon:${WeaponId}` | `ammo:${WeaponId}` | 'grenades' | `up:${UpgradeId}`;

export interface ShopItem {
  id: ShopItemId;
  cost: number;
  /** Dá sa kúpiť (nie je vlastnené / na maxime / vyžaduje zbraň). */
  available: boolean;
  /** Úroveň vylepšenia / množstvo nábojov (pre popis). */
  level?: number;
  max?: number;
}

/** Ponuka obchodu pre aktuálnu výbavu. Plameňomet od 4. úrovne. */
export function shopItems(carry: Carry, level: number): ShopItem[] {
  const items: ShopItem[] = [];
  for (const id of ['shotgun', 'smg', 'flamer'] as const) {
    if (id === 'flamer' && level < 4) continue;
    if (!carry.owned.includes(id))
      items.push({ id: `weapon:${id}`, cost: WEAPON_PRICE[id]!, available: true });
    else
      items.push({
        id: `ammo:${id}`,
        cost: AMMO_PRICE[id]!,
        available: true,
        level: carry.ammo[id],
      });
  }
  items.push({
    id: 'grenades',
    cost: GRENADES_PRICE,
    available: carry.grenades < MAX_GRENADES,
    level: carry.grenades,
    max: MAX_GRENADES,
  });
  for (const id of Object.keys(UPGRADES) as UpgradeId[]) {
    const lvl = carry.upgrades[id];
    const def = UPGRADES[id];
    items.push({
      id: `up:${id}`,
      cost: def.cost(lvl),
      available: lvl < def.max,
      level: lvl,
      max: def.max,
    });
  }
  return items;
}

/** Nákup: vráti novú výbavu, alebo null, ak sa nedá (málo peňazí / nedostupné). */
export function buy(carry: Carry, level: number, id: ShopItemId): Carry | null {
  const item = shopItems(carry, level).find((i) => i.id === id);
  if (!item || !item.available || carry.cash < item.cost) return null;
  const next: Carry = {
    ...carry,
    cash: carry.cash - item.cost,
    ammo: { ...carry.ammo },
    owned: [...carry.owned],
    upgrades: { ...carry.upgrades },
  };
  const [kind, what] = id.split(':') as [string, string];
  if (kind === 'weapon') {
    const w = what as WeaponId;
    next.owned.push(w);
    next.ammo[w] += WEAPONS[w].ammoPack;
    next.weapon = w;
  } else if (kind === 'ammo') {
    const w = what as WeaponId;
    next.ammo[w] += WEAPONS[w].ammoPack;
  } else if (kind === 'grenades') {
    next.grenades = Math.min(MAX_GRENADES, next.grenades + GRENADES_PACK);
  } else {
    next.upgrades[what as UpgradeId]++;
  }
  return next;
}
