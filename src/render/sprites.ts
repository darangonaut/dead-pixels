import { TILE, Tile, type CityMap } from '@/game/map';
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
        case Tile.Fence:
          grass(pc, x0, y0);
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

  // Prerušovaná stredová čiara v uliciach (stred 4 políčok širokej ulice).
  const period = 17;
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      if (at(x, y) !== Tile.Road) continue;
      if (y % period === 2 && at(x, y - 1) === Tile.Road)
        for (let i = 0; i < TILE; i++)
          if ((x * TILE + i) % 12 < 6) pc.set(x * TILE + i, y * TILE, C.line);
      if (x % period === 2 && at(x - 1, y) === Tile.Road)
        for (let i = 0; i < TILE; i++)
          if ((y * TILE + i) % 12 < 6) pc.set(x * TILE, y * TILE + i, C.line);
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
        for (let yy = -8; yy <= 8; yy++)
          for (let xx = -8; xx <= 8; xx++) {
            const d = xx * xx + yy * yy;
            if (d > 64 + pixelNoise(cx + xx, cy + yy, 71) * 20) continue;
            const light = xx + yy < -4 && pixelNoise(cx + xx, cy + yy, 72) < 0.6;
            pc.set(cx + xx, cy + yy, light ? C.leafLight : C.leaf);
          }
      } else if (t === Tile.Lamp) {
        pc.fillRect(cx - 2, cy - 2, 5, 5, C.metalDark);
        pc.fillRect(cx - 1, cy - 1, 3, 3, C.yellow);
      } else if (t === Tile.Fence) {
        drawFenceTile(pc, map, x, y);
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

const FENCE = 0x9aa0aa;
const FENCE_DARK = 0x5f6570;

/**
 * Drôtený plot na okrajovom políčku: pletivo pri vnútornej hrane (hráč sa oň opiera)
 * a stĺpiky každé políčko.
 */
function drawFenceTile(pc: PixelCanvas, map: CityMap, x: number, y: number): void {
  const x0 = x * TILE;
  const y0 = y * TILE;
  const top = y === 0;
  const bottom = y === map.height - 1;
  const left = x === 0;
  const right = x === map.width - 1;
  const mesh = (px: number, py: number) =>
    pc.set(px, py, (px + py) % 3 === 0 ? FENCE : FENCE_DARK, (px + py) % 3 === 0 ? 255 : 170);
  // Pletivo ako pás 3 px pri hrane smerom do mesta, s diagonálnym vzorom.
  if (top || bottom) {
    const row = top ? y0 + TILE - 4 : y0 + 1;
    for (let i = 0; i < TILE; i++) for (let k = 0; k < 3; k++) mesh(x0 + i, row + k);
    pc.fillRect(x0, top ? row - 1 : row + 3, TILE, 1, FENCE_DARK);
  }
  if (left || right) {
    const col = left ? x0 + TILE - 4 : x0 + 1;
    for (let i = 0; i < TILE; i++) for (let k = 0; k < 3; k++) mesh(col + k, y0 + i);
    pc.fillRect(left ? col - 1 : col + 3, y0, 1, TILE, FENCE_DARK);
  }
  // Stĺpiky (aj v rohoch).
  const postX = left ? x0 + TILE - 5 : right ? x0 + 1 : x0 + 6;
  const postY = top ? y0 + TILE - 5 : bottom ? y0 + 1 : y0 + 6;
  pc.fillRect(postX, postY, 4, 4, FENCE_DARK);
  pc.fillRect(postX + 1, postY + 1, 2, 2, FENCE);
  // Tu a tam burina pri plote.
  if (pixelNoise(x, y, 81) < 0.4) {
    pc.set(x0 + 3, y0 + 4, C.grassLight);
    pc.set(x0 + 11, y0 + 10, C.grassLight);
  }
}

/** Okolie za plotom: zarastená tráva, burina a stromy (mimo hracej plochy). */
export function drawOutskirts(map: CityMap, margin: number): PixelCanvas {
  const w = (map.width + margin * 2) * TILE;
  const h = (map.height + margin * 2) * TILE;
  const pc = new PixelCanvas(w, h);
  for (let ty = 0; ty < map.height + margin * 2; ty++)
    for (let tx = 0; tx < map.width + margin * 2; tx++) {
      const inside =
        tx >= margin && ty >= margin && tx < map.width + margin && ty < map.height + margin;
      if (inside) continue;
      grass(pc, tx * TILE, ty * TILE);
      // Tmavšie fľaky buriny a vyšliapané blato.
      for (let yy = 0; yy < TILE; yy++)
        for (let xx = 0; xx < TILE; xx++) {
          const n = pixelNoise(tx * TILE + xx, ty * TILE + yy, 91);
          if (n < 0.1) pc.set(tx * TILE + xx, ty * TILE + yy, C.leaf);
          else if (pixelNoise(tx, ty, 92) < 0.15 && n > 0.6)
            pc.set(tx * TILE + xx, ty * TILE + yy, 0x4a3d2a);
        }
    }
  // Stromy za plotom (hustejšie ďalej od mesta).
  for (let ty = 0; ty < map.height + margin * 2; ty++)
    for (let tx = 0; tx < map.width + margin * 2; tx++) {
      const dx =
        tx < margin ? margin - tx : tx >= map.width + margin ? tx - map.width - margin + 1 : 0;
      const dy =
        ty < margin ? margin - ty : ty >= map.height + margin ? ty - map.height - margin + 1 : 0;
      const depth = Math.max(dx, dy);
      if (depth < 2 || pixelNoise(tx, ty, 93) > 0.12 + depth * 0.06) continue;
      const cx = tx * TILE + 8;
      const cy = ty * TILE + 8;
      for (let yy = -9; yy <= 9; yy++)
        for (let xx = -9; xx <= 9; xx++) {
          if (xx * xx + yy * yy > 70 + pixelNoise(cx + xx, cy + yy, 94) * 20) continue;
          const light = xx + yy < -5 && pixelNoise(cx + xx, cy + yy, 95) < 0.6;
          pc.set(cx + xx, cy + yy, light ? C.leafLight : C.leaf);
        }
    }
  return pc;
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
