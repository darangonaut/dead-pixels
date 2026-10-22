import { createRng, randomInt } from './rng';

export const TILE = 16;

export const enum Tile {
  Road,
  Sidewalk,
  Grass,
  Building,
  Car,
  Tree,
  Lamp,
  Crate,
}

/** Mesto: mriežka políčok, autá a budovy blokujú pohyb aj svetlo. */
export interface CityMap {
  width: number;
  height: number;
  tiles: Uint8Array;
  /** Farba strechy / auta (index do palety) pre políčka budov a áut. */
  variant: Uint8Array;
  lamps: { x: number; y: number }[];
  spawn: { x: number; y: number };
}

const SOLID = new Set<Tile>([Tile.Building, Tile.Car, Tile.Tree, Tile.Lamp, Tile.Crate]);
const OPAQUE = new Set<Tile>([Tile.Building, Tile.Car, Tile.Crate]);

export const tileAt = (map: CityMap, tx: number, ty: number): Tile =>
  tx < 0 || ty < 0 || tx >= map.width || ty >= map.height
    ? Tile.Building
    : (map.tiles[ty * map.width + tx]! as Tile);

/** Políčko, cez ktoré sa nedá prejsť (okraj mapy je stena). */
export const isSolid = (map: CityMap, tx: number, ty: number): boolean =>
  SOLID.has(tileAt(map, tx, ty));

/** Políčko, ktoré zastaví svetlo baterky (budovy, autá, debny — nie stromy a lampy). */
export const isOpaque = (map: CityMap, tx: number, ty: number): boolean =>
  OPAQUE.has(tileAt(map, tx, ty));

const BLOCK = 13;
const STREET = 4;

/**
 * Vygeneruje štvrť: mriežka ulíc (vozovka so chodníkmi), bloky s budovami, uličkami
 * a parkami, autá na cestách a lampy pri chodníkoch.
 */
export function generateCity(seed: number, blocksX = 5, blocksY = 4): CityMap {
  const rng = createRng(seed);
  const width = blocksX * (BLOCK + STREET) + STREET;
  const height = blocksY * (BLOCK + STREET) + STREET;
  const tiles = new Uint8Array(width * height).fill(Tile.Road);
  const variant = new Uint8Array(width * height);
  const set = (x: number, y: number, t: Tile, v = 0) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    tiles[y * width + x] = t;
    variant[y * width + x] = v;
  };
  const get = (x: number, y: number) => tiles[y * width + x] as Tile;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const x0 = STREET + bx * (BLOCK + STREET);
      const y0 = STREET + by * (BLOCK + STREET);
      // Chodník okolo bloku.
      for (let y = y0 - 1; y <= y0 + BLOCK; y++)
        for (let x = x0 - 1; x <= x0 + BLOCK; x++) set(x, y, Tile.Sidewalk);
      if (rng() < 0.2) {
        // Park: tráva, stromy, pár debien.
        for (let y = y0; y < y0 + BLOCK; y++)
          for (let x = x0; x < x0 + BLOCK; x++) {
            set(x, y, Tile.Grass);
            if (rng() < 0.12) set(x, y, Tile.Tree);
          }
        continue;
      }
      // Budovy: blok rozdelený uličkou na 2–4 domy.
      for (let y = y0; y < y0 + BLOCK; y++)
        for (let x = x0; x < x0 + BLOCK; x++) set(x, y, Tile.Sidewalk);
      const splitX = randomInt(rng, 4, BLOCK - 5);
      const splitY = randomInt(rng, 4, BLOCK - 5);
      const rects = [
        [x0, y0, splitX, splitY],
        [x0 + splitX + 2, y0, BLOCK - splitX - 2, splitY],
        [x0, y0 + splitY + 2, splitX, BLOCK - splitY - 2],
        [x0 + splitX + 2, y0 + splitY + 2, BLOCK - splitX - 2, BLOCK - splitY - 2],
      ] as const;
      for (const [rx, ry, rw, rh] of rects) {
        if (rng() < 0.15) continue; // prázdna parcela
        const roof = randomInt(rng, 0, 3);
        for (let y = ry; y < ry + rh; y++)
          for (let x = rx; x < rx + rw; x++) set(x, y, Tile.Building, roof);
      }
      // Debny v uličkách.
      for (let i = 0; i < 3; i++) {
        const x = x0 + splitX + randomInt(rng, 0, 1);
        const y = y0 + randomInt(rng, 0, BLOCK - 1);
        if (get(x, y) === Tile.Sidewalk && rng() < 0.5) set(x, y, Tile.Crate);
      }
    }
  }

  // Lampy na rohoch blokov a v strede strán.
  const lamps: { x: number; y: number }[] = [];
  for (let by = 0; by <= blocksY; by++)
    for (let bx = 0; bx <= blocksX; bx++) {
      const x = STREET + bx * (BLOCK + STREET) - 1;
      const y = STREET + by * (BLOCK + STREET) - 1;
      for (const [lx, ly] of [
        [x, y],
        [x + Math.floor(BLOCK / 2) + 1, y],
      ] as const) {
        if (
          lx > 0 &&
          ly > 0 &&
          lx < width - 1 &&
          ly < height - 1 &&
          get(lx, ly) === Tile.Sidewalk
        ) {
          if (rng() < 0.75) {
            set(lx, ly, Tile.Lamp);
            lamps.push({ x: (lx + 0.5) * TILE, y: (ly + 0.5) * TILE });
          }
        }
      }
    }

  // Opustené autá na cestách (1 × 2 políčka).
  const cars = Math.floor(width * height * 0.006);
  for (let i = 0; i < cars; i++) {
    const x = randomInt(rng, 1, width - 3);
    const y = randomInt(rng, 1, height - 3);
    const horizontal = rng() < 0.5;
    const x2 = horizontal ? x + 1 : x;
    const y2 = horizontal ? y : y + 1;
    if (get(x, y) !== Tile.Road || get(x2, y2) !== Tile.Road) continue;
    const color = randomInt(rng, 0, 4) | (horizontal ? 0x10 : 0);
    set(x, y, Tile.Car, color);
    set(x2, y2, Tile.Car, color | 0x20);
  }

  // Štart: stred mapy na najbližšej voľnej ceste.
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  let spawn = { x: (cx + 0.5) * TILE, y: (cy + 0.5) * TILE };
  outer: for (let r = 0; r < 20; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const t = get(cx + dx, cy + dy);
        if (t === Tile.Road) {
          spawn = { x: (cx + dx + 0.5) * TILE, y: (cy + dy + 0.5) * TILE };
          break outer;
        }
      }
  // Okolo štartu nič neblokuje (autá preč).
  const stx = Math.floor(spawn.x / TILE);
  const sty = Math.floor(spawn.y / TILE);
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      if (get(stx + dx, sty + dy) === Tile.Car) set(stx + dx, sty + dy, Tile.Road);

  return { width, height, tiles, variant, lamps, spawn };
}
