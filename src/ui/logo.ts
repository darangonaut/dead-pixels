import { PixelCanvas } from '@/render/PixelCanvas';

const GLYPHS: Record<string, string[]> = {
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
};

/** Logo DEAD PIXELS: krvavo červené písmená so stekajúcimi kvapkami. */
export function drawLogo(text = 'DEAD PIXELS'): HTMLCanvasElement {
  const scale = 2;
  const width = [...text].reduce((w, ch) => w + (GLYPHS[ch]![0]!.length + 1) * scale, 0);
  const pc = new PixelCanvas(width + 4, 7 * scale + 12);
  let cursor = 2;
  let seed = 7;
  for (const ch of text) {
    const glyph = GLYPHS[ch]!;
    glyph.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) {
        if (row[gx] !== '#') continue;
        const color = gy < 2 ? 0xe03a3a : gy < 5 ? 0xb01e2a : 0x7a1020;
        pc.fillRect(cursor + gx * scale, 2 + gy * scale, scale, scale, color);
        // Kvapky stekajú z niektorých spodných bodov.
        if (gy === 6) {
          seed = (seed * 9301 + 49297) % 233280;
          if (seed % 3 === 0) {
            const len = 2 + (seed % 7);
            pc.fillRect(cursor + gx * scale, 2 + 7 * scale, 1, len, 0x7a1020);
          }
        }
      }
    });
    cursor += (glyph[0]!.length + 1) * scale;
  }
  pc.outline(0x0d0b14);
  return pc.toCanvas();
}
