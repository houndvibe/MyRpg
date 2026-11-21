// QTE небоевой проверки поверх карты — как парирование в бою. Поле того же размера, что поле атак боя; в случайном месте
// поля появляется кружок с буквой из пула героя и растёт, красное кольцо стягивается за окно буквы. Отбить его нужно
// ПКМ курсором основного оружия (картинка, отбивает отрезок клинка — PARRY_CURSOR), держа зажатой клавишу этой буквы
// (физическую: KeyQ — «Q», при любой раскладке). Отбил с нужной буквой — следующий кружок. Отбил без неё (или зажаты
// ещё другие буквы пула) или кольцо стянулось — провал. Взмах мимо кружков ничего не стоит, как в бою.
// Нет основного оружия — курсор-крестик, отбивает точкой. Частичного результата нет. Время — реальное (update(delta)).
// tutorial — первая проверка: на первом кружке время стоит и идёт пошаговое обучение (data/tutorials.ts, TutorialOverlay);
// отбитый в обучении кружок засчитывается, дальше — как обычно.
// Числа проверок — QTE_CHECKS (balance.ts), вид кружка — FEEL.parry (как в бою), время и цвета окна — FEEL.qte,
// раскладка — MAP_LAYOUT.qte.
import * as Phaser from 'phaser';
import { QTE_CHECKS } from '../config/balance';
import { itemKey, MAP_LAYOUT, PARRY_CURSOR } from '../config/assets';
import { FEEL } from '../config/feel';
import { DIFFICULTY_NAMES, QTE_LETTERS, type CheckDifficulty, type QteLetter } from '../data/checks';
import { QTE_TUTORIAL } from '../data/tutorials';
import { TutorialOverlay, type Rect } from './TutorialOverlay';
import { ITEMS } from '../data/items';
import { run } from '../state';
import { addText, C, H, segmentDist, W } from '../ui';

const DEPTH = 45;

type Pt = { x: number; y: number };

export class QteWindow {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private zone: { x: number; y: number; w: number; h: number };
  private dots: Phaser.GameObjects.Arc[] = [];
  private status: Phaser.GameObjects.Text;
  private result: Phaser.GameObjects.Text;
  private sequence: QteLetter[];
  private window: number;
  private index = 0;
  /** Время на текущей фазе, мс. */
  private t = 0;
  private phase: 'ready' | 'letter' | 'gap' | 'result' = 'ready';
  private success = false;
  /** Текущий кружок: контейнер (подложка и буква), кольцо и заливка, центр и радиус зоны отбива. */
  private icon: { cont: Phaser.GameObjects.Container; letter: Phaser.GameObjects.Text; ring: Phaser.GameObjects.Graphics; fill: Phaser.GameObjects.Graphics; x: number; y: number; r: number } | null = null;
  /** Курсор: картинка оружия (или крестик кодом) и отрезок клинка от кончика (смещение от курсора). */
  private cursorImg: Phaser.GameObjects.Image | null = null;
  private cross: Phaser.GameObjects.Graphics;
  private blade: Pt | null = null;
  private swingUntil = 0;
  private inField = false;
  /** Зажатые сейчас буквы (физические клавиши). */
  private held = new Set<string>();
  /** Обучение: оверлей (null — обучения нет или прошло) и номер шага. */
  private tut: TutorialOverlay | null = null;
  private tutStep = 0;
  private readonly onKeyDown = (e: KeyboardEvent) => /^Key[A-Z]$/.test(e.code) && this.held.add(e.code.slice(3));
  private readonly onKeyUp = (e: KeyboardEvent) => /^Key[A-Z]$/.test(e.code) && this.held.delete(e.code.slice(3));

  constructor(private scene: Phaser.Scene, title: string, difficulty: CheckDifficulty, pool: QteLetter[], private onDone: (success: boolean) => void, private tutorial = false) {
    const L = MAP_LAYOUT.qte;
    const F = FEEL.qte;
    const check = QTE_CHECKS[difficulty];
    this.window = check.window * 1000;
    this.sequence = Array.from({ length: check.letters }, () => Phaser.Utils.Array.GetRandom(pool));
    this.zone = L.field;
    const z = this.zone;
    const shade = scene.add.rectangle(0, 0, W, H, 0x000000, F.shade).setOrigin(0).setDepth(DEPTH);
    const t = addText(scene, L.title.x, L.title.y, title, 40, C.accent).setOrigin(0.5).setDepth(DEPTH + 1);
    const sub = addText(scene, L.sub.x, L.sub.y, `Проверка: ${DIFFICULTY_NAMES[difficulty]} · кружков ${check.letters} · окно ${check.window} с`, 22, C.dim).setOrigin(0.5).setDepth(DEPTH + 1);
    const help = addText(scene, L.help.x, L.help.y, 'Зажмите клавишу буквы и отбейте кружок ПКМ', 20, C.text).setOrigin(0.5).setDepth(DEPTH + 1);
    const frame = scene.add.rectangle(z.x, z.y, z.w, z.h, 0x000000, 0.25).setOrigin(0).setStrokeStyle(2, C.border, 0.8).setDepth(DEPTH + 1);
    this.status = addText(scene, z.x + z.w / 2, z.y + z.h / 2, 'Приготовьтесь', 30, C.text).setOrigin(0.5).setDepth(DEPTH + 2);
    const D = L.dots;
    const x0 = W / 2 - ((check.letters - 1) * D.gap) / 2;
    for (let i = 0; i < check.letters; i++) this.dots.push(scene.add.circle(x0 + i * D.gap, D.y, 9, C.cell).setStrokeStyle(2, C.border).setDepth(DEPTH + 1));
    this.result = addText(scene, L.result.x, L.result.y, '', 44, C.text).setOrigin(0.5).setDepth(DEPTH + 1);
    this.cross = scene.add.graphics().setDepth(DEPTH + 10).setVisible(false);
    this.objects = [shade, t, sub, help, frame, this.status, ...this.dots, this.result, this.cross];
    this.createCursor();
    scene.input.on('pointermove', this.onMove, this);
    scene.input.on('pointerdown', this.onDown, this);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clearHeld);
  }

  private readonly clearHeld = () => this.held.clear();

  /** Курсор — картинка основного оружия с опорой в кончике и наклоном покоя (как в бою); клинок — отрезок от кончика. */
  private createCursor(): void {
    const main = run.items.find((i) => i.uid === run.mainUid && i.inGrid);
    const S = main && ITEMS[main.id].parryPerk ? PARRY_CURSOR.weapons[main.id] : undefined;
    if (!main || !S) return;
    const def = ITEMS[main.id];
    const h = S.size;
    let w = (S.size * def.w) / def.h;
    const key = itemKey(main.id);
    if (this.scene.textures.exists(key)) {
      const img = this.scene.add.image(0, 0, key).setOrigin(S.tip.x, S.tip.y).setAngle(S.angle).setDepth(DEPTH + 10).setVisible(false);
      img.setScale(S.size / img.height);
      w = (S.size * img.width) / img.height;
      this.cursorImg = img;
      this.objects.push(img);
    }
    const a = Phaser.Math.DegToRad(S.angle);
    const dx = (S.bladeEnd.x - S.tip.x) * w;
    const dy = (S.bladeEnd.y - S.tip.y) * h;
    this.blade = { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
  }

  private inZone(p: Pt): boolean {
    const z = this.zone;
    return p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const inField = this.inZone(p) && this.phase !== 'result';
    if (inField !== this.inField) {
      this.inField = inField;
      this.scene.input.setDefaultCursor(inField ? 'none' : 'default');
    }
    const swinging = this.scene.time.now < this.swingUntil;
    if (this.cursorImg) {
      this.cursorImg.setVisible(inField).setPosition(p.x, p.y);
      if (swinging) this.cursorImg.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL).setAlpha(0.85);
      else this.cursorImg.clearTint().setAlpha(1);
    }
    this.cross.clear().setVisible(inField && !this.cursorImg);
    if (inField && !this.cursorImg) this.cross.lineStyle(2, 0xece6d6, 1).lineBetween(p.x - 10, p.y, p.x + 10, p.y).lineBetween(p.x, p.y - 10, p.x, p.y + 10);
  }

  /** ПКМ в поле — взмах: клинок задел кружок — отбит; с нужной зажатой буквой — дальше, иначе провал. Мимо — ничего. */
  private onDown(p: Phaser.Input.Pointer): void {
    if (p.button !== 2 || !this.inZone(p)) return;
    this.swingUntil = this.scene.time.now + FEEL.parry.swingMs;
    this.onMove(p);
    const ic = this.icon;
    if (this.phase !== 'letter' || !ic) return;
    const b = this.blade;
    const d = b ? segmentDist(p.x, p.y, p.x + b.x, p.y + b.y, ic.x, ic.y) : Math.hypot(p.x - ic.x, p.y - ic.y);
    if (d > ic.r) return;
    if (this.tut) {
      // В обучении отбивать можно только на шаге «отбейте»; без нужной буквы — подсказка, не провал.
      const step = QTE_TUTORIAL[this.tutStep];
      if (step.wait !== 'parry') return;
      if (!this.armed()) return this.tut.setText(this.tutText(step.retry ?? step.text));
      this.parried();
      return this.nextTutorialStep();
    }
    if (!this.armed()) return this.finish(false);
    this.parried();
  }

  /** Зажата клавиша буквы текущего кружка и никакая другая буква пула. */
  private armed(): boolean {
    const pressed = QTE_LETTERS.filter((l) => this.held.has(l));
    return pressed.length === 1 && pressed[0] === this.sequence[this.index];
  }

  /** Кадр: время фаз, рост кружка и кольца. В обучении время стоит: кружок замер, шаг «зажмите» ждёт нужную букву. */
  update(delta: number): void {
    const F = FEEL.qte;
    if (this.tut) {
      if (this.phase === 'letter') this.place(F.tutorialK);
      if (QTE_TUTORIAL[this.tutStep].wait === 'hold' && this.armed()) this.nextTutorialStep();
      return;
    }
    this.t += Math.min(delta, 100); // длинный кадр (вкладка свёрнута, подвисание) не съедает окно целиком
    if (this.phase === 'ready' && this.t >= F.readyMs) this.spawn();
    else if (this.phase === 'gap' && this.t >= F.gapMs) this.spawn();
    else if (this.phase === 'letter') {
      const k = Math.min(1, this.t / this.window);
      this.place(k);
      if (k >= 1) this.finish(false);
    } else if (this.phase === 'result' && this.t >= F.resultMs) this.close();
  }

  /** Новый кружок с буквой в случайном месте поля. */
  private spawn(): void {
    const P = FEEL.parry;
    const z = this.zone;
    const R = P.size / 2;
    const reach = R * P.ringFrom;
    const x = Phaser.Math.Between(z.x + reach, z.x + z.w - reach);
    const y = Phaser.Math.Between(z.y + reach, z.y + z.h - reach);
    this.status.setText('');
    const glow = this.scene.add.circle(0, 0, R * 0.95, P.glow, P.glowAlpha);
    const letter = addText(this.scene, 0, 0, this.sequence[this.index], 56, C.text).setOrigin(0.5);
    const cont = this.scene.add.container(x, y, [glow, letter]).setDepth(DEPTH + 4);
    const ring = this.scene.add.graphics().setDepth(DEPTH + 5);
    const fill = this.scene.add.graphics().setDepth(DEPTH + 3);
    this.icon = { cont, letter, ring, fill, x, y, r: R };
    this.phase = 'letter';
    this.t = 0;
    this.place(0);
    if (this.tutorial && this.index === 0 && !this.tut) {
      this.place(FEEL.qte.tutorialK);
      this.tut = new TutorialOverlay(this.scene, DEPTH + 7);
      this.tutStep = 0;
      this.showTutorialStep();
    }
  }

  /** Текст шага: {letter} — буква текущего кружка. */
  private tutText(text: string): string {
    return text.split('{letter}').join(`«${this.sequence[this.index]}»`);
  }

  /** Что подсвечено на шаге обучения. */
  private tutorialArea(target: (typeof QTE_TUTORIAL)[number]['target']): Rect | null {
    if (target === 'field') return this.zone;
    if (target === 'circle' && this.icon) return { x: this.icon.x - this.icon.r, y: this.icon.y - this.icon.r, w: this.icon.r * 2, h: this.icon.r * 2 };
    if (target === 'dots') {
      const a = this.dots[0];
      const b = this.dots[this.dots.length - 1];
      return { x: a.x - 14, y: a.y - 14, w: b.x - a.x + 28, h: 28 };
    }
    return null;
  }

  private showTutorialStep(): void {
    const step = QTE_TUTORIAL[this.tutStep];
    const button = step.wait === 'next' ? (step.button ?? 'Далее') : null;
    this.tut!.show(this.tutorialArea(step.target), this.tutText(step.text), button, () => this.nextTutorialStep());
  }

  /** Следующий шаг; шаги кончились — обучение пройдено, проверка идёт дальше с настоящим временем. */
  private nextTutorialStep(): void {
    if (!this.tut) return;
    this.tutStep++;
    if (this.tutStep < QTE_TUTORIAL.length) return this.showTutorialStep();
    this.tut.destroy();
    this.tut = null;
    this.t = 0;
    if (!run.tutorialsSeen.includes('qte')) run.tutorialsSeen.push('qte');
  }

  /** Кружок по доле окна k: растёт и светлеет с ускорением, кольцо стягивается — как атака в бою. Кольцо белое,
   *  с зажатой нужной буквой — голубое. */
  private place(k: number): void {
    const ic = this.icon;
    if (!ic) return;
    const P = FEEL.parry;
    const e = Math.pow(k, P.growPow);
    ic.cont.setScale(P.startScale + (1 - P.startScale) * e).setAlpha(P.startAlpha + (1 - P.startAlpha) * e);
    const R = P.size / 2;
    const rr = R + (R * P.ringFrom - R) * (1 - k);
    const color = this.armed() ? FEEL.qte.armed : FEEL.qte.idle;
    ic.fill.clear().fillStyle(color, P.ringFillAlpha).fillCircle(ic.x, ic.y, rr);
    ic.ring.clear().lineStyle(P.ringWidth, color, 0.45 + 0.55 * k).strokeCircle(ic.x, ic.y, rr);
    ic.r = rr + P.ringWidth / 2;
  }

  /** Убрать кружок: отбит — кольцо зеленеет и гаснет, кружок отлетает с искрами; провал — тает на месте. */
  private dropIcon(parried: boolean): void {
    const ic = this.icon;
    if (!ic) return;
    this.icon = null;
    const P = FEEL.parry;
    if (parried) {
      const rr = ic.r - P.ringWidth / 2;
      const green = FEEL.qte.parried;
      ic.fill.clear().fillStyle(green, P.ringFillAlpha * 2).fillCircle(ic.x, ic.y, rr);
      ic.ring.clear().lineStyle(P.ringWidth, green, 1).strokeCircle(ic.x, ic.y, rr);
      this.scene.tweens.add({ targets: [ic.ring, ic.fill], alpha: 0, duration: P.knockMs, onComplete: () => { ic.ring.destroy(); ic.fill.destroy(); } });
    } else {
      ic.ring.destroy();
      ic.fill.destroy();
    }
    if (parried) {
      this.sparks(ic.x, ic.y);
      this.scene.tweens.add({ targets: ic.cont, x: ic.x + P.knockDist, y: ic.y + P.knockDist * 0.8, angle: 540, scale: ic.cont.scale * 0.45, alpha: 0, duration: P.knockMs, ease: 'Cubic.easeOut', onComplete: () => ic.cont.destroy() });
    } else {
      ic.letter.setColor(C.bad);
      this.scene.tweens.add({ targets: ic.cont, alpha: 0, duration: FEEL.qte.resultMs * 0.8, onComplete: () => ic.cont.destroy() });
    }
  }

  private sparks(x: number, y: number): void {
    const P = FEEL.parry;
    for (let i = 0; i < P.sparks; i++) {
      const a = (Math.PI * 2 * i) / P.sparks + Phaser.Math.FloatBetween(-0.2, 0.2);
      const s = this.scene.add.rectangle(x, y, Phaser.Math.Between(12, 28), 4, i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0xfff2b0 : 0xffc04a).setRotation(a).setDepth(DEPTH + 6);
      const dist = P.sparkDist * Phaser.Math.FloatBetween(0.6, 1);
      this.scene.tweens.add({ targets: s, x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist, alpha: 0, scaleX: 0.3, duration: P.sparkMs, ease: 'Cubic.easeOut', onComplete: () => s.destroy() });
    }
  }

  private parried(): void {
    this.dropIcon(true);
    this.dots[this.index].setFillStyle(FEEL.qte.good);
    this.index++;
    if (this.index >= this.sequence.length) return this.finish(true);
    this.phase = 'gap';
    this.t = 0;
  }

  private finish(success: boolean): void {
    const F = FEEL.qte;
    this.success = success;
    this.phase = 'result';
    this.t = 0;
    if (!success) {
      this.dots[this.index]?.setFillStyle(F.bad);
      this.dropIcon(false);
    }
    this.result.setText(success ? 'Успех' : 'Провал').setColor(success ? C.good : C.bad);
  }

  private close(): void {
    this.destroy();
    this.onDone(this.success);
  }

  destroy(): void {
    this.scene.input.off('pointermove', this.onMove, this);
    this.scene.input.off('pointerdown', this.onDown, this);
    this.scene.input.setDefaultCursor('default');
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clearHeld);
    this.tut?.destroy();
    this.tut = null;
    if (this.icon) {
      this.icon.cont.destroy();
      this.icon.ring.destroy();
      this.icon.fill.destroy();
      this.icon = null;
    }
    for (const o of this.objects) o.destroy();
    this.objects = [];
  }
}
