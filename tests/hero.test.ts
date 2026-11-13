import { describe, expect, it } from 'vitest';
import type { Carry } from '@/game/game';
import { NO_UPGRADES, shopItems } from '@/game/shop';
import { drawHero, drawIcon, HERO_H, HERO_W, type IconId } from '@/render/hero';

const carry = (patch: Partial<Carry> = {}): Carry => ({
  weapon: 'pistol',
  ammo: { crowbar: Infinity, pistol: Infinity, shotgun: 0, smg: 0, flamer: 0 },
  owned: ['pistol', 'crowbar'],
  score: 0,
  kills: 0,
  lives: 3,
  cash: 0,
  grenades: 2,
  upgrades: { ...NO_UPGRADES },
  battery: 100,
  ...patch,
});

describe('hrdina v obchode', () => {
  it('výbava sa na postave prejaví (vesta, topánky, zbrane, baterka)', () => {
    const base = drawHero(carry());
    expect(base.width).toBe(HERO_W);
    expect(base.height).toBe(HERO_H);
    const variants = [
      carry({ upgrades: { ...NO_UPGRADES, health: 3 } }),
      carry({ upgrades: { ...NO_UPGRADES, speed: 2 } }),
      carry({ upgrades: { ...NO_UPGRADES, damage: 4 } }),
      carry({ upgrades: { ...NO_UPGRADES, flashlight: 4 } }),
      carry({ weapon: 'shotgun', owned: ['pistol', 'crowbar', 'shotgun'] }),
      carry({ battery: 5 }),
    ];
    for (const c of variants) expect(drawHero(c).data).not.toEqual(base.data);
  });

  it('každá položka obchodu má ikonu', () => {
    const full = carry({ owned: ['pistol', 'crowbar', 'shotgun', 'smg', 'flamer'], battery: 40 });
    const ids = [...shopItems(carry(), 4), ...shopItems(full, 4)].map((i) => i.id);
    for (const id of ids) {
      const icon = drawIcon(id as IconId);
      expect(icon.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
    }
  });
});
