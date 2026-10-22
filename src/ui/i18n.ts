export type Language = 'sk' | 'en';

const sk = {
  tagline: 'Mesto padlo. Zostala ti baterka.',
  play: 'Hrať',
  again: 'Znova',
  best: 'Najlepšie skóre',
  controlsDesktop: 'WASD pohyb · myš mieri a strieľa · 1–3 / koliesko zbraň',
  controlsTouch: 'Ľavý palec pohyb · pravý palec mieri a strieľa',
  wave: 'Vlna {n}',
  waveNext: 'Ďalšia vlna o {s} s',
  remaining: 'Zostáva {n}',
  score: 'Skóre',
  kills: 'Zabitia',
  dead: 'Si mŕtvy',
  summary: 'Vlna {wave} · {kills} zabití · skóre {score}',
  newBest: 'Nový rekord!',
  pistol: 'Pištoľ',
  shotgun: 'Brokovnica',
  smg: 'Samopal',
  sound: 'Zvuk',
  pickupHealth: '+ Lekárnička',
  pickupAmmo: '+ Náboje',
  pickupWeapon: '+ {weapon}',
  rotate: 'Otoč telefón na šírku — hrá sa lepšie.',
};

type Key = keyof typeof sk;

const en: Record<Key, string> = {
  tagline: 'The city has fallen. You still have a flashlight.',
  play: 'Play',
  again: 'Again',
  best: 'Best score',
  controlsDesktop: 'WASD move · mouse aims and shoots · 1–3 / wheel weapon',
  controlsTouch: 'Left thumb moves · right thumb aims and shoots',
  wave: 'Wave {n}',
  waveNext: 'Next wave in {s} s',
  remaining: '{n} left',
  score: 'Score',
  kills: 'Kills',
  dead: 'You are dead',
  summary: 'Wave {wave} · {kills} kills · score {score}',
  newBest: 'New record!',
  pistol: 'Pistol',
  shotgun: 'Shotgun',
  smg: 'SMG',
  sound: 'Sound',
  pickupHealth: '+ Medkit',
  pickupAmmo: '+ Ammo',
  pickupWeapon: '+ {weapon}',
  rotate: 'Turn your phone sideways — it plays better.',
};

const KEY = 'deadpixels.language';
let language: Language = (() => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'sk' || saved === 'en') return saved;
  } catch {
    // úložisko nedostupné
  }
  return navigator.language.toLowerCase().startsWith('sk') ||
    navigator.language.toLowerCase().startsWith('cs')
    ? 'sk'
    : 'en';
})();

export const getLanguage = (): Language => language;

export function setLanguage(next: Language): void {
  language = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // úložisko nedostupné
  }
}

export function t(key: Key, params: Record<string, string | number> = {}): string {
  const text = (language === 'sk' ? sk : en)[key];
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''));
}
