import { isOpaque, isSolid, TILE, type CityMap } from './map';

export interface Vec {
  x: number;
  y: number;
}

/**
 * Lúč cez mriežku (DDA): vráti vzdialenosť po prvé políčko, pre ktoré `blocks` platí,
 * najviac `maxDist`.
 */
export function castRay(
  map: CityMap,
  x: number,
  y: number,
  dx: number,
  dy: number,
  maxDist: number,
  blocks: (map: CityMap, tx: number, ty: number) => boolean = isOpaque,
): number {
  let tx = Math.floor(x / TILE);
  let ty = Math.floor(y / TILE);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx === 0 ? Infinity : Math.abs(TILE / dx);
  const tDeltaY = dy === 0 ? Infinity : Math.abs(TILE / dy);
  let tMaxX = dx === 0 ? Infinity : (dx > 0 ? (tx + 1) * TILE - x : x - tx * TILE) / Math.abs(dx);
  let tMaxY = dy === 0 ? Infinity : (dy > 0 ? (ty + 1) * TILE - y : y - ty * TILE) / Math.abs(dy);
  let t = 0;
  while (t < maxDist) {
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      tx += stepX;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      ty += stepY;
    }
    if (t >= maxDist) break;
    if (blocks(map, tx, ty)) return t;
  }
  return maxDist;
}

/** Vidno z bodu A do bodu B (nič nepriehľadné medzi nimi)? */
export function lineOfSight(map: CityMap, a: Vec, b: Vec): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return true;
  return castRay(map, a.x, a.y, dx / dist, dy / dist, dist) >= dist;
}

/** Vytlačí kruh z pevných políčok (posun po osiach, aby sa dalo kĺzať po stenách). */
export function moveCircle(map: CityMap, pos: Vec, r: number, dx: number, dy: number): void {
  pos.x += dx;
  resolve(map, pos, r);
  pos.y += dy;
  resolve(map, pos, r);
}

function resolve(map: CityMap, pos: Vec, r: number): void {
  const minX = Math.floor((pos.x - r) / TILE);
  const maxX = Math.floor((pos.x + r) / TILE);
  const minY = Math.floor((pos.y - r) / TILE);
  const maxY = Math.floor((pos.y + r) / TILE);
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (!isSolid(map, tx, ty)) continue;
      const nx = Math.max(tx * TILE, Math.min(pos.x, (tx + 1) * TILE));
      const ny = Math.max(ty * TILE, Math.min(pos.y, (ty + 1) * TILE));
      const ox = pos.x - nx;
      const oy = pos.y - ny;
      const d2 = ox * ox + oy * oy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x += (ox / d) * (r - d);
        pos.y += (oy / d) * (r - d);
      } else {
        // Stred vo vnútri políčka: von najkratšou stranou.
        const left = pos.x - tx * TILE;
        const right = (tx + 1) * TILE - pos.x;
        const top = pos.y - ty * TILE;
        const bottom = (ty + 1) * TILE - pos.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) pos.x -= left + r;
        else if (m === right) pos.x += right + r;
        else if (m === top) pos.y -= top + r;
        else pos.y += bottom + r;
      }
    }
  }
}

/**
 * Polygón viditeľnosti (vejár lúčov) zo stredu po prekážky: celý kruh alebo výsek
 * okolo smeru `angle` so šírkou `spread` (radiány).
 */
export function visibilityFan(
  map: CityMap,
  x: number,
  y: number,
  radius: number,
  angle = 0,
  spread = Math.PI * 2,
  rays = 96,
): number[] {
  const points: number[] = [];
  const full = spread >= Math.PI * 2 - 1e-6;
  if (!full) points.push(x, y);
  const start = full ? 0 : angle - spread / 2;
  const count = full ? rays : rays + 1;
  for (let i = 0; i < count; i++) {
    const a = start + (spread * i) / rays;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    // Kúsok do steny, nech je osvetlená aj jej hrana.
    const d = Math.min(radius, castRay(map, x, y, dx, dy, radius) + 3);
    points.push(x + dx * d, y + dy * d);
  }
  return points;
}
