import type { Carry } from '@/game/game';
import type { WeaponId } from '@/game/weapons';
import { PixelCanvas, pixelNoise, shade, type Rgb } from './PixelCanvas';

/**
 * Hrdina celý spredu (obrazovka obchodu). Výbava sa na ňom ukáže: vesta podľa zdravia,
 * topánky podľa rýchlosti, baterka podľa jej úrovne a batérie, rukavice a nábojový pás
 * podľa sily zbraní, zbraň v ruke, ďalšie na chrbte, granáty na opasku.
 */

const INK = 0x0d0b14;
const SKIN = 0xe0a878;
const SKIN_D = 0xb8805a;
const HAIR = 0x4a3628;
const HAIR_L = 0x6a4c36;
const JACKET = 0x2f5d62;
const JEANS = 0x2c3a5a;
const BOOT = 0x3a2a20;
const VEST = 0x4a5534;
const STRAP = 0x2a251c;
const METAL = 0x8b93a1;
const GUN = 0x1a1c22;
const GUN_L = 0x3a3e48;
const WOOD = 0x6a4428;
const RED = 0xc42a36;
const BRASS = 0xd8b04a;
const LIGHT = 0xfff2b0;

export const HERO_W = 72;
export const HERO_H = 104;

function rect(pc: PixelCanvas, x: number, y: number, w: number, h: number, c: Rgb): void {
  pc.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h), c);
}

function ellipse(
  pc: PixelCanvas,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: Rgb | ((nx: number, ny: number, x: number, y: number) => Rgb | null),
  alpha = 255,
  onlyEmpty = false,
): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      if (onlyEmpty && pc.isFilled(x, y)) continue;
      const c = typeof color === 'function' ? color(nx, ny, x, y) : color;
      if (c !== null) pc.set(x, y, c, alpha);
    }
}

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

/** Tmavý obrys okolo všetkého nakresleného (čitateľná silueta). */
function outline(pc: PixelCanvas): void {
  const edge: number[] = [];
  for (let y = 0; y < pc.height; y++)
    for (let x = 0; x < pc.width; x++) {
      if (pc.isFilled(x, y)) continue;
      if (
        pc.isFilled(x - 1, y) ||
        pc.isFilled(x + 1, y) ||
        pc.isFilled(x, y - 1) ||
        pc.isFilled(x, y + 1)
      )
        edge.push(x, y);
    }
  for (let i = 0; i < edge.length; i += 2) pc.set(edge[i]!, edge[i + 1]!, INK);
}

/** Zvislé tieňovanie: svetlo zľava, tieň vpravo. */
const sideShade = (base: Rgb, x: number, left: number, right: number): Rgb =>
  x <= left ? shade(base, 1.22) : x >= right ? shade(base, 0.72) : base;

// --- Zbrane (bočný pohľad, hlaveň doľava) ---

function heldWeapon(pc: PixelCanvas, weapon: WeaponId, hx: number, hy: number): void {
  if (weapon === 'crowbar') {
    line(pc, hx - 1, hy + 1, hx - 7, hy + 17, 2.2, (t) => (t < 0.15 ? 0x8b93a1 : 0x9a2a22));
    rect(pc, hx - 10, hy + 16, 3, 2, 0x9a2a22);
    pc.set(hx - 10, hy + 16, 0xc8ccd4);
    return;
  }
  if (weapon === 'pistol') {
    rect(pc, hx - 8, hy - 1, 8, 3, GUN);
    rect(pc, hx - 8, hy - 1, 8, 1, GUN_L);
    rect(pc, hx - 2, hy + 2, 2, 3, GUN);
    return;
  }
  if (weapon === 'shotgun') {
    rect(pc, hx - 17, hy - 1, 17, 2, GUN);
    rect(pc, hx - 17, hy - 1, 17, 1, GUN_L);
    rect(pc, hx - 12, hy + 1, 6, 2, WOOD); // pumpa
    rect(pc, hx - 12, hy + 1, 6, 1, shade(WOOD, 1.25));
    rect(pc, hx + 1, hy, 5, 3, WOOD); // pažba pod pazuchou
    return;
  }
  if (weapon === 'smg') {
    rect(pc, hx - 12, hy - 1, 12, 3, GUN);
    rect(pc, hx - 12, hy - 1, 12, 1, GUN_L);
    rect(pc, hx - 6, hy + 2, 2, 5, GUN); // zásobník
    rect(pc, hx - 15, hy, 3, 1, GUN_L); // tlmič
    rect(pc, hx + 1, hy, 3, 2, GUN_L);
    return;
  }
  // Plameňomet: tryska a hadica k nádržiam na chrbte.
  rect(pc, hx - 15, hy - 1, 15, 3, 0x5a5e66);
  rect(pc, hx - 15, hy - 1, 15, 1, METAL);
  rect(pc, hx - 17, hy - 1, 2, 3, GUN);
  pc.set(hx - 18, hy, 0xff9a30);
  pc.set(hx - 18, hy + 1, 0xffd34e);
  line(pc, hx + 1, hy + 2, hx + 7, hy + 6, 1.4, 0x2a2a2a);
}

/** Zbrane, ktoré nie sú v ruke: na chrbte (kreslí sa pred telom = za ním). */
function backWeapons(pc: PixelCanvas, owned: readonly WeaponId[], held: WeaponId): void {
  const has = (w: WeaponId) => owned.includes(w) && w !== held;
  if (has('flamer')) {
    for (const x of [24, 43]) {
      rect(pc, x, 19, 6, 12, 0xa83a2a);
      rect(pc, x, 19, 2, 12, 0xc85a4a);
      rect(pc, x + 1, 17, 4, 2, METAL);
    }
  }
  if (has('shotgun')) {
    // Cez pravé plece (z pohľadu diváka vľavo): hlaveň trčí nad rameno.
    line(pc, 22, 2, 28, 30, 2.4, (t) => (t < 0.62 ? GUN : WOOD));
    pc.set(22, 2, GUN_L);
  }
  if (has('smg')) line(pc, 50, 8, 46, 30, 2.6, (t) => (t < 0.2 ? GUN_L : GUN));
}

/** Hrdina spredu s celou výbavou. */
export function drawHero(carry: Carry): PixelCanvas {
  const pc = new PixelCanvas(HERO_W, HERO_H);
  const u = carry.upgrades;
  const held = carry.weapon;
  const cx = 36;

  backWeapons(pc, carry.owned, held);

  // --- Nohy a topánky ---
  for (const x0 of [27, 37]) {
    for (let y = 58; y < 86; y++)
      for (let x = x0; x < x0 + 9; x++) {
        const knee = y === 71 || y === 72;
        const c = sideShade(JEANS, x, x0, x0 + 7);
        pc.set(x, y, knee && pixelNoise(x, y, 4) < 0.5 ? shade(c, 0.85) : c);
      }
    if (u.speed >= 3) {
      // Chrániče kolien.
      rect(pc, x0, 70, 9, 5, 0x2a2c32);
      rect(pc, x0 + 1, 70, 7, 1, 0x4a4e58);
    }
    if (u.speed >= 1) {
      // Bežecké topánky: biele s farebným pruhom.
      rect(pc, x0 - 1, 85, 11, 6, 0xe8e4dc);
      rect(pc, x0 - 1, 85, 11, 1, 0xffffff);
      rect(pc, x0 - 1, 90, 11, 2, 0x8a8a8a);
      rect(pc, x0 + 1, 87, 7, 2, u.speed >= 2 ? 0xffd34e : RED);
      if (u.speed >= 2) rect(pc, x0, 83, 9, 2, 0xffd34e); // reflexné pásky
    } else {
      rect(pc, x0 - 1, 85, 11, 6, BOOT);
      rect(pc, x0 - 1, 85, 11, 1, shade(BOOT, 1.3));
      rect(pc, x0 - 1, 90, 11, 2, shade(BOOT, 0.6));
      rect(pc, x0 + 2, 86, 5, 1, shade(BOOT, 0.75)); // šnúrky
    }
  }

  // --- Trup: bunda, tričko, zips ---
  for (let y = 28; y < 57; y++) {
    const inset = y < 31 ? 0 : Math.floor((y - 31) / 12);
    for (let x = 24 + inset; x <= 48 - inset; x++) pc.set(x, y, sideShade(JACKET, x, 27, 45));
  }
  for (let y = 28; y < 34; y++)
    for (let x = cx - 4 + (y - 28); x <= cx + 4 - (y - 28); x++)
      pc.set(x, y, y === 28 ? 0x7a7a72 : 0x9a9a92);
  for (let y = 34; y < 55; y++) pc.set(cx, y, shade(JACKET, 0.6));
  pc.set(cx, 35, METAL);
  // Popruhy batohu (ak nie je vesta).
  if (u.health < 1)
    for (const x of [29, 42]) {
      rect(pc, x, 28, 2, 22, STRAP);
      rect(pc, x, 44, 2, 2, METAL);
    }

  // --- Vesta (zdravie) ---
  if (u.health >= 1) {
    for (let y = 30; y < 55; y++)
      for (let x = 27; x <= 45; x++) {
        if (y < 33 && x > 31 && x < 41) continue; // výstrih
        const c = sideShade(VEST, x, 29, 43);
        pc.set(x, y, u.health >= 2 && (y === 41 || y === 48) ? shade(VEST, 0.7) : c);
      }
    rect(pc, 28, 28, 4, 3, VEST);
    rect(pc, 41, 28, 4, 3, shade(VEST, 0.8));
    // Červený kríž na hrudi.
    rect(pc, 31, 35, 3, 1, RED);
    rect(pc, 32, 34, 1, 3, RED);
    if (u.health >= 3)
      for (const x of [28, 39]) {
        rect(pc, x, 49, 6, 5, shade(VEST, 0.78));
        rect(pc, x, 49, 6, 2, shade(VEST, 1.15));
        pc.set(x + 3, 51, METAL);
      }
    if (u.health >= 4)
      for (const x of [24, 48])
        ellipse(pc, x, 30, 4.2, 3, (_nx, ny) => (ny < -0.3 ? shade(VEST, 1.25) : VEST));
  }

  // --- Nábojový pás (sila zbraní) ---
  if (u.damage >= 2) {
    line(pc, 27, 30, 45, 54, 3, 0x5a3a1e);
    const bullets = 2 + u.damage * 2;
    for (let i = 0; i < bullets; i++) {
      const t = (i + 0.5) / bullets;
      const x = Math.round(27 + 18 * t);
      const y = Math.round(30 + 24 * t);
      pc.set(x, y - 1, BRASS);
      pc.set(x, y, shade(BRASS, 0.8));
    }
  }

  // --- Opasok, granáty, pajcer ---
  rect(pc, 25, 55, 23, 3, STRAP);
  rect(pc, 34, 55, 4, 3, METAL);
  rect(pc, 35, 56, 2, 1, shade(METAL, 0.6));
  const nades = Math.min(4, carry.grenades);
  for (let i = 0; i < nades; i++) {
    const gx = 27 + i * 2.6;
    ellipse(pc, gx, 60, 1.4, 2, (nx) => (nx < -0.2 ? 0x5e7034 : 0x4a5a2a));
    pc.set(Math.round(gx), 57, METAL);
  }
  if (held !== 'crowbar' && carry.owned.includes('crowbar')) {
    line(pc, 46, 56, 49, 74, 2, 0x9a2a22);
    rect(pc, 49, 73, 2, 2, 0x9a2a22);
    pc.set(46, 56, 0xc8ccd4);
  }

  // --- Ruky ---
  const sleeve = (_t: number, side: number) =>
    side > 0.35 ? shade(JACKET, 0.72) : side < -0.35 ? shade(JACKET, 1.22) : JACKET;
  line(pc, 23, 30, 19, 52, 5.4, sleeve);
  line(pc, 49, 30, 53, 52, 5.4, sleeve);
  const glove = u.damage >= 1;
  for (const [hx, hy] of [
    [19, 55],
    [53, 55],
  ] as const) {
    ellipse(pc, hx, hy, 2.6, 2.6, (nx, ny) =>
      glove ? (ny > 0.4 ? SKIN : nx < -0.2 ? 0x3a3c44 : 0x2a2c32) : nx < -0.2 ? SKIN : SKIN_D,
    );
  }
  if (u.damage >= 5) rect(pc, 21, 37, 5, 2, RED); // páska na rukáve

  // --- Hlava ---
  rect(pc, 33, 25, 7, 3, SKIN_D); // krk
  ellipse(pc, cx, 17, 6.6, 8.2, (nx, ny, x, y) => {
    if (ny < -0.28 || (Math.abs(nx) > 0.82 && ny < 0.25))
      return nx < -0.2 && ny < -0.5 ? HAIR_L : HAIR;
    if (ny > 0.45 && pixelNoise(x, y, 7) < 0.3) return SKIN_D; // strnisko
    return nx > 0.55 ? SKIN_D : SKIN;
  });
  pc.set(29, 18, SKIN_D);
  pc.set(43, 18, SKIN_D);
  for (const ex of [33, 39]) {
    pc.set(ex, 17, 0x1a1418);
    pc.set(ex, 16, HAIR);
    pc.set(ex + (ex < cx ? -1 : 1), 16, HAIR);
  }
  pc.set(cx, 19, SKIN_D);
  pc.set(cx, 20, SKIN_D);
  rect(pc, cx - 1, 22, 3, 1, 0x8a4a3a);
  // Šatka (sila 4+), prilba (zdravie 5), čelovka (baterka 3+).
  if (u.damage >= 4) {
    rect(pc, 30, 12, 13, 2, RED);
    rect(pc, 43, 13, 2, 1, RED);
    rect(pc, 44, 14, 2, 1, shade(RED, 0.8));
  }
  if (u.health >= 5) {
    ellipse(pc, cx, 12, 8, 6, (nx, ny) =>
      ny > 0.25 ? null : nx < -0.3 && ny < -0.3 ? shade(VEST, 1.3) : VEST,
    );
    rect(pc, 28, 13, 17, 1, shade(VEST, 0.7));
    pc.set(29, 19, STRAP);
    pc.set(43, 19, STRAP);
  }
  if (u.flashlight >= 3) {
    rect(pc, 29, 11, 15, 1, 0x2a2a2a);
    rect(pc, 34, 9, 5, 3, 0x3a3c44);
    rect(pc, 35, 10, 3, 1, LIGHT);
  }

  // --- Zbraň v ruke a baterka ---
  heldWeapon(pc, held, 17, 55);
  const flen = 6 + u.flashlight;
  rect(pc, 52, 57, 3, flen, 0x2a2c32);
  rect(pc, 52, 57, 1, flen, 0x4a4e58);
  rect(pc, 51, 57 + flen, 5, 3, METAL);
  rect(pc, 52, 59 + flen, 3, 1, LIGHT);
  // Ukazovateľ batérie na baterke.
  const battery = carry.battery ?? 100;
  const level = Math.round((battery / 100) * (flen - 2));
  const batColor = battery < 20 ? RED : battery < 50 ? 0xffd34e : 0x7fd040;
  for (let i = 0; i < flen - 2; i++) pc.set(54, 58 + flen - 2 - i, i < level ? batColor : GUN);

  outline(pc);

  // --- Tieň a kruh svetla na zemi (nad obrysom, len na prázdnych miestach) ---
  ellipse(pc, cx, 96, 15, 2.6, 0x000000, 110, true);
  const pool = 7 + u.flashlight * 1.6;
  const glow = Math.round(40 + u.flashlight * 14) * (battery > 0 ? 1 : 0.3);
  ellipse(pc, 58, 96, pool, 2.4 + u.flashlight * 0.3, LIGHT, glow, true);
  for (let y = 62 + flen; y < 95; y++) {
    const t = (y - 62 - flen) / (95 - 62 - flen);
    const half = 1.5 + t * pool * 0.75;
    for (let x = Math.floor(53.5 + t * 4.5 - half); x <= Math.ceil(53.5 + t * 4.5 + half); x++)
      if (!pc.isFilled(x, y)) pc.set(x, y, LIGHT, Math.round(glow * 0.5));
  }
  return pc;
}

// --- Ikony položiek obchodu (16 × 16) ---

export type IconId =
  | `weapon:${WeaponId}`
  | `ammo:${WeaponId}`
  | 'grenades'
  | 'batteries'
  | `up:${'damage' | 'flashlight' | 'health' | 'speed'}`;

function gunIcon(pc: PixelCanvas, weapon: WeaponId): void {
  if (weapon === 'shotgun') {
    rect(pc, 1, 6, 11, 2, GUN);
    rect(pc, 1, 6, 11, 1, GUN_L);
    rect(pc, 4, 8, 4, 2, WOOD);
    rect(pc, 11, 6, 4, 4, WOOD);
    rect(pc, 12, 9, 3, 2, shade(WOOD, 0.8));
  } else if (weapon === 'smg') {
    rect(pc, 2, 5, 10, 3, GUN);
    rect(pc, 2, 5, 10, 1, GUN_L);
    rect(pc, 6, 8, 2, 5, GUN);
    rect(pc, 10, 8, 2, 3, GUN);
    rect(pc, 12, 6, 3, 2, GUN_L);
    rect(pc, 0, 6, 2, 1, GUN_L);
  } else if (weapon === 'flamer') {
    rect(pc, 9, 3, 5, 10, 0xa83a2a);
    rect(pc, 9, 3, 2, 10, 0xc85a4a);
    rect(pc, 10, 2, 3, 1, METAL);
    rect(pc, 1, 8, 9, 2, 0x5a5e66);
    rect(pc, 1, 8, 9, 1, METAL);
    pc.set(0, 8, 0xff9a30);
  } else {
    rect(pc, 4, 6, 8, 3, GUN);
    rect(pc, 9, 9, 3, 4, GUN);
  }
}

export function drawIcon(id: IconId): PixelCanvas {
  const pc = new PixelCanvas(16, 16);
  const [kind, what] = id.split(':') as [string, string | undefined];
  if (kind === 'weapon') gunIcon(pc, what as WeaponId);
  else if (kind === 'ammo') {
    if (what === 'shotgun')
      for (let i = 0; i < 3; i++) {
        rect(pc, 3 + i * 4, 3, 3, 8, RED);
        rect(pc, 3 + i * 4, 3, 1, 8, 0xe85a5a);
        rect(pc, 3 + i * 4, 11, 3, 3, BRASS);
      }
    else if (what === 'smg')
      for (let i = 0; i < 4; i++) {
        rect(pc, 2 + i * 3, 4, 2, 9, BRASS);
        rect(pc, 2 + i * 3, 3, 2, 2, 0xb86a3a);
        pc.set(2 + i * 3, 6, 0xf0d070);
      }
    else {
      rect(pc, 4, 4, 8, 10, RED);
      rect(pc, 4, 4, 2, 10, 0xe85a5a);
      rect(pc, 6, 2, 3, 2, METAL);
      rect(pc, 7, 7, 2, 4, 0xffd34e);
      pc.set(6, 9, 0xff9a30);
      pc.set(9, 9, 0xff9a30);
    }
  } else if (kind === 'grenades') {
    ellipse(pc, 8, 9.5, 4.5, 5, (nx, ny, x, y) =>
      x % 3 === 0 || y % 3 === 0 ? 0x34401e : nx + ny < -0.5 ? 0x6e7e3a : 0x4a5a2a,
    );
    rect(pc, 6, 3, 4, 2, METAL);
    rect(pc, 10, 3, 3, 1, METAL);
    ellipse(pc, 4.5, 3.5, 1.6, 1.6, (nx, ny) => (nx * nx + ny * ny < 0.3 ? null : BRASS));
  } else if (kind === 'batteries') {
    rect(pc, 2, 5, 11, 7, 0x1e2026);
    rect(pc, 2, 5, 11, 1, 0x4a4e58);
    rect(pc, 9, 5, 4, 7, 0xc8781e);
    rect(pc, 9, 5, 4, 1, 0xf0a840);
    rect(pc, 13, 7, 2, 3, METAL);
    rect(pc, 4, 8, 3, 1, 0x8ac87a);
    rect(pc, 5, 7, 1, 3, 0x8ac87a);
  } else if (what === 'damage') {
    // Náboj s iskrami.
    line(pc, 3, 13, 10, 6, 3, (t) => (t < 0.55 ? BRASS : 0xb86a3a));
    pc.set(4, 11, 0xf0d070);
    for (const [x, y] of [
      [12, 2],
      [14, 5],
      [11, 4],
      [13, 1],
    ] as const)
      pc.set(x, y, 0xffd34e);
  } else if (what === 'flashlight') {
    for (let x = 7; x < 16; x++) {
      const half = (x - 7) * 0.6 + 1;
      for (let y = Math.round(8 - half); y <= Math.round(8 + half); y++) pc.set(x, y, LIGHT, 110);
    }
    rect(pc, 1, 7, 5, 3, 0x2a2c32);
    rect(pc, 1, 7, 5, 1, 0x4a4e58);
    rect(pc, 6, 6, 2, 5, METAL);
  } else if (what === 'health') {
    // Vesta s krížom.
    for (let y = 3; y < 14; y++)
      for (let x = 3; x < 13; x++) {
        if (y < 5 && x > 5 && x < 10) continue; // výstrih
        pc.set(x, y, x < 5 ? shade(VEST, 1.25) : y === 10 ? shade(VEST, 0.7) : VEST);
      }
    rect(pc, 7, 7, 3, 1, RED);
    rect(pc, 8, 6, 1, 3, RED);
  } else {
    // Bežecká topánka s čiarami pohybu.
    rect(pc, 5, 7, 6, 5, 0xe8e4dc);
    rect(pc, 5, 9, 10, 3, 0xe8e4dc);
    rect(pc, 5, 12, 10, 2, 0x8a8a8a);
    rect(pc, 7, 9, 6, 1, RED);
    rect(pc, 5, 7, 6, 1, 0xffffff);
    for (const y of [6, 9, 12]) rect(pc, 0, y, 3, 1, 0x8a8696);
  }
  outline(pc);
  return pc;
}
