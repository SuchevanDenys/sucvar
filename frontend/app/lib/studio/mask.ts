// app/lib/studio/mask.ts — „Editează o zonă” (inpainting): trasee de pensulă în coordonatele IMAGINII (independente
// de afișare / zoom / redimensionarea ferestrei), randarea lor pe canvas, exportul măștii binare PNG
// (alb #FFFFFF = zona de modificat, negru #000000 = zona protejată) la rezoluția exactă a fotografiei normalizate
// și metadatele selecției (bounding box 0..1 + poziție lizibilă), oglinda lui SelectionRegion.Describe din API.

export type MaskTool = 'brush' | 'eraser';

export interface MaskPoint { x: number; y: number }

/** Un traseu: unealta, grosimea în pixeli de imagine și punctele (pixeli de imagine). */
export interface MaskStroke {
  tool: MaskTool;
  size: number;
  points: MaskPoint[];
}

export interface SelectionBounds { x: number; y: number; width: number; height: number }

export interface ExportedMask {
  /** PNG binar, exact `width × height` ale fotografiei sursă. */
  dataUrl: string;
  bounds: SelectionBounds;
  /** Fracțiunea (0..1) din cadru selectată. */
  coverage: number;
  position: string;
}

export const BRUSH_MIN = 12, BRUSH_MAX = 96, BRUSH_DEFAULT = 40;
/** Evidențierea selecției: bordo arhitectural translucid (opacitatea se aplică stratului întreg, fără suprapuneri mai închise). */
export const MASK_TINT = '#5C1628';
export const MASK_OPACITY = 0.42;

export const hasSelection = (strokes: MaskStroke[]) => strokes.some((s) => s.tool === 'brush' && s.points.length > 0);

/**
 * Desenează traseele pe un context deja scalat la coordonatele imaginii. Pensula pictează `paint`; radiera
 * folosește `erase`: 'clear' = destination-out (overlay transparent), altfel o culoare (export: negru).
 */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: MaskStroke[], paint: string, erase: 'clear' | string) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (s.points.length === 0) continue;
    const clear = s.tool === 'eraser' && erase === 'clear';
    ctx.globalCompositeOperation = clear ? 'destination-out' : 'source-over';
    const color = s.tool === 'brush' ? paint : clear ? '#000' : erase;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = s.size;
    const pts = s.points;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, s.size / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    // Curbe pătratice prin mijlocul segmentelor: trasee netede chiar și la mișcări rapide
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** Poziția lizibilă a unei selecții (identică cu SelectionRegion.Describe din API). */
export function describeSelection(b: SelectionBounds): string {
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  if (b.width >= 0.85 && b.height >= 0.85) return 'most of the frame';
  if (b.width >= 0.55 && b.y + b.height >= 0.92 && cy >= 0.6) return 'lower floor area';
  if (b.width >= 0.55 && b.y <= 0.08 && cy <= 0.35) return 'upper ceiling area';
  const h = cx < 0.36 ? 'left' : cx > 0.64 ? 'right' : 'center';
  if (cy > 0.64) return `${h} foreground`;
  if (cy < 0.36) return h === 'center' ? 'upper center' : `upper ${h}`;
  return h === 'center' ? 'center of the frame' : `${h} side`;
}

/** Traducerea poziției pentru interfață. */
export function positionLabel(position: string, t: (ro: string, en: string, fr?: string) => string): string {
  const map: Record<string, [string, string, string]> = {
    'most of the frame': ['aproape tot cadrul', 'most of the frame', 'presque tout le cadre'],
    'lower floor area': ['zona pardoselii', 'floor area', 'zone du sol'],
    'upper ceiling area': ['zona tavanului', 'ceiling area', 'zone du plafond'],
    'left foreground': ['prim-plan, stânga', 'left foreground', 'premier plan, gauche'],
    'center foreground': ['prim-plan, centru', 'center foreground', 'premier plan, centre'],
    'right foreground': ['prim-plan, dreapta', 'right foreground', 'premier plan, droite'],
    'upper left': ['sus, stânga', 'upper left', 'en haut, à gauche'],
    'upper center': ['sus, centru', 'upper center', 'en haut, au centre'],
    'upper right': ['sus, dreapta', 'upper right', 'en haut, à droite'],
    'left side': ['partea stângă', 'left side', 'côté gauche'],
    'center of the frame': ['centrul cadrului', 'center of the frame', 'centre du cadre'],
    'right side': ['partea dreaptă', 'right side', 'côté droit'],
  };
  const m = map[position];
  return m ? t(m[0], m[1], m[2]) : position;
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/**
 * Bounding box aproximativ din trasee (pentru previzualizarea promptului, fără a rasteriza): extinderea
 * pensulei, fără radieră. Exportul calculează valorile exacte din pixeli.
 */
export function strokeBounds(strokes: MaskStroke[], width: number, height: number): SelectionBounds | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    if (s.tool !== 'brush') continue;
    for (const p of s.points) {
      x0 = Math.min(x0, p.x - s.size / 2); y0 = Math.min(y0, p.y - s.size / 2);
      x1 = Math.max(x1, p.x + s.size / 2); y1 = Math.max(y1, p.y + s.size / 2);
    }
  }
  if (!Number.isFinite(x0) || width <= 0 || height <= 0) return null;
  const x = Math.max(0, x0 / width), y = Math.max(0, y0 / height);
  const w = Math.min(1, x1 / width) - x, h = Math.min(1, y1 / height) - y;
  return w > 0 && h > 0 ? { x: round4(x), y: round4(y), width: round4(w), height: round4(h) } : null;
}

/** Dimensiunile naturale ale unei imagini (data URL). */
export function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

/**
 * Masca binară la rezoluția exactă a fotografiei: fundal negru, pensula albă, radiera neagră, apoi prag 50 %
 * (marginile antialiasate devin pur alb / negru). Null dacă selecția e goală după radieră.
 */
export function exportMask(strokes: MaskStroke[], width: number, height: number): ExportedMask | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  drawStrokes(ctx, strokes, '#fff', '#000');

  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  let minX = width, minY = height, maxX = -1, maxY = -1, selected = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const on = px[i] >= 128;
      const v = on ? 255 : 0;
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
      if (!on) continue;
      selected++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (selected === 0) return null;
  ctx.putImageData(image, 0, 0);

  const bounds = {
    x: round4(minX / width), y: round4(minY / height),
    width: round4((maxX - minX + 1) / width), height: round4((maxY - minY + 1) / height),
  };
  return { dataUrl: canvas.toDataURL('image/png'), bounds, coverage: round4(selected / (width * height)), position: describeSelection(bounds) };
}
