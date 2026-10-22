export type WeaponId = 'pistol' | 'shotgun' | 'smg' | 'flamer';

export interface WeaponDef {
  id: WeaponId;
  /** Výstrely za sekundu. */
  rate: number;
  pellets: number;
  /** Rozptyl (radiány, celková šírka). */
  spread: number;
  damage: number;
  range: number;
  /** Odhodenie zombie pri zásahu (px). */
  knockback: number;
  /** Náboje v jednom balíku; Infinity = neobmedzene. */
  ammoPack: number;
  /** Zväčšenie záblesku (svetlo pri výstrele). */
  flash: number;
}

export const WEAPONS: Readonly<Record<WeaponId, WeaponDef>> = {
  pistol: {
    id: 'pistol',
    rate: 4,
    pellets: 1,
    spread: 0.04,
    damage: 1,
    range: 230,
    knockback: 3,
    ammoPack: Infinity,
    flash: 1,
  },
  shotgun: {
    id: 'shotgun',
    rate: 1.3,
    pellets: 7,
    spread: 0.45,
    damage: 1,
    range: 140,
    knockback: 7,
    ammoPack: 16,
    flash: 1.8,
  },
  smg: {
    id: 'smg',
    rate: 11,
    pellets: 1,
    spread: 0.14,
    damage: 0.6,
    range: 200,
    knockback: 1.5,
    ammoPack: 90,
    flash: 0.8,
  },
  // Plameňomet: krátky kužeľ ohňa, zapáli zombie (palivo = náboje).
  flamer: {
    id: 'flamer',
    rate: 20,
    pellets: 0,
    spread: 0.7,
    damage: 0.3,
    range: 64,
    knockback: 0,
    ammoPack: 120,
    flash: 0.6,
  },
};

export const WEAPON_ORDER: readonly WeaponId[] = ['pistol', 'shotgun', 'smg', 'flamer'];
