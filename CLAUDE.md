# Dead Pixels

- `src/game/` je čistá logika bez PixiJS a DOM (vynútené ESLintom) — testy vo `tests/`.
- Pixel art sa kreslí v kóde (`src/render/sprites.ts`, `PixelCanvas`), žiadne obrázky.
- Texty rozhrania len cez `t()` z `src/ui/i18n.ts` (slovenčina a angličtina).
- Myslieť na mobil: dotykové páčky, väčšie priblíženie, `env(safe-area-inset-*)`.
- Overenie: `npm run typecheck && npm run lint && npm test`.
