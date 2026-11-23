// Боковое меню точки (сайдбар): выезжает справа на всю высоту экрана, когда герой пришёл в точку локации.
// Сверху — картинка места (places/<id>.webp; нет арта — увеличенный фрагмент карты вокруг точки), ниже название,
// художественное описание (data/places.ts) и кнопки действий. Закреплено на экране; сцена рисует его камерой интерфейса.
// Раскладка — PLACE_SIDEBAR (assets.ts), время и цвета — FEEL.sidebar.
import * as Phaser from 'phaser';
import { PLACE_SIDEBAR as S, placeKey } from '../config/assets';
import { FEEL } from '../config/feel';
import { POIS, type PoiId } from '../data/map';
import { PLACE_TEXT } from '../data/places';
import { addText, Button, C, H, W } from '../ui';

/** Действие точки: подпись кнопки и что сделать. */
export interface PlaceAction {
  label: string;
  run: () => void;
  /** false — кнопка видна, но не нажимается (например, не хватает свечей). */
  enabled?: boolean;
}

/** Картинка-заглушка из карты: ключ подложки, её увеличение в мире (px мира на px картинки). */
export interface MapSource {
  key: string;
  scale: number;
}

const SHADOW = 'sidebar_shadow';
/** Подложка с вырезанным проёмом. */
const PANEL_CUT = 'sidebar_panel_cut';

export class PlaceSidebar {
  private root: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Container | null = null;
  /** Картинка места — под подложкой (видна сквозь вырезанный проём, уголки рамки поверх). */
  private picture: Phaser.GameObjects.Container;
  private poi: PoiId | null = null;
  private shown = false;

  constructor(private scene: Phaser.Scene, depth = 25) {
    ensureShadow(scene);
    const F = FEEL.sidebar;
    this.root = scene.add.container(W + F.shadowW, 0).setScrollFactor(0).setDepth(depth).setVisible(false);
    // Подложка панели, отражённая (рамка, проём под картинку, золотая кайма слева — к карте), и мягкая тень на карту слева.
    // Нет подложки — тёмная панель с каймой, нарисованная кодом.
    const shadow = scene.add.image(0, 0, SHADOW).setOrigin(1, 0).setFlipX(true).setDisplaySize(F.shadowW, H).setAlpha(F.shadowAlpha);
    this.picture = scene.add.container(0, 0);
    if (scene.textures.exists(S.panel.key)) {
      ensurePanelCut(scene);
      this.root.add([shadow, scene.add.rectangle(S.image.x, S.image.y, S.image.w, S.image.h, 0x000000).setOrigin(0), this.picture, scene.add.image(0, 0, PANEL_CUT).setOrigin(0).setFlipX(true).setDisplaySize(S.w, H)]);
    }
    else
      this.root.add([
        scene.add.rectangle(0, 0, S.w, H, F.fill, F.fillAlpha).setOrigin(0),
        shadow,
        scene.add.rectangle(F.strokeWidth / 2, 0, F.strokeWidth, H, F.stroke).setOrigin(0.5, 0),
        this.picture,
      ]);
  }

  /** Открыт и про какую точку. */
  get openFor(): PoiId | null {
    return this.shown ? this.poi : null;
  }

  /** Точка экрана над панелью — карта её не получает. */
  covers(x: number): boolean {
    return this.shown && x >= W - S.w;
  }

  /** Показать меню точки id: картинка (или фрагмент карты), название, описание, пометка note (если есть), кнопки действий. */
  open(id: PoiId, actions: PlaceAction[], map: MapSource, onClose: () => void, note?: string): void {
    this.body?.destroy();
    this.picture.removeAll(true);
    this.poi = id;
    const scene = this.scene;
    const b = scene.add.container(0, 0);
    this.body = b;
    const I = S.image;

    // Картинка места: есть арт — он, нет — увеличенный фрагмент карты вокруг точки (та же рамка).
    const art = placeKey(id);
    if (scene.textures.exists(art)) {
      const img = scene.add.image(I.x + I.w / 2, I.y + I.h / 2, art);
      img.setScale(Math.max(I.w / img.width, I.h / img.height));
      img.setCrop((img.width - I.w / img.scaleX) / 2, (img.height - I.h / img.scaleY) / 2, I.w / img.scaleX, I.h / img.scaleY);
      this.picture.add(img);
    } else this.picture.add(this.mapCrop(id, map));
    // Рамка картинки — на подложке; без подложки — тонкая кайма кодом.
    if (!scene.textures.exists(S.panel.key)) b.add(scene.add.rectangle(I.x, I.y, I.w, I.h).setOrigin(0).setStrokeStyle(2, FEEL.sidebar.stroke, 0.9));

    // Название и описание.
    let y = I.y + I.h + S.pad;
    const T = S.text;
    const name = addText(scene, T.x, y, POIS[id].name, S.nameSize, C.accent).setShadow(0, 0, 'rgba(224,182,90,0.5)', 8, false, true);
    b.add(name);
    y += name.height + S.gap;
    const text = addText(scene, T.x, y, PLACE_TEXT[id], S.textSize, C.text, { wordWrap: { width: T.w }, lineSpacing: S.lineSpacing });
    b.add(text);
    y += text.height + S.gap;
    // Пометка: своя (свечи догорели, комнаты…) или, если своих действий нет (только «Уйти»), скромное «нечего делать».
    const noteText = note ?? (actions.length <= 1 ? 'Здесь пока нечего делать.' : null);
    if (noteText) {
      const n = addText(scene, T.x, y, noteText, S.textSize - 2, C.dim, { fontStyle: 'italic', wordWrap: { width: T.w }, lineSpacing: S.lineSpacing });
      b.add(n);
      y += n.height + S.gap;
    }
    // Кнопки действий друг под другом во всю ширину, сразу под текстом.
    y += S.gap;
    for (const a of actions) {
      b.add(new Button(scene, T.x + T.w / 2, y + S.buttonH / 2, T.w, S.buttonH, a.label, a.run, 24).setEnabled(a.enabled !== false));
      y += S.buttonH + S.buttonGap;
    }
    // Крестик в правом верхнем углу картинки.
    const x = addText(scene, S.close.x, S.close.y, '✕', 30, C.text, { stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    x.on('pointerover', () => x.setColor(C.accent));
    x.on('pointerout', () => x.setColor(C.text));
    x.on('pointerdown', (p: Phaser.Input.Pointer) => p.button === 0 && onClose());
    b.add(x);
    this.root.add(b);

    // Выезд справа.
    if (!this.shown) {
      this.shown = true;
      this.root.setVisible(true);
      scene.tweens.killTweensOf(this.root);
      scene.tweens.add({ targets: this.root, x: W - S.w, duration: FEEL.sidebar.slideMs, ease: 'Cubic.easeOut' });
    }
  }

  /** Уехать вправо. */
  close(): void {
    if (!this.shown) return;
    this.shown = false;
    this.scene.tweens.killTweensOf(this.root);
    this.scene.tweens.add({
      targets: this.root,
      x: W + FEEL.sidebar.shadowW,
      duration: FEEL.sidebar.slideMs,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        if (!this.shown) this.root.setVisible(false);
      },
    });
  }

  /** Заглушка картинки: фрагмент подложки вокруг точки, увеличенный в FEEL.sidebar.placeZoom раз от карты на экране. */
  private mapCrop(id: PoiId, map: MapSource): Phaser.GameObjects.Image {
    const I = S.image;
    const img = this.scene.add.image(0, 0, map.key, '__BASE').setOrigin(0);
    const s = map.scale * FEEL.sidebar.placeZoom; // px экрана на px подложки
    const cw = Math.min(I.w / s, img.width);
    const ch = Math.min(I.h / s, img.height);
    const p = POIS[id];
    const cx = Phaser.Math.Clamp(p.x - cw / 2, 0, img.width - cw);
    const cy = Phaser.Math.Clamp(p.y - ch * 0.6, 0, img.height - ch); // точка чуть ниже центра — здание над ней видно
    const k = Math.max(I.w / cw, I.h / ch);
    img.setScale(k).setCrop(cx, cy, cw, ch).setPosition(I.x - cx * k, I.y - cy * k);
    return img;
  }
}

/** Подложка с чёрным проёмом, вырезанным в прозрачность (только почти чёрные пиксели внутри проёма — уголки рамки остаются). */
function ensurePanelCut(scene: Phaser.Scene): void {
  if (scene.textures.exists(PANEL_CUT)) return;
  const src = scene.textures.get(S.panel.key).getSourceImage() as HTMLImageElement;
  const t = scene.textures.createCanvas(PANEL_CUT, src.width, src.height)!;
  const c = t.getContext();
  c.drawImage(src, 0, 0);
  const h = S.panel.hole;
  const data = c.getImageData(h.x, h.y, h.w, h.h);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) < 14) d[i + 3] = 0;
  c.putImageData(data, h.x, h.y);
  t.refresh();
}

/** Тень панели: горизонтальный градиент из чёрного в прозрачный — один раз на игру. */
function ensureShadow(scene: Phaser.Scene): void {
  if (scene.textures.exists(SHADOW)) return;
  const t = scene.textures.createCanvas(SHADOW, 64, 4)!;
  const c = t.getContext();
  const g = c.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 4);
  t.refresh();
}
