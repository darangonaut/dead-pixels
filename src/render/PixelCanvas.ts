/**
 * Malé RGBA plátno pre pixel art. Žiadne vyhladzovanie: pixel je buď celý, alebo vôbec.
 * Polygóny sa rasterizujú testom stredu pixela, takže izometrické hrany majú čisté
 * schodíky 2:1 a susedné políčka sa skladajú bez medzier aj prekryvov.
 */
export type Rgb = number; // 0xRRGGBB

export type Point = readonly [number, number];

export class PixelCanvas {
  readonly data: Uint8ClampedArray;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  set(x: number, y: number, color: Rgb, alpha = 255): void {
    if (!this.inBounds(x, y)) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = (color >> 16) & 0xff;
    this.data[i + 1] = (color >> 8) & 0xff;
    this.data[i + 2] = color & 0xff;
    this.data[i + 3] = alpha;
  }

  isFilled(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.data[(y * this.width + x) * 4 + 3]! > 0;
  }

  get(x: number, y: number): Rgb | null {
    if (!this.isFilled(x, y)) return null;
    const i = (y * this.width + x) * 4;
    return (this.data[i]! << 16) | (this.data[i + 1]! << 8) | this.data[i + 2]!;
  }

  /** Vyplní polygón; `color` môže byť funkcia súradníc (dithering, textúra). */
  fillPolygon(points: readonly Point[], color: Rgb | ((x: number, y: number) => Rgb | null)): void {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const minX = Math.max(0, Math.floor(Math.min(...xs)));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(...xs)));
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(...ys)));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!pointInPolygon(x + 0.5, y + 0.5, points)) continue;
        const c = typeof color === 'function' ? color(x, y) : color;
        if (c !== null) this.set(x, y, c);
      }
    }
  }

  /** Izometrický kosoštvorec so stredom (cx, cy) a polovičnými rozmermi hw × hw/2. */
  fillDiamond(
    cx: number,
    cy: number,
    hw: number,
    color: Rgb | ((x: number, y: number) => Rgb | null),
  ): void {
    this.fillPolygon(diamondPoints(cx, cy, hw), color);
  }

  fillRect(x: number, y: number, w: number, h: number, color: Rgb): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, color);
  }

  /**
   * Nakreslí ASCII sprite. Každý znak je kľúč do palety, '.' a ' ' sú priehľadné.
   * (x, y) je ľavý horný roh.
   */
  stamp(
    x: number,
    y: number,
    rows: readonly string[],
    palette: Readonly<Record<string, Rgb>>,
  ): void {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const color = palette[row[dx]!];
        if (color !== undefined) this.set(x + dx, y + dy, color);
      }
    });
  }

  /** Nakreslí iné plátno (jeho nepriehľadné pixely) s ľavým horným rohom v (x, y). */
  blit(source: PixelCanvas, x: number, y: number): void {
    for (let sy = 0; sy < source.height; sy++) {
      for (let sx = 0; sx < source.width; sx++) {
        const i = (sy * source.width + sx) * 4;
        if (source.data[i + 3]! === 0) continue;
        const color = (source.data[i]! << 16) | (source.data[i + 1]! << 8) | source.data[i + 2]!;
        this.set(x + sx, y + sy, color, source.data[i + 3]!);
      }
    }
  }

  /** Obrys: priehľadné pixely susediace (4-okolie) s vyplnenými dostanú farbu `color`. */
  outline(color: Rgb): void {
    const edge: number[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.isFilled(x, y)) continue;
        if (
          this.isFilled(x - 1, y) ||
          this.isFilled(x + 1, y) ||
          this.isFilled(x, y - 1) ||
          this.isFilled(x, y + 1)
        ) {
          edge.push(x, y);
        }
      }
    }
    for (let i = 0; i < edge.length; i += 2) this.set(edge[i]!, edge[i + 1]!, color);
  }

  /** Prevedie na HTML canvas (iba v prehliadači). */
  toCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(this.width, this.height);
    image.data.set(this.data);
    context.putImageData(image, 0, 0);
    return canvas;
  }
}

export function diamondPoints(cx: number, cy: number, hw: number): Point[] {
  const hh = hw / 2;
  return [
    [cx, cy - hh],
    [cx + hw, cy],
    [cx, cy + hh],
    [cx - hw, cy],
  ];
}

function pointInPolygon(x: number, y: number, points: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Deterministický šum 0–1 pre pixel (textúry, dithering). */
export function pixelNoise(x: number, y: number, seed: number): number {
  let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1442695041, 2246822519) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function shade(color: Rgb, factor: number): Rgb {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}
