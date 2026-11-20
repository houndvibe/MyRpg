// Экран боя — отображение над логикой src/systems/battle.ts (BattleSim).
// Слева — герой и его инвентарь: пассивные предметы срабатывают сами, активные — по клику. Справа — враг и его сумка.
// Между ними — поле атак: атаки врага летят кружками, ПКМ по кружку курсором основного оружия — парирование.
// Курсор — отрезок клинка по числам PARRY_CURSOR (та же зона попадания, что у картинки-курсора в Людъмаке).
import * as Phaser from 'phaser';
import { GridView } from '../components/GridView';
import { BATTLE_LAYOUT, PARRY_CURSOR } from '../config/assets';
import { BATTLE_FAST_SPEED } from '../config/balance';
import { FEEL } from '../config/feel';
import { ENEMIES } from '../data/enemies';
import { ENEMY_ITEMS, type EnemyItemId } from '../data/enemyItems';
import { ITEMS } from '../data/items';
import { removeItem, run, spendCharge } from '../state';
import { MASK, rectMask, type OwnedItem } from '../systems/backpack';
import { BattleSim, type BattleEvent, type EnemySlot } from '../systems/battle';
import { addPortrait, addText, Button, C, CATEGORY_COLORS, describeEnemyItem, describeOwnedItem, W } from '../ui';

const L = BATTLE_LAYOUT;
const BAR_W = 360;
/** Цвет плитки предмета врага в его сумке. */
const ENEMY_ITEM_COLOR = 0x5a3434;

/** Летящая атака врага на поле: кружок с подписью, кольцо-таймер, заливка (зона клика). */
interface ParryIcon {
  cont: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  ring: Phaser.GameObjects.Graphics;
  fill: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  r: number;
  item: EnemyItemId;
}

export class BattleScene extends Phaser.Scene {
  private sim!: BattleSim;
  private speed = 1;
  private shownStatus: BattleSim['status'] = 'fight';
  private finished = false;

  private heroView!: GridView<OwnedItem>;
  private enemyView!: GridView<EnemySlot>;
  private enemyImg!: Phaser.GameObjects.Image | Phaser.GameObjects.Container;
  private heroBar!: Phaser.GameObjects.Rectangle;
  private heroHpText!: Phaser.GameObjects.Text;
  private heroStatus!: Phaser.GameObjects.Text;
  private enemyBar!: Phaser.GameObjects.Rectangle;
  private enemyHpText!: Phaser.GameObjects.Text;
  private enemyStatus!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private logLines: { text: string; color: string }[] = [];
  private logTexts: Phaser.GameObjects.Text[] = [];
  private lastHit = '';
  private hitStopUntil = 0;
  private badgesKey = '';
  private parryIcons = new Map<number, ParryIcon>();

  /** Курсор в поле атак: отрезок клинка от кончика до конца лезвия и рукоять. */
  private cursor!: Phaser.GameObjects.Graphics;
  /** От кончика (точка курсора) до конца лезвия и до рукояти, px; null — у основного оружия нет курсора. */
  private blade: { end: { x: number; y: number }; grip: { x: number; y: number } } | null = null;
  private cursorShown = false;
  private lastPointer = { x: 0, y: 0 };
  private swingUntil = 0;

  constructor() {
    super('Battle');
  }

  create(): void {
    const items = run.items.filter((i) => i.inGrid);
    const mainUid = items.some((i) => i.uid === run.mainUid) ? run.mainUid : null;
    this.sim = new BattleSim({ items, enemy: run.enemy, mainUid });
    this.speed = 1;
    this.shownStatus = 'fight';
    this.finished = false;
    this.logLines = [];
    this.logTexts = [];
    this.lastHit = '';
    this.hitStopUntil = 0;
    this.badgesKey = '';
    this.parryIcons = new Map();
    this.swingUntil = 0;
    this.cursorShown = false;

    // Шапка.
    new Button(this, 130, 45, 200, 54, '← Назад', () => this.leave(), 22);
    addText(this, W / 2, 45, `Бой: ${ENEMIES[run.enemy].name}`, 32, C.accent).setOrigin(0.5);
    const speedBtn = new Button(this, 380, 45, 220, 54, 'Ускорение ×1', () => {
      this.speed = this.speed === 1 ? BATTLE_FAST_SPEED : 1;
      speedBtn.setLabel(`Ускорение ×${this.speed}`);
    }, 22);
    addText(this, W - 60, 92, 'ПКМ по кружку в поле атак — парировать. ЛКМ по активному предмету — применить.', 18, C.dim).setOrigin(1, 0.5);

    // Поле атак — тонкая рамка.
    const z = L.parryZone;
    this.add.rectangle(z.x, z.y, z.w, z.h).setOrigin(0).setStrokeStyle(2, C.border, 0.6);

    // Герой: плашка вместо портрета, имя, здоровье, статусы.
    const hp = L.heroPortrait;
    this.add.rectangle(hp.x, hp.y, hp.w, hp.h, C.panel).setStrokeStyle(2, C.border);
    addText(this, hp.x, hp.y, 'Герой', 30, C.dim).setOrigin(0.5);
    const hx = hp.x + hp.w / 2 + 30;
    addText(this, hx, hp.y - 110, 'Герой', 36, C.accent);
    [this.heroBar, this.heroHpText] = this.makeBar(hx, hp.y - 40);
    this.heroStatus = addText(this, hx, hp.y, '', 22, C.bad, { lineSpacing: 4 });

    // Враг: портрет, имя, здоровье.
    const ep = L.enemyPortrait;
    this.enemyImg = addPortrait(this, ep.x, ep.y, ep.w, ep.h, run.enemy).setDepth(2);
    const ex = ep.x - ep.w / 2 - 30;
    addText(this, ex, ep.y - 110, ENEMIES[run.enemy].name, 36, C.bad).setOrigin(1, 0);
    [this.enemyBar, this.enemyHpText] = this.makeBar(ex - BAR_W, ep.y - 40);
    this.enemyStatus = addText(this, ex, ep.y, '', 22, C.bad, { align: 'right' }).setOrigin(1, 0);

    // Подсказка о предмете под курсором — растёт вверх от нижнего края.
    this.info = addText(this, L.centerX, L.infoBottom, '', 20, C.text, {
      align: 'center',
      wordWrap: { width: 700 },
      backgroundColor: 'rgba(0,0,0,0.8)',
      padding: { x: 10, y: 6 },
    })
      .setOrigin(0.5, 1)
      .setDepth(70)
      .setVisible(false);

    this.heroView = new GridView<OwnedItem>(this, {
      x: L.heroGrid.x,
      y: L.heroGrid.y,
      cell: L.cell,
      mask: MASK,
      mode: 'battle',
      items: () => items,
      look: (it) => ({ w: ITEMS[it.id].w, h: ITEMS[it.id].h, label: ITEMS[it.id].name, color: CATEGORY_COLORS[ITEMS[it.id].category], charges: it.charges ?? null }),
      onHover: (it) => this.setInfo(it ? describeOwnedItem(it, this.sim.powers, this.sim.items) : ''),
      onClick: (it) => {
        if (this.sim.useActive(it.uid)) this.afterSimChange();
      },
    });
    this.heroView.setMain(this.sim.mainUid);

    const def = ENEMIES[run.enemy];
    this.enemyView = new GridView<EnemySlot>(this, {
      x: L.enemyGrid.right - def.bagCols * L.cell,
      y: L.enemyGrid.y,
      cell: L.cell,
      mask: rectMask(def.bagCols, def.bagRows),
      mode: 'view',
      items: () => this.sim.enemy.slots,
      look: (s) => ({ w: s.def.w, h: s.def.h, label: s.def.name, color: ENEMY_ITEM_COLOR, charges: Number.isFinite(s.charges) ? s.charges : null }),
      onHover: (s) => this.setInfo(s ? describeEnemyItem(s.def.id) : ''),
    });

    this.createLog();
    this.createCursor();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onBattleClick(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.moveCursor(p));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input.setDefaultCursor('default'));
    this.afterSimChange(); // события начала боя: сгорело, отравлено, взрыв
  }

  update(_time: number, delta: number): void {
    this.moveCursor(this.lastPointer);
    if (this.sim.status !== 'fight') return;
    if (this.time.now < this.hitStopUntil) return;
    // Окна парирования идут в реальном времени: ускорение на них не влияет.
    this.sim.step((delta / 1000) * this.speed, delta / 1000);
    this.afterSimChange();
  }

  private leave(): void {
    this.scene.start('Main');
  }

  // ─── Поле атак ───────────────────────────────────────────────────────────

  /**
   * Атака врага летит из глубины: появляется маленькой и тусклой в случайной точке поля (подальше от уже летящих)
   * и за окно парирования вырастает до полного размера — полный размер означает удар.
   */
  private spawnParryIcon(e: Extract<BattleEvent, { type: 'windup' }>): void {
    const P = FEEL.parry;
    const r = P.size / 2;
    const pos = this.freeSpot();
    const cont = this.add.container(pos.x, pos.y).setDepth(60);
    const glow = this.add.circle(0, 0, r * 0.95, P.glow, P.glowAlpha);
    // Вместо картинки предмета — его название.
    const label = addText(this, 0, 0, ENEMY_ITEMS[e.item].name, 20, C.text, { align: 'center', wordWrap: { width: r * 1.7 } }).setOrigin(0.5);
    cont.add([glow, label]);
    const ring = this.add.graphics().setDepth(61);
    const fill = this.add.graphics().setDepth(59.5);
    const icon: ParryIcon = { cont, label, ring, fill, x: pos.x, y: pos.y, r, item: e.item };
    this.parryIcons.set(e.id, icon);
    this.placeParryIcon(icon, 0);
  }

  /** Случайная точка поля подальше от уже летящих атак. */
  private freeSpot(): { x: number; y: number } {
    const P = FEEL.parry;
    const z = L.parryZone;
    const r = P.size / 2;
    const taken = [...this.parryIcons.values()];
    let best = { x: z.x + z.w / 2, y: z.y + z.h / 2, d: -1 };
    for (let k = 0; k < 16; k++) {
      const x = Phaser.Math.Between(z.x + r, z.x + z.w - r);
      const y = Phaser.Math.Between(z.y + r, z.y + z.h - r);
      const d = Math.min(Infinity, ...taken.map((o) => Math.hypot(o.x - x, o.y - y)));
      if (d > best.d) best = { x, y, d };
      if (d >= P.minGap) break;
    }
    return { x: best.x, y: best.y };
  }

  /** Атака по доле полёта t (0 — только вылетела, 1 — удар): растёт и светлеет с ускорением, кольцо стягивается. */
  private placeParryIcon(icon: ParryIcon, t: number): void {
    const P = FEEL.parry;
    const k = Phaser.Math.Clamp(t, 0, 1);
    const e = Math.pow(k, P.growPow);
    icon.cont.setScale(P.startScale + (1 - P.startScale) * e).setAlpha(P.startAlpha + (1 - P.startAlpha) * e);
    icon.label.setAlpha(P.startBright + (1 - P.startBright) * e);
    const R = P.size / 2;
    const rr = R + (R * P.ringFrom - R) * (1 - k);
    // Зона клика — всё внутри кольца.
    icon.fill.clear().fillStyle(P.ringColor, P.ringFillAlpha).fillCircle(icon.x, icon.y, rr);
    icon.ring.clear().lineStyle(P.ringWidth, P.ringColor, 0.45 + 0.55 * k).strokeCircle(icon.x, icon.y, rr);
    icon.r = rr + P.ringWidth / 2;
  }

  /** Каждый кадр: атаки летят по оставшемуся времени окна; отменённые (враг умер) убираются. */
  private syncParryIcons(): void {
    for (const [id, icon] of this.parryIcons) {
      const p = this.sim.pending.find((a) => a.id === id);
      if (p) this.placeParryIcon(icon, this.sim.progress(p));
      else {
        icon.cont.destroy();
        icon.ring.destroy();
        icon.fill.destroy();
        this.parryIcons.delete(id);
      }
    }
  }

  /** Удар кружка: отбит — отлетает вправо с искрами; не отбит — долетает до героя. */
  private resolveParryIcon(id: number, parried: boolean): void {
    const icon = this.parryIcons.get(id);
    if (!icon) return;
    this.parryIcons.delete(id);
    icon.ring.destroy();
    icon.fill.destroy();
    const P = FEEL.parry;
    const { x, y } = icon.cont;
    if (!parried) {
      if (ENEMY_ITEMS[icon.item].stain) {
        this.stain(x, y);
        this.stain(L.heroPortrait.x, L.heroPortrait.y);
      }
      this.tweens.add({ targets: icon.cont, x: L.heroPortrait.x, y: L.heroPortrait.y, scale: icon.cont.scale * 0.7, duration: P.hitFlyMs, ease: 'Quad.easeIn', onComplete: () => icon.cont.destroy() });
      return;
    }
    this.shatterRing(icon);
    this.tweens.add({
      targets: icon.cont,
      x: x + P.knockDist,
      y: y + P.knockDist * 0.8,
      angle: 540,
      scale: icon.cont.scale * 0.45,
      alpha: 0,
      duration: P.knockMs,
      ease: 'Cubic.easeOut',
      onComplete: () => icon.cont.destroy(),
    });
    this.sparks(x, y);
    this.floatText(x, y - P.size * 0.6, 'Парировано', C.accent, P.textSize);
  }

  /** Отбитый кружок: кольцо разлетается осколками-дугами. */
  private shatterRing(icon: ParryIcon): void {
    const P = FEEL.parry;
    const rr = icon.r - P.ringWidth / 2;
    for (let i = 0; i < P.shatterPieces; i++) {
      const a0 = (Math.PI * 2 * i) / P.shatterPieces;
      const a1 = a0 + (Math.PI * 2) / P.shatterPieces - 0.12;
      const mid = (a0 + a1) / 2;
      const g = this.add.graphics().setDepth(61).setPosition(icon.x, icon.y);
      g.lineStyle(P.ringWidth, P.ringColor, 1).beginPath().arc(0, 0, rr, a0, a1).strokePath();
      const d = P.shatterDist * Phaser.Math.FloatBetween(0.6, 1);
      this.tweens.add({
        targets: g,
        x: icon.x + Math.cos(mid) * d,
        y: icon.y + Math.sin(mid) * d,
        angle: Phaser.Math.Between(-60, 60),
        alpha: 0,
        duration: P.shatterMs,
        ease: 'Cubic.easeOut',
        onComplete: () => g.destroy(),
      });
    }
  }

  /** Вспышка искр: короткие светлые черточки разлетаются и гаснут. */
  private sparks(x: number, y: number): void {
    const P = FEEL.parry;
    for (let i = 0; i < P.sparks; i++) {
      const a = (Math.PI * 2 * i) / P.sparks + Phaser.Math.FloatBetween(-0.2, 0.2);
      const s = this.add.rectangle(x, y, Phaser.Math.Between(12, 28), 4, i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0xfff2b0 : 0xffc04a).setRotation(a).setDepth(65);
      const dist = P.sparkDist * Phaser.Math.FloatBetween(0.6, 1);
      this.tweens.add({ targets: s, x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist, alpha: 0, scaleX: 0.3, duration: P.sparkMs, ease: 'Cubic.easeOut', onComplete: () => s.destroy() });
    }
  }

  /** Промах: силуэт ближайшего кружка размером с его кольцо в момент клика тает. */
  private missCircle(icon: ParryIcon): void {
    const M = FEEL.parry.miss;
    const g = this.add.graphics().setDepth(55).setPosition(icon.cont.x, icon.cont.y);
    g.fillStyle(M.color, M.alpha * 0.5).fillCircle(0, 0, icon.r).lineStyle(3, M.color, M.alpha * 1.5).strokeCircle(0, 0, icon.r);
    this.tweens.add({ targets: g, alpha: 0, delay: M.holdMs, duration: M.fadeMs, onComplete: () => g.destroy() });
  }

  /** Промах: на месте клика остаётся светлый силуэт курсора и тает. */
  private missMark(q: { x: number; y: number }): void {
    const M = FEEL.parry.miss;
    const g = this.add.graphics().setDepth(55);
    this.drawBlade(g, q, M.color, M.alpha * 2);
    this.tweens.add({ targets: g, alpha: 0, delay: M.holdMs, duration: M.fadeMs, onComplete: () => g.destroy() });
  }

  /** Пятно от пропущенного удара (лепёшка): клякса на поле и на плашке героя. */
  private stain(x: number, y: number): void {
    const S = FEEL.stain;
    const R = (FEEL.parry.size / 2) * S.size;
    const g = this.add.graphics().setDepth(62).setPosition(x, y);
    g.fillStyle(S.color, S.alpha).fillCircle(0, 0, R);
    for (let i = 0; i < 7; i++) {
      const a = (Math.PI * 2 * i) / 7 + Phaser.Math.FloatBetween(-0.3, 0.3);
      const d = R * Phaser.Math.FloatBetween(0.7, 1.05);
      g.fillCircle(Math.cos(a) * d, Math.sin(a) * d, R * Phaser.Math.FloatBetween(0.25, 0.45));
    }
    g.setScale(0.4);
    this.tweens.add({ targets: g, scale: 1, duration: 120, ease: 'Back.easeOut' });
    this.tweens.add({ targets: g, alpha: 0, delay: S.holdMs, duration: S.fadeMs, onComplete: () => g.destroy() });
  }

  // ─── Курсор и парирование ────────────────────────────────────────────────

  /**
   * Курсор основного оружия: отрезок от кончика до конца лезвия по числам PARRY_CURSOR.weapons (доли картинки предмета,
   * угол покоя, высота size; ширина картинки — size × w / h предмета). Им отбиваются атаки.
   */
  private createCursor(): void {
    this.cursor = this.add.graphics().setDepth(2500).setVisible(false);
    this.blade = null;
    const main = this.sim.slots.find((s) => s.item.uid === this.sim.mainUid);
    const S = main?.def.parryPerk ? PARRY_CURSOR.weapons[main.def.id] : undefined;
    if (!main || !S) return;
    const h = S.size;
    const w = (S.size * main.def.w) / main.def.h;
    const a = Phaser.Math.DegToRad(S.angle);
    const rot = (q: { x: number; y: number }) => {
      const dx = (q.x - S.tip.x) * w;
      const dy = (q.y - S.tip.y) * h;
      return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
    };
    this.blade = { end: rot(S.bladeEnd), grip: rot(S.grip) };
  }

  /** Можно отбивать: есть курсор-клинок и основное оружие работает. */
  private canParry(): boolean {
    return this.blade !== null && !!this.sim.mainSlot;
  }

  private inParryZone(p: { x: number; y: number }): boolean {
    const z = L.parryZone;
    return p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;
  }

  private drawBlade(g: Phaser.GameObjects.Graphics, q: { x: number; y: number }, color: number, alpha: number): void {
    if (!this.blade) return;
    const { end, grip } = this.blade;
    g.lineStyle(4, 0x8a6a4a, alpha).lineBetween(q.x + end.x, q.y + end.y, q.x + grip.x, q.y + grip.y);
    g.lineStyle(7, color, alpha).lineBetween(q.x, q.y, q.x + end.x, q.y + end.y);
  }

  private moveCursor(m: { x: number; y: number }): void {
    this.lastPointer = { x: m.x, y: m.y };
    const inField = this.inParryZone(m) && !this.finished;
    if (inField !== this.cursorShown) {
      this.cursorShown = inField;
      this.input.setDefaultCursor(inField ? 'none' : 'default');
    }
    this.cursor.clear().setVisible(inField);
    if (!inField) return;
    if (!this.canParry()) {
      // Нечем отбивать: в поле — просто крестик.
      this.cursor.lineStyle(2, 0x8f889c, 1).lineBetween(m.x - 10, m.y, m.x + 10, m.y).lineBetween(m.x, m.y - 10, m.x, m.y + 10);
      return;
    }
    this.drawBlade(this.cursor, m, this.time.now < this.swingUntil ? 0xffffff : FEEL.parry.cursorColor, 1);
  }

  /**
   * ПКМ в поле атак — взмах. Клинок отбивает кружок, если круг касается отрезка лезвия (от кончика-курсора до конца лезвия).
   * Задеты несколько — отбивается ближайший к точке клика.
   */
  private onBattleClick(p: Phaser.Input.Pointer): void {
    if (p.button !== 2 || !this.inParryZone(p) || !this.canParry()) return;
    this.swingUntil = this.time.now + FEEL.parry.swingMs;
    const { end } = this.blade!;
    let hit: number | null = null;
    let best = Infinity;
    for (const [id, icon] of this.parryIcons) {
      const c = { x: icon.cont.x, y: icon.cont.y };
      if (segmentDist(p.x, p.y, p.x + end.x, p.y + end.y, c.x, c.y) > icon.r) continue;
      const near = Math.hypot(p.x - c.x, p.y - c.y);
      if (near < best) {
        best = near;
        hit = id;
      }
    }
    if (hit === null || !this.sim.parry(hit)) {
      this.missMark(p);
      let near: ParryIcon | null = null;
      let nd = Infinity;
      for (const icon of this.parryIcons.values()) {
        const d = Math.hypot(icon.cont.x - p.x, icon.cont.y - p.y);
        if (d < nd) {
          nd = d;
          near = icon;
        }
      }
      if (near) this.missCircle(near);
      return;
    }
    this.afterSimChange();
  }

  // ─── События боя ─────────────────────────────────────────────────────────

  private afterSimChange(): void {
    for (const e of this.sim.drain()) {
      this.logEvent(e);
      this.showEvent(e);
    }
    this.syncParryIcons();
    this.syncBadges();
    this.refresh();
    const status = this.sim.status;
    if (status === this.shownStatus) return;
    this.shownStatus = status;
    if (status === 'won') {
      this.hitStopUntil = this.time.now + FEEL.hitStopMs;
      this.finish('Победа', C.good);
    } else if (status === 'lost') this.finish('Герой пал', C.bad);
  }

  /** Конец боя: надпись и кнопки «Ещё раз» и «На главный экран». Потраченные расходники не возвращаются. */
  private finish(message: string, color: string): void {
    if (this.finished) return;
    this.finished = true;
    this.input.setDefaultCursor('default');
    this.cursor.setVisible(false);
    const box = this.add.container(L.centerX, 600).setDepth(90);
    box.add(this.add.rectangle(0, 0, 560, 260, 0x000000, 0.85).setStrokeStyle(2, C.border));
    box.add(addText(this, 0, -70, message, 56, color).setOrigin(0.5));
    box.add(new Button(this, -135, 50, 240, 70, 'Ещё раз', () => this.scene.restart(), 26));
    box.add(new Button(this, 135, 50, 240, 70, 'На главный', () => this.leave(), 26));
  }

  /** Метки соседства на предметах: перерисовать, только если эффекты изменились (предмет исчез). */
  private syncBadges(): void {
    const key = this.sim.effects.map((e) => `${e.source}>${e.target}:${e.good}`).join(',');
    if (key === this.badgesKey) return;
    this.badgesKey = key;
    for (const s of this.sim.slots) {
      const p = this.sim.powers.get(s.item.uid);
      if (p) this.heroView.setBadges(s.item.uid, p.received.filter((e) => e.good && !e.inactive).length, p.received.filter((e) => !e.good && !e.inactive).length);
    }
  }

  private showEvent(e: BattleEvent): void {
    const F = FEEL.float;
    const cx = L.centerX;
    switch (e.type) {
      case 'heroItem':
        this.heroView.flash(e.uid);
        if (e.active) this.floatText(cx, L.itemNameY, e.name, C.accent, 30);
        break;
      case 'heroCharge':
        spendCharge(e.uid); // расходник тратится навсегда
        this.heroView.setCharges(e.uid, e.left);
        if (e.left <= 0) this.heroView.removePiece(e.uid);
        break;
      case 'enemyItem':
        this.enemyView.flash(e.uid);
        this.floatText(cx, L.itemNameY, e.name, C.bad, 30);
        break;
      case 'enemyCharge':
        this.enemyView.setCharges(e.uid, e.left);
        if (e.left <= 0) this.enemyView.removePiece(e.uid);
        break;
      case 'enemyHit':
        if (e.taken > 0) {
          this.floatText(L.floatEnemyX, L.floatY, `${e.taken}`, F.enemyDamage, e.taken >= F.bigHitEnemy ? F.bigSize : F.size);
          this.hitFx(this.enemyImg);
        }
        break;
      case 'heroHit':
        if (e.taken > 0) {
          this.floatText(L.floatHeroX, L.floatY, `−${e.taken}`, e.self ? F.selfDamage : F.heroDamage, e.taken >= F.bigHitHero ? F.bigSize : F.size);
          if (!e.self && e.taken >= FEEL.shake.heroHitThreshold) this.cameras.main.shake(FEEL.shake.heroHitMs, FEEL.shake.heroHitIntensity);
        }
        break;
      case 'heroHeal':
        if (e.amount > 0) this.floatText(L.floatHeroX, L.floatY, `+${e.amount}`, F.heal, F.size);
        break;
      case 'burned':
        this.floatText(cx, L.itemNameY - 60, `${e.name}: ${e.reason.toLowerCase()}`, C.bad, 26);
        break;
      case 'poisoned':
        this.floatText(cx, L.itemNameY - 60, `${e.name}: отравлена`, C.bad, 26);
        break;
      case 'explode':
        removeItem(e.uid); // все заряды потеряны — предмет исчезает навсегда
        this.heroView.removePiece(e.uid);
        this.floatText(cx, L.itemNameY - 60, `Взрыв! ${e.name}`, C.bad, 32);
        this.cameras.main.shake(FEEL.shake.explosionMs, FEEL.shake.explosionIntensity);
        break;
      case 'enabled':
        this.floatText(cx, L.itemNameY - 60, `${e.name} снова работает`, C.good, 26);
        break;
      case 'bonusLost':
        this.floatText(cx, L.itemNameY - 60, `${e.name}: бонус соседа пропал`, C.dim, 24);
        break;
      case 'blocked':
        this.floatText(cx, L.itemNameY - 60, `${e.name}: ${e.reason}`, C.bad, 26);
        break;
      case 'windup':
        this.spawnParryIcon(e);
        break;
      case 'strike':
        this.resolveParryIcon(e.id, e.parried);
        break;
      case 'enemyMiss':
        this.floatText(L.floatHeroX, L.floatY, 'промах!', C.dim, 34);
        break;
      case 'fatigue':
        this.floatText(L.floatEnemyX, L.floatY + 60, `враг звереет: урон +${Math.round(e.bonus * 100)}%`, C.bad, 28);
        break;
    }
  }

  // ─── Журнал ──────────────────────────────────────────────────────────────

  private createLog(): void {
    const g = L.log;
    this.add.rectangle(g.x, g.y, g.w, g.h, 0x000000, g.alpha).setOrigin(0);
    for (let i = 0; i < g.lines; i++) {
      this.logTexts.push(addText(this, g.x + g.pad, g.y + g.pad + i * ((g.h - 2 * g.pad) / g.lines), '', g.size, C.text));
    }
  }

  private log(text: string, color: string): void {
    const g = L.log;
    this.logLines.push({ text, color });
    if (this.logLines.length > g.lines) this.logLines.shift();
    const n = this.logLines.length;
    this.logTexts.forEach((t, i) => {
      const line = this.logLines[i - (g.lines - n)];
      t.setText(line?.text ?? '').setColor(line?.color ?? C.text).setAlpha(1 - (g.lines - 1 - i) * g.fade);
    });
  }

  private logEvent(e: BattleEvent): void {
    const foe = ENEMIES[run.enemy].name;
    switch (e.type) {
      case 'strike': {
        const icon = this.parryIcons.get(e.id);
        if (!icon) break;
        this.lastHit = ENEMY_ITEMS[icon.item].name;
        if (e.parried) this.log(`Отбито: ${this.lastHit.toLowerCase()}`, C.good);
        break;
      }
      case 'enemyHit':
        if (e.taken > 0) this.log(`${ITEMS[e.item].name} → ${foe} −${e.taken}`, C.text);
        break;
      case 'heroHit':
        if (e.self) this.log(`Урон себе −${e.taken}`, C.bad);
        else if (e.taken > 0) this.log(`${this.lastHit || 'Удар'}: −${e.taken}`, C.bad);
        break;
      case 'heroHeal':
        if (e.amount > 0) this.log(`Лечение +${e.amount}`, C.good);
        break;
      case 'enemyMiss':
        this.log(`${e.name}: промах`, C.dim);
        break;
      case 'fatigue':
        this.log(`Затяжной бой: урон врага +${Math.round(e.bonus * 100)}%`, C.bad);
        break;
    }
  }

  // ─── Отрисовка ───────────────────────────────────────────────────────────

  /** Полоска здоровья: x — левый край. Возвращает заливку и подпись. */
  private makeBar(x: number, y: number): [Phaser.GameObjects.Rectangle, Phaser.GameObjects.Text] {
    this.add.rectangle(x, y, BAR_W, 34, 0x000000, 0.7).setOrigin(0, 0.5).setStrokeStyle(2, C.border);
    const bar = this.add.rectangle(x, y, BAR_W, 34, 0xb03a3a).setOrigin(0, 0.5);
    const text = addText(this, x + BAR_W / 2, y, '', 22, C.text, { stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5);
    return [bar, text];
  }

  private setInfo(text: string): void {
    this.info.setText(text).setVisible(text !== '');
  }

  private refresh(): void {
    const sim = this.sim;
    this.heroBar.width = BAR_W * Phaser.Math.Clamp(sim.heroHp / sim.heroMaxHp, 0, 1);
    this.heroHpText.setText(`${sim.heroHp} / ${sim.heroMaxHp}`);
    this.heroStatus.setText(sim.mainSlot ? '' : 'Нечем отбивать: основного оружия нет или оно отключено');

    // Инвентарь героя: отключённые — серые; пассивные — перезарядка; активные — светлая рамка, пока их можно нажать.
    for (const slot of sim.slots) this.heroView.setDisabled(slot.item.uid, slot.disabled);
    for (const p of sim.passives) this.heroView.setProgress(p.item.uid, p.stats.cooldown ? p.timer / p.stats.cooldown : 1);
    for (const a of sim.actives) {
      const canUse = sim.status === 'fight' && !a.disabled;
      this.heroView.setReady(a.item.uid, canUse);
      this.heroView.setProgress(a.item.uid, canUse ? 1 : 0);
    }

    const e = sim.enemy;
    this.enemyBar.width = BAR_W * Phaser.Math.Clamp(e.hp / e.maxHp, 0, 1);
    this.enemyHpText.setText(`${e.hp} / ${e.maxHp}`);
    this.enemyStatus.setText(sim.fatigueBonus > 0 ? `Затяжной бой: урон +${Math.round(sim.fatigueBonus * 100)}%` : '');

    // Сумка врага: заполняется только то, что враг готовит сейчас.
    const next = sim.nextAction();
    for (const s of e.slots) this.enemyView.setProgress(s.uid, s === next ? e.actionTimer / s.stats.cooldown : 0);
  }

  private floatText(x: number, y: number, str: string, color: string, size: number): void {
    const t = addText(this, x + Phaser.Math.Between(-40, 40), y, str, size, color, { stroke: '#000000', strokeThickness: 5, align: 'center' })
      .setOrigin(0.5)
      .setDepth(80);
    this.tweens.add({ targets: t, y: y - FEEL.float.rise, alpha: 0, duration: FEEL.float.durationMs, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  /** Вспышка и покачивание портрета при ударе (Phaser 4: заливка оттенком — setTintMode(FILL)). */
  private hitFx(target: Phaser.GameObjects.Image | Phaser.GameObjects.Container): void {
    const baseX = L.enemyPortrait.x;
    this.tweens.killTweensOf(target);
    target.x = baseX;
    if (target instanceof Phaser.GameObjects.Image) {
      target.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      this.time.delayedCall(70, () => target.active && target.clearTint());
    }
    this.tweens.add({ targets: target, x: baseX + 14, duration: 45, yoyo: true, repeat: 1, onComplete: () => (target.x = baseX) });
  }
}

/** Расстояние от точки (x, y) до отрезка (x1, y1) — (x2, y2). */
function segmentDist(x1: number, y1: number, x2: number, y2: number, x: number, y: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const k = Phaser.Math.Clamp(((x - x1) * dx + (y - y1) * dy) / len2, 0, 1);
  return Math.hypot(x - (x1 + k * dx), y - (y1 + k * dy));
}
