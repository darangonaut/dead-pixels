import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import './styles.css';
import { Sound } from './audio/audio';
import { BATTERY_LOW, Game, type Carry, type GameEvent } from './game/game';
import { districtOf, FINAL_LEVEL } from './game/map';
import {
  dailyKey,
  dailySetup,
  parseRecords,
  streak,
  upsertRecord,
  type DailyRecord,
  type DailySetup,
} from './game/daily';
import { parseSave, serializeSave, type SaveData } from './game/save';
import { buy, shopItems, type ShopItem } from './game/shop';
import { Controls } from './input/input';
import { Renderer } from './render/renderer';
import { getLanguage, setLanguage, t, type Language } from './ui/i18n';
import { drawLogo } from './ui/logo';
import { TitleScene } from './ui/title';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const host = $('#game');
const hud = $('#hud');
const start = $('#start');
const over = $('#over');
const done = $('#done');
const pausedScreen = $('#paused');
const victory = $('#victory');
const bossBar = $('#boss-bar');
const banner = $('#banner');
const toast = $('#toast');
const hurt = $('#hurt');
const weaponBtn = $<HTMLButtonElement>('#weapon-btn');
const grenadeBtn = $<HTMLButtonElement>('#grenade-btn');
const lightBtn = $<HTMLButtonElement>('#light-btn');
const focusBtn = $<HTMLButtonElement>('#focus-btn');
/** Dotykové tlačidlá počas hry. */
const touchButtons = [weaponBtn, grenadeBtn, lightBtn, focusBtn];
const showTouchButtons = (show: boolean) => touchButtons.forEach((b) => (b.hidden = !show));
const isTouch = () => window.matchMedia('(pointer: coarse)').matches || controls.touchMode;

// --- Uložený postup (začiatok poslednej úrovne s výbavou) ---
const SAVE_KEY = 'deadpixels.save';
function readSave(): SaveData | null {
  try {
    return parseSave(localStorage.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}
function writeSave(save: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, serializeSave(save));
  } catch {
    // úložisko nedostupné — hra pokračuje bez uloženia
  }
}
function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // úložisko nedostupné
  }
}

const BEST_KEY = 'deadpixels.best';
const readBest = (): number => {
  try {
    return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
};

// --- Denné mesto: jeden pokus denne, história výsledkov ---
const DAILY_KEY = 'deadpixels.daily';
const dailyScreen = $('#daily');
function readDaily(): DailyRecord[] {
  try {
    return parseRecords(localStorage.getItem(DAILY_KEY));
  } catch {
    return [];
  }
}
function writeDaily(record: DailyRecord): void {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(upsertRecord(readDaily(), record)));
  } catch {
    // úložisko nedostupné
  }
}
/** Rozohrané denné mesto (inak null). */
let daily: DailySetup | null = null;
const todayKey = () => dailyKey(new Date());
const shortDate = (key: string) => {
  const [, m, d] = key.split('-');
  return `${Number(d)}. ${Number(m)}.`;
};
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const DISTRICT_KEY = {
  city: 'districtCity',
  hospital: 'districtHospital',
  metro: 'districtMetro',
  base: 'districtBase',
} as const;
const MOD_KEY = {
  dark: 'modDark',
  runners: 'modRunners',
  scarce: 'modScarce',
  brutes: 'modBrutes',
} as const;

const sound = new Sound();
let game: Game | null = null;
let renderer: Renderer | null = null;
const controls = new Controls(host, { move: $('#stick-move'), aim: $('#stick-aim') });
controls.onTouchMode = () => showTouchButtons(!!game);
grenadeBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  controls.requestGrenade();
});
weaponBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  controls.nextWeapon();
});
lightBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  controls.toggleLight();
});
focusBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  controls.requestFocus();
});

// --- Obrazovky ---

const logoCanvas = drawLogo();
const logoImg = $<HTMLImageElement>('.logo');
logoImg.src = logoCanvas.toDataURL();
// Živé pozadie úvodnej obrazovky (kužeľ baterky cez logo, občas zombie).
const title = new TitleScene(start, logoImg, logoCanvas);
title.start();

function renderTexts(): void {
  $('.tagline').textContent = t('tagline');
  $('.play').textContent = t('play');
  $('.again').textContent = t('again');
  $('.dead').textContent = t('dead');
  $('.next').textContent = t('nextLevel');
  const save = readSave();
  const cont = $<HTMLButtonElement>('.continue');
  cont.hidden = !save;
  if (save) cont.textContent = t('continueLevel', { n: save.level });
  $('.paused-title').textContent = t('paused');
  $('.victory-title').textContent = t('victoryTitle');
  $('.victory-story').textContent = t('victoryStory');
  $('.endless').textContent = t('endlessButton');
  $('.victory-menu').textContent = t('toMenu');
  $('.boss-name').textContent = t('bossName');
  $('.resume').textContent = t('resume');
  $('.sound-toggle').textContent = sound.muted ? t('soundOff') : t('soundOn');
  $('.to-menu').textContent = t('toMenu');
  $('.paused-hint').textContent = t('pausedHint');
  const touch = window.matchMedia('(pointer: coarse)').matches;
  $('.controls').textContent = touch ? t('controlsTouch') : t('controlsDesktop');
  const best = readBest();
  $('.best').textContent = best > 0 ? `${t('best')}: ${best}` : '';
  const today = readDaily().find((r) => r.key === todayKey());
  $('.daily').textContent = today
    ? t('dailyPlayed', { score: today.score })
    : t('dailyButton', { date: shortDate(todayKey()) });
  document.querySelectorAll<HTMLButtonElement>('.langs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === getLanguage());
  });
  document.documentElement.lang = getLanguage();
}

document.querySelectorAll<HTMLButtonElement>('.langs button').forEach((b) =>
  b.addEventListener('click', () => {
    setLanguage(b.dataset.lang as Language);
    renderTexts();
  }),
);
renderTexts();

let bannerTimer = 0;
function showBanner(text: string, seconds = 2): void {
  banner.textContent = text;
  banner.classList.add('show');
  bannerTimer = seconds;
}

let toastTimer = 0;
function showToast(text: string, seconds = 1.2): void {
  toast.textContent = text;
  toast.classList.add('show');
  toastTimer = Math.max(seconds, text.length / 22);
}
/** Prvý alarm auta v hre dostane vysvetlenie. */
let alarmHinted = false;

let seed = 0;

async function newGame(
  level = 1,
  carry?: Carry,
  resumeSeed?: number,
  dailyRun: DailySetup | null = null,
): Promise<void> {
  sound.start();
  alarmHinted = false;
  daily = dailyRun;
  if (resumeSeed !== undefined) seed = resumeSeed;
  else if (level === 1 || !seed) seed = Math.floor(Math.random() * 1e9);
  // Postup sa uloží na začiatku každej úrovne (od druhej); denné mesto uloženie nemení.
  if (dailyRun) {
    // nič — kampaň zostáva uložená
  } else if (carry)
    writeSave({ version: 1, seed, level, carry, savedAt: new Date().toISOString() });
  else clearSave();
  renderer?.destroy();
  renderer = null;
  game = null;
  host.innerHTML = '';
  // Slučka začne kresliť až po inicializácii renderera.
  const next = new Game(seed, level, carry, dailyRun?.mod ?? null);
  const view = new Renderer(next);
  await view.init(host);
  game = next;
  renderer = view;
  // Ladenie a automatické testy: `?debug` sprístupní hru v konzole.
  if (new URLSearchParams(location.search).has('debug'))
    (window as unknown as { __dp: unknown }).__dp = { game: next, renderer: view };
  start.hidden = true;
  dailyScreen.hidden = true;
  title.stop();
  over.hidden = true;
  done.hidden = true;
  victory.hidden = true;
  hud.hidden = false;
  showTouchButtons(controls.touchMode);
  sound.music(true);
  if (dailyRun) {
    showBanner(t('dailyBanner', { district: t(DISTRICT_KEY[next.map.district]) }), 3);
    setTimeout(() => {
      if (game === next) showToast(t(MOD_KEY[dailyRun.mod]), 4);
    }, 1500);
    return;
  }
  showBanner(
    `${t('level', { n: level })} · ${t(DISTRICT_KEY[next.map.district])}${level > FINAL_LEVEL ? ` · ${t('endless')}` : ''}`,
    3,
  );
  // Prvá úroveň: ako sa hrá potichu.
  if (level === 1)
    setTimeout(() => {
      if (game === next) showToast(t(isTouch() ? 'hintStealthTouch' : 'hintStealth'), 5);
    }, 3200);
}

// Ladenie: `?debug&level=N` začne rovno na N-tej úrovni.
const debugLevel = new URLSearchParams(location.search).has('debug')
  ? Number(new URLSearchParams(location.search).get('level')) || 1
  : 1;
$('.play').addEventListener('click', () => void newGame(debugLevel));
$('.again').addEventListener('click', () => void newGame());
$('.continue').addEventListener('click', () => {
  const save = readSave();
  if (save) void newGame(save.level, save.carry, save.seed);
});

// --- Denné mesto: obrazovka ---

/** Obrazovka denného mesta: pred hrou úvod a štart, po hre výsledok a história. */
function showDaily(): void {
  const key = todayKey();
  const setup = dailySetup(key);
  const records = readDaily();
  const today = records.find((r) => r.key === key);
  $('.daily-title').textContent = t('dailyTitle');
  $('.daily-intro').textContent = t('dailyIntro', {
    date: shortDate(key),
    level: setup.level,
    district: t(DISTRICT_KEY[districtOf(setup.level)]),
  });
  $('.daily-mod').textContent = t(MOD_KEY[setup.mod]);
  $('.daily-rules').textContent = today ? t('dailyTomorrow') : t('dailyRules');
  const result = $('.daily-result');
  result.hidden = !today;
  if (today)
    result.textContent = `${today.done ? t('dailyDone') : t('dailyFailed')} — ${t('dailyResult', {
      score: today.score,
      kills: today.kills,
      time: clock(today.time),
    })}`;
  const history = $('.daily-history');
  history.innerHTML = '';
  for (const r of records.slice(0, 7)) {
    const li = document.createElement('li');
    li.classList.toggle('today', r.key === key);
    const date = document.createElement('span');
    date.textContent = `${shortDate(r.key)} ${r.done ? '✓' : '✗'}`;
    const score = document.createElement('span');
    score.textContent = String(r.score);
    li.append(date, score);
    history.appendChild(li);
  }
  history.hidden = records.length === 0;
  const best = Math.max(0, ...records.map((r) => r.score));
  const run = streak(records, key);
  $('.daily-best').textContent =
    records.length > 0
      ? `${t('dailyBest', { n: best })}${run > 1 ? ` · ${t('dailyStreak', { n: run })}` : ''}`
      : '';
  const startBtn = $<HTMLButtonElement>('.daily-start');
  startBtn.hidden = !!today;
  startBtn.textContent = t('dailyStart');
  const share = $<HTMLButtonElement>('.daily-share');
  share.hidden = !today;
  share.textContent = t('dailyShare');
  $('.daily-menu').textContent = t('toMenu');
  start.hidden = true;
  over.hidden = true;
  toast.classList.remove('show');
  banner.classList.remove('show');
  dailyScreen.hidden = false;
}

$('.daily').addEventListener('click', showDaily);
$('.daily-start').addEventListener('click', () => {
  const key = todayKey();
  if (readDaily().some((r) => r.key === key)) return showDaily();
  const setup = dailySetup(key);
  // Pokus sa započíta hneď (znovunačítanie stránky nedá druhú šancu).
  writeDaily({ key, score: 0, kills: 0, time: 0, done: false });
  void newGame(setup.level, setup.carry, setup.seed, setup);
});
$('.daily-share').addEventListener('click', () => {
  const today = readDaily().find((r) => r.key === todayKey());
  if (!today) return;
  const text = t('dailyShareText', {
    date: shortDate(today.key),
    score: today.score,
    mark: today.done ? '✓' : '✗',
  });
  void navigator.clipboard
    ?.writeText(text)
    .then(() => showToast(t('dailyCopied')))
    .catch(() => showToast(text, 4));
});
$('.daily-menu').addEventListener('click', () => {
  dailyScreen.hidden = true;
  start.hidden = false;
  renderTexts();
});

/** Koniec denného mesta: výsledok sa uloží (za dosiahnutie heliportu bonus). */
function finishDaily(g: Game, done: boolean): void {
  if (!daily) return;
  const score = g.score + (done ? 500 * g.level : 0);
  writeDaily({ key: daily.key, score, kills: g.kills, time: g.time, done });
  daily = null;
}

// --- Obchod medzi úrovňami ---
let shopCarry: Carry | null = null;
let shopLevel = 1;

function itemLabel(item: ShopItem): string {
  const [kind, what] = item.id.split(':') as [string, string | undefined];
  const params = { l: item.level ?? 0, max: item.max ?? 0, n: item.level ?? 0 };
  if (kind === 'weapon') return t('itemWeapon', { weapon: t(what as 'shotgun') });
  if (kind === 'ammo') return t('itemAmmo', { weapon: t(what as 'shotgun'), n: item.level ?? 0 });
  if (kind === 'grenades') return t('itemGrenades', params);
  if (kind === 'batteries') return t('itemBatteries', params);
  const key = {
    damage: 'itemDamage',
    flashlight: 'itemFlashlight',
    health: 'itemHealth',
    speed: 'itemSpeed',
  } as const;
  return t(key[what as keyof typeof key], params);
}

function renderShop(): void {
  if (!shopCarry) return;
  const carry = shopCarry;
  $('.done-cash').textContent = t('doneCash', { n: carry.cash });
  const shop = $('.shop');
  shop.innerHTML = '';
  for (const item of shopItems(carry, shopLevel)) {
    const button = document.createElement('button');
    button.disabled = !item.available || carry.cash < item.cost;
    button.dataset.item = item.id;
    const name = document.createElement('span');
    name.textContent = itemLabel(item);
    const price = document.createElement('span');
    price.className = 'price';
    price.textContent = item.available ? `${item.cost} $` : '✓';
    button.append(name, price);
    button.addEventListener('click', () => {
      const next = buy(carry, shopLevel, item.id);
      if (!next) return;
      shopCarry = next;
      sound.play([{ type: 'pickup', kind: 'cash' }], { x: 0, y: 0 });
      renderShop();
    });
    shop.appendChild(button);
  }
}

$('.next').addEventListener('click', () => {
  if (game && shopCarry) void newGame(game.level + 1, shopCarry);
});
const mute = $('.mute');
function toggleSound(): void {
  sound.setMuted(!sound.muted);
  mute.classList.toggle('off', sound.muted);
  $('.sound-toggle').textContent = sound.muted ? t('soundOff') : t('soundOn');
}
mute.addEventListener('click', toggleSound);

// --- Pauza ---

let paused = false;
/** Pauza sa dá zapnúť len počas hrania (nie na obrazovkách menu, smrti, konca úrovne). */
const playing = () =>
  !!game &&
  !game.over &&
  !game.complete &&
  start.hidden &&
  over.hidden &&
  done.hidden &&
  victory.hidden;

function setPaused(next: boolean): void {
  if (next && !playing()) return;
  paused = next;
  pausedScreen.hidden = !next;
  controls.reset();
  if (next) sound.suspend();
  else {
    sound.resume();
    last = performance.now();
    acc = 0;
  }
}

$('.pause-btn').addEventListener('click', () => setPaused(true));
$('.resume').addEventListener('click', () => setPaused(false));
$('.sound-toggle').addEventListener('click', toggleSound);
$('.endless').addEventListener('click', () => {
  if (game) void newGame(game.level + 1, shopCarry ?? game.carry());
});
$('.victory-menu').addEventListener('click', () => $<HTMLButtonElement>('.to-menu').click());
$('.to-menu').addEventListener('click', () => {
  // Odchod z denného mesta ho ukončí s doterajším skóre.
  if (game && daily) finishDaily(game, false);
  sound.music(false);
  victory.hidden = true;
  bossBar.hidden = true;
  setPaused(false);
  renderer?.destroy();
  renderer = null;
  game = null;
  host.innerHTML = '';
  hud.hidden = true;
  showTouchButtons(false);
  $('#lowhp').classList.remove('on');
  start.hidden = false;
  title.start();
  renderTexts();
});
// Prepnutie karty / minimalizovanie okna hru pozastaví.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});
window.addEventListener('blur', () => setPaused(true));

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'escape' || key === 'p') {
    if (paused) setPaused(false);
    else setPaused(true);
    return;
  }
  if (paused) return;
  if (e.key === 'Enter' && !start.hidden) void newGame();
  else if (e.key === 'Enter' && !over.hidden) void newGame();
  else if (e.key === 'Enter' && !done.hidden) $('.next').click();
  if (key === 'm') toggleSound();
});

// --- HUD ---

const hpFill = $('.hp-fill');
const weaponName = $('.weapon-name');
const ammo = $('.ammo');
const waveLabel = $('.wave-label');
const stats = $('.stats');
let lastHud = '';

const livesEl = $('.lives');

const bossFill = $('.boss-fill');
const grenadesEl = $('.grenades');
const cashEl = $('.cash');
const batFill = $('.bat-fill');
const batBar = $('.bat');

function updateHud(g: Game): void {
  const boss = g.boss;
  bossBar.hidden = !boss;
  if (boss) bossFill.style.width = `${Math.max(0, boss.hp / boss.maxHp) * 100}%`;
  const p = g.player;
  const ammoText =
    p.weapon === 'crowbar'
      ? ''
      : Number.isFinite(p.ammo[p.weapon])
        ? String(p.ammo[p.weapon])
        : '∞';
  const battery = Math.ceil(p.battery);
  batBar.classList.toggle('low', p.battery < BATTERY_LOW);
  batBar.classList.toggle('off', !p.light);
  lightBtn.classList.toggle('off', !p.light);
  focusBtn.classList.toggle('off', p.focusCooldown > 0 || p.battery < 12);
  const horde = g.hordeRemaining;
  const roomIndex = Math.max(0, g.room);
  const waveText =
    horde !== null
      ? t('hordeLeft', { n: horde })
      : `${t('level', { n: g.level })} · ${t('section', { i: roomIndex + 1, n: g.map.rooms.length })}`;
  const key = `${p.hp}|${p.weapon}|${ammoText}|${waveText}|${g.kills}|${g.score}|${g.lives}|${g.cash}|${p.grenades}|${battery}|${getLanguage()}`;
  if (key === lastHud) return;
  lastHud = key;
  hpFill.style.width = `${(p.hp / g.maxHp) * 100}%`;
  batFill.style.width = `${battery}%`;
  weaponName.textContent = t(p.weapon);
  ammo.textContent = ammoText;
  waveLabel.textContent = waveText;
  livesEl.textContent = '♥'.repeat(Math.max(0, g.lives));
  stats.textContent = `${t('kills')} ${g.kills} · ${t('score')} ${g.score}`;
  grenadesEl.textContent = `💣 ${p.grenades}`;
  cashEl.textContent = `${g.cash} $`;
}

function react(events: GameEvent[], g: Game): void {
  for (const e of events) {
    if (e.type === 'horde') showBanner(t('horde'), 1.6);
    if (e.type === 'cleared') showBanner(t('cleared'), 1.6);
    if (e.type === 'died' && e.lives > 0) showBanner(t('died', { n: e.lives }), 1.6);
    if (e.type === 'room' && e.room === g.map.rooms.length - 1) showBanner(t('reachExit'), 2);
    if (e.type === 'boss') showBanner(t('boss'), 2);
    if (e.type === 'blackout') showBanner(t('blackout'), 1.8);
    if (e.type === 'survivorCall' && e.first) showBanner(t('survivorCall'), 2.2);
    if (e.type === 'survivorGift') showBanner(t('survivorGift'), 2);
    if (e.type === 'survivorTrap') {
      showBanner(t('survivorTrap'), 2);
      navigator.vibrate?.(120);
    }
    if (e.type === 'alarm' && !alarmHinted) {
      alarmHinted = true;
      showToast(t('carAlarm'));
    }
    if (e.type === 'powerBack') showToast(t('powerBack'));
    if (e.type === 'batteryLow') showToast(t(isTouch() ? 'batteryLowTouch' : 'batteryLow'), 3);
    if (e.type === 'takedown') showToast(t('takedown'));
    if (e.type === 'grab') {
      showToast(t('grabbed'));
      navigator.vibrate?.([60, 40, 60]);
    }
    if (e.type === 'explode') navigator.vibrate?.(80);
    if (daily && (e.type === 'levelComplete' || e.type === 'gameover')) {
      finishDaily(g, e.type === 'levelComplete');
      setTimeout(() => {
        renderer?.destroy();
        renderer = null;
        game = null;
        host.innerHTML = '';
        hud.hidden = true;
        bossBar.hidden = true;
        showTouchButtons(false);
        lowHp.classList.remove('on');
        sound.music(false);
        showDaily();
      }, 1200);
      continue;
    }
    if (e.type === 'levelComplete' && e.final) {
      clearSave();
      setTimeout(() => {
        $('.victory-stats').textContent = t('victoryStats', { kills: g.kills, score: g.score });
        victory.hidden = false;
        showTouchButtons(false);
        bossBar.hidden = true;
        // Nekonečný režim pokračuje s výbavou — obchod pred ním.
        shopCarry = g.carry();
      }, 1200);
    } else if (e.type === 'levelComplete') {
      setTimeout(() => {
        $('.done-title').textContent = t('levelDone', { n: e.level });
        $('.done-summary').textContent = t('levelSummary', { kills: g.kills, score: g.score });
        shopCarry = g.carry();
        shopLevel = g.level + 1;
        renderShop();
        done.hidden = false;
        showTouchButtons(false);
      }, 900);
    }
    if (e.type === 'hurt') {
      hurt.style.opacity = '1';
      setTimeout(() => (hurt.style.opacity = '0'), 120);
      navigator.vibrate?.(40);
    }
    if (e.type === 'pickup')
      showToast(
        e.kind === 'health'
          ? t('pickupHealth')
          : e.kind === 'weapon' && e.weapon
            ? t('pickupWeapon', { weapon: t(e.weapon) })
            : e.kind === 'cash'
              ? t('pickupCash', { n: 20 + g.level * 5 })
              : e.kind === 'grenade'
                ? t('pickupGrenade')
                : e.kind === 'battery'
                  ? t('pickupBattery')
                  : t('pickupAmmo'),
      );
    if (e.type === 'gameover') {
      clearSave();
      const best = readBest();
      const record = g.score > best;
      if (record)
        try {
          localStorage.setItem(BEST_KEY, String(g.score));
        } catch {
          // úložisko nedostupné
        }
      setTimeout(() => {
        $('.summary').textContent = t('summary', {
          level: g.level,
          kills: g.kills,
          score: g.score,
        });
        $('.record').textContent = record
          ? t('newBest')
          : `${t('best')}: ${Math.max(best, g.score)}`;
        over.hidden = false;
        showTouchButtons(false);
        renderTexts();
      }, 1200);
    }
  }
}

// --- Slučka: pevný krok simulácie 1/60 s, vykresľovanie každú snímku ---

const STEP = 1 / 60;
let acc = 0;
let last = performance.now();
let heartbeat = 0;
const lowHp = $('#lowhp');
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game && renderer && paused) renderer.render(0);
  else if (game && renderer && renderer.freeze > 0) {
    // Zastavenie pri silnom zásahu: svet na okamih zamrzne.
    renderer.freeze -= dt;
    renderer.render(0);
  } else if (game && renderer) {
    acc += dt;
    const r = renderer;
    while (acc >= STEP) {
      acc -= STEP;
      const input = controls.read(game.player, (x, y) => r.screenToWorld(x, y));
      game.update(STEP, input);
      const events = game.takeEvents();
      if (events.length) {
        r.handle(events);
        sound.play(events, game.player);
        react(events, game);
      }
    }
    r.render(dt);
    sound.setIntensity(game.boss ? 2 : game.hordeRemaining !== null ? 1 : 0);
    updateHud(game);
    // Málo zdravia: okraje obrazovky pulzujú a bije srdce.
    const low = game.player.hp > 0 && game.player.hp < game.maxHp * 0.3 && game.respawn <= 0;
    lowHp.classList.toggle('on', low);
    if (low && (heartbeat -= dt) <= 0) {
      heartbeat = 0.5 + (game.player.hp / game.maxHp) * 2;
      sound.heartbeat();
    }
  }
  if (bannerTimer > 0 && (bannerTimer -= dt) <= 0) banner.classList.remove('show');
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) toast.classList.remove('show');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
