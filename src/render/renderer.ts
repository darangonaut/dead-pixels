import {
  Application,
  BlurFilter,
  Container,
  Graphics,
  RenderTexture,
  Sprite,
  Texture,
} from 'pixi.js';
import type { Game, GameEvent, ZombieKind } from '@/game/game';
import { Tile } from '@/game/map';
import { visibilityFan } from '@/game/geometry';
import type { WeaponId } from '@/game/weapons';
import type { PixelCanvas } from './PixelCanvas';
import {
  C,
  drawBlood,
  drawCorpse,
  drawDot,
  drawArrow,
  drawBarrel,
  drawFlame,
  drawGrenadeSprite,
  drawGate,
  drawGround,
  drawPickup,
  drawHelicopter,
  drawPlayer,
  drawRotor,
  drawScorch,
  drawSpit,
  drawProps,
  drawRoofs,
  drawZombie,
  lightCanvas,
} from './sprites';

function texture(pc: PixelCanvas): Texture {
  const t = Texture.from(pc.toCanvas());
  t.source.scaleMode = 'nearest';
  return t;
}

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  life: number;
  age: number;
  /** Po dopade zostane na zemi (krv, nábojnica). */
  stain: boolean;
  friction: number;
}

interface Flash {
  x: number;
  y: number;
  size: number;
  age: number;
  life: number;
}

interface Tracer {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  age: number;
}

const FLASHLIGHT_RANGE = 200;
const FLASHLIGHT_SPREAD = 0.95;
const DARKNESS = 0.93;

/** PixiJS zobrazenie hry: mesto, postavy, krv, tma so svetlami a efekty. */
export class Renderer {
  readonly app = new Application();
  private world = new Container();
  private decals!: RenderTexture;
  private stamp = new Container();
  private stampSprite = new Sprite();
  private pickupsLayer = new Container();
  private actors = new Container();
  private effects = new Container();
  private glow = new Container();
  private tracerGfx = new Graphics();
  private darkFill = new Graphics();
  private lightGfx = new Graphics();
  /** Koreň pre svetlá: režim „erase“ musí mať dieťa, nie koreň vykresľovaný do textúry. */
  private lightRoot = new Container();
  private lightSprites = new Container();
  private flashRoot = new Container();
  private dark!: RenderTexture;
  private darkSprite!: Sprite;
  private roofs!: Sprite;
  private zoom = 3;
  private viewW = 0;
  private viewH = 0;
  private cam = { x: 0, y: 0 };
  private shake = 0;

  private tex = {
    player: new Map<string, Texture>(),
    zombie: new Map<string, Texture>(),
    corpse: new Map<ZombieKind, Texture>(),
    blood: [] as Texture[],
    pickup: new Map<string, Texture>(),
    drop: Texture.EMPTY,
    spark: Texture.EMPTY,
    shell: Texture.EMPTY,
    light: Texture.EMPTY,
    spit: Texture.EMPTY,
    acid: Texture.EMPTY,
    scorch: Texture.EMPTY,
  };
  private zombieSprites = new Map<number, Sprite>();
  private pickupSprites = new Map<number, Sprite>();
  private player = new Sprite();
  private particles: Particle[] = [];
  private flashes: Flash[] = [];
  private tracers: Tracer[] = [];
  private lamps: {
    x: number;
    y: number;
    poly: number[];
    on: boolean;
    flicker: boolean;
    glow: Sprite;
  }[] = [];
  private hurtFlash = 0;
  private gateSprites: Sprite[] = [];
  private arrow = new Sprite();
  private beacon = new Sprite();
  private heli = new Container();
  private rotor: Sprite | null = null;
  private spitSprites: Sprite[] = [];
  private grenadeSprites: Sprite[] = [];
  private barrelSprites = new Map<number, Sprite>();
  private flameTex: Texture[] = [];
  private grenadeTex: Texture[] = [];

  constructor(private readonly game: Game) {}

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: C.ink,
      antialias: false,
      roundPixels: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    host.appendChild(this.app.canvas);
    const map = this.game.map;

    this.tex.blood = Array.from({ length: 6 }, (_, i) => texture(drawBlood(i)));
    for (const kind of ['walker', 'runner', 'brute', 'exploder', 'spitter', 'boss'] as const) {
      this.tex.corpse.set(kind, texture(drawCorpse(kind)));
      for (const f of [0, 1]) this.tex.zombie.set(`${kind}${f}`, texture(drawZombie(kind, f)));
    }
    for (const w of ['pistol', 'shotgun', 'smg'] as const)
      for (const f of [0, 1]) this.tex.player.set(`${w}${f}`, texture(drawPlayer(f, w)));
    this.tex.drop = texture(drawDot(C.blood));
    this.tex.spark = texture(drawDot(C.yellow, 1, 1));
    this.tex.shell = texture(drawDot(0xd8b04a, 2, 1));
    this.tex.spit = texture(drawSpit());
    this.tex.acid = texture(drawDot(0x7fd040));
    this.tex.scorch = texture(drawScorch());
    this.flameTex = [0, 1, 2].map((v) => texture(drawFlame(v)));
    this.grenadeTex = [false, true].map((lit) => texture(drawGrenadeSprite(lit)));
    // Výbušné sudy ako samostatné sprity (dajú sa zničiť).
    const barrelTex = texture(drawBarrel());
    for (let i = 0; i < map.tiles.length; i++) {
      if (map.tiles[i] !== Tile.Barrel) continue;
      const sprite = new Sprite(barrelTex);
      sprite.anchor.set(0.5);
      sprite.position.set((i % map.width) * 16 + 8, Math.floor(i / map.width) * 16 + 8);
      this.barrelSprites.set(i, sprite);
    }
    const light = Texture.from(lightCanvas(128));
    light.source.scaleMode = 'linear';
    this.tex.light = light;

    const ground = new Sprite(texture(drawGround(map)));
    const props = new Sprite(texture(drawProps(map)));
    // Strechy nad tmou, stlmené ako v mesačnom svetle — mesto je čitateľné aj v tme.
    this.roofs = new Sprite(texture(drawRoofs(map)));
    this.roofs.tint = 0x4a4a5e;
    this.decals = RenderTexture.create({ width: ground.width, height: ground.height });
    this.decals.source.scaleMode = 'nearest';
    this.stamp.addChild(this.stampSprite);
    this.stampSprite.anchor.set(0.5);

    // Lampy: polygón svetla s tieňmi sa počíta raz (mapa sa nemení).
    this.lamps = map.lamps.map((l, i) => {
      const glow = new Sprite(this.tex.light);
      glow.anchor.set(0.5);
      glow.position.set(l.x, l.y);
      glow.width = glow.height = 150;
      // Farba svetla podľa štvrte: teplé lampy, studené žiarivky v nemocnici, zelenkasté metro.
      glow.tint =
        map.district === 'hospital' ? 0xc8e4ff : map.district === 'metro' ? 0xc8ffb0 : 0xffc070;
      glow.alpha = 0.12;
      glow.blendMode = 'add';
      this.glow.addChild(glow);
      const hash = Math.abs(Math.sin(i * 12.9898 + map.width) * 43758.5453) % 1;
      return {
        ...l,
        poly: visibilityFan(map, l.x, l.y, 80, 0, Math.PI * 2, 72),
        on: hash < 0.75,
        flicker: hash < 0.15,
        glow,
      };
    });

    this.player.anchor.set(0.5);
    this.actors.addChild(this.player);
    this.lightGfx.blendMode = 'erase';
    this.lightRoot.addChild(this.lightGfx);
    this.flashRoot.addChild(this.lightSprites);
    // Brány (mreže): viditeľné, keď sú zatvorené.
    this.gateSprites = map.gates.map((gate) => {
      const sprite = new Sprite(texture(drawGate(gate.vertical)));
      sprite.anchor.set(0.5);
      sprite.position.set(gate.x, gate.y);
      sprite.alpha = gate.open ? 0 : 1;
      return sprite;
    });
    this.arrow = new Sprite(texture(drawArrow()));
    this.arrow.anchor.set(0.5);
    this.beacon = new Sprite(this.tex.light);
    this.beacon.anchor.set(0.5);
    this.beacon.position.set(map.exit.x, map.exit.y);
    this.beacon.width = this.beacon.height = 120;
    this.beacon.tint = 0xff3030;
    if (this.game.level === 10) {
      // Záverečná úroveň: na heliporte čaká vojenský vrtuľník.
      const heli = new Sprite(texture(drawHelicopter()));
      heli.anchor.set(0.35, 0.5);
      heli.position.set(map.exit.x, map.exit.y);
      heli.rotation = -0.3;
      this.rotor = new Sprite(texture(drawRotor()));
      this.rotor.anchor.set(0.5);
      this.rotor.position.set(map.exit.x, map.exit.y);
      this.heli.addChild(heli, this.rotor);
    }
    this.beacon.blendMode = 'add';
    this.world.addChild(
      ground,
      new Sprite(this.decals),
      props,
      ...this.barrelSprites.values(),
      ...this.gateSprites,
      this.pickupsLayer,
      this.heli,
      this.actors,
      this.effects,
      this.glow,
      this.beacon,
    );
    this.effects.addChild(this.tracerGfx);
    this.app.stage.addChild(this.world);
    this.resize();
    this.app.renderer.on('resize', () => this.resize());
    this.cam = { x: this.game.player.x, y: this.game.player.y };
  }

  private resize(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    // Celočíselné zväčšenie: kratšia strana ukáže ~220 px sveta (ostré pixely).
    // Na dotykovom displeji (mobil) väčšie priblíženie — postavy musia byť dobre vidieť.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.zoom = Math.max(2, Math.min(6, Math.round(Math.min(w, h) / (coarse ? 130 : 180))));
    this.world.scale.set(this.zoom);
    this.viewW = Math.ceil(w / this.zoom) + 2;
    this.viewH = Math.ceil(h / this.zoom) + 2;
    this.dark?.destroy(true);
    this.dark = RenderTexture.create({ width: this.viewW, height: this.viewH, resolution: 0.5 });
    this.dark.source.scaleMode = 'linear';
    if (this.darkSprite) this.darkSprite.texture = this.dark;
    else {
      this.darkSprite = new Sprite(this.dark);
      // Mäkké okraje svetla.
      this.darkSprite.filters = [new BlurFilter({ strength: 3, quality: 2 })];
      this.world.addChild(this.darkSprite, this.roofs, this.arrow);
    }
  }

  /** Bod obrazovky (CSS px) → svetové súradnice. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.world.x) / this.zoom, y: (sy - this.world.y) / this.zoom };
  }

  // --- Udalosti hry → efekty ---

  handle(events: GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'shot': {
          const big = e.weapon === 'shotgun';
          this.flashes.push({
            x: e.x,
            y: e.y,
            size: big ? 110 : 80,
            age: 0,
            life: big ? 0.09 : 0.06,
          });
          for (const hit of e.hits)
            this.tracers.push({ x1: e.x, y1: e.y, x2: hit.x, y2: hit.y, age: 0 });
          this.shake = Math.max(this.shake, big ? 3 : e.weapon === 'smg' ? 0.8 : 1.2);
          // Nábojnica vyletí doprava od zbrane.
          const side = e.angle + Math.PI / 2;
          this.particle(
            this.tex.shell,
            e.x,
            e.y,
            Math.cos(side) * 40,
            Math.sin(side) * 40,
            0.4,
            true,
            6,
          );
          for (const hit of e.hits)
            for (let i = 0; i < 2; i++)
              this.particle(
                this.tex.spark,
                hit.x,
                hit.y,
                (Math.random() - 0.5) * 60,
                (Math.random() - 0.5) * 60,
                0.15,
                false,
                4,
              );
          break;
        }
        case 'hit':
          this.splatter(e.x, e.y, e.angle, 4, false);
          break;
        case 'explode': {
          this.flashes.push({ x: e.x, y: e.y, size: 180, age: 0, life: 0.25 });
          this.shake = Math.max(this.shake, 5);
          this.stampDecal(this.tex.scorch, e.x, e.y, Math.random() * Math.PI * 2, 0.9);
          for (let i = 0; i < 24; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 40 + Math.random() * 120;
            this.particle(
              i % 3 === 0 ? this.tex.spark : this.tex.acid,
              e.x,
              e.y,
              Math.cos(a) * sp,
              Math.sin(a) * sp,
              0.35,
              i % 2 === 0,
              5,
            );
          }
          break;
        }
        case 'splash':
          for (let i = 0; i < 5; i++)
            this.particle(
              this.tex.acid,
              e.x,
              e.y,
              (Math.random() - 0.5) * 60,
              (Math.random() - 0.5) * 60,
              0.25,
              true,
              6,
            );
          break;
        case 'barrel':
          this.barrelSprites.get(e.tile)?.destroy();
          this.barrelSprites.delete(e.tile);
          break;
        case 'flame':
          for (let i = 0; i < 3; i++) {
            const a = e.angle + (Math.random() - 0.5) * 0.6;
            const sp = 150 + Math.random() * 90;
            this.particle(
              this.flameTex[i % 3]!,
              e.x,
              e.y,
              Math.cos(a) * sp,
              Math.sin(a) * sp,
              0.32,
              false,
              2,
            );
          }
          this.flashes.push({
            x: e.x + Math.cos(e.angle) * 24,
            y: e.y + Math.sin(e.angle) * 24,
            size: 90,
            age: 0,
            life: 0.08,
          });
          break;
        case 'bossStun':
          this.shake = Math.max(this.shake, 4);
          break;
        case 'kill':
          this.splatter(e.x, e.y, e.angle, 10, true);
          this.stampDecal(
            this.tex.corpse.get(e.kind)!,
            e.x + Math.cos(e.angle) * 3,
            e.y + Math.sin(e.angle) * 3,
            e.angle,
          );
          break;
        case 'respawn':
          this.cam = { x: this.game.player.x, y: this.game.player.y };
          break;
        case 'hurt':
          this.hurtFlash = 0.25;
          this.shake = Math.max(this.shake, 2.5);
          this.splatter(e.x, e.y, Math.random() * Math.PI * 2, 3, false);
          break;
        default:
      }
    }
  }

  private splatter(x: number, y: number, angle: number, drops: number, pool: boolean): void {
    for (let i = 0; i < drops; i++) {
      const a = angle + (Math.random() - 0.5) * 1.2;
      const speed = 30 + Math.random() * 70;
      this.particle(this.tex.drop, x, y, Math.cos(a) * speed, Math.sin(a) * speed, 0.35, true, 5);
    }
    if (pool) {
      const blood = this.tex.blood[Math.floor(Math.random() * this.tex.blood.length)]!;
      this.stampDecal(
        blood,
        x + Math.cos(angle) * 6,
        y + Math.sin(angle) * 6,
        Math.random() * Math.PI * 2,
      );
    }
  }

  private particle(
    tex: Texture,
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    stain: boolean,
    friction: number,
  ): void {
    if (this.particles.length > 600) return;
    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    this.effects.addChild(sprite);
    this.particles.push({ sprite, vx, vy, life, age: 0, stain, friction });
  }

  /** Trvalá stopa na zemi (krv, mŕtvola, nábojnica). */
  private stampDecal(tex: Texture, x: number, y: number, rotation: number, alpha = 1): void {
    this.stampSprite.texture = tex;
    this.stampSprite.position.set(x, y);
    this.stampSprite.rotation = rotation;
    this.stampSprite.alpha = alpha;
    this.app.renderer.render({ container: this.stamp, target: this.decals, clear: false });
  }

  // --- Snímka ---

  render(dt: number): void {
    const game = this.game;
    const p = game.player;
    this.syncActors(dt);
    this.updateParticles(dt);

    // Kamera: hráč s výhľadom v smere mierenia, otrasy pri streľbe.
    const lookX = p.x + Math.cos(p.angle) * 26;
    const lookY = p.y + Math.sin(p.angle) * 26;
    const k = 1 - Math.exp(-8 * dt);
    this.cam.x += (lookX - this.cam.x) * k;
    this.cam.y += (lookY - this.cam.y) * k;
    this.shake = Math.max(0, this.shake - dt * 12);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.world.position.set(
      Math.round(w / 2 - (this.cam.x + sx) * this.zoom),
      Math.round(h / 2 - (this.cam.y + sy) * this.zoom),
    );

    // Brány sa plynulo objavia / zmiznú.
    this.game.map.gates.forEach((gate, i) => {
      const sprite = this.gateSprites[i]!;
      const target = gate.open ? 0 : 1;
      sprite.alpha += (target - sprite.alpha) * Math.min(1, dt * 8);
      sprite.visible = sprite.alpha > 0.02;
    });
    // Šípka k ďalším dverám / heliportu (kým nie je horda).
    const goal = game.objective;
    const far = goal && Math.hypot(goal.x - p.x, goal.y - p.y) > 48;
    this.arrow.visible = !!far && game.hordeRemaining === null && game.respawn <= 0;
    if (goal && this.arrow.visible) {
      const a = Math.atan2(goal.y - p.y, goal.x - p.x);
      this.arrow.position.set(
        Math.round(p.x + Math.cos(a) * 20),
        Math.round(p.y + Math.sin(a) * 20),
      );
      this.arrow.rotation = a;
      this.arrow.alpha = 0.55 + 0.35 * Math.sin(game.time * 5);
    }
    this.beacon.alpha = 0.25 + 0.2 * Math.sin(game.time * 4);
    if (this.rotor) this.rotor.rotation += dt * 18;
    // Granáty (blikajúca poistka).
    while (this.grenadeSprites.length < game.grenades.length) {
      const sprite = new Sprite(this.grenadeTex[0]);
      sprite.anchor.set(0.5);
      this.effects.addChild(sprite);
      this.grenadeSprites.push(sprite);
    }
    this.grenadeSprites.forEach((sprite, i) => {
      const g = game.grenades[i];
      sprite.visible = !!g;
      if (!g) return;
      sprite.position.set(Math.round(g.x), Math.round(g.y));
      sprite.texture = this.grenadeTex[Math.floor(g.fuse * 10) % 2]!;
    });
    // Horiace zombie: plamene a svetlo.
    for (const z of game.zombies) {
      if (z.burn <= 0 || Math.random() > dt * 14) continue;
      this.particle(
        this.flameTex[Math.floor(Math.random() * 3)]!,
        z.x + (Math.random() - 0.5) * 8,
        z.y + (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 10,
        -20,
        0.4,
        false,
        2,
      );
      this.flashes.push({ x: z.x, y: z.y, size: 50, age: 0, life: 0.12 });
    }
    // Pľuvance kyseliny.
    while (this.spitSprites.length < game.spits.length) {
      const sprite = new Sprite(this.tex.spit);
      sprite.anchor.set(0.5);
      this.effects.addChild(sprite);
      this.spitSprites.push(sprite);
    }
    this.spitSprites.forEach((sprite, i) => {
      const spit = game.spits[i];
      sprite.visible = !!spit;
      if (spit) sprite.position.set(Math.round(spit.x), Math.round(spit.y));
    });
    this.player.visible = game.respawn <= 0;
    this.drawTracers(dt);
    this.drawDarkness(dt);
  }

  private syncActors(dt: number): void {
    const game = this.game;
    const p = game.player;
    const frame = Math.floor(p.step) % 2;
    this.player.texture = this.tex.player.get(`${p.weapon}${frame}`)!;
    this.player.position.set(Math.round(p.x), Math.round(p.y));
    this.player.rotation = p.angle;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.player.tint = this.hurtFlash > 0 ? 0xff6060 : 0xffffff;

    const alive = new Set<number>();
    for (const z of game.zombies) {
      alive.add(z.id);
      let sprite = this.zombieSprites.get(z.id);
      if (!sprite) {
        sprite = new Sprite();
        sprite.anchor.set(0.5);
        this.actors.addChildAt(sprite, 0);
        this.zombieSprites.set(z.id, sprite);
      }
      sprite.texture = this.tex.zombie.get(`${z.kind}${Math.floor(z.step) % 2}`)!;
      sprite.position.set(Math.round(z.x), Math.round(z.y));
      sprite.rotation = z.angle + (z.stagger > 0 ? 0.3 : 0);
      sprite.tint =
        z.state === 'windup'
          ? 0xff7070
          : z.state === 'stunned'
            ? 0xaaaaff
            : z.stagger > 0
              ? 0xffaaaa
              : 0xffffff;
    }
    for (const [id, sprite] of this.zombieSprites)
      if (!alive.has(id)) {
        sprite.destroy();
        this.zombieSprites.delete(id);
      }

    const present = new Set<number>();
    for (const item of game.pickups) {
      present.add(item.id);
      let sprite = this.pickupSprites.get(item.id);
      if (!sprite) {
        const key = `${item.kind}${item.weapon ?? ''}`;
        let t = this.tex.pickup.get(key);
        if (!t) {
          t = texture(drawPickup(item.kind, item.weapon as WeaponId | undefined));
          this.tex.pickup.set(key, t);
        }
        sprite = new Sprite(t);
        sprite.anchor.set(0.5);
        this.pickupsLayer.addChild(sprite);
        this.pickupSprites.set(item.id, sprite);
      }
      sprite.position.set(Math.round(item.x), Math.round(item.y + Math.sin(item.age * 4) * 1.5));
      // Pred zmiznutím bliká.
      sprite.visible = item.age < 25 || Math.floor(item.age * 8) % 2 === 0;
    }
    for (const [id, sprite] of this.pickupSprites)
      if (!present.has(id)) {
        sprite.destroy();
        this.pickupSprites.delete(id);
      }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i]!;
      q.age += dt;
      const f = Math.exp(-q.friction * dt);
      q.vx *= f;
      q.vy *= f;
      q.sprite.x += q.vx * dt;
      q.sprite.y += q.vy * dt;
      if (q.age >= q.life) {
        if (q.stain) this.stampDecal(q.sprite.texture, q.sprite.x, q.sprite.y, 0, 0.9);
        q.sprite.destroy();
        this.particles.splice(i, 1);
      }
    }
    for (const f of this.flashes) f.age += dt;
    this.flashes = this.flashes.filter((f) => f.age < f.life);
  }

  private drawTracers(dt: number): void {
    const g = this.tracerGfx.clear();
    for (const t of this.tracers) {
      t.age += dt;
      g.moveTo(t.x1, t.y1)
        .lineTo(t.x2, t.y2)
        .stroke({ width: 1, color: 0xfff2b0, alpha: Math.max(0, 0.9 - t.age * 15) });
    }
    this.tracers = this.tracers.filter((t) => t.age < 0.06);
  }

  /**
   * Tma: textúra veľkosti výhľadu sa vyplní čiernou a svetlá sa z nej „vygumujú“
   * (baterka a lampy s tieňmi od budov a áut, záblesky výstrelov, kruh okolo hráča).
   */
  private drawDarkness(dt: number): void {
    const game = this.game;
    const p = game.player;
    const vx = this.cam.x - this.viewW / 2;
    const vy = this.cam.y - this.viewH / 2;
    this.darkSprite.position.set(vx, vy);
    this.darkSprite.width = this.viewW;
    this.darkSprite.height = this.viewH;

    this.darkFill
      .clear()
      .rect(0, 0, this.viewW, this.viewH)
      .fill({ color: 0x04030a, alpha: DARKNESS });
    this.app.renderer.render({ container: this.darkFill, target: this.dark, clear: true });

    const g = this.lightGfx.clear();
    const poly = (points: number[], alpha: number) => {
      const shifted = points.map((v, i) => (i % 2 === 0 ? v - vx : v - vy));
      g.poly(shifted).fill({ color: 0xffffff, alpha });
    };
    // Lampy (len tie vo výhľade); niektoré blikajú, niektoré nesvietia.
    const time = game.time;
    for (const lamp of this.lamps) {
      const visible =
        lamp.x > vx - 90 &&
        lamp.x < vx + this.viewW + 90 &&
        lamp.y > vy - 90 &&
        lamp.y < vy + this.viewH + 90;
      const flickerOn = !lamp.flicker || Math.sin(time * 23 + lamp.x) + Math.sin(time * 7.3) > -0.6;
      lamp.glow.visible = lamp.on && flickerOn;
      if (!visible || !lamp.on || !flickerOn) continue;
      poly(lamp.poly, 0.55);
    }
    // Maják heliportu pulzuje.
    const ex = game.map.exit;
    if (
      ex.x > vx - 80 &&
      ex.x < vx + this.viewW + 80 &&
      ex.y > vy - 80 &&
      ex.y < vy + this.viewH + 80
    )
      poly(
        visibilityFan(game.map, ex.x, ex.y, 60, 0, Math.PI * 2, 48),
        0.3 + 0.25 * Math.sin(time * 4),
      );
    // Baterka: tri vrstvy kužeľa (mäkký okraj ďaleko), okolo hráča malý kruh.
    for (const [range, alpha] of [
      [FLASHLIGHT_RANGE * game.flashlightScale, 0.45],
      [FLASHLIGHT_RANGE * game.flashlightScale * 0.7, 0.35],
      [FLASHLIGHT_RANGE * game.flashlightScale * 0.42, 0.25],
    ] as const) {
      poly(visibilityFan(game.map, p.x, p.y, range, p.angle, FLASHLIGHT_SPREAD, 72), alpha);
    }
    poly(visibilityFan(game.map, p.x, p.y, 34, 0, Math.PI * 2, 48), 0.55);
    this.app.renderer.render({ container: this.lightRoot, target: this.dark, clear: false });

    // Záblesky výstrelov (mäkké kruhy bez tieňov).
    this.lightSprites.removeChildren();
    for (const f of this.flashes) {
      const s = new Sprite(this.tex.light);
      s.anchor.set(0.5);
      s.position.set(f.x - vx, f.y - vy);
      s.width = s.height = f.size;
      s.alpha = 1 - f.age / f.life;
      s.blendMode = 'erase';
      this.lightSprites.addChild(s);
    }
    if (this.flashes.length > 0)
      this.app.renderer.render({ container: this.flashRoot, target: this.dark, clear: false });
    this.lightSprites.removeChildren().forEach((s) => s.destroy());
    void dt;
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
