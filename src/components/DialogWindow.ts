// Окно взаимодействия: фон-интерьер во весь экран с лучами света из окон и пылинками, слева портрет героя,
// справа — собеседника, внизу рамка с именем, репликой (печатается по буквам) и вариантами ответа.
// Параллакс от мыши: фон, лучи, пыль и портреты сдвигаются на разную глубину; портреты «дышат»; говорящий ярче.
// Выбор — клик по варианту или клавиши 1…9; клик или пробел во время печати — допечатать; Esc — закрыть.
// Раскладка — DIALOG_LAYOUT и DIALOG_BACKGROUNDS (assets.ts), силы и время — FEEL.dialog, тексты — data/dialogs.ts.
// Без фильтров: свет и подложки — текстуры с осветлением, нарисованные кодом один раз.
import * as Phaser from 'phaser';
import { DIALOG_BACKGROUNDS, DIALOG_LAYOUT as D, NPC_PORTRAITS, type PortraitAnim } from '../config/assets';
import { FEEL } from '../config/feel';
import { DIALOGS, type Dialog, type DialogId } from '../data/dialogs';
import { addText, C, H, W } from '../ui';
import { PortraitPlayer } from './AnimatedPortrait';
import { ensureFxTextures, FX_SOFT } from './MapAmbience';

/** Сколько вариантов ответа помещается в рамку. */
const MAX_CHOICES = 6;
const SHADE = 'dlg_shade';
const HIGHLIGHT = 'dlg_highlight';
const hex = (s: string) => Phaser.Display.Color.HexStringToColor(s).color;

type Pt = [number, number];
interface Beam { a: Pt; b: Pt; c: Pt; d: Pt }
/** Слой параллакса: объект, его место без сдвига и глубина (сдвиг при курсоре у края экрана, px). */
interface Layer { obj: Phaser.GameObjects.Components.Transform; x: number; y: number; depth: number }
interface ChoiceRow { box: Phaser.GameObjects.Container; hl: Phaser.GameObjects.Image; num: Phaser.GameObjects.Text; ring: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text; zone: Phaser.GameObjects.Zone; baseX: number }

export class DialogWindow {
  private root: Phaser.GameObjects.Container;
  private layers: Layer[] = [];
  private beams: Phaser.GameObjects.Image;
  /** Свечение у окон — дышит вместе с лучами. */
  private glows: Phaser.GameObjects.Image[] = [];
  private hero: Phaser.GameObjects.Image;
  private npc: Phaser.GameObjects.Image;
  private heroBase = { x: 0, scale: 1 };
  private npcBase = { x: 0, scale: 1 };
  private plays: PortraitPlayer[] = [];
  private arrowGlow: Phaser.GameObjects.Image;
  private text: Phaser.GameObjects.Text;
  private rows: ChoiceRow[] = [];
  private dialog: Dialog;
  private nodeId: string;
  private closed = false;
  /** Вариант под курсором (пока он есть — в фокусе герой). */
  private hovered: ChoiceRow | null = null;
  /** Выбор сделан в этом кадре — тот же клик не должен допечатать следующую реплику. */
  private justChose = false;

  /** Сглаженное положение курсора: −1…1 от центра экрана. */
  private look = { x: 0, y: 0 };
  /** Выезд портретов с краёв (px, твинится к 0) и кто в фокусе (0 — собеседник, 1 — герой). */
  private anim = { slide: 0, focus: 0 };
  private time = 0;
  /** Печать: вся реплика (с переносами) и сколько символов уже видно. */
  private typed = '';
  private shown = 0;

  /** onBattle — вариант 'battle': окно закрывается без исчезновения (сцена уходит в бой); start — с какого узла начать. */
  constructor(private scene: Phaser.Scene, id: DialogId, private onClose: () => void, private onBattle: () => void, start?: string) {
    this.dialog = DIALOGS[id];
    this.nodeId = start ?? this.dialog.start;
    const S = FEEL.dialog;
    const P = S.parallax;
    ensureFxTextures(scene);
    ensureDialogTextures(scene);
    const bgDef = DIALOG_BACKGROUNDS[this.dialog.background];
    ensureBeamTexture(scene, bgDef.key, bgDef.beams);

    this.root = scene.add.container(0, 0).setScrollFactor(0).setDepth(30);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.root.add(o);
      return o;
    };

    // Фон во весь экран с запасом под параллакс; лучи и пыль — в его координатах.
    const bg = add(scene.add.image(W / 2, H / 2, bgDef.key));
    const k = Math.max((W + 2 * P.bg) / bg.width, (H + 2 * P.bg) / bg.height);
    bg.setScale(k);
    this.layer(bg, P.bg);
    this.beams = add(scene.add.image(W / 2, H / 2, beamKey(bgDef.key)).setScale(k).setTint(hex(S.beam.color)).setBlendMode(Phaser.BlendModes.ADD));
    this.layer(this.beams, P.beams);
    for (const bm of bgDef.beams) {
      const [cx, cy] = lerp2(bm.a, bm.b, 0.5);
      const len = Math.hypot(bm.b[0] - bm.a[0], bm.b[1] - bm.a[1]) * k * S.beam.windowGlow;
      const g = add(scene.add.image(W / 2 + (cx - bg.width / 2) * k, H / 2 + (cy - bg.height / 2) * k, FX_SOFT)
        .setDisplaySize(len, len).setTint(hex(S.beam.color)).setBlendMode(Phaser.BlendModes.ADD));
      this.layer(g, P.bg);
      this.glows.push(g);
    }
    const dust = add(this.addDust(bgDef.beams));
    dust.setPosition(W / 2 - (bg.width * k) / 2, H / 2 - (bg.height * k) / 2).setScale(k);
    this.layer(dust, P.dust);

    // Тень внизу экрана — рамка не висит на пёстром фоне.
    add(scene.add.image(0, H, SHADE).setOrigin(0, 1).setDisplaySize(W, S.shade.h).setAlpha(S.shade.alpha));

    // Портреты низом к низу экрана.
    this.hero = add(this.portrait(D.heroPortrait.anim, D.heroPortrait.x, D.heroPortrait.h));
    this.npc = add(this.portrait(NPC_PORTRAITS[this.dialog.portrait].anim, D.npcPortrait.x, D.npcPortrait.h));
    this.heroBase = { x: this.hero.x, scale: this.hero.scale };
    this.npcBase = { x: this.npc.x, scale: this.npc.scale };

    // Рамка: снизу по центру; под прозрачным проёмом — тёмный фон.
    const F = D.frame;
    const fk = F.w / 2000;
    const left = F.x - F.w / 2;
    const top = F.bottom - 1000 * fk;
    const hole = { x: left + D.hole.x * fk, y: top + D.hole.y * fk, w: D.hole.w * fk };
    add(scene.add.rectangle(hole.x, hole.y, D.hole.w * fk, D.hole.h * fk, S.holeFill, S.holeAlpha).setOrigin(0));
    for (let i = 0; i < MAX_CHOICES; i++) this.rows.push(this.addRow(i, hole.x + D.choices.x, hole.w - D.choices.x * 2));
    for (const r of this.rows) add(r.box);
    add(scene.add.image(F.x, F.bottom, F.key).setOrigin(0.5, 1).setScale(fk));
    const A = S.arrow;
    this.arrowGlow = add(scene.add.image(left + D.arrow.x * fk, top + D.arrow.y * fk, FX_SOFT).setDisplaySize(A.size, A.size)
      .setTint(hex(S.choiceHover)).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0));
    add(addText(scene, left + D.plate.x * fk, top + D.plate.y * fk, this.dialog.speaker, S.plate.size, C.accent)
      .setOrigin(0.5).setShadow(0, 0, 'rgba(224,182,90,0.75)', S.plate.glow, false, true));
    const T = D.text;
    this.text = add(addText(scene, hole.x + T.x, hole.y + T.y, '', T.size, C.text, { wordWrap: { width: T.wrap }, lineSpacing: T.lineSpacing }));

    scene.input.keyboard?.on('keydown', this.onKey, this);
    scene.input.on('pointerup', this.onClick, this);
    this.show();

    // Появление: всё проявляется поверх карты, портреты выезжают с краёв.
    this.root.setAlpha(0);
    scene.tweens.add({ targets: this.root, alpha: 1, duration: S.bgFadeMs });
    this.anim.slide = S.slide;
    scene.tweens.add({ targets: this.anim, slide: 0, duration: S.fadeMs * 1.5, ease: 'Cubic.easeOut' });
    this.update(0);
  }

  private layer(obj: Phaser.GameObjects.Components.Transform, depth: number): void {
    this.layers.push({ obj, x: obj.x, y: obj.y, depth });
  }

  /** Анимированный портрет низом к низу экрана, вписан по высоте. */
  private portrait(anim: PortraitAnim, x: number, h: number): Phaser.GameObjects.Image {
    const p = new PortraitPlayer(this.scene, anim, x, H, h);
    this.plays.push(p);
    return p.img;
  }

  /** Пылинки внутри лучей: появляются в случайной точке луча, медленно плывут, мерцают и тают. */
  private addDust(beams: Beam[]): Phaser.GameObjects.Particles.ParticleEmitter {
    const Du = FEEL.dialog.dust;
    return this.scene.add.particles(0, 0, FX_SOFT, {
      frequency: Du.frequency,
      lifespan: { min: Du.lifespan[0], max: Du.lifespan[1] },
      speedX: { min: -Du.drift, max: Du.drift },
      speedY: { min: -Du.drift, max: Du.drift * 0.6 },
      scale: { min: Du.scale[0], max: Du.scale[1] },
      alpha: { onEmit: () => 0, onUpdate: (_p: unknown, _k: string, t: number) => Math.sin(t * Math.PI) * Du.alpha },
      blendMode: Phaser.BlendModes.ADD,
      advance: Du.lifespan[1],
      emitZone: {
        type: 'random',
        source: {
          getRandomPoint: (pt: Phaser.Types.Math.Vector2Like) => {
            // Точка в четырёхугольнике луча: u — от окна к полу, v — поперёк.
            const bm = beams[Math.floor(Math.random() * beams.length)];
            const u = Math.random();
            const v = Math.random();
            const top = lerp2(bm.a, bm.b, v);
            const bottom = lerp2(bm.d, bm.c, v);
            const p = lerp2(top, bottom, u);
            return Object.assign(pt, { x: p[0], y: p[1] });
          },
        },
      },
    });
  }

  /** Строка варианта: подложка-подсветка, номер в кружке, текст; зона клика на всю ширину проёма. */
  private addRow(i: number, x: number, w: number): ChoiceRow {
    const S = FEEL.dialog;
    const Hl = S.highlight;
    const box = this.scene.add.container(x, 0);
    const hl = this.scene.add.image(-Hl.numR - 10, 0, HIGHLIGHT).setOrigin(0, 0.5).setDisplaySize(w, Hl.h).setTint(hex(Hl.color)).setAlpha(0);
    const ring = this.scene.add.circle(0, 0, Hl.numR).setStrokeStyle(2, hex(S.choice), 0.8);
    const num = addText(this.scene, 0, 0, String(i + 1), D.choices.size - 4, S.choice).setOrigin(0.5);
    const label = addText(this.scene, Hl.numR + 14, 0, '', D.choices.size, S.choice).setOrigin(0, 0.5);
    const zone = this.scene.add.zone(-Hl.numR - 10, 0, w, Hl.h).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    box.add([hl, ring, num, label, zone]);
    const row: ChoiceRow = { box, hl, num, ring, label, zone, baseX: x };
    zone.on('pointerover', () => this.hoverRow(row, true));
    zone.on('pointerout', () => this.hoverRow(row, false));
    zone.on('pointerup', () => this.choose(i));
    return row;
  }

  /** Подсветка варианта; пока курсор на варианте — в фокусе герой. */
  private hoverRow(row: ChoiceRow, on: boolean): void {
    const S = FEEL.dialog;
    const color = on ? S.choiceHover : S.choice;
    row.label.setColor(color);
    row.num.setColor(color);
    row.ring.setStrokeStyle(2, hex(color), on ? 1 : 0.8);
    this.scene.tweens.killTweensOf([row.hl, row.box]);
    this.scene.tweens.add({ targets: row.hl, alpha: on ? S.highlight.alpha : 0, duration: 120 });
    this.scene.tweens.add({ targets: row.box, x: row.baseX + (on ? S.highlight.shift : 0), duration: 120, ease: 'Sine.easeOut' });
    if (on) this.hovered = row;
    else if (this.hovered === row) this.hovered = null;
    this.setFocus(this.hovered ? 1 : 0);
  }

  /** Плавно перевести фокус: 0 — говорит собеседник, 1 — герой (курсор на варианте ответа). */
  private setFocus(f: number): void {
    this.scene.tweens.add({ targets: this.anim, focus: f, duration: FEEL.dialog.focus.ms });
  }

  /** Показать текущий узел: реплика начинает печататься, варианты ждут конца печати. */
  private show(): void {
    const node = this.dialog.nodes[this.nodeId];
    // Переносы считаются заранее по всей реплике — при печати строки не прыгают.
    this.typed = this.text.getWrappedText(node.text).join('\n');
    this.text.setText(this.typed);
    let y = this.text.y + this.text.height + D.choices.after + FEEL.dialog.highlight.h / 2;
    this.text.setText('');
    this.shown = 0;
    this.rows.forEach((r, i) => {
      const c = node.choices[i];
      r.box.setVisible(false).setY(y);
      this.scene.tweens.killTweensOf([r.hl, r.box]);
      r.hl.setAlpha(0);
      r.ring.setStrokeStyle(2, hex(FEEL.dialog.choice), 0.8);
      r.box.x = r.baseX;
      r.label.setText(c ? c.text : '').setColor(FEEL.dialog.choice);
      r.num.setColor(FEEL.dialog.choice);
      if (c) y += Math.max(r.label.height, FEEL.dialog.highlight.h * 0.8) + D.choices.gap;
    });
    this.hovered = null;
    this.setFocus(0);
  }

  private get typing(): boolean {
    return this.shown < this.typed.length;
  }

  /** Допечатать реплику и показать варианты. */
  private finishTyping(): void {
    this.shown = this.typed.length;
    this.text.setText(this.typed);
    const node = this.dialog.nodes[this.nodeId];
    this.rows.forEach((r, i) => r.box.setVisible(!!node.choices[i]));
  }

  private choose(i: number): void {
    const c = this.dialog.nodes[this.nodeId].choices[i];
    if (!c || this.closed || this.typing) return;
    if (c.next === 'close') return this.close();
    if (c.next === 'battle') {
      this.closed = true;
      this.scene.input.keyboard?.off('keydown', this.onKey, this);
      this.scene.input.off('pointerup', this.onClick, this);
      return this.onBattle();
    }
    this.justChose = true;
    this.nodeId = c.next;
    this.show();
  }

  private onClick(): void {
    if (!this.closed && this.typing && !this.justChose) this.finishTyping();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') return this.close();
    if (e.key === ' ' && this.typing) return this.finishTyping();
    const n = Number(e.key);
    if (n >= 1 && n <= 9) this.choose(n - 1);
  }

  /** Каждый кадр: печать, параллакс, дыхание и фокус портретов, мерцание лучей и треугольника. */
  update(deltaMs: number): void {
    if (this.closed) return;
    const S = FEEL.dialog;
    this.time += deltaMs;
    this.justChose = false;

    if (this.typing) {
      this.shown = Math.min(this.typed.length, this.shown + (S.typeCps * deltaMs) / 1000);
      this.text.setText(this.typed.slice(0, Math.floor(this.shown)));
      if (!this.typing) this.finishTyping();
    }

    // Параллакс: курсор от центра экрана, сглаженно; слои уходят в обратную сторону, по вертикали вдвое слабее.
    const p = this.scene.input.activePointer;
    const t = 1 - Math.exp(-deltaMs / S.parallax.ms);
    this.look.x += (Phaser.Math.Clamp((p.x - W / 2) / (W / 2), -1, 1) - this.look.x) * t;
    this.look.y += (Phaser.Math.Clamp((p.y - H / 2) / (H / 2), -1, 1) - this.look.y) * t;
    for (const l of this.layers) l.obj.setPosition(l.x - this.look.x * l.depth, l.y - this.look.y * l.depth * 0.5);

    // Раскадровки портретов: один проход, потом пауза на первом кадре.
    for (const pl of this.plays) pl.update(deltaMs);

    // Портреты: выезд, параллакс, фокус (яркость и размер), дыхание в разном ритме.
    const Pd = S.parallax.portraits;
    const Fo = S.focus;
    const f = this.anim.focus;
    const B = S.breath;
    const wave = (period: number) => 0.5 - 0.5 * Math.cos((this.time / period) * Math.PI * 2);
    const place = (img: Phaser.GameObjects.Image, base: { x: number; scale: number }, side: number, bright: number, size: number, period: number) => {
      img.x = base.x + side * this.anim.slide - this.look.x * Pd;
      img.y = H - this.look.y * Pd * 0.5 + Pd * 0.5; // запас снизу, чтобы край не открывался
      img.scaleX = base.scale * size;
      img.scaleY = base.scale * size * (1 + (B.scale - 1) * wave(period));
      const v = Math.round(255 * bright);
      img.setTint((v << 16) | (v << 8) | v);
    };
    place(this.hero, this.heroBase, -1, Phaser.Math.Linear(Fo.dim, 1, f), Phaser.Math.Linear(Fo.scale, 1, f), B.periodMs[0]);
    place(this.npc, this.npcBase, 1, Phaser.Math.Linear(1, Fo.dim, f), Phaser.Math.Linear(1, Fo.scale, f), B.periodMs[1]);

    // Лучи «дышат»; треугольник пульсирует, пока печатается текст.
    const Bm = S.beam;
    const breath = Phaser.Math.Linear(Bm.breath[0], Bm.breath[1], wave(Bm.periodMs));
    this.beams.setAlpha(Bm.alpha * breath);
    for (const g of this.glows) g.setAlpha(Bm.alpha * breath);
    const Ar = S.arrow;
    this.arrowGlow.setAlpha(this.typing ? Phaser.Math.Linear(Ar.alpha[0], Ar.alpha[1], wave(Ar.periodMs)) : 0);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.scene.input.keyboard?.off('keydown', this.onKey, this);
    this.scene.input.off('pointerup', this.onClick, this);
    for (const r of this.rows) r.zone.disableInteractive();
    this.scene.tweens.add({ targets: this.root, alpha: 0, duration: FEEL.dialog.bgFadeMs, onComplete: () => this.root.destroy() });
    this.onClose();
  }
}

const lerp2 = (p: Pt, q: Pt, t: number): Pt => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const beamKey = (bgKey: string) => `${bgKey}_beams`;

/** Тень внизу экрана (вертикальный градиент) и подложка варианта (гаснет вправо, мягкие края) — один раз на игру. */
function ensureDialogTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(SHADE)) {
    const t = scene.textures.createCanvas(SHADE, 4, 256)!;
    const c = t.getContext();
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = g;
    c.fillRect(0, 0, 4, 256);
    t.refresh();
  }
  if (!scene.textures.exists(HIGHLIGHT)) {
    const w = 512;
    const h = 64;
    const t = scene.textures.createCanvas(HIGHLIGHT, w, h)!;
    const c = t.getContext();
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    // Мягкие верх и низ: маска по вертикали.
    const m = c.createLinearGradient(0, 0, 0, h);
    m.addColorStop(0, 'rgba(0,0,0,0)');
    m.addColorStop(0.3, 'rgba(0,0,0,1)');
    m.addColorStop(0.7, 'rgba(0,0,0,1)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalCompositeOperation = 'destination-in';
    c.fillStyle = m;
    c.fillRect(0, 0, w, h);
    t.refresh();
  }
}

/** Лучи фона: белые размытые четырёхугольники, ярче у окна, гаснут к полу (красятся tint) — один раз на фон. */
function ensureBeamTexture(scene: Phaser.Scene, bgKey: string, beams: Beam[]): void {
  const key = beamKey(bgKey);
  if (scene.textures.exists(key)) return;
  const src = scene.textures.get(bgKey).getSourceImage();
  const t = scene.textures.createCanvas(key, src.width, src.height)!;
  const c = t.getContext();
  c.filter = `blur(${FEEL.dialog.beam.blur}px)`;
  for (const bm of beams) {
    const from = lerp2(bm.a, bm.b, 0.5);
    const to = lerp2(bm.d, bm.c, 0.5);
    const g = c.createLinearGradient(from[0], from[1], to[0], to[1]);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(...bm.a);
    c.lineTo(...bm.d);
    c.lineTo(...bm.c);
    c.lineTo(...bm.b);
    c.closePath();
    c.fill();
  }
  t.refresh();
}
