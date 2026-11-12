export type WeaponId = 'crowbar' | 'pistol' | 'shotgun' | 'smg' | 'flamer';

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
  /**
   * Hlasitosť (px): zombie bližšie ako polovica zbystria, ďalšie v dosahu prídu zvuk
   * preskúmať.
   */
  noise: number;
}

export const WEAPONS: Readonly<Record<WeaponId, WeaponDef>> = {
  // Pajcer: tichý úder na blízko (oblúk pred hráčom), nič nespotrebuje.
  crowbar: {
    id: 'crowbar',
    rate: 2.4,
    pellets: 0,
    spread: 1.7,
    damage: 2,
    range: 21,
    knockback: 6,
    ammoPack: Infinity,
    flash: 0,
    noise: 24,
  },
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
    noise: 150,
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
    noise: 280,
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
    noise: 210,
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
    noise: 110,
  },
};

export const WEAPON_ORDER: readonly WeaponId[] = ['crowbar', 'pistol', 'shotgun', 'smg', 'flamer'];

/** Zbrane, ktoré má hráč vždy (s neobmedzenými nábojmi). */
export const STARTING_WEAPONS: readonly WeaponId[] = ['pistol', 'crowbar'];
