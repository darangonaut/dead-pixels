export type Language = 'sk' | 'en';

const sk = {
  tagline: 'Mesto padlo. Zostala ti baterka.',
  play: 'Hrať',
  again: 'Znova',
  best: 'Najlepšie skóre',
  controlsDesktop: 'WASD pohyb · myš mieri a strieľa · 1–3 / koliesko zbraň',
  controlsTouch: 'Ľavý palec pohyb · pravý palec mieri a strieľa',
  level: 'Úroveň {n}',
  districtCity: 'Centrum mesta',
  districtHospital: 'Nemocnica sv. Anny',
  districtMetro: 'Metro',
  districtBase: 'Vojenská základňa',
  endless: 'Nekonečný režim',
  boss: 'MÄSIAR!',
  bossName: 'Mäsiar',
  victoryTitle: 'Utiekol si z mesta!',
  victoryStory:
    'Vrtuľník sa odlepil od zeme a mesto plné mŕtvych zmizlo v tme pod tebou. Prežil si.',
  victoryStats: '{kills} zabití · skóre {score}',
  endlessButton: 'Nekonečný režim',
  section: 'Úsek {i}/{n}',
  horde: 'HORDA!',
  hordeLeft: 'Horda: {n}',
  cleared: 'Úsek vyčistený',
  reachExit: 'Dostaň sa k heliportu',
  died: 'Zomrel si — životy: {n}',
  levelDone: 'Úroveň {n} dokončená',
  nextLevel: 'Ďalšia úroveň',
  levelSummary: '{kills} zabití · skóre {score} · +1 život',
  score: 'Skóre',
  kills: 'Zabitia',
  dead: 'Si mŕtvy',
  summary: 'Úroveň {level} · {kills} zabití · skóre {score}',
  newBest: 'Nový rekord!',
  pistol: 'Pištoľ',
  shotgun: 'Brokovnica',
  smg: 'Samopal',
  sound: 'Zvuk',
  paused: 'Pauza',
  resume: 'Pokračovať',
  soundOn: 'Zvuk: zapnutý',
  soundOff: 'Zvuk: vypnutý',
  toMenu: 'Hlavné menu',
  pausedHint: 'Esc / P pokračuje',
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
  level: 'Level {n}',
  districtCity: 'Downtown',
  districtHospital: "St. Anne's Hospital",
  districtMetro: 'Subway',
  districtBase: 'Military base',
  endless: 'Endless mode',
  boss: 'THE BUTCHER!',
  bossName: 'The Butcher',
  victoryTitle: 'You escaped the city!',
  victoryStory:
    'The helicopter lifted off and the city full of the dead vanished in the dark below. You survived.',
  victoryStats: '{kills} kills · score {score}',
  endlessButton: 'Endless mode',
  section: 'Area {i}/{n}',
  horde: 'HORDE!',
  hordeLeft: 'Horde: {n}',
  cleared: 'Area cleared',
  reachExit: 'Get to the helipad',
  died: 'You died — lives: {n}',
  levelDone: 'Level {n} complete',
  nextLevel: 'Next level',
  levelSummary: '{kills} kills · score {score} · +1 life',
  score: 'Score',
  kills: 'Kills',
  dead: 'You are dead',
  summary: 'Level {level} · {kills} kills · score {score}',
  newBest: 'New record!',
  pistol: 'Pistol',
  shotgun: 'Shotgun',
  smg: 'SMG',
  sound: 'Sound',
  paused: 'Paused',
  resume: 'Resume',
  soundOn: 'Sound: on',
  soundOff: 'Sound: off',
  toMenu: 'Main menu',
  pausedHint: 'Esc / P resumes',
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
