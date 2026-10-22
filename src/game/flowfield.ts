import { isSolid, TILE, type CityMap } from './map';

export const UNREACHABLE = 0xffff;

/**
 * Mapa vzdialeností k hráčovi (BFS po políčkach, aj diagonálne). Zombie idú vždy na
 * susedné políčko s menšou hodnotou — jedna mapa stačí pre celú hordu.
 */
export class FlowField {
  readonly dist: Uint16Array;
  private queue: Int32Array;
  targetTile = -1;

  constructor(private readonly map: CityMap) {
    this.dist = new Uint16Array(map.width * map.height);
    this.queue = new Int32Array(map.width * map.height);
  }

  update(x: number, y: number): void {
    const { width, height } = this.map;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const target = ty * width + tx;
    if (target === this.targetTile) return;
    this.targetTile = target;
    this.dist.fill(UNREACHABLE);
    let head = 0;
    let tail = 0;
    this.dist[target] = 0;
    this.queue[tail++] = target;
    while (head < tail) {
      const i = this.queue[head++]!;
      const cx = i % width;
      const cy = (i - cx) / width;
      const d = this.dist[i]! + 1;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (isSolid(this.map, nx, ny)) continue;
          // Diagonála len ak sa nedá zaseknúť o roh.
          if (
            ox !== 0 &&
            oy !== 0 &&
            (isSolid(this.map, cx + ox, cy) || isSolid(this.map, cx, cy + oy))
          )
            continue;
          const n = ny * width + nx;
          if (this.dist[n]! <= d) continue;
          this.dist[n] = d;
          this.queue[tail++] = n;
        }
      }
    }
  }

  /** Smer (jednotkový vektor) k hráčovi z bodu, alebo null, ak nevedie cesta. */
  direction(x: number, y: number): { x: number; y: number } | null {
    const { width, height } = this.map;
    const cx = Math.floor(x / TILE);
    const cy = Math.floor(y / TILE);
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) return null;
    let best = this.dist[cy * width + cx]!;
    let bx = 0;
    let by = 0;
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const d = this.dist[ny * width + nx]!;
        if (d < best) {
          best = d;
          bx = ox;
          by = oy;
        }
      }
    if (bx === 0 && by === 0) return null;
    const tx = (cx + bx + 0.5) * TILE - x;
    const ty = (cy + by + 0.5) * TILE - y;
    const len = Math.hypot(tx, ty) || 1;
    return { x: tx / len, y: ty / len };
  }
}
