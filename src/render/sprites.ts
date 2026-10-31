import {
  carBurnt,
  PARKING_LINE,
  ROAD_LINE_H,
  ROAD_LINE_V,
  TILE,
  Tile,
  type CityMap,
  type District,
} from '@/game/map';
import type { ZombieKind } from '@/game/game';
import type { WeaponId } from '@/game/weapons';
import { PixelCanvas, pixelNoise, shade, type Rgb } from './PixelCanvas';

/**
 * Pixelov kresby na jeden pixel sveta. Všetko sa kreslí v dvojnásobnom rozlíšení
 * (jemnejšie pixely, viac detailov) a renderer textúry zmenší späť na veľkosť sveta.
 */
export const PX = 2;
/** Políčko mapy v pixeloch kresby. */
const T = TILE * PX;

/** Paleta: tlmené farby nočného mesta. */
export const C = {
  ink: 0x0d0b14,
  asphalt: 0x343842,
  asphaltDark: 0x2a2d35,
  asphaltLight: 0x40454f,
  line: 0xb59a3c,
  sidewalk: 0x7d8290,
  sidewalkDark: 0x6a6f7c,
  curb: 0x595d68,
  grass: 0x2d4d2c,
  grassDark: 0x223c22,
  grassLight: 0x3a5e36,
  leaf: 0x234a2a,
  leafLight: 0x3d6b3a,
  wood: 0x7a5435,
  woodDark: 0x553923,
  metal: 0x8b93a1,
  metalDark: 0x555b66,
  skin: 0xd8a482,
  zombieSkin: 0x8fae74,
  zombieDark: 0x5e7a4a,
  blood: 0x7a1020,
  bloodDark: 0x4e0912,
  bloodLight: 0xa8182c,
  white: 0xffffff,
  yellow: 0xffd34e,
} as const;

const ROOFS: Record<District, readonly Rgb[]> = {
  city: [0x4e4446, 0x434b5c, 0x5a4a3a, 0x3c4a3c],
  hospital: [0x8a8e96, 0x7a8088, 0x969aa2, 0x6e747e],
  metro: [0x34302c, 0x2c2a28, 0x3a3530, 0x302c2a],
  base: [0x4a5234, 0x3e4630, 0x56583a, 0x444a36],
};
const CARS: readonly Rgb[] = [0x8a2b2b, 0x2e4f7a, 0xb8b8b0, 0xa8862e, 0x3e6a44, 0xe8e8e4];

// --- Pomocné kreslenie ---

/** Hladký šum 0–1 (bilineárne medzi uzlami mriežky s krokom `step`). */
function smooth(x: number, y: number, seed: number, step: number): number {
  const fx = x / step;
  const fy = y / step;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  let tx = fx - ix;
  let ty = fy - iy;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const a = pixelNoise(ix, iy, seed);
  const b = pixelNoise(ix + 1, iy, seed);
  const c = pixelNoise(ix, iy + 1, seed);
  const d = pixelNoise(ix + 1, iy + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/**
 * Elipsa so stredom (cx, cy). `color` dostane normalizované súradnice (−1 až 1)
 * a súradnice pixela; null pixel vynechá.
 */
function ellipse(
  pc: PixelCanvas,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: Rgb | ((nx: number, ny: number, x: number, y: number) => Rgb | null),
  alpha = 255,
): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      const c = typeof color === 'function' ? color(nx, ny, x, y) : color;
      if (c !== null) pc.set(x, y, c, alpha);
    }
}

/** Hrubá čiara (úsečka s hrúbkou w); `color` dostane polohu na úsečke a stranu (−1 až 1). */
function line(
  pc: PixelCanvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  color: Rgb | ((t: number, side: number) => Rgb),
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  const r = w / 2;
  for (let y = Math.floor(Math.min(y0, y1) - r); y <= Math.ceil(Math.max(y0, y1) + r); y++)
    for (let x = Math.floor(Math.min(x0, x1) - r); x <= Math.ceil(Math.max(x0, x1) + r); x++) {
      const px = x + 0.5 - x0;
      const py = y + 0.5 - y0;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const ex = px - t * dx;
      const ey = py - t * dy;
      if (ex * ex + ey * ey > r * r) continue;
      const side = (ex * -dy + ey * dx) / Math.sqrt(len2) / r;
      pc.set(x, y, typeof color === 'function' ? color(t, side) : color);
    }
}

/**
 * Tieňovanie gule pri pohľade zhora (nezávislé od otočenia sprite):
 * stred je najsvetlejší, okraj tmavší. Vráti jeden z troch tónov.
 */
function dome(base: Rgb, nx: number, ny: number, light = 1.18, dark = 0.72): Rgb {
  const r = nx * nx + ny * ny;
  return r < 0.28 ? shade(base, light) : r < 0.7 ? base : shade(base, dark);
}

/** Šum na farbe (zrnitosť materiálu). */
function grain(base: Rgb, x: number, y: number, seed: number, amount: number): Rgb {
  return shade(base, 1 + (pixelNoise(x, y, seed) - 0.5) * amount);
}

/** Puklina: náhodná prechádzka tmavými pixelmi. */
function crack(
  pc: PixelCanvas,
  x: number,
  y: number,
  seed: number,
  length: number,
  color: Rgb,
): void {
  let a = pixelNoise(x, y, seed) * Math.PI * 2;
  let px = x;
  let py = y;
  for (let i = 0; i < length; i++) {
    pc.set(Math.round(px), Math.round(py), color);
    a += (pixelNoise(i, seed, x + y) - 0.5) * 1.4;
    px += Math.cos(a);
    py += Math.sin(a);
  }
}

// --- Povrchy (súradnice v pixeloch kresby, políčko má T × T) ---

function asphalt(pc: PixelCanvas, x0: number, y0: number): void {
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const gx = x0 + x;
      const gy = y0 + y;
      const n = pixelNoise(gx, gy, 11);
      const patch = smooth(gx, gy, 12, 22);
      let c: Rgb = patch < 0.35 ? 0x31353e : patch > 0.7 ? 0x383c46 : C.asphalt;
      if (n < 0.06) c = C.asphaltDark;
      else if (n > 0.975) c = C.asphaltLight;
      else if (n > 0.93) c = shade(c, 1.07);
      pc.set(gx, gy, c);
    }
  if (pixelNoise(x0, y0, 13) < 0.12)
    crack(pc, x0 + 6 + ((pixelNoise(x0, y0, 14) * 20) | 0), y0 + 10, x0 + y0, 18, 0x25282f);
  // Mastný fľak.
  if (pixelNoise(x0, y0, 15) < 0.06)
    ellipse(pc, x0 + 16, y0 + 16, 7, 5, (nx, ny, x, y) =>
      pixelNoise(x, y, 16) < 0.75 ? (nx * nx + ny * ny < 0.4 ? 0x24272d : 0x2c2f37) : null,
    );
}

function sidewalk(pc: PixelCanvas, x0: number, y0: number): void {
  // Štyri dlaždice na políčko so škárou, svetlou a tmavou hranou.
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const gx = x0 + x;
      const gy = y0 + y;
      const lx = gx % 16;
      const ly = gy % 16;
      const slab = shade(C.sidewalk, 0.94 + pixelNoise(gx >> 4, gy >> 4, 21) * 0.1);
      let c: Rgb;
      if (lx === 0 || ly === 0) c = 0x5f6470;
      else if (lx === 1 || ly === 1) c = shade(slab, 1.1);
      else if (lx === 15 || ly === 15) c = shade(slab, 0.88);
      else {
        const n = pixelNoise(gx, gy, 23);
        c = n < 0.05 ? C.sidewalkDark : n > 0.97 ? shade(slab, 1.08) : slab;
      }
      pc.set(gx, gy, c);
    }
  if (pixelNoise(x0, y0, 24) < 0.1) crack(pc, x0 + 8, y0 + 8, x0 * 3 + y0, 12, 0x5f6470);
}

function concrete(pc: PixelCanvas, x0: number, y0: number): void {
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const gx = x0 + x;
      const gy = y0 + y;
      const n = pixelNoise(gx, gy, 17);
      const stain = smooth(gx, gy, 18, 18);
      let c: Rgb = stain < 0.25 ? 0x46494f : stain > 0.75 ? 0x4d5058 : 0x4a4d55;
      if (n < 0.05) c = 0x3c3f46;
      else if (n > 0.985) c = 0x5c606a;
      pc.set(gx, gy, c);
    }
  // Škáry medzi panelmi (tmavá ryha a svetlý okraj).
  if ((x0 / T) % 3 === 0) {
    pc.fillRect(x0, y0, 1, T, 0x34373d);
    pc.fillRect(x0 + 1, y0, 1, T, 0x52555d);
  }
  if ((y0 / T) % 3 === 0) {
    pc.fillRect(x0, y0, T, 1, 0x34373d);
    pc.fillRect(x0, y0 + 1, T, 1, 0x52555d);
  }
}

/** Biela nemocničná dlažba so škárami. */
function whiteTiles(pc: PixelCanvas, x0: number, y0: number): void {
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const gx = x0 + x;
      const gy = y0 + y;
      const lx = gx % 16;
      const ly = gy % 16;
      const dirty = pixelNoise(gx >> 4, gy >> 4, 27) < 0.12;
      const base = dirty ? 0xbcbfc0 : 0xc4c8ce;
      let c: Rgb;
      if (lx === 0 || ly === 0) c = 0x9a9ea6;
      else if (lx === 1 || ly === 1) c = 0xd4d8de;
      else if (lx === 15 || ly === 15) c = shade(base, 0.92);
      else {
        const n = pixelNoise(gx, gy, 29);
        c = n < 0.015 ? 0x9a9ea6 : n > 0.98 ? 0xd0d4da : base;
      }
      pc.set(gx, gy, c);
    }
}

/** Štrk koľajiska. */
function gravel(pc: PixelCanvas, x0: number, y0: number): void {
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const gx = x0 + x;
      const gy = y0 + y;
      // Kamienky 2 × 2 so svetlým vrškom a tmavou škárou.
      const stone = pixelNoise(gx >> 1, gy >> 1, 37);
      let c: Rgb = stone < 0.3 ? 0x3e3a35 : stone < 0.7 ? 0x46423c : 0x504b45;
      if ((gx & 1) === 0 && (gy & 1) === 0) c = shade(c, 1.06);
      if (pixelNoise(gx, gy, 38) < 0.04) c = 0x33302c;
      pc.set(gx, gy, c);
    }
}

function grass(pc: PixelCanvas, x0: number, y0: number): void {
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const gx = x0 + x;
      const gy = y0 + y;
      const patch = smooth(gx, gy, 32, 14);
      let c: Rgb = patch < 0.3 ? 0x284628 : patch > 0.72 ? 0x325430 : C.grass;
      const n = pixelNoise(gx, gy, 31);
      if (n < 0.08) c = C.grassDark;
      else if (n > 0.95) c = C.grassLight;
      pc.set(gx, gy, c);
    }
  // Steblá: svetlý vršok, tmavá pätka.
  for (let i = 0; i < 26; i++) {
    const bx = x0 + ((pixelNoise(i, x0, y0 + 33) * T) | 0);
    const by = y0 + ((pixelNoise(i, y0, x0 + 34) * (T - 2)) | 0);
    pc.set(bx, by, 0x4a7040);
    pc.set(bx, by + 1, C.grassLight);
    pc.set(bx, by + 2, C.grassDark);
  }
}

/** Prah brány: tmavý pás so žltými výstražnými pruhmi. */
function threshold(pc: PixelCanvas, x0: number, y0: number): void {
  pc.fillRect(x0, y0, T, T, C.asphaltDark);
  for (let i = 0; i < T; i++)
    for (let k = 0; k < T; k++) {
      if (!(i < 4 || i > T - 5 || k < 4 || k > T - 5)) continue;
      if (((i + k) >> 3) % 2 !== 0) continue;
      const worn = pixelNoise(x0 + i, y0 + k, 39) < 0.15;
      pc.set(x0 + i, y0 + k, worn ? 0x5a4a1a : 0x8a7020);
    }
}

/** Celé mesto do jedného obrázka (statická zem a značenie). */
export function drawGround(map: CityMap): PixelCanvas {
  const pc = new PixelCanvas(map.width * T, map.height * T);
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= map.width || y >= map.height
      ? Tile.Building
      : (map.tiles[y * map.width + x] as Tile);
  const roadLike = (t: Tile) => t === Tile.Road || t === Tile.Car;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const raw = at(x, y);
      // Pod sudom sa kreslí pôvodná podlaha (sud je samostatný sprite, dá sa zničiť).
      const t = raw === Tile.Barrel ? (map.variant[y * map.width + x] as Tile) : raw;
      const x0 = x * T;
      const y0 = y * T;
      switch (t) {
        case Tile.Road:
        case Tile.Car:
        case Tile.Helipad:
          asphalt(pc, x0, y0);
          break;
        case Tile.Grass:
        case Tile.Tree:
          grass(pc, x0, y0);
          break;
        case Tile.Floor:
        case Tile.Pillar:
          concrete(pc, x0, y0);
          break;
        case Tile.WhiteFloor:
        case Tile.Bed:
        case Tile.Desk:
          if (map.district === 'hospital') whiteTiles(pc, x0, y0);
          else concrete(pc, x0, y0);
          break;
        case Tile.Track:
          gravel(pc, x0, y0);
          break;
        case Tile.Gate:
        case Tile.Door:
          threshold(pc, x0, y0);
          break;
        default:
          sidewalk(pc, x0, y0);
      }
      // Obrubník chodníka pri ceste: kameň so svetlou hranou a tmavou ryhou k ceste.
      if (t === Tile.Sidewalk || t === Tile.Lamp || t === Tile.Crate) {
        if (roadLike(at(x, y + 1))) {
          pc.fillRect(x0, y0 + T - 4, T, 4, C.curb);
          pc.fillRect(x0, y0 + T - 4, T, 1, 0x6c707b);
          pc.fillRect(x0, y0 + T - 1, T, 1, 0x3e414a);
        }
        if (roadLike(at(x, y - 1))) {
          pc.fillRect(x0, y0, T, 4, C.curb);
          pc.fillRect(x0, y0 + 3, T, 1, 0x6c707b);
          pc.fillRect(x0, y0, T, 1, 0x3e414a);
        }
        if (roadLike(at(x + 1, y))) {
          pc.fillRect(x0 + T - 4, y0, 4, T, C.curb);
          pc.fillRect(x0 + T - 4, y0, 1, T, 0x6c707b);
          pc.fillRect(x0 + T - 1, y0, 1, T, 0x3e414a);
        }
        if (roadLike(at(x - 1, y))) {
          pc.fillRect(x0, y0, 4, T, C.curb);
          pc.fillRect(x0 + 3, y0, 1, T, 0x6c707b);
          pc.fillRect(x0, y0, 1, T, 0x3e414a);
        }
      }
    }
  }

  // Značenie: stredová čiara ulíc, parkovacie čiary, koľaje, stĺpy v sklade.
  const paint = (gx: number, gy: number, color: Rgb) => {
    if (pixelNoise(gx, gy, 43) > 0.12) pc.set(gx, gy, color);
  };
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const v = map.variant[y * map.width + x]!;
      const t = at(x, y);
      const x0 = x * T;
      const y0 = y * T;
      if (t === Tile.Road && v === ROAD_LINE_H)
        for (let i = 0; i < T; i++)
          if ((x0 + i) % 24 < 12) for (let k = 14; k < 17; k++) paint(x0 + i, y0 + k, C.line);
      if (t === Tile.Road && v === ROAD_LINE_V)
        for (let i = 0; i < T; i++)
          if ((y0 + i) % 24 < 12) for (let k = 14; k < 17; k++) paint(x0 + k, y0 + i, C.line);
      if ((t === Tile.Road || t === Tile.Car) && v === PARKING_LINE)
        for (let i = 0; i < T; i++) for (let k = T - 2; k < T; k++) paint(x0 + k, y0 + i, 0xb8bcc4);
      // Koľaje: podvaly s letokruhmi, dve koľajnice s leskom a podkladnice.
      if (t === Tile.Track) {
        const horizontal = v !== ROAD_LINE_V;
        const put = (a: number, b: number, c: Rgb) =>
          horizontal ? pc.set(x0 + a, y0 + b, c) : pc.set(x0 + b, y0 + a, c);
        for (let i = 3; i < T; i += 10)
          for (let a = i; a < i + 5; a++)
            for (let b = 4; b < 28; b++)
              put(a, b, a === i ? 0x6d4836 : grain(0x5d3a2c, a + x0, b + y0, 44, 0.25));
        if (v === ROAD_LINE_H || v === ROAD_LINE_V)
          for (const r of [8, 22])
            for (let a = 0; a < T; a++) {
              put(a, r - 1, 0x2a2826);
              put(a, r, 0xc8ccd4);
              put(a, r + 1, 0x8a909a);
              put(a, r + 2, 0x4a4e56);
              const m = (((a - 3) % 10) + 10) % 10;
              if (m < 5) {
                put(a, r - 2, 0x3a3a3c);
                put(a, r + 3, 0x3a3a3c);
              }
            }
      }
      // Žltá výstražná hrana nástupišťa s hmatovými bodmi.
      if (t === Tile.Floor) {
        const edge = (ax: number, ay: number, w: number, h: number) => {
          for (let yy = 0; yy < h; yy++)
            for (let xx = 0; xx < w; xx++) {
              const gx = x0 + ax + xx;
              const gy = y0 + ay + yy;
              pc.set(gx, gy, gx % 3 === 1 && gy % 3 === 1 ? 0xa88a2a : 0xc8a83a);
            }
        };
        if (at(x, y + 1) === Tile.Track) edge(0, T - 6, T, 6);
        if (at(x, y - 1) === Tile.Track) edge(0, 0, T, 6);
        if (at(x + 1, y) === Tile.Track) edge(T - 6, 0, 6, T);
        if (at(x - 1, y) === Tile.Track) edge(0, 0, 6, T);
      }
      if (t === Tile.Pillar) {
        // Tieň stĺpa, plášť so svetlou a tmavou hranou.
        pc.fillRect(x0 + 9, y0 + 9, 20, 20, 0x26282d);
        pc.fillRect(x0 + 6, y0 + 6, 20, 20, 0x5a5e66);
        pc.fillRect(x0 + 6, y0 + 6, 20, 3, 0x7a7e88);
        pc.fillRect(x0 + 6, y0 + 6, 2, 20, 0x6c7078);
        pc.fillRect(x0 + 23, y0 + 6, 3, 20, 0x40444c);
        pc.fillRect(x0 + 6, y0 + 23, 20, 3, 0x464a52);
        for (let yy = 9; yy < 23; yy++)
          for (let xx = 8; xx < 23; xx++)
            if (pixelNoise(x0 + xx, y0 + yy, 45) < 0.07) pc.set(x0 + xx, y0 + yy, 0x50545c);
      }
    }
  // Heliport: kruh a písmeno H cez celú plochu 4 × 4 políčok.
  for (let y = 1; y < map.height - 1; y++)
    for (let x = 1; x < map.width - 1; x++) {
      if (
        at(x, y) !== Tile.Helipad ||
        at(x - 1, y) === Tile.Helipad ||
        at(x, y - 1) === Tile.Helipad
      )
        continue;
      const cx = x * T + 2 * T;
      const cy = y * T + 2 * T;
      const mark = (gx: number, gy: number) =>
        pc.set(gx, gy, pixelNoise(gx, gy, 46) < 0.1 ? 0xa8a088 : 0xd8d0b0);
      for (let yy = -64; yy < 64; yy++)
        for (let xx = -64; xx < 64; xx++) {
          const d = Math.hypot(xx + 0.5, yy + 0.5);
          if (d > 52 && d < 60) mark(cx + xx, cy + yy);
        }
      for (const [rx, ry, w, h] of [
        [-24, -28, 10, 56],
        [14, -28, 10, 56],
        [-14, -4, 28, 10],
      ] as const)
        for (let yy = 0; yy < h; yy++)
          for (let xx = 0; xx < w; xx++) mark(cx + rx + xx, cy + ry + yy);
    }

  return pc;
}

/** Strechy budov zvlášť: kreslia sa nad tmou ako siluety v mesačnom svetle. */
export function drawRoofs(map: CityMap): PixelCanvas {
  const pc = new PixelCanvas(map.width * T, map.height * T);
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= map.width || y >= map.height
      ? Tile.Building
      : (map.tiles[y * map.width + x] as Tile);
  const v = (x: number, y: number) => map.variant[y * map.width + x]!;
  // Strechy budov: lepenka so švami, atika so svetlou hranou, tmavšia južná a východná
  // hrana, vzduchotechnika, svetlíky a prieduchy.
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      if (at(x, y) !== Tile.Building) continue;
      const palette = ROOFS[map.district];
      const roof = palette[v(x, y) % palette.length]!;
      const x0 = x * T;
      const y0 = y * T;
      for (let yy = 0; yy < T; yy++)
        for (let xx = 0; xx < T; xx++) {
          const gx = x0 + xx;
          const gy = y0 + yy;
          const n = pixelNoise(gx, gy, 41);
          let c = smooth(gx, gy, 47, 20) < 0.3 ? shade(roof, 0.94) : roof;
          if (n < 0.06) c = shade(roof, 0.86);
          else if (n > 0.97) c = shade(roof, 1.1);
          if (gy % 20 === 0) c = shade(c, 0.9);
          pc.set(gx, gy, c);
        }
      const edge = shade(roof, 1.25);
      const top = shade(roof, 1.45);
      const dark = shade(roof, 0.6);
      if (at(x, y - 1) !== Tile.Building) {
        pc.fillRect(x0, y0, T, 4, edge);
        pc.fillRect(x0, y0, T, 1, top);
        pc.fillRect(x0, y0 + 4, T, 1, shade(roof, 0.8));
      }
      if (at(x - 1, y) !== Tile.Building) {
        pc.fillRect(x0, y0, 4, T, edge);
        pc.fillRect(x0, y0, 1, T, top);
        pc.fillRect(x0 + 4, y0 + 4, 1, T - 4, shade(roof, 0.8));
      }
      if (at(x, y + 1) !== Tile.Building) {
        pc.fillRect(x0, y0 + T - 6, T, 6, dark);
        pc.fillRect(x0, y0 + T - 6, T, 1, shade(roof, 0.75));
      }
      if (at(x + 1, y) !== Tile.Building) {
        pc.fillRect(x0 + T - 6, y0, 6, T, dark);
        pc.fillRect(x0 + T - 6, y0, 1, T, shade(roof, 0.75));
      }
      if (pixelNoise(x, y, 51) < 0.12) {
        // Klimatizačná jednotka: tieň, plášť, mriežka a ventilátor.
        pc.fillRect(x0 + 10, y0 + 10, 16, 14, shade(roof, 0.55));
        pc.fillRect(x0 + 7, y0 + 7, 16, 14, C.metalDark);
        pc.fillRect(x0 + 7, y0 + 7, 16, 1, 0xa8b0bc);
        pc.fillRect(x0 + 8, y0 + 8, 14, 12, C.metal);
        for (let k = 9; k < 20; k += 2) pc.fillRect(x0 + 9, y0 + k, 4, 1, C.metalDark);
        ellipse(pc, x0 + 17.5, y0 + 14, 4, 4, (nx, ny) =>
          Math.abs(nx) < 0.25 || Math.abs(ny) < 0.25 ? 0x6a717c : 0x3a3f48,
        );
      } else if (pixelNoise(x, y, 52) < 0.08) {
        // Prieduch s poklopom.
        pc.fillRect(x0 + 11, y0 + 11, 10, 10, C.metalDark);
        pc.fillRect(x0 + 12, y0 + 12, 8, 8, C.ink);
        for (let k = 13; k < 20; k += 2) pc.fillRect(x0 + 12, y0 + k, 8, 1, 0x2a2e36);
        pc.fillRect(x0 + 11, y0 + 11, 10, 1, C.metal);
      } else if (pixelNoise(x, y, 53) < 0.05) {
        // Svetlík: rám a tmavé sklo s odleskom.
        pc.fillRect(x0 + 6, y0 + 9, 20, 14, 0x6a707a);
        pc.fillRect(x0 + 7, y0 + 10, 18, 12, 0x1c2633);
        pc.fillRect(x0 + 16, y0 + 10, 1, 12, 0x6a707a);
        for (let k = 0; k < 5; k++) pc.set(x0 + 9 + k, y0 + 19 - k, 0x3a5068);
      }
    }

  return pc;
}

/** Auto zhora v pozdĺžnej polohe (56 × 26), predkom k x = 0. */
function drawCar(body: Rgb, burnt: boolean, ambulance: boolean, seed: number): PixelCanvas {
  const L = 56;
  const W = 26;
  const pc = new PixelCanvas(L, W + 2);
  const oy = 1;
  for (let y = 0; y < W; y++)
    for (let x = 0; x < L; x++) {
      // Zaoblené rohy.
      const cx = Math.min(x, L - 1 - x);
      const cy = Math.min(y, W - 1 - y);
      if (cx < 3 && cy < 3 && (3 - cx) ** 2 + (3 - cy) ** 2 > 10) continue;
      let c = body;
      if (y < 2) c = shade(body, 1.2);
      else if (y > W - 3) c = shade(body, 0.7);
      if (burnt && pixelNoise(x, y, seed) < 0.3)
        c = pixelNoise(x, y, seed + 1) < 0.5 ? 0x5a3a26 : 0x242424;
      else if (pixelNoise(x, y, 62) < 0.03) c = shade(body, 0.75);
      pc.set(x, y + oy, c);
    }
  const glass = burnt ? 0x141414 : 0x22303f;
  const glassHi = burnt ? 0x2a2a2a : 0x4a6680;
  // Kapota so švom, čelné sklo, strecha, zadné sklo.
  pc.fillRect(4, oy + 3, 1, W - 6, shade(body, 0.8));
  for (let x = 13; x < 21; x++) {
    const inset = Math.round((20 - x) * 0.35) + 3;
    for (let y = inset; y < W - inset; y++) pc.set(x, y + oy, glass);
  }
  for (let k = 0; k < 5; k++) pc.set(15 + k, oy + 6 + k, glassHi);
  pc.fillRect(21, oy + 3, 17, W - 6, shade(body, burnt ? 0.6 : 0.88));
  pc.fillRect(21, oy + 3, 17, 1, shade(body, 1.1));
  pc.fillRect(38, oy + 4, 6, W - 8, glass);
  pc.fillRect(39, oy + 5, 1, 4, glassHi);
  // Bočné okná a spätné zrkadlá.
  pc.fillRect(21, oy + 1, 16, 2, glass);
  pc.fillRect(21, oy + W - 3, 16, 2, glass);
  pc.fillRect(17, 0, 3, 1, shade(body, 0.6));
  pc.fillRect(17, W + 1, 3, 1, shade(body, 0.6));
  if (!burnt) {
    // Svetlá vpredu, zadné červené.
    pc.fillRect(0, oy + 3, 1, 4, 0xe8e0b0);
    pc.fillRect(0, oy + W - 7, 1, 4, 0xe8e0b0);
    pc.fillRect(L - 1, oy + 3, 1, 4, 0xa82020);
    pc.fillRect(L - 1, oy + W - 7, 1, 4, 0xa82020);
  }
  if (ambulance && !burnt) {
    // Sanitka: červený pruh, modrý maják a kríž na streche.
    pc.fillRect(0, oy + 11, L, 4, 0xc82828);
    pc.fillRect(24, oy + 8, 6, 10, 0x3a7ad8);
    pc.fillRect(25, oy + 9, 2, 3, 0x9ac4ff);
    pc.fillRect(42, oy + 9, 8, 2, 0xc82828);
    pc.fillRect(45, oy + 6, 2, 8, 0xc82828);
  }
  return pc;
}

/** Autá, stromy, lampy a nábytok (nad zemou, pod postavami). */
export function drawProps(map: CityMap): PixelCanvas {
  const pc = new PixelCanvas(map.width * T, map.height * T);
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= map.width || y >= map.height
      ? Tile.Building
      : (map.tiles[y * map.width + x] as Tile);
  const v = (x: number, y: number) => map.variant[y * map.width + x]!;
  // Autá (1 × 2 políčka) zhora, s tieňom.
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      if (at(x, y) !== Tile.Car || v(x, y) & 0x20) continue;
      const horizontal = (v(x, y) & 0x10) !== 0;
      const burnt = carBurnt(x, y);
      const kind = v(x, y) & 0x0f;
      const body = burnt ? 0x3a3a3a : CARS[kind]!;
      const car = drawCar(body, burnt, kind === 5, x * 7 + y);
      const bx = x * T + (horizontal ? 4 : 2);
      const by = y * T + (horizontal ? 2 : 4);
      const put = (cx: number, cy: number, c: Rgb, a = 255) =>
        horizontal ? pc.set(bx + cx, by + cy, c, a) : pc.set(bx + cy, by + cx, c, a);
      // Tieň posunutý doprava dole.
      for (let cy = 0; cy < car.height; cy++)
        for (let cx = 0; cx < car.width; cx++)
          if (car.isFilled(cx, cy)) {
            put(cx + 2, cy + 2, 0x15161a, 170);
          }
      for (let cy = 0; cy < car.height; cy++)
        for (let cx = 0; cx < car.width; cx++) {
          const c = car.get(cx, cy);
          if (c !== null) put(cx, cy, c);
        }
    }

  // Stromy, lampy a nábytok.
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const t = at(x, y);
      const x0 = x * T;
      const y0 = y * T;
      const cx = x0 + T / 2;
      const cy = y0 + T / 2;
      if (t === Tile.Tree) {
        drawTree(pc, cx, cy);
      } else if (t === Tile.Lamp) {
        ellipse(pc, cx + 1.5, cy + 1.5, 6, 6, 0x15161a, 150);
        ellipse(pc, cx, cy, 5.5, 5.5, (nx, ny) => dome(C.metalDark, nx, ny));
        ellipse(pc, cx, cy, 3.5, 3.5, (nx, ny) => (nx * nx + ny * ny < 0.3 ? 0xfff2b0 : C.yellow));
      } else if (t === Tile.Bed) {
        // Posteľ / nosidlá: kovový rám, matrac, prikrývka so záhybmi, vankúš.
        const bx = x0 + 4;
        const by = y0 + 2;
        pc.fillRect(bx + 2, by + 2, 24, 28, 0x2a2c30);
        pc.fillRect(bx, by, 24, 28, 0x6a707a);
        pc.fillRect(bx, by, 24, 1, 0x8a909a);
        pc.fillRect(bx + 2, by + 2, 20, 24, 0xe8ecf0);
        pc.fillRect(bx + 4, by + 3, 16, 6, 0xffffff);
        pc.fillRect(bx + 4, by + 8, 16, 1, 0xc8ccd2);
        pc.fillRect(bx + 11, by + 4, 2, 3, 0xdadee4);
        const sheet = map.district === 'hospital' ? 0x7aa8c8 : 0x9a9a8a;
        pc.fillRect(bx + 2, by + 12, 20, 12, sheet);
        pc.fillRect(bx + 2, by + 12, 20, 1, shade(sheet, 1.2));
        for (const k of [16, 20]) pc.fillRect(bx + 3, by + k, 18, 1, shade(sheet, 0.82));
        if (pixelNoise(x, y, 63) < 0.3)
          ellipse(pc, bx + 11, by + 17, 3.5, 2.5, (_nx, _ny, px, py) =>
            pixelNoise(px, py, 64) < 0.7 ? C.blood : null,
          );
      } else if (t === Tile.Desk) {
        if (map.district === 'metro') {
          // Turniket: skrinka so zelenou kontrolkou a otočné rameno.
          pc.fillRect(x0 + 11, y0 + 4, 10, 24, 0x5a616c);
          pc.fillRect(x0 + 12, y0 + 5, 8, 22, 0x8b93a1);
          pc.fillRect(x0 + 12, y0 + 5, 8, 1, 0xb8bcc4);
          pc.fillRect(x0 + 14, y0 + 8, 4, 3, 0x3ac84a);
          line(pc, x0 + 6, y0 + 16, x0 + 26, y0 + 16, 2, 0xc8ccd4);
        } else {
          // Stôl: dosky s letokruhmi, papiere a hrnček.
          const dx = x0 + 2;
          const dy = y0 + 8;
          pc.fillRect(dx + 2, dy + 2, 28, 16, 0x24201c);
          pc.fillRect(dx, dy, 28, 16, C.woodDark);
          for (let yy = 1; yy < 13; yy++)
            for (let xx = 1; xx < 27; xx++)
              pc.set(
                dx + xx,
                dy + yy,
                yy % 4 === 0 ? 0x6a4a2e : grain(C.wood, xx, yy + y0, 65, 0.15),
              );
          pc.fillRect(dx, dy, 28, 1, 0x8e6644);
          pc.fillRect(dx + 4, dy + 3, 8, 6, 0xd8d4c8);
          pc.fillRect(dx + 5, dy + 4, 6, 1, 0x8a867c);
          pc.fillRect(dx + 5, dy + 6, 4, 1, 0x8a867c);
          ellipse(pc, dx + 20, dy + 6, 2.5, 2.5, (nx, ny) =>
            nx * nx + ny * ny < 0.35 ? 0x3a2418 : 0xe8e4dc,
          );
        }
      } else if (t === Tile.Crate && map.district === 'base') {
        // Vrecia s pieskom: zaoblené, so švom.
        for (const [sx, sy] of [
          [3, 6],
          [16, 6],
          [9, 16],
        ] as const)
          ellipse(pc, x0 + sx + 7, y0 + sy + 5, 7.5, 5.5, (nx, ny, px, py) => {
            if (Math.abs(nx) > 0.82) return 0x6a5c3a;
            const c = ny < -0.3 ? 0xa8966a : ny > 0.45 ? 0x6e6040 : 0x8a7a50;
            return pixelNoise(px, py, 66) < 0.08 ? shade(c, 0.85) : c;
          });
      } else if (t === Tile.Crate) {
        // Debna: rám, dosky, krížová vzpera, klince.
        const bx = x0 + 4;
        const by = y0 + 4;
        pc.fillRect(bx + 2, by + 2, 24, 24, 0x1c1814);
        for (let yy = 0; yy < 24; yy++)
          for (let xx = 0; xx < 24; xx++)
            pc.set(
              bx + xx,
              by + yy,
              yy % 6 === 5 ? C.woodDark : grain(C.wood, xx + x0, yy, 67, 0.18),
            );
        line(pc, bx + 2, by + 2, bx + 22, by + 22, 2.5, 0x664528);
        line(pc, bx + 22, by + 2, bx + 2, by + 22, 2.5, 0x664528);
        pc.fillRect(bx, by, 24, 2, 0x8e6644);
        pc.fillRect(bx, by, 2, 24, 0x8a6240);
        pc.fillRect(bx, by + 22, 24, 2, C.woodDark);
        pc.fillRect(bx + 22, by, 2, 24, C.woodDark);
        for (const [nx, ny] of [
          [1, 1],
          [22, 1],
          [1, 22],
          [22, 22],
        ] as const)
          pc.set(bx + nx, by + ny, 0xb8bcc4);
      }
    }
  return pc;
}

/**
 * Koruna stromu zhora: tieň posunutý nabok, tmavý obrys a chumáče lístia
 * osvetlené zľava zhora (aby sa strom nestratil na tráve).
 */
function drawTree(pc: PixelCanvas, cx: number, cy: number): void {
  const R = 19;
  const inside = (xx: number, yy: number) =>
    xx * xx + yy * yy <= 250 + smooth(cx + xx, cy + yy, 71, 4) * 120;
  // Tieň.
  for (let yy = -R; yy <= R; yy++)
    for (let xx = -R; xx <= R; xx++)
      if (inside(xx, yy)) pc.set(cx + xx + 6, cy + yy + 6, 0x0b160c, 190);
  // Obrys.
  for (let yy = -R - 1; yy <= R + 1; yy++)
    for (let xx = -R - 1; xx <= R + 1; xx++) {
      if (inside(xx, yy)) continue;
      if (inside(xx + 1, yy) || inside(xx - 1, yy) || inside(xx, yy + 1) || inside(xx, yy - 1))
        pc.set(cx + xx, cy + yy, 0x0e2414);
    }
  // Koruna: celkové svetlo zľava zhora + chumáče lístia, každý s vlastným odleskom.
  for (let yy = -R; yy <= R; yy++)
    for (let xx = -R; xx <= R; xx++) {
      if (!inside(xx, yy)) continue;
      const gx = cx + xx;
      const gy = cy + yy;
      const lx = (((gx % 7) + 7) % 7) - 3;
      const ly = (((gy % 7) + 7) % 7) - 3;
      const clump = (-lx - ly) / 8;
      const lit = (-xx - yy) / (R * 1.7) + clump * 0.55 + (pixelNoise(gx, gy, 72) - 0.5) * 0.3;
      const color =
        lit > 0.6
          ? 0x9ad66a
          : lit > 0.3
            ? 0x6ab84e
            : lit > 0
              ? 0x4f9c45
              : lit > -0.35
                ? 0x2f7438
                : 0x1a4d2a;
      pc.set(gx, gy, color);
    }
}

// --- Postavy (otáčajú sa, kreslené pri pohľade doprava) ---

/** Hráč: bunda, batoh, vlasy a zbraň v smere +x; dve fázy kroku. */
export function drawPlayer(frame: number, weapon: WeaponId): PixelCanvas {
  const pc = new PixelCanvas(38, 32);
  const cx = 12;
  const cy = 16;
  const jacket = 0x2f5d62;
  // Topánky vyčnievajú pred a za telo podľa kroku.
  const step = frame ? 5 : -5;
  const boot = (nx: number) => (nx > 0.3 ? 0x3a3e4a : 0x22252e);
  ellipse(pc, cx + step, cy - 4.5, 3.6, 2.4, boot);
  ellipse(pc, cx - step, cy + 4.5, 3.6, 2.4, boot);
  // Batoh, pri plameňomete dve nádrže.
  if (weapon === 'flamer') {
    ellipse(pc, cx - 6, cy - 3, 3, 4, (nx, ny) => dome(0xa83a2a, nx, ny, 1.3, 0.7));
    ellipse(pc, cx - 6, cy + 3, 3, 4, (nx, ny) => dome(0xa83a2a, nx, ny, 1.3, 0.7));
  } else {
    ellipse(pc, cx - 5.5, cy, 4, 6, (nx, ny) =>
      Math.abs(ny) < 0.12 ? 0x2a251c : dome(0x4a4232, nx, ny),
    );
  }
  // Ramená a trup so zipsom.
  ellipse(pc, cx, cy, 6.5, 10.5, (nx, ny) => {
    if (Math.abs(ny) < 0.1 && nx > 0.2) return shade(jacket, 0.7);
    return dome(jacket, nx, ny, 1.25, 0.72);
  });
  // Ruky: rukávy k zbrani.
  const len = weapon === 'shotgun' ? 16 : weapon === 'smg' ? 13 : weapon === 'flamer' ? 14 : 8;
  const sleeve = (_t: number, side: number) =>
    side > 0.35 ? shade(jacket, 0.72) : side < -0.35 ? shade(jacket, 1.2) : jacket;
  const twoHanded = weapon !== 'pistol';
  line(pc, cx + 1, cy - 8, cx + 9, cy - 1.5, 3.4, sleeve);
  line(pc, cx + 1, cy + 8, twoHanded ? cx + 13 : cx + 9, cy + 1.5, 3.4, sleeve);
  // Zbraň (pozdĺž +x).
  const gx = cx + 8;
  const gun = 0x1a1c22;
  if (weapon === 'flamer') line(pc, cx - 4, cy + 4, gx + 3, cy + 3, 1.4, 0x2a2a2a); // hadica
  pc.fillRect(gx, cy - 1, len + 2, 3, gun);
  pc.fillRect(gx, cy - 1, len + 2, 1, 0x3a3e48);
  pc.set(gx + len + 1, cy, 0x050506);
  if (weapon === 'shotgun') {
    pc.fillRect(gx - 3, cy - 1, 5, 3, 0x6a4428); // pažba
    pc.fillRect(gx + 7, cy - 2, 5, 5, 0x553923); // pumpa
    pc.fillRect(gx + 7, cy - 2, 5, 1, 0x7a5435);
  } else if (weapon === 'smg') {
    pc.fillRect(gx + 4, cy + 2, 2, 4, gun); // zásobník
    pc.fillRect(gx - 2, cy - 1, 3, 2, 0x2a2c32);
  } else if (weapon === 'flamer') {
    pc.fillRect(gx + 2, cy - 2, 6, 5, 0x5a5e66);
    pc.fillRect(gx + 2, cy - 2, 6, 1, 0x8b93a1);
    pc.set(gx + len + 1, cy + 1, 0xff9a30);
  }
  // Dlane.
  ellipse(pc, cx + 9.5, cy - 1.5, 1.8, 1.8, C.skin);
  ellipse(pc, twoHanded ? cx + 13.5 : cx + 9.5, cy + 1.5, 1.8, 1.8, shade(C.skin, 0.85));
  // Hlava: vlasy s leskom, čelo a nos vpredu, uši.
  ellipse(pc, cx + 1, cy, 4.8, 4.6, (nx, ny) => {
    if (nx > 0.62) return nx > 0.85 && Math.abs(ny) < 0.25 ? shade(C.skin, 0.85) : C.skin;
    const r = (nx + 0.15) ** 2 + ny * ny;
    return r < 0.12 ? 0x6a4c36 : r < 0.5 ? 0x4a3628 : 0x3a2a20;
  });
  pc.set(cx + 1, cy - 5, shade(C.skin, 0.8));
  pc.set(cx + 1, cy + 4, shade(C.skin, 0.8));
  pc.outline(C.ink);
  return pc;
}

interface ZombieLook {
  shirt: Rgb;
  skin: Rgb;
  /** Zväčšenie postavy (1 = bežná zombie). */
  size: number;
  eyes: Rgb;
  hair: Rgb;
}

const ZOMBIE_LOOK: Record<'walker' | 'runner' | 'brute', ZombieLook> = {
  walker: { shirt: 0x5a4a6a, skin: C.zombieSkin, size: 1, eyes: 0xe8e8b0, hair: 0x3a3428 },
  runner: { shirt: 0x7a3030, skin: 0xa8b88a, size: 1, eyes: 0xff4a3a, hair: 0x2a2420 },
  brute: { shirt: 0x3a3f2a, skin: 0x7a9a62, size: 1.5, eyes: 0xffd060, hair: 0x22201a },
};

/** Zombie s rukami natiahnutými dopredu (+x); dve fázy kroku. */
function drawHumanoid(look: ZombieLook, frame: number, seed: number): PixelCanvas {
  const s = look.size;
  const size = Math.ceil(34 * s);
  const pc = new PixelCanvas(size, size);
  const cx = Math.round(13 * s);
  const cy = size / 2;
  // Šúchajúce sa nohy.
  const step = (frame ? 3.5 : -3.5) * s;
  ellipse(pc, cx + step, cy - 4.5 * s, 3.4 * s, 2.3 * s, 0x2a2620);
  ellipse(pc, cx - step, cy + 4.5 * s, 3.4 * s, 2.3 * s, 0x2a2620);
  // Roztrhané tričko: diery s kožou, krv na pleci.
  ellipse(pc, cx, cy, 7 * s, 10.5 * s, (nx, ny, x, y) => {
    const n = pixelNoise(x, y, seed);
    if (n < 0.07) return dome(look.skin, nx, ny);
    if (smooth(x, y, seed + 1, 5 * s) < 0.28 && ny < 0.2) return n < 0.5 ? C.blood : C.bloodDark;
    return dome(look.shirt, nx, ny, 1.25, 0.7);
  });
  // Natiahnuté ruky (striedajú sa pri chôdzi) s kostnatými prstami.
  const arm = (side: number, wobble: number) => {
    const sy = cy + side * 7.5 * s;
    const hx = cx + 14 * s - Math.abs(wobble);
    const hy = cy + side * 5 * s + wobble;
    line(pc, cx + 1, sy, hx, hy, 3 * s, (_t, sd) =>
      sd * side > 0.3
        ? shade(look.skin, 0.75)
        : sd * side < -0.4
          ? shade(look.skin, 1.15)
          : look.skin,
    );
    for (const f of [-1, 0, 1])
      pc.set(Math.round(hx + 1.5 * s), Math.round(hy + f * s), shade(look.skin, 0.85));
  };
  arm(-1, frame ? 0 : 1.5 * s);
  arm(1, frame ? -1.5 * s : 0);
  // Hlava: chumáče vlasov vzadu, oči a ústa vpredu.
  const hx = cx + 1.5 * s;
  ellipse(pc, hx, cy, 5 * s, 4.8 * s, (nx, ny, x, y) => {
    if (nx < -0.1 && pixelNoise(x, y, seed + 2) < 0.55) return look.hair;
    return dome(look.skin, nx, ny, 1.15, 0.75);
  });
  const ex = Math.round(hx + 3 * s);
  for (const side of [-1, 1]) {
    const ey = Math.round(cy + side * 2 * s - 0.5);
    pc.set(ex, ey, C.ink);
    pc.set(ex + 1, ey, look.eyes);
  }
  pc.set(Math.round(hx + 4.5 * s), Math.round(cy), C.bloodDark);
  pc.set(Math.round(hx + 4.5 * s), Math.round(cy) - 1, C.blood);
  pc.outline(C.ink);
  return pc;
}

/** Nafúknutá zombie: guľaté telo s pľuzgiermi a žilami, krátke ruky. */
function drawExploder(frame: number): PixelCanvas {
  const pc = new PixelCanvas(40, 40);
  const cx = 18;
  const cy = 20;
  ellipse(pc, cx, cy, 14, 14, (nx, ny, x, y) => {
    // Žily: tenké tmavé čiary zo šumu.
    if (Math.abs(smooth(x, y, 81, 6) - 0.5) < 0.03) return 0x5a6a1e;
    return dome(0x8a9a3a, nx, ny, 1.3, 0.72);
  });
  // Pľuzgiere so svetlým okrajom a tmavým stredom.
  for (const [px, py, r] of [
    [11, 14, 2.5],
    [22, 27, 3],
    [24, 12, 2],
    [13, 26, 1.8],
    [27, 20, 2.2],
  ] as const)
    ellipse(pc, px, py, r, r, (nx, ny) =>
      nx * nx + ny * ny < 0.3 ? 0x6a7a20 : nx + ny < 0 ? 0xf0f8a0 : 0xd8e070,
    );
  // Krátke ručičky.
  line(pc, cx + 10, cy - 8, cx + 17, cy - 9 + frame * 2, 3, 0xb8c860);
  line(pc, cx + 10, cy + 8, cx + 17, cy + 9 - frame * 2, 3, 0xb8c860);
  // Hlava zaborená v tele.
  ellipse(pc, cx + 9, cy, 4.5, 5, (nx, ny) => dome(0xa8b860, nx, ny));
  pc.set(cx + 12, cy - 2, C.ink);
  pc.set(cx + 12, cy + 1, C.ink);
  pc.fillRect(cx + 13, cy - 1, 1, 2, 0x4a1a10);
  pc.outline(C.ink);
  return pc;
}

/** Pľujúca zombie: vychudnutá, zhrbená, so žiariacimi vakmi s kyselinou. */
function drawSpitter(frame: number): PixelCanvas {
  const pc = new PixelCanvas(34, 34);
  const cx = 12;
  const cy = 17;
  ellipse(pc, cx - 3 + frame * 2, cy - 4, 3, 2, 0x2a2620);
  ellipse(pc, cx - 1 - frame * 2, cy + 4, 3, 2, 0x2a2620);
  // Vychudnutý trup s rebrami.
  ellipse(pc, cx, cy, 5.5, 8.5, (nx, ny, x, y) => {
    if (nx > -0.2 && nx < 0.5 && y % 3 === 0) return 0x3e5a46;
    return pixelNoise(x, y, 82) < 0.06 ? 0x9ad06a : dome(0x2f4a3a, nx, ny, 1.3, 0.72);
  });
  // Tenké ruky.
  line(pc, cx + 1, cy - 6, cx + 10, cy - 7 + frame * 2, 2, 0x9ad06a);
  line(pc, cx + 1, cy + 6, cx + 10, cy + 7 - frame * 2, 2, 0x9ad06a);
  // Vaky s kyselinou na krku.
  for (const side of [-1, 1])
    ellipse(pc, cx + 3, cy + side * 4, 2.6, 2.6, (nx, ny) =>
      nx + ny < -0.3 ? 0xd8ff9a : 0x7fff3a,
    );
  // Veľká hlava vystrčená dopredu, otvorené ústa so slinou.
  ellipse(pc, cx + 7, cy, 5, 4.6, (nx, ny) => dome(0x9ad06a, nx, ny, 1.15, 0.75));
  pc.set(cx + 9, cy - 2, C.ink);
  pc.set(cx + 9, cy + 2, C.ink);
  pc.fillRect(cx + 11, cy - 1, 1, 3, 0x1a2a10);
  for (let k = 0; k < 4; k++) pc.set(cx + 12 + k, cy + (k % 2), k < 2 ? 0x7fff3a : 0xb8ff6a);
  pc.outline(C.ink);
  return pc;
}

/** Boss „Mäsiar“: obrovské telo, zástera od krvi, opasok, sekáčik. */
function drawBoss(frame: number): PixelCanvas {
  const pc = new PixelCanvas(74, 70);
  const cx = 30;
  const cy = 35;
  const limb = (flip: number) => (_t: number, sd: number) =>
    sd * flip < -0.3 ? 0xa8b888 : sd * flip > 0.4 ? 0x6e7e56 : 0x8fa070;
  // Ruka so sekáčikom (pod telom, čepeľ trčí dopredu).
  const hy = cy - 24 + frame * 2;
  line(pc, cx + 6, cy - 16, cx + 26, hy, 7, limb(1));
  pc.fillRect(cx + 24, hy - 2, 6, 4, 0x4a2a1a);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 13; x++) {
      const c =
        y < 2 ? 0xe8ecf2 : x > 10 ? 0x8a909a : pixelNoise(x, y, 83) < 0.15 ? C.blood : 0xb8bcc4;
      pc.set(cx + 29 + x, hy - 8 + y, c);
    }
  // Druhá ruka natiahnutá.
  line(pc, cx + 6, cy + 16, cx + 26, cy + 18 - frame * 2, 7, limb(-1));
  // Telo so zásterou.
  ellipse(pc, cx, cy, 22, 26, (nx, ny, x, y) => {
    if (nx > 0.1 && Math.abs(ny) < 0.62) {
      // Zástera: plátno, krvavé fľaky, šev.
      if (Math.abs(nx - 0.12) < 0.04) return 0x8a8478;
      const blot = smooth(x, y, 84, 6);
      if (blot < 0.32) return blot < 0.2 ? C.bloodDark : C.blood;
      return pixelNoise(x, y, 85) < 0.06 ? 0xa8a090 : dome(0xc8c0b0, nx, ny, 1.08, 0.82);
    }
    return dome(0x5a3a3a, nx, ny, 1.25, 0.72);
  });
  // Opasok s prackou.
  for (let y = cy - 18; y <= cy + 18; y++) {
    pc.set(cx - 2, y, 0x2a1a14);
    pc.set(cx - 1, y, 0x3a2418);
  }
  pc.fillRect(cx - 3, cy - 2, 4, 4, 0xb8a050);
  // Hlava: zošitá jazva, červené oči.
  ellipse(pc, cx + 8, cy, 9, 9, (nx, ny) => dome(0x8fa070, nx, ny, 1.15, 0.75));
  for (let k = -5; k <= 5; k++) pc.set(cx + 4, cy + k, k % 2 ? 0x3a2a20 : 0x6e5a40);
  for (const side of [-1, 1]) {
    pc.fillRect(cx + 12, cy + side * 4 - 1, 2, 2, 0xff3030);
    pc.set(cx + 13, cy + side * 4 - 1, 0xffa0a0);
  }
  pc.fillRect(cx + 15, cy - 2, 1, 5, 0x3a1010);
  pc.set(cx + 2, cy - 8, C.blood);
  pc.outline(C.ink);
  return pc;
}

/** Zombie podľa druhu; dve fázy kroku. */
export function drawZombie(kind: ZombieKind, frame: number): PixelCanvas {
  if (kind === 'exploder') return drawExploder(frame);
  if (kind === 'spitter') return drawSpitter(frame);
  if (kind === 'boss') return drawBoss(frame);
  const seed = kind === 'walker' ? 86 : kind === 'runner' ? 87 : 88;
  return drawHumanoid(ZOMBIE_LOOK[kind], frame, seed);
}

// --- Stopy na zemi ---

/** Fľak krvi (varianty). */
export function drawBlood(variant: number): PixelCanvas {
  const pc = new PixelCanvas(28, 28);
  const seed = variant * 97 + 5;
  for (let y = 0; y < 28; y++)
    for (let x = 0; x < 28; x++) {
      const dx = x - 13.5;
      const dy = y - 13.5;
      const d = dx * dx + dy * dy;
      const edge = 56 + smooth(x, y, seed, 4) * 120;
      if (d > edge) continue;
      const c =
        d < edge * 0.3 ? C.bloodDark : pixelNoise(x, y, seed) < 0.1 ? C.bloodLight : C.blood;
      pc.set(x, y, c, 215);
    }
  // Lesk mokrej krvi.
  pc.set(11, 11, 0xc84050, 200);
  // Kvapky okolo.
  for (let i = 0; i < 7; i++) {
    const a = pixelNoise(i, variant, 9) * Math.PI * 2;
    const r = 10 + pixelNoise(variant, i, 10) * 3;
    const px = Math.round(13.5 + Math.cos(a) * r);
    const py = Math.round(13.5 + Math.sin(a) * r);
    pc.set(px, py, C.blood, 210);
    if (i % 2) pc.set(px + 1, py, C.bloodDark, 210);
  }
  return pc;
}

/** Mŕtvola zombie (ležiaca, tmavšia). */
export function drawCorpse(kind: ZombieKind): PixelCanvas {
  const src = drawZombie(kind, 0);
  const pc = new PixelCanvas(src.width, src.height);
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) {
      const c = src.get(x, y);
      if (c !== null) pc.set(x, y, shade(c, 0.55), 235);
    }
  return pc;
}

// --- Predmety ---

export function drawPickup(
  kind: 'ammo' | 'health' | 'weapon' | 'cash' | 'grenade',
  weapon?: WeaponId,
): PixelCanvas {
  const pc = new PixelCanvas(24, 24);
  if (kind === 'cash') {
    // Zväzok bankoviek s páskou.
    pc.fillRect(2, 7, 20, 11, 0x2e5a2a);
    pc.fillRect(3, 5, 20, 11, 0x3e7a3a);
    pc.fillRect(4, 4, 19, 11, 0x5aa04a);
    pc.fillRect(4, 4, 19, 1, 0x8ac87a);
    ellipse(pc, 15.5, 9.5, 3, 3, (nx, ny) => (nx * nx + ny * ny < 0.4 ? 0x5aa04a : 0x9ad07a));
    pc.fillRect(20, 12, 2, 2, 0x9ad07a);
    pc.fillRect(8, 4, 3, 11, 0xd8b04a);
    pc.fillRect(8, 4, 3, 1, 0xf0d070);
  } else if (kind === 'grenade') {
    ellipse(pc, 12, 13.5, 6.5, 7.5, (nx, ny, x, y) =>
      x % 4 === 0 || y % 4 === 0 ? 0x34401e : dome(0x4a5a2a, nx, ny, 1.35, 0.75),
    );
    pc.fillRect(10, 4, 5, 3, 0x8b93a1);
    pc.fillRect(10, 4, 5, 1, 0xc8ccd4);
    pc.fillRect(14, 5, 5, 2, 0x8b93a1); // páka
    ellipse(pc, 8, 4.5, 2.2, 2.2, (nx, ny) => (nx * nx + ny * ny < 0.35 ? null : 0xd8b04a));
  } else if (kind === 'health') {
    // Lekárnička: rúčka, biely kufrík s tieňovaním, červený kríž.
    pc.fillRect(9, 2, 6, 3, 0x6a707a);
    pc.fillRect(10, 3, 4, 2, 0x000000);
    pc.fillRect(2, 5, 20, 16, 0xc8ccd2);
    pc.fillRect(2, 5, 20, 14, C.white);
    pc.fillRect(2, 12, 20, 1, 0xd8dce2);
    pc.fillRect(10, 7, 4, 11, 0xd02030);
    pc.fillRect(6, 10, 12, 4, 0xd02030);
    pc.fillRect(10, 7, 4, 1, 0xf04050);
    pc.fillRect(6, 10, 4, 1, 0xf04050);
  } else if (kind === 'ammo') {
    // Krabica nábojov: náboje s medenými špičkami trčia z vrchu.
    for (let i = 0; i < 5; i++) {
      pc.fillRect(4 + i * 3, 2, 2, 6, 0xd8b04a);
      pc.fillRect(4 + i * 3, 2, 2, 1, 0xb86a3a);
      pc.fillRect(4 + i * 3, 3, 1, 4, 0xf0d070);
    }
    pc.fillRect(2, 7, 20, 14, 0x3a4a22);
    pc.fillRect(2, 7, 20, 12, 0x4a5a2a);
    pc.fillRect(2, 7, 20, 1, 0x6e7e3a);
    pc.fillRect(4, 10, 16, 4, 0x5e7034);
    pc.fillRect(5, 11, 6, 2, 0xd8b04a);
    pc.fillRect(11, 17, 2, 2, 0x8b93a1);
  } else {
    // Zbraň na zemi.
    const long = weapon === 'shotgun' ? 22 : weapon === 'smg' ? 18 : weapon === 'flamer' ? 20 : 14;
    pc.fillRect(1, 9, long, 4, 0x22252e);
    pc.fillRect(1, 9, long, 1, 0x4a4e58);
    pc.fillRect(3, 13, 4, 6, 0x553923);
    pc.fillRect(3, 13, 1, 6, 0x7a5435);
    if (weapon === 'shotgun') {
      pc.fillRect(9, 13, 6, 3, 0x553923);
      pc.fillRect(0, 8, 4, 6, 0x6a4428);
    }
    if (weapon === 'smg') pc.fillRect(9, 13, 3, 7, 0x22252e);
    if (weapon === 'flamer') {
      ellipse(pc, 6, 17, 4, 4.5, (nx, ny) => dome(0xa83a2a, nx, ny, 1.3, 0.7));
      pc.set(long, 12, 0xff9a30);
    }
    pc.set(long, 8, C.yellow);
    pc.set(long - 1, 7, C.yellow);
  }
  pc.outline(C.ink);
  return pc;
}

/** Malá častica (krv, iskra, nábojnica): w × h pixelov sveta, zaoblené rohy a lesk. */
export function drawDot(color: Rgb, w = 2, h = 2): PixelCanvas {
  const W = w * PX;
  const H = h * PX;
  const pc = new PixelCanvas(W, H);
  pc.fillRect(0, 0, W, H, color);
  if (W > 2 && H > 2) {
    for (const [x, y] of [
      [0, 0],
      [W - 1, 0],
      [0, H - 1],
      [W - 1, H - 1],
    ] as const)
      pc.set(x, y, 0, 0);
    pc.set(1, 1, shade(color, 1.35));
  } else if (W > 2) pc.fillRect(0, 0, W, 1, shade(color, 1.3));
  return pc;
}

/** Brána z mreží (zatvorená): 3 políčka dlhá, zvislá alebo vodorovná. */
export function drawGate(vertical: boolean): PixelCanvas {
  const long = T * 3;
  // Kreslí sa vodorovne, zvislá sa transponuje.
  const h = new PixelCanvas(long, T);
  h.fillRect(0, 10, long, 12, 0x3a3f4a);
  for (let x = 2; x < long; x += 8) {
    h.fillRect(x, 8, 4, 16, 0x8b93a1);
    h.fillRect(x, 8, 1, 16, 0xc8ccd4);
    h.fillRect(x + 3, 8, 1, 16, 0x555b66);
  }
  h.fillRect(0, 14, long, 4, 0x8b93a1);
  h.fillRect(0, 14, long, 1, 0xc8ccd4);
  h.fillRect(0, 17, long, 1, 0x555b66);
  for (let x = 4; x < long; x += 16) h.set(x, 15, 0x3a3f4a);
  let pc = h;
  if (vertical) {
    pc = new PixelCanvas(T, long);
    for (let y = 0; y < T; y++)
      for (let x = 0; x < long; x++) {
        const c = h.get(x, y);
        if (c !== null) pc.set(y, x, c);
      }
  }
  pc.outline(C.ink);
  return pc;
}

/** Šípka navigácie (smer +x). */
export function drawArrow(): PixelCanvas {
  const pc = new PixelCanvas(20, 20);
  pc.fillPolygon(
    [
      [1, 6],
      [9, 6],
      [9, 1],
      [19, 10],
      [9, 19],
      [9, 14],
      [1, 14],
    ],
    (_x, y) => (y < 9 ? 0xffe680 : y > 11 ? 0xd8a830 : C.yellow),
  );
  pc.outline(0x3a2a08);
  return pc;
}

/** Pľuvanec kyseliny. */
export function drawSpit(): PixelCanvas {
  const pc = new PixelCanvas(12, 12);
  ellipse(pc, 6, 6, 4.5, 4.5, (nx, ny) =>
    nx * nx + ny * ny < 0.3 ? 0xd8ffa0 : nx + ny < 0 ? 0xb8ff6a : 0x5ab02a,
  );
  pc.set(4, 4, 0xffffff);
  return pc;
}

/** Spálenina po výbuchu (stopa na zemi). */
export function drawScorch(): PixelCanvas {
  const pc = new PixelCanvas(80, 80);
  for (let y = 0; y < 80; y++)
    for (let x = 0; x < 80; x++) {
      const d = Math.hypot(x - 40, y - 40);
      const n = pixelNoise(x, y, 77);
      const edge = 26 + smooth(x, y, 78, 6) * 14;
      if (d < edge) pc.set(x, y, d < edge * 0.5 || n < 0.3 ? 0x101010 : 0x1e1c1a, 200);
      else if (d < edge + 8 && n < 0.12) pc.set(x, y, 0x2a2622, 160);
    }
  return pc;
}

/** Vojenský vrtuľník zhora (rotor zvlášť, otáča sa). */
export function drawHelicopter(): PixelCanvas {
  const pc = new PixelCanvas(120, 52);
  // Ližiny.
  pc.fillRect(16, 4, 4, 44, 0x2a2e22);
  pc.fillRect(52, 4, 4, 44, 0x2a2e22);
  pc.fillRect(16, 4, 40, 2, 0x2a2e22);
  pc.fillRect(16, 46, 40, 2, 0x2a2e22);
  // Chvost a chvostová vrtuľka.
  pc.fillRect(64, 22, 48, 8, 0x48522f);
  pc.fillRect(64, 22, 48, 2, 0x5e6a40);
  pc.fillRect(104, 12, 6, 28, 0x3a4226);
  line(pc, 107, 8, 107, 44, 2, 0x2a2e22);
  // Trup s tieňovaním, kabína, dvere a znak.
  ellipse(pc, 40, 26, 28, 18, (nx, ny) =>
    nx + ny < -0.9 ? 0x6e7a4a : nx + ny < 0.4 ? 0x5e6a40 : 0x48522f,
  );
  ellipse(pc, 56, 26, 10, 12, (nx, ny) => (nx + ny < -0.5 ? 0x4a6a8a : 0x2a3a4a));
  pc.fillRect(26, 10, 1, 32, 0x3a4226);
  pc.fillRect(44, 10, 1, 32, 0x3a4226);
  ellipse(pc, 34, 26, 4, 4, (nx, ny) => (nx * nx + ny * ny < 0.35 ? 0xe8e4d8 : 0x2a2e22));
  pc.outline(C.ink);
  return pc;
}

export function drawRotor(): PixelCanvas {
  const pc = new PixelCanvas(128, 128);
  for (let i = -60; i <= 60; i++) {
    const tip = Math.abs(i) > 54;
    for (const k of [0, 1, 2]) {
      const c = tip ? 0xc8a830 : k === 0 ? 0x3a3e32 : 0x2a2e22;
      pc.set(64 + i, 63 + k, c, 200);
      pc.set(63 + k, 64 + i, c, 200);
    }
  }
  ellipse(pc, 64, 64, 6, 6, (nx, ny) => dome(0x2a2e22, nx, ny, 1.5, 0.7));
  return pc;
}

/** Výbušný sud zhora: obruč, veko, výstražný znak, zátky. */
export function drawBarrel(): PixelCanvas {
  const pc = new PixelCanvas(28, 28);
  ellipse(pc, 13.5, 13.5, 12, 12, (nx, ny) => {
    const r = Math.sqrt(nx * nx + ny * ny);
    if (r > 0.9) return nx + ny < 0 ? 0x9a2420 : 0x5a1412;
    if (r > 0.78) return 0x7a1a18;
    if (r > 0.7) return 0xc8342c;
    return nx + ny < -0.6 ? 0xd03a30 : 0xb82a24;
  });
  pc.fillPolygon(
    [
      [13.5, 6],
      [20.5, 18],
      [6.5, 18],
    ],
    0xffd34e,
  );
  pc.fillRect(13, 10, 2, 4, 0x1a1a1a);
  pc.fillRect(13, 15, 2, 2, 0x1a1a1a);
  ellipse(pc, 8, 22, 1.6, 1.6, 0x4a1010);
  ellipse(pc, 19.5, 22, 1.6, 1.6, 0x4a1010);
  pc.outline(C.ink);
  return pc;
}

/** Granát v letu (s blikajúcou poistkou). */
export function drawGrenadeSprite(lit: boolean): PixelCanvas {
  const pc = new PixelCanvas(12, 12);
  ellipse(pc, 6, 6.5, 4, 4.5, (nx, ny, x, y) =>
    x % 3 === 0 || y % 3 === 0 ? 0x34401e : dome(0x4a5a2a, nx, ny, 1.35, 0.75),
  );
  pc.fillRect(5, 1, 3, 2, lit ? 0xff3030 : 0x8b93a1);
  pc.outline(C.ink);
  return pc;
}

/** Jazyk plameňa (častica). */
export function drawFlame(variant: number): PixelCanvas {
  const pc = new PixelCanvas(10, 10);
  const colors = [0xffe070, 0xff9a30, 0xe8501e];
  ellipse(pc, 5, 5, 4.5, 4.5, (nx, ny) => {
    const r = nx * nx + ny * ny;
    return r < 0.2 ? 0xfff6c0 : r < 0.55 ? colors[variant % 3]! : colors[(variant + 1) % 3]!;
  });
  return pc;
}

/**
 * Okno s preživším (políčko steny, pohľad zhora, okno na strane +x): osvetlené sklo
 * a človek vykláňajúci sa von, ktorý máva (dve fázy). `broken` = rozbité tmavé okno
 * po pasci.
 */
export function drawWindow(frame: number, broken: boolean): PixelCanvas {
  const pc = new PixelCanvas(T, T);
  // Rám a parapet.
  pc.fillRect(18, 3, 14, 26, 0x2a2622);
  pc.fillRect(30, 2, 2, 28, 0x8a8478);
  if (broken) {
    pc.fillRect(20, 5, 10, 22, 0x140c0c);
    // Črepy skla a krvavá šmuha cez parapet.
    for (const [x, y] of [
      [21, 6],
      [22, 7],
      [28, 6],
      [27, 25],
      [21, 24],
      [29, 15],
    ] as const)
      pc.set(x, y, 0x8aa0b0);
    for (let y = 11; y < 22; y++) pc.set(30 + (y % 2), y, y % 3 ? 0x7a1020 : 0x4e0912);
    pc.outline(C.ink);
    return pc;
  }
  // Teplé svetlo izby.
  for (let y = 5; y < 27; y++)
    for (let x = 20; x < 30; x++) pc.set(x, y, x > 25 ? 0xffd890 : x > 22 ? 0xf0b860 : 0xc88a40);
  // Preživší: ramená v okne, hlava vyklonená von, mávajúce ruky.
  ellipse(pc, 25, 16, 3.5, 6, 0x4a5a7a);
  const wave = frame ? -3 : 3;
  line(pc, 26, 11, 31, 6 + wave, 2, C.skin);
  line(pc, 26, 21, 31, 26 - wave, 2, C.skin);
  ellipse(pc, 28, 16, 3.4, 3.4, (nx, ny) =>
    nx > 0.45 ? C.skin : nx * nx + ny * ny < 0.25 ? 0x6a4c36 : 0x4a3628,
  );
  pc.outline(C.ink);
  return pc;
}

/** Mäkké kruhové svetlo (Canvas 2D gradient) pre tmu a teplý odlesk lámp. */
export function lightCanvas(size: number, inner = 0.15): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * inner * 0.5,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
