import { PARKING_LINE, ROAD_LINE_H, ROAD_LINE_V, TILE, Tile, type CityMap } from '@/game/map';
import type { ZombieKind } from '@/game/game';
import type { WeaponId } from '@/game/weapons';
import { PixelCanvas, pixelNoise, shade, type Rgb } from './PixelCanvas';

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

const ROOFS: readonly Rgb[] = [0x4e4446, 0x434b5c, 0x5a4a3a, 0x3c4a3c];
const CARS: readonly Rgb[] = [0x8a2b2b, 0x2e4f7a, 0xb8b8b0, 0xa8862e, 0x3e6a44];

function asphalt(pc: PixelCanvas, x0: number, y0: number): void {
  pc.fillRect(x0, y0, TILE, TILE, C.asphalt);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const n = pixelNoise(x0 + x, y0 + y, 11);
      if (n < 0.05) pc.set(x0 + x, y0 + y, C.asphaltDark);
      else if (n > 0.97) pc.set(x0 + x, y0 + y, C.asphaltLight);
    }
}

function sidewalk(pc: PixelCanvas, x0: number, y0: number): void {
  pc.fillRect(x0, y0, TILE, TILE, C.sidewalk);
  for (let i = 0; i < TILE; i++) {
    pc.set(x0 + i, y0, C.sidewalkDark);
    pc.set(x0 + i, y0 + 8, C.sidewalkDark);
    pc.set(x0, y0 + i, C.sidewalkDark);
    pc.set(x0 + 8, y0 + i, C.sidewalkDark);
  }
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++)
      if (pixelNoise(x0 + x, y0 + y, 23) < 0.03) pc.set(x0 + x, y0 + y, C.curb);
}

function concrete(pc: PixelCanvas, x0: number, y0: number): void {
  pc.fillRect(x0, y0, TILE, TILE, 0x4a4d55);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const n = pixelNoise(x0 + x, y0 + y, 17);
      if (n < 0.05) pc.set(x0 + x, y0 + y, 0x3c3f46);
      else if (n > 0.985) pc.set(x0 + x, y0 + y, 0x5c606a);
    }
  // Škáry medzi panelmi.
  if ((x0 / TILE) % 3 === 0) pc.fillRect(x0, y0, 1, TILE, 0x3a3d44);
  if ((y0 / TILE) % 3 === 0) pc.fillRect(x0, y0, TILE, 1, 0x3a3d44);
}

function grass(pc: PixelCanvas, x0: number, y0: number): void {
  pc.fillRect(x0, y0, TILE, TILE, C.grass);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const n = pixelNoise(x0 + x, y0 + y, 31);
      if (n < 0.08) pc.set(x0 + x, y0 + y, C.grassDark);
      else if (n > 0.95) pc.set(x0 + x, y0 + y, C.grassLight);
    }
}

/** Celé mesto do jedného obrázka (statická zem, strechy, autá, stromy). */
export function drawGround(map: CityMap): PixelCanvas {
  const pc = new PixelCanvas(map.width * TILE, map.height * TILE);
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= map.width || y >= map.height
      ? Tile.Building
      : (map.tiles[y * map.width + x] as Tile);
  const roadLike = (t: Tile) => t === Tile.Road || t === Tile.Car;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = at(x, y);
      const x0 = x * TILE;
      const y0 = y * TILE;
      switch (t) {
        case Tile.Road:
        case Tile.Car:
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
        case Tile.Helipad:
          asphalt(pc, x0, y0);
          break;
        case Tile.Gate:
        case Tile.Door:
          // Prah brány: tmavý pás so žltými výstražnými pruhmi.
          pc.fillRect(x0, y0, TILE, TILE, C.asphaltDark);
          for (let i = 0; i < TILE; i++)
            for (let k = 0; k < TILE; k++)
              if (((i + k) >> 2) % 2 === 0 && (i < 2 || i > 13 || k < 2 || k > 13))
                pc.set(x0 + i, y0 + k, 0x8a7020);
          break;
        default:
          sidewalk(pc, x0, y0);
      }
      // Obrubník chodníka pri ceste.
      if (t === Tile.Sidewalk || t === Tile.Lamp || t === Tile.Crate) {
        if (roadLike(at(x, y + 1))) pc.fillRect(x0, y0 + TILE - 2, TILE, 2, C.curb);
        if (roadLike(at(x, y - 1))) pc.fillRect(x0, y0, TILE, 2, C.curb);
        if (roadLike(at(x + 1, y))) pc.fillRect(x0 + TILE - 2, y0, 2, TILE, C.curb);
        if (roadLike(at(x - 1, y))) pc.fillRect(x0, y0, 2, TILE, C.curb);
      }
    }
  }

  // Značenie: stredová čiara ulíc, parkovacie čiary, stĺpy v sklade, heliport.
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const v = map.variant[y * map.width + x]!;
      const t = at(x, y);
      const x0 = x * TILE;
      const y0 = y * TILE;
      if (t === Tile.Road && v === ROAD_LINE_H)
        for (let i = 0; i < TILE; i++) if ((x0 + i) % 12 < 6) pc.set(x0 + i, y0 + 7, C.line);
      if (t === Tile.Road && v === ROAD_LINE_V)
        for (let i = 0; i < TILE; i++) if ((y0 + i) % 12 < 6) pc.set(x0 + 7, y0 + i, C.line);
      if ((t === Tile.Road || t === Tile.Car) && v === PARKING_LINE)
        pc.fillRect(x0 + 15, y0, 1, TILE, 0xb8bcc4);
      if (t === Tile.Pillar) {
        pc.fillRect(x0 + 3, y0 + 3, 10, 10, 0x5a5e66);
        pc.fillRect(x0 + 3, y0 + 3, 10, 2, 0x7a7e88);
        pc.fillRect(x0 + 11, y0 + 3, 2, 10, 0x40444c);
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
      const cx = x * TILE + 32;
      const cy = y * TILE + 32;
      for (let yy = -32; yy < 32; yy++)
        for (let xx = -32; xx < 32; xx++) {
          const d = Math.hypot(xx + 0.5, yy + 0.5);
          if (d > 26 && d < 30) pc.set(cx + xx, cy + yy, 0xd8d0b0);
        }
      pc.fillRect(cx - 12, cy - 14, 5, 28, 0xd8d0b0);
      pc.fillRect(cx + 7, cy - 14, 5, 28, 0xd8d0b0);
      pc.fillRect(cx - 7, cy - 2, 14, 5, 0xd8d0b0);
    }

  return pc;
}

/** Strechy budov zvlášť: kreslia sa nad tmou ako siluety v mesačnom svetle. */
export function drawRoofs(map: CityMap): PixelCanvas {
  const pc = new PixelCanvas(map.width * TILE, map.height * TILE);
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= map.width || y >= map.height
      ? Tile.Building
      : (map.tiles[y * map.width + x] as Tile);
  const v = (x: number, y: number) => map.variant[y * map.width + x]!;
  // Strechy budov: okraj (atika), tmavšia južná a východná hrana, vetráky a jednotky.
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      if (at(x, y) !== Tile.Building) continue;
      const roof = ROOFS[v(x, y) % ROOFS.length]!;
      const x0 = x * TILE;
      const y0 = y * TILE;
      pc.fillRect(x0, y0, TILE, TILE, roof);
      for (let yy = 0; yy < TILE; yy++)
        for (let xx = 0; xx < TILE; xx++)
          if (pixelNoise(x0 + xx, y0 + yy, 41) < 0.06) pc.set(x0 + xx, y0 + yy, shade(roof, 0.88));
      const edge = shade(roof, 1.25);
      const dark = shade(roof, 0.6);
      if (at(x, y - 1) !== Tile.Building) pc.fillRect(x0, y0, TILE, 2, edge);
      if (at(x - 1, y) !== Tile.Building) pc.fillRect(x0, y0, 2, TILE, edge);
      if (at(x, y + 1) !== Tile.Building) pc.fillRect(x0, y0 + TILE - 3, TILE, 3, dark);
      if (at(x + 1, y) !== Tile.Building) pc.fillRect(x0 + TILE - 3, y0, 3, TILE, dark);
      if (pixelNoise(x, y, 51) < 0.12) {
        pc.fillRect(x0 + 4, y0 + 4, 7, 6, C.metalDark);
        pc.fillRect(x0 + 5, y0 + 5, 5, 3, C.metal);
      } else if (pixelNoise(x, y, 52) < 0.08) {
        pc.fillRect(x0 + 6, y0 + 6, 4, 4, C.ink);
        pc.set(x0 + 7, y0 + 7, C.metalDark);
      }
    }

  return pc;
}

/** Autá, stromy, lampy a debny (nad zemou, pod postavami). */
export function drawProps(map: CityMap): PixelCanvas {
  const pc = new PixelCanvas(map.width * TILE, map.height * TILE);
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= map.width || y >= map.height
      ? Tile.Building
      : (map.tiles[y * map.width + x] as Tile);
  const v = (x: number, y: number) => map.variant[y * map.width + x]!;
  // Autá (1 × 2 políčka) zhora.
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      if (at(x, y) !== Tile.Car || v(x, y) & 0x20) continue;
      const horizontal = (v(x, y) & 0x10) !== 0;
      const burnt = pixelNoise(x, y, 61) < 0.25;
      const body = burnt ? 0x3a3a3a : CARS[v(x, y) & 0x0f]!;
      const w = horizontal ? 28 : 13;
      const h = horizontal ? 13 : 28;
      const bx = x * TILE + (horizontal ? 2 : 1);
      const by = y * TILE + (horizontal ? 1 : 2);
      pc.fillRect(bx, by, w, h, body);
      // Predné a zadné sklo, strecha.
      const glass = burnt ? 0x1a1a1a : 0x22303f;
      if (horizontal) {
        pc.fillRect(bx + 6, by + 2, 4, h - 4, glass);
        pc.fillRect(bx + 19, by + 2, 3, h - 4, glass);
        pc.fillRect(bx + 10, by + 2, 9, h - 4, shade(body, 0.85));
      } else {
        pc.fillRect(bx + 2, by + 6, w - 4, 4, glass);
        pc.fillRect(bx + 2, by + 19, w - 4, 3, glass);
        pc.fillRect(bx + 2, by + 10, w - 4, 9, shade(body, 0.85));
      }
      for (let yy = by; yy < by + h; yy++)
        for (let xx = bx; xx < bx + w; xx++)
          if (pixelNoise(xx, yy, 62) < (burnt ? 0.25 : 0.04)) pc.set(xx, yy, shade(body, 0.6));
    }

  // Stromy, lampy a debny.
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const t = at(x, y);
      const cx = x * TILE + 8;
      const cy = y * TILE + 8;
      if (t === Tile.Tree) {
        drawTree(pc, cx, cy);
      } else if (t === Tile.Lamp) {
        pc.fillRect(cx - 2, cy - 2, 5, 5, C.metalDark);
        pc.fillRect(cx - 1, cy - 1, 3, 3, C.yellow);
      } else if (t === Tile.Crate) {
        pc.fillRect(x * TILE + 2, y * TILE + 2, 12, 12, C.wood);
        for (let i = 0; i < 12; i++) {
          pc.set(x * TILE + 2 + i, y * TILE + 2 + i, C.woodDark);
          pc.set(x * TILE + 13 - i, y * TILE + 2 + i, C.woodDark);
        }
        pc.fillRect(x * TILE + 2, y * TILE + 2, 12, 1, C.woodDark);
        pc.fillRect(x * TILE + 2, y * TILE + 13, 12, 1, C.woodDark);
      }
    }
  return pc;
}

/**
 * Koruna stromu zhora: tieň posunutý nabok, tmavý obrys a sýta zelená s odleskom
 * (aby sa strom nestratil na tráve).
 */
function drawTree(pc: PixelCanvas, cx: number, cy: number): void {
  const R = 9;
  const inside = (xx: number, yy: number) =>
    xx * xx + yy * yy <= 64 + pixelNoise(cx + xx, cy + yy, 71) * 22;
  // Tieň.
  for (let yy = -R; yy <= R; yy++)
    for (let xx = -R; xx <= R; xx++)
      if (inside(xx, yy)) pc.set(cx + xx + 3, cy + yy + 3, 0x0b160c, 190);
  // Obrys.
  for (let yy = -R - 1; yy <= R + 1; yy++)
    for (let xx = -R - 1; xx <= R + 1; xx++) {
      if (inside(xx, yy)) continue;
      if (inside(xx + 1, yy) || inside(xx - 1, yy) || inside(xx, yy + 1) || inside(xx, yy - 1))
        pc.set(cx + xx, cy + yy, 0x0e2414);
    }
  // Koruna: tieňovanie podľa vzdialenosti od svetla vľavo hore, chumáče lístia.
  for (let yy = -R; yy <= R; yy++)
    for (let xx = -R; xx <= R; xx++) {
      if (!inside(xx, yy)) continue;
      const lit = (-xx - yy) / (R * 1.6) + (pixelNoise(cx + xx, cy + yy, 72) - 0.5) * 0.5;
      const color =
        lit > 0.55 ? 0x86c95e : lit > 0.15 ? 0x4f9c45 : lit > -0.35 ? 0x2f7438 : 0x1a4d2a;
      pc.set(cx + xx, cy + yy, color);
    }
}

// --- Postavy (otáčajú sa, kreslené pri pohľade doprava) ---

/** Hráč: bunda, vlasy a zbraň v smere +x; dve fázy kroku. */
export function drawPlayer(frame: number, weapon: WeaponId): PixelCanvas {
  const pc = new PixelCanvas(18, 16);
  const legs = frame ? ['..k...', '......', '...k..'] : ['...k..', '......', '..k...'];
  pc.stamp(3, 5, legs, { k: 0x22252e });
  // Ramená a telo (bunda).
  pc.stamp(4, 3, ['.jjjj.', 'jjjjjj', 'jjJJjj', 'jjJJjj', 'jjjjjj', '.jjjj.'], {
    j: 0x2f5d62,
    J: 0x3f7a80,
  });
  // Hlava.
  pc.stamp(6, 5, ['hhh', 'hHh', 'hhh'], { h: 0x3a2a20, H: 0x4a3628 });
  // Zbraň a ruky.
  const length = weapon === 'shotgun' ? 8 : weapon === 'smg' ? 6 : 4;
  pc.fillRect(9, 7, length + 2, 2, 0x1a1c22);
  pc.set(9, 6, C.skin);
  pc.set(9, 9, C.skin);
  pc.outline(C.ink);
  return pc;
}

const ZOMBIE_LOOK: Record<ZombieKind, { shirt: Rgb; skin: Rgb; size: number }> = {
  walker: { shirt: 0x5a4a6a, skin: C.zombieSkin, size: 1 },
  runner: { shirt: 0x7a3030, skin: 0xa8b88a, size: 1 },
  brute: { shirt: 0x3a3f2a, skin: 0x7a9a62, size: 1.5 },
};

/** Zombie s rukami natiahnutými dopredu (+x); dve fázy kroku. */
export function drawZombie(kind: ZombieKind, frame: number): PixelCanvas {
  const look = ZOMBIE_LOOK[kind];
  const big = look.size > 1;
  const pc = new PixelCanvas(big ? 24 : 16, big ? 22 : 16);
  const ox = big ? 3 : 2;
  const oy = big ? 4 : 2;
  const body = big
    ? [
        '..ssssss..',
        '.ssssssss.',
        'ssssSSssss',
        'ssssSSssss',
        'ssssSSssss',
        'ssssssssss',
        '.ssssssss.',
        '..ssssss..',
      ]
    : ['.ssss.', 'ssssss', 'ssSSss', 'ssSSss', 'ssssss', '.ssss.'];
  pc.stamp(ox, oy + 1, body, { s: look.shirt, S: shade(look.shirt, 1.25) });
  // Natiahnuté ruky (striedajú sa pri chôdzi).
  const armY1 = oy + 1 + (frame ? 0 : 1);
  const armY2 = oy + (big ? 8 : 6) - (frame ? 1 : 0);
  const reach = big ? 9 : 7;
  pc.fillRect(ox + (big ? 6 : 4), armY1, reach, big ? 2 : 1, look.skin);
  pc.fillRect(ox + (big ? 6 : 4), armY2, reach - (frame ? 1 : 0), big ? 2 : 1, look.skin);
  // Hlava (zelená koža, tmavé oči).
  const head = big
    ? ['.hhhh.', 'hhhhhh', 'hHhhHh', 'hhhhhh', '.hhhh.']
    : ['.hhh.', 'hhhhh', 'hHhHh', '.hhh.'];
  pc.stamp(ox + (big ? 2 : 1), oy + (big ? 2 : 2), head, { h: look.skin, H: C.ink });
  // Krv na tričku.
  pc.set(ox + 1, oy + 3, C.blood);
  pc.set(ox + 2, oy + 4, C.bloodDark);
  pc.outline(C.ink);
  return pc;
}

// --- Stopy na zemi ---

/** Fľak krvi (varianty). */
export function drawBlood(variant: number): PixelCanvas {
  const pc = new PixelCanvas(14, 14);
  for (let y = 0; y < 14; y++)
    for (let x = 0; x < 14; x++) {
      const dx = x - 7;
      const dy = y - 7;
      const n = pixelNoise(x, y, variant * 97 + 5);
      if (dx * dx + dy * dy < 14 + n * 30 && n < 0.85)
        pc.set(x, y, n < 0.25 ? C.bloodDark : C.blood, 210);
    }
  // Kvapky okolo.
  for (let i = 0; i < 4; i++) {
    const a = pixelNoise(i, variant, 9) * Math.PI * 2;
    pc.set(Math.round(7 + Math.cos(a) * 6), Math.round(7 + Math.sin(a) * 6), C.blood, 200);
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

export function drawPickup(kind: 'ammo' | 'health' | 'weapon', weapon?: WeaponId): PixelCanvas {
  const pc = new PixelCanvas(12, 12);
  if (kind === 'health') {
    pc.fillRect(1, 2, 10, 8, C.white);
    pc.fillRect(5, 3, 2, 6, 0xd02030);
    pc.fillRect(3, 5, 6, 2, 0xd02030);
  } else if (kind === 'ammo') {
    pc.fillRect(1, 3, 10, 7, 0x4a5a2a);
    pc.fillRect(2, 4, 8, 2, 0x5e7034);
    for (let i = 0; i < 4; i++) pc.fillRect(2 + i * 2, 1, 1, 3, 0xd8b04a);
  } else {
    pc.fillRect(0, 5, weapon === 'shotgun' ? 12 : 9, 2, 0x22252e);
    pc.fillRect(2, 7, 2, 3, 0x553923);
    if (weapon === 'smg') pc.fillRect(5, 7, 1, 3, 0x22252e);
    pc.set(11, 4, C.yellow);
  }
  pc.outline(C.ink);
  return pc;
}

/** Malá častica (krv, iskra, nábojnica). */
export function drawDot(color: Rgb, w = 2, h = 2): PixelCanvas {
  const pc = new PixelCanvas(w, h);
  pc.fillRect(0, 0, w, h, color);
  return pc;
}

/** Brána z mreží (zatvorená): 3 políčka dlhá, zvislá alebo vodorovná. */
export function drawGate(vertical: boolean): PixelCanvas {
  const long = TILE * 3;
  const pc = new PixelCanvas(vertical ? TILE : long, vertical ? long : TILE);
  const bar = 0x8b93a1;
  const dark = 0x3a3f4a;
  if (vertical) {
    pc.fillRect(5, 0, 6, long, dark);
    for (let y = 1; y < long; y += 4) pc.fillRect(4, y, 8, 2, bar);
    pc.fillRect(7, 0, 2, long, bar);
  } else {
    pc.fillRect(0, 5, long, 6, dark);
    for (let x = 1; x < long; x += 4) pc.fillRect(x, 4, 2, 8, bar);
    pc.fillRect(0, 7, long, 2, bar);
  }
  pc.outline(C.ink);
  return pc;
}

/** Šípka navigácie (smer +x). */
export function drawArrow(): PixelCanvas {
  const pc = new PixelCanvas(9, 9);
  pc.stamp(
    0,
    0,
    [
      '..y......',
      '..yy.....',
      'yyyyy....',
      'yyyyyy...',
      'yyyyyyy..',
      'yyyyyy...',
      'yyyyy....',
      '..yy.....',
      '..y......',
    ],
    {
      y: C.yellow,
    },
  );
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
