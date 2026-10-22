/** Priestorová mriežka pre rýchle hľadanie blízkych zombie (oddeľovanie, zásahy). */
export class SpatialHash<T extends { x: number; y: number }> {
  private cells = new Map<number, T[]>();

  constructor(private readonly size: number) {}

  private key(cx: number, cy: number): number {
    return (cx + 1024) * 4096 + (cy + 1024);
  }

  rebuild(items: readonly T[]): void {
    this.cells.clear();
    for (const item of items) {
      const k = this.key(Math.floor(item.x / this.size), Math.floor(item.y / this.size));
      let cell = this.cells.get(k);
      if (!cell) this.cells.set(k, (cell = []));
      cell.push(item);
    }
  }

  /** Položky v okolí bodu (bunky prekrývajúce štvorec s polomerom `r`). */
  near(x: number, y: number, r: number, out: T[] = []): T[] {
    out.length = 0;
    const minX = Math.floor((x - r) / this.size);
    const maxX = Math.floor((x + r) / this.size);
    const minY = Math.floor((y - r) / this.size);
    const maxY = Math.floor((y + r) / this.size);
    for (let cy = minY; cy <= maxY; cy++)
      for (let cx = minX; cx <= maxX; cx++) {
        const cell = this.cells.get(this.key(cx, cy));
        if (cell) for (const item of cell) out.push(item);
      }
    return out;
  }
}
