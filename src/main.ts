import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import './styles.css';
import { Sound } from './audio/audio';
import { Game, type GameEvent } from './game/game';
import { Controls } from './input/input';
import { Renderer } from './render/renderer';
import { getLanguage, setLanguage, t, type Language } from './ui/i18n';
import { drawLogo } from './ui/logo';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const host = $('#game');
const hud = $('#hud');
const start = $('#start');
const over = $('#over');
const banner = $('#banner');
const toast = $('#toast');
const hurt = $('#hurt');
const weaponBtn = $<HTMLButtonElement>('#weapon-btn');

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
controls.onTouchMode = () => (weaponBtn.hidden = !game);
weaponBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  controls.nextWeapon();
});

// --- Obrazovky ---

$<HTMLImageElement>('.logo').src = drawLogo().toDataURL();

function renderTexts(): void {
  $('.tagline').textContent = t('tagline');
  $('.play').textContent = t('play');
  $('.again').textContent = t('again');
  $('.dead').textContent = t('dead');
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

async function newGame(): Promise<void> {
  sound.start();
  renderer?.destroy();
  renderer = null;
  game = null;
  host.innerHTML = '';
  // Slučka začne kresliť až po inicializácii renderera.
  const next = new Game(Math.floor(Math.random() * 1e9));
  const view = new Renderer(next);
  await view.init(host);
  game = next;
  renderer = view;
  // Ladenie a automatické testy: `?debug` sprístupní hru v konzole.
  if (new URLSearchParams(location.search).has('debug'))
    (window as unknown as { __dp: unknown }).__dp = { game: next, renderer: view };
  start.hidden = true;
  over.hidden = true;
  hud.hidden = false;
  weaponBtn.hidden = !controls.touchMode;
  showBanner(t('waveNext', { s: 3 }), 2.5);
}

$('.play').addEventListener('click', () => void newGame());
$('.again').addEventListener('click', () => void newGame());
const mute = $('.mute');
mute.addEventListener('click', () => {
  sound.setMuted(!sound.muted);
  mute.classList.toggle('off', sound.muted);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !start.hidden) void newGame();
  else if (e.key === 'Enter' && !over.hidden) void newGame();
  if (e.key.toLowerCase() === 'm') mute.click();
});

// --- HUD ---

const hpFill = $('.hp-fill');
const weaponName = $('.weapon-name');
const ammo = $('.ammo');
const waveLabel = $('.wave-label');
const stats = $('.stats');
let lastHud = '';

function updateHud(g: Game): void {
  const p = g.player;
  const ammoText = Number.isFinite(p.ammo[p.weapon]) ? String(p.ammo[p.weapon]) : '∞';
  const waveText =
    g.intermission > 0 && g.wave > 0
      ? t('waveNext', { s: Math.ceil(g.intermission) })
      : g.wave > 0
        ? `${t('wave', { n: g.wave })} · ${t('remaining', { n: g.remaining })}`
        : '';
  const key = `${p.hp}|${p.weapon}|${ammoText}|${waveText}|${g.kills}|${g.score}|${getLanguage()}`;
  if (key === lastHud) return;
  lastHud = key;
  hpFill.style.width = `${(p.hp / g.maxHp) * 100}%`;
  weaponName.textContent = t(p.weapon);
  ammo.textContent = ammoText;
  waveLabel.textContent = waveText;
  stats.textContent = `${t('kills')} ${g.kills} · ${t('score')} ${g.score}`;
}

function react(events: GameEvent[], g: Game): void {
  for (const e of events) {
    if (e.type === 'wave') showBanner(t('wave', { n: e.wave }));
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
            : t('pickupAmmo'),
      );
    if (e.type === 'gameover') {
      const best = readBest();
      const record = g.score > best;
      if (record)
        try {
          localStorage.setItem(BEST_KEY, String(g.score));
        } catch {
          // úložisko nedostupné
        }
      setTimeout(() => {
        $('.summary').textContent = t('summary', { wave: g.wave, kills: g.kills, score: g.score });
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
  if (game && renderer) {
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
    updateHud(game);
  }
  if (bannerTimer > 0 && (bannerTimer -= dt) <= 0) banner.classList.remove('show');
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) toast.classList.remove('show');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
