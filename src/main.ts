import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import './styles.css';
import { Sound } from './audio/audio';
import { Game, type Carry, type GameEvent } from './game/game';
import { FINAL_LEVEL } from './game/map';
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

const sound = new Sound();
let game: Game | null = null;
let renderer: Renderer | null = null;
const controls = new Controls(host, { move: $('#stick-move'), aim: $('#stick-aim') });
controls.onTouchMode = () => {
  weaponBtn.hidden = !game;
  grenadeBtn.hidden = !game;
};
grenadeBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  controls.requestGrenade();
});
weaponBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  controls.nextWeapon();
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
function showToast(text: string): void {
  toast.textContent = text;
  toast.classList.add('show');
  toastTimer = 1.2;
}

let seed = 0;

async function newGame(level = 1, carry?: Carry, resumeSeed?: number): Promise<void> {
  sound.start();
  if (resumeSeed !== undefined) seed = resumeSeed;
  else if (level === 1 || !seed) seed = Math.floor(Math.random() * 1e9);
  // Postup sa uloží na začiatku každej úrovne (od druhej).
  if (carry) writeSave({ version: 1, seed, level, carry, savedAt: new Date().toISOString() });
  else clearSave();
  renderer?.destroy();
  renderer = null;
  game = null;
  host.innerHTML = '';
  // Slučka začne kresliť až po inicializácii renderera.
  const next = new Game(seed, level, carry);
  const view = new Renderer(next);
  await view.init(host);
  game = next;
  renderer = view;
  // Ladenie a automatické testy: `?debug` sprístupní hru v konzole.
  if (new URLSearchParams(location.search).has('debug'))
    (window as unknown as { __dp: unknown }).__dp = { game: next, renderer: view };
  start.hidden = true;
  title.stop();
  over.hidden = true;
  done.hidden = true;
  victory.hidden = true;
  hud.hidden = false;
  weaponBtn.hidden = !controls.touchMode;
  grenadeBtn.hidden = !controls.touchMode;
  sound.music(true);
  const districtKey = {
    city: 'districtCity',
    hospital: 'districtHospital',
    metro: 'districtMetro',
    base: 'districtBase',
  } as const;
  showBanner(
    `${t('level', { n: level })} · ${t(districtKey[next.map.district])}${level > FINAL_LEVEL ? ` · ${t('endless')}` : ''}`,
    3,
  );
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

// --- Obchod medzi úrovňami ---
let shopCarry: Carry | null = null;
let shopLevel = 1;

function itemLabel(item: ShopItem): string {
  const [kind, what] = item.id.split(':') as [string, string | undefined];
  const params = { l: item.level ?? 0, max: item.max ?? 0, n: item.level ?? 0 };
  if (kind === 'weapon') return t('itemWeapon', { weapon: t(what as 'shotgun') });
  if (kind === 'ammo') return t('itemAmmo', { weapon: t(what as 'shotgun'), n: item.level ?? 0 });
  if (kind === 'grenades') return t('itemGrenades', params);
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
  sound.music(false);
  victory.hidden = true;
  bossBar.hidden = true;
  setPaused(false);
  renderer?.destroy();
  renderer = null;
  game = null;
  host.innerHTML = '';
  hud.hidden = true;
  weaponBtn.hidden = true;
  grenadeBtn.hidden = true;
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

function updateHud(g: Game): void {
  const boss = g.boss;
  bossBar.hidden = !boss;
  if (boss) bossFill.style.width = `${Math.max(0, boss.hp / boss.maxHp) * 100}%`;
  const p = g.player;
  const ammoText = Number.isFinite(p.ammo[p.weapon]) ? String(p.ammo[p.weapon]) : '∞';
  const horde = g.hordeRemaining;
  const roomIndex = Math.max(0, g.room);
  const waveText =
    horde !== null
      ? t('hordeLeft', { n: horde })
      : `${t('level', { n: g.level })} · ${t('section', { i: roomIndex + 1, n: g.map.rooms.length })}`;
  const key = `${p.hp}|${p.weapon}|${ammoText}|${waveText}|${g.kills}|${g.score}|${g.lives}|${g.cash}|${p.grenades}|${getLanguage()}`;
  if (key === lastHud) return;
  lastHud = key;
  hpFill.style.width = `${(p.hp / g.maxHp) * 100}%`;
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
    if (e.type === 'explode') navigator.vibrate?.(80);
    if (e.type === 'levelComplete' && e.final) {
      clearSave();
      setTimeout(() => {
        $('.victory-stats').textContent = t('victoryStats', { kills: g.kills, score: g.score });
        victory.hidden = false;
        weaponBtn.hidden = true;
        grenadeBtn.hidden = true;
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
        weaponBtn.hidden = true;
        grenadeBtn.hidden = true;
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
        weaponBtn.hidden = true;
        renderTexts();
      }, 1200);
    }
  }
}

// --- Slučka: pevný krok simulácie 1/60 s, vykresľovanie každú snímku ---

const STEP = 1 / 60;
let acc = 0;
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game && renderer && paused) renderer.render(0);
  else if (game && renderer) {
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
  }
  if (bannerTimer > 0 && (bannerTimer -= dt) <= 0) banner.classList.remove('show');
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) toast.classList.remove('show');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
