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
  /** Betónová podlaha v budovách. */
  Floor,
  /** Zatvorená brána medzi úsekmi (mreže — svetlo cez ne presvieti). */
  Gate,
  /** Otvorená brána (prah). */
  Door,
  /** Heliport — cieľ úrovne. */
  Helipad,
  /** Stĺp v sklade. */
  Pillar,
}

export type RoomType = 'street' | 'alley' | 'parking' | 'park' | 'warehouse' | 'plaza';
export type Encounter = 'start' | 'calm' | 'roam' | 'horde' | 'exit';
export type SpawnKind = 'walker' | 'runner' | 'brute';

/** Úsek úrovne: obdĺžnik políčok obklopený budovami, s bránou dnu a von. */
export interface Room {
  index: number;
  type: RoomType;
  encounter: Encounter;
  /** Vnútorné hranice (políčka, vrátane). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Kontrolný bod: miesto pri vstupe (svet). */
  entry: { x: number; y: number };
  doorIn: number | null;
  doorOut: number | null;
  /** Zombie, ktoré sa v úseku túlajú od začiatku. */
  roamers: { kind: SpawnKind; x: number; y: number }[];
  loot: { kind: 'ammo' | 'health'; x: number; y: number }[];
}

export interface Gate {
  id: number;
  tiles: number[];
  /** Brána v zvislej stene (prechod vľavo ↔ vpravo). */
  vertical: boolean;
  open: boolean;
  /** Stred brány (svet) — šípka navigácie. */
  x: number;
  y: number;
}

/** Úroveň: mriežka políčok, úseky pospájané bránami, štart a heliport. */
export interface CityMap {
  width: number;
  height: number;
  tiles: Uint8Array;
  /** Farba strechy / auta, značenie ciest (pozri `drawGround`). */
  variant: Uint8Array;
  lamps: { x: number; y: number }[];
  spawn: { x: number; y: number };
  rooms: Room[];
  gates: Gate[];
  /** Index úseku pre každé políčko (-1 = mimo). */
  roomOf: Int16Array;
  exit: { x: number; y: number };
  /** Zvýši sa pri každej zmene priechodnosti (brány) — mapa vzdialeností sa prepočíta. */
  revision: number;
}

const SOLID = new Set<Tile>([
  Tile.Building,
  Tile.Car,
  Tile.Tree,
  Tile.Lamp,
  Tile.Crate,
  Tile.Gate,
  Tile.Pillar,
]);
const OPAQUE = new Set<Tile>([Tile.Building, Tile.Car, Tile.Crate, Tile.Pillar]);

export const tileAt = (map: CityMap, tx: number, ty: number): Tile =>
  tx < 0 || ty < 0 || tx >= map.width || ty >= map.height
    ? Tile.Building
    : (map.tiles[ty * map.width + tx]! as Tile);

/** Políčko, cez ktoré sa nedá prejsť (okraj mapy je stena). */
export const isSolid = (map: CityMap, tx: number, ty: number): boolean =>
  SOLID.has(tileAt(map, tx, ty));

/** Políčko, ktoré zastaví svetlo baterky (budovy, autá, regály — nie mreže a stromy). */
export const isOpaque = (map: CityMap, tx: number, ty: number): boolean =>
  OPAQUE.has(tileAt(map, tx, ty));

/** Otvorí alebo zatvorí bránu (zmení priechodnosť mapy). */
export function setGate(map: CityMap, id: number, open: boolean): void {
  const gate = map.gates[id];
  if (!gate || gate.open === open) return;
  gate.open = open;
  for (const i of gate.tiles) map.tiles[i] = open ? Tile.Door : Tile.Gate;
  map.revision++;
}

/** Veľkosť bunky mriežky úsekov (vrátane jednej steny). */
const CW = 22;
const CH = 16;
const ROWS = 3;

/** Variant cesty: stredová čiara a parkovacie čiary (pre kreslenie). */
export const ROAD_LINE_H = 1;
export const ROAD_LINE_V = 2;
export const PARKING_LINE = 3;

const PROPS = new Set<Tile>([Tile.Building, Tile.Car, Tile.Crate, Tile.Tree, Tile.Pillar]);

/**
 * Vygeneruje úroveň: cesta úsekov rôznych typov (ulica, ulička, parkovisko, park, sklad,
 * námestie) na mriežke, pospájaných bránami. Prvý úsek je štart, posledný heliport.
 * Vyššia úroveň = dlhšia cesta a viac hord.
 */
export function generateLevel(seed: number, level = 1): CityMap {
  const rng = createRng(seed ^ Math.imul(level, 0x9e3779b1));
  const length = Math.min(12, 5 + level);

  // Náhodná cesta po mriežke: hlavne doprava, občas hore / dole (bez návratu).
  const cells: { cx: number; cy: number }[] = [{ cx: 0, cy: randomInt(rng, 0, ROWS - 1) }];
  const used = new Set([`${cells[0]!.cx},${cells[0]!.cy}`]);
  while (cells.length < length) {
    const { cx, cy } = cells.at(-1)!;
    const options = [
      { cx: cx + 1, cy, w: 3 },
      { cx, cy: cy - 1, w: 1 },
      { cx, cy: cy + 1, w: 1 },
    ].filter((o) => o.cy >= 0 && o.cy < ROWS && !used.has(`${o.cx},${o.cy}`));
    const total = options.reduce((s, o) => s + o.w, 0);
    let pick = rng() * total;
    const next = options.find((o) => (pick -= o.w) < 0) ?? options[0]!;
    cells.push({ cx: next.cx, cy: next.cy });
    used.add(`${next.cx},${next.cy}`);
  }
  const cols = Math.max(...cells.map((c) => c.cx)) + 1;
  const width = cols * CW + 1;
  const height = ROWS * CH + 1;
  const tiles = new Uint8Array(width * height).fill(Tile.Building);
  const variant = new Uint8Array(width * height);
  const roomOf = new Int16Array(width * height).fill(-1);
  const set = (x: number, y: number, t: Tile, v = 0) => {
    if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) return;
    tiles[y * width + x] = t;
    variant[y * width + x] = v;
  };
  const get = (x: number, y: number) => tiles[y * width + x] as Tile;
  // Strechy budov: farba podľa bunky mriežky.
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      variant[y * width + x] = Math.floor(x / CW) * 7 + Math.floor(y / CH) * 3;

  // Udalosti: štart, heliport; hordy (nie dve za sebou), túlavé zombie alebo pokoj.
  const encounters: Encounter[] = cells.map((_, i) =>
    i === 0 ? 'start' : i === cells.length - 1 ? 'exit' : 'calm',
  );
  const middle = cells.map((_, i) => i).slice(1, -1);
  const hordes = Math.min(Math.ceil(middle.length / 2), 2 + Math.floor(level / 2));
  let placed = 0;
  for (const i of [...middle].sort(() => rng() - 0.5)) {
    if (placed >= hordes) break;
    if (encounters[i - 1] === 'horde' || encounters[i + 1] === 'horde') continue;
    encounters[i] = 'horde';
    placed++;
  }
  for (const i of middle) if (encounters[i] === 'calm' && rng() < 0.65) encounters[i] = 'roam';

  const TYPES: RoomType[] = ['street', 'alley', 'parking', 'park', 'warehouse', 'plaza'];
  const rooms: Room[] = cells.map(({ cx, cy }, index) => ({
    index,
    type:
      index === 0
        ? 'street'
        : index === cells.length - 1
          ? 'parking'
          : TYPES[randomInt(rng, 0, TYPES.length - 1)]!,
    encounter: encounters[index]!,
    x0: cx * CW + 1,
    y0: cy * CH + 1,
    x1: cx * CW + CW - 1,
    y1: cy * CH + CH - 1,
    entry: { x: 0, y: 0 },
    doorIn: null,
    doorOut: null,
    roamers: [],
    loot: [],
  }));

  // Brány medzi po sebe idúcimi úsekmi (3 políčka v spoločnej stene).
  const gates: Gate[] = [];
  const doorPoints: { x: number; y: number }[][] = rooms.map(() => []);
  for (let i = 0; i + 1 < rooms.length; i++) {
    const a = cells[i]!;
    const b = cells[i + 1]!;
    const gateTiles: number[] = [];
    let vertical: boolean;
    let gx: number;
    let gy: number;
    if (a.cy === b.cy) {
      vertical = true;
      gx = Math.max(a.cx, b.cx) * CW;
      gy = a.cy * CH + Math.floor(CH / 2);
      for (let d = -1; d <= 1; d++) gateTiles.push((gy + d) * width + gx);
      doorPoints[i]!.push({ x: gx + (b.cx > a.cx ? -1 : 1), y: gy });
      doorPoints[i + 1]!.push({ x: gx + (b.cx > a.cx ? 1 : -1), y: gy });
    } else {
      vertical = false;
      gy = Math.max(a.cy, b.cy) * CH;
      gx = a.cx * CW + Math.floor(CW / 2);
      for (let d = -1; d <= 1; d++) gateTiles.push(gy * width + gx + d);
      doorPoints[i]!.push({ x: gx, y: gy + (b.cy > a.cy ? -1 : 1) });
      doorPoints[i + 1]!.push({ x: gx, y: gy + (b.cy > a.cy ? 1 : -1) });
    }
    gates.push({
      id: i,
      tiles: gateTiles,
      vertical,
      open: true,
      x: (gx + 0.5) * TILE,
      y: (gy + 0.5) * TILE,
    });
    rooms[i]!.doorOut = i;
    rooms[i + 1]!.doorIn = i;
  }

  const lamps: { x: number; y: number }[] = [];
  const lamp = (x: number, y: number) => {
    if (get(x, y) === Tile.Building || x <= 0 || y <= 0) return;
    set(x, y, Tile.Lamp);
    lamps.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
  };

  for (const room of rooms) {
    const { x0, y0, x1, y1 } = room;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const center = { x: x0 + Math.floor(w / 2), y: y0 + Math.floor(h / 2) };
    const fill = (t: Tile, v = 0) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t, v);
    };
    const floorOf: Tile =
      room.type === 'warehouse'
        ? Tile.Floor
        : room.type === 'park'
          ? Tile.Grass
          : room.type === 'alley' || room.type === 'plaza'
            ? Tile.Sidewalk
            : Tile.Road;
    switch (room.type) {
      case 'street': {
        const horizontal = rng() < 0.6;
        fill(Tile.Road);
        if (horizontal) {
          for (let x = x0; x <= x1; x++) {
            for (const y of [y0, y0 + 1, y1 - 1, y1]) set(x, y, Tile.Sidewalk);
            set(x, center.y, Tile.Road, ROAD_LINE_H);
          }
          for (let x = x0 + 3; x < x1; x += 7) {
            lamp(x, y0 + 1);
            lamp(x + 3, y1 - 1);
          }
        } else {
          for (let y = y0; y <= y1; y++) {
            for (const x of [x0, x0 + 1, x1 - 1, x1]) set(x, y, Tile.Sidewalk);
            set(center.x, y, Tile.Road, ROAD_LINE_V);
          }
          for (let y = y0 + 3; y < y1; y += 6) {
            lamp(x0 + 1, y);
            lamp(x1 - 1, y + 3);
          }
        }
        for (let i = 0; i < randomInt(rng, 2, 5); i++) {
          const x = randomInt(rng, x0 + 3, x1 - 4);
          const y = randomInt(rng, y0 + 3, y1 - 4);
          const hz = horizontal ? rng() < 0.8 : rng() < 0.2;
          const color = randomInt(rng, 0, 4) | (hz ? 0x10 : 0);
          if (get(x, y) !== Tile.Road || get(hz ? x + 1 : x, hz ? y : y + 1) !== Tile.Road)
            continue;
          set(x, y, Tile.Car, color);
          set(hz ? x + 1 : x, hz ? y : y + 1, Tile.Car, color | 0x20);
        }
        break;
      }
      case 'parking': {
        fill(Tile.Road);
        // Rady parkovacích miest s autami.
        for (let row = y0 + 2; row <= y1 - 3; row += 5) {
          for (let x = x0 + 2; x <= x1 - 2; x++) {
            set(x, row, Tile.Road, x % 2 === 0 ? PARKING_LINE : 0);
            set(x, row + 1, Tile.Road, x % 2 === 0 ? PARKING_LINE : 0);
            if (x % 2 === 1 && rng() < 0.55) {
              const color = randomInt(rng, 0, 4);
              set(x, row, Tile.Car, color);
              set(x, row + 1, Tile.Car, color | 0x20);
            }
          }
        }
        lamp(x0 + 1, y0 + 1);
        lamp(x1 - 1, y1 - 1);
        lamp(x0 + 1, y1 - 1);
        lamp(x1 - 1, y0 + 1);
        break;
      }
      case 'park': {
        fill(Tile.Grass);
        for (let x = x0; x <= x1; x++) set(x, center.y, Tile.Sidewalk);
        for (let y = y0; y <= y1; y++) set(center.x, y, Tile.Sidewalk);
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++)
            if (get(x, y) === Tile.Grass && rng() < 0.11) set(x, y, Tile.Tree);
        lamp(center.x - 1, center.y - 1);
        lamp(center.x + 1, center.y + 1);
        break;
      }
      case 'warehouse': {
        fill(Tile.Floor);
        // Regály (rady debien) s uličkami a stĺpy.
        if (rng() < 0.5) {
          for (let x = x0 + 2; x <= x1 - 2; x += 4)
            for (let y = y0 + 2; y <= y1 - 2; y++) if (rng() < 0.85) set(x, y, Tile.Crate);
        } else {
          for (let y = y0 + 2; y <= y1 - 2; y += 4)
            for (let x = x0 + 2; x <= x1 - 2; x++) if (rng() < 0.85) set(x, y, Tile.Crate);
        }
        for (let y = y0 + 1; y <= y1 - 1; y += 6)
          for (let x = x0 + 1; x <= x1 - 1; x += 7)
            if (get(x, y) === Tile.Floor) set(x, y, Tile.Pillar);
        // Jediná lampa — sklad je tmavý.
        lamp(center.x, y0 + 1);
        break;
      }
      case 'alley':
        // Úzke uličky medzi budovami: steny zostanú, chodník sa vyreže nižšie.
        break;
      case 'plaza': {
        fill(Tile.Sidewalk);
        for (const [px, py] of [
          [center.x, center.y],
          [x0 + 3, y0 + 3],
          [x1 - 3, y0 + 3],
          [x0 + 3, y1 - 3],
          [x1 - 3, y1 - 3],
        ] as const)
          set(px, py, Tile.Tree);
        for (let i = 0; i < 6; i++)
          set(randomInt(rng, x0 + 2, x1 - 2), randomInt(rng, y0 + 2, y1 - 2), Tile.Crate);
        lamp(x0 + 1, y0 + 1);
        lamp(x1 - 1, y0 + 1);
        lamp(x0 + 1, y1 - 1);
        lamp(x1 - 1, y1 - 1);
        break;
      }
    }

    // Priechod od dverí cez úsek (prekážky sa odstránia) — úsek je vždy prechodný.
    const doors = doorPoints[room.index]!;
    const carve = (a: { x: number; y: number }, b: { x: number; y: number }, wide: number) => {
      const corner = rng() < 0.5 ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
      for (const [p, q] of [
        [a, corner],
        [corner, b],
      ] as const) {
        const steps = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y));
        for (let s = 0; s <= steps; s++) {
          const x = p.x + Math.sign(q.x - p.x) * s;
          const y = p.y + Math.sign(q.y - p.y) * s;
          for (let dy = -wide; dy <= wide; dy++)
            for (let dx = -wide; dx <= wide; dx++) {
              const tx = x + dx;
              const ty = y + dy;
              if (tx < x0 || ty < y0 || tx > x1 || ty > y1) continue;
              const t = get(tx, ty);
              if (room.type === 'alley' ? t !== Tile.Lamp && t !== Tile.Crate : PROPS.has(t))
                set(tx, ty, floorOf);
            }
        }
      }
    };
    if (room.type === 'alley') {
      // Kľukatá ulička cez náhodný bod, s kontajnermi pri stenách.
      const via = { x: randomInt(rng, x0 + 3, x1 - 3), y: randomInt(rng, y0 + 3, y1 - 3) };
      for (const d of doors) carve(d, via, 2);
      carve(via, center, 2);
      for (let i = 0; i < 10; i++) {
        const x = randomInt(rng, x0, x1);
        const y = randomInt(rng, y0, y1);
        const nearWall = [get(x + 1, y), get(x - 1, y), get(x, y + 1), get(x, y - 1)].includes(
          Tile.Building,
        );
        if (get(x, y) === Tile.Sidewalk && nearWall) set(x, y, Tile.Crate);
      }
      lamp(via.x, via.y);
    }
    for (const d of doors) carve(d, center, 1);
    // Kontajnery v uličke nesmú zablokovať cestu: znova vyrezať úzko.
    if (room.type === 'alley') for (const d of doors) carve(d, center, 0);

    // Heliport v poslednom úseku: 4 × 4 v strede, bez prekážok okolo.
    if (room.encounter === 'exit') {
      for (let y = center.y - 3; y <= center.y + 3; y++)
        for (let x = center.x - 3; x <= center.x + 3; x++) set(x, y, Tile.Road);
      for (let y = center.y - 2; y <= center.y + 1; y++)
        for (let x = center.x - 2; x <= center.x + 1; x++) set(x, y, Tile.Helipad);
    }

    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) roomOf[y * width + x] = room.index;
    const entryTile = room.index === 0 ? center : doors[0]!;
    room.entry = { x: (entryTile.x + 0.5) * TILE, y: (entryTile.y + 0.5) * TILE };
  }

  // Brány: z hordy von zavreté, kým sa úsek nevyčistí.
  for (const gate of gates) {
    gate.open = rooms[gate.id]!.encounter !== 'horde';
    for (const t of gate.tiles) {
      tiles[t] = gate.open ? Tile.Door : Tile.Gate;
      roomOf[t] = gate.id;
    }
  }

  // Túlavé zombie a zásoby.
  const freeTile = (room: Room, minFromEntry: number) => {
    for (let attempt = 0; attempt < 80; attempt++) {
      const x = randomInt(rng, room.x0, room.x1);
      const y = randomInt(rng, room.y0, room.y1);
      const t = get(x, y);
      if (PROPS.has(t) || t === Tile.Lamp) continue;
      const wx = (x + 0.5) * TILE;
      const wy = (y + 0.5) * TILE;
      if (Math.hypot(wx - room.entry.x, wy - room.entry.y) < minFromEntry * TILE) continue;
      return { x: wx, y: wy };
    }
    return null;
  };
  for (const room of rooms) {
    if (room.encounter === 'roam') {
      const count = 3 + level + randomInt(rng, 0, 2);
      for (let i = 0; i < count; i++) {
        const at = freeTile(room, 6);
        if (!at) continue;
        const roll = rng();
        const kind: SpawnKind =
          level >= 3 && roll < 0.08 ? 'brute' : level >= 2 && roll < 0.35 ? 'runner' : 'walker';
        room.roamers.push({ kind, ...at });
      }
    }
    const lootCount = room.encounter === 'calm' ? 3 : room.encounter === 'roam' ? 1 : 0;
    for (let i = 0; i < lootCount; i++) {
      const at = freeTile(room, 3);
      if (at) room.loot.push({ kind: rng() < 0.6 ? 'ammo' : 'health', ...at });
    }
  }

  const exitRoom = rooms.at(-1)!;
  return {
    width,
    height,
    tiles,
    variant,
    lamps,
    spawn: rooms[0]!.entry,
    rooms,
    gates,
    roomOf,
    exit: {
      x: (exitRoom.x0 + Math.floor((exitRoom.x1 - exitRoom.x0 + 1) / 2)) * TILE,
      y: (exitRoom.y0 + Math.floor((exitRoom.y1 - exitRoom.y0 + 1) / 2)) * TILE,
    },
    revision: 0,
  };
}
