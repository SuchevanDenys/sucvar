// app/lib/studio/detectedItems.ts
// „Inspector obiecte” (Shop the look): obiectele detectate pe o randare (`detectedItems` din /api/generate sau
// /api/detected-items) — validare defensivă (date din API / proiecte salvate), hit-testing și îmbinarea după
// o editare de zonă (obiectele din afara selecției rămân cele ale pasului anterior).

export interface DetectedItem {
  id: string;
  label: string;
  category: 'furniture' | 'lighting' | 'surface' | 'decor' | 'outdoor';
  materialNote: string;
  estimatedPriceRon: number;
  retailerName: string;
  retailerUrl: string;
  /** Poziția în procente din imagine (0..100, originea stânga-sus); raza în procente din lățime. */
  xPercent: number;
  yPercent: number;
  radiusPercent: number;
  /** Obiectul modificat la ultima editare de zonă. */
  edited?: boolean;
}

const CATEGORIES = new Set(['furniture', 'lighting', 'surface', 'decor', 'outdoor']);
/** Doar căutări pe magazinele din România (aceleași ca `RomanianRetail` din API). */
const RETAILER_HOSTS = ['www.ikea.com', 'mobexpert.ro', 'www.dedeman.ro', 'www.leroymerlin.ro', 'www.hornbach.ro'];
const MAX_ITEMS = 8;
/** Distanța minimă între două ținte, în % din imagine (`RoomObjectExtractor.MinGapPercent`). */
const MIN_GAP_PERCENT = 18;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function safeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && RETAILER_HOSTS.includes(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Orice formă invalidă este ignorată; întoarce `undefined` când nu rămâne niciun obiect. */
export function parseDetectedItems(raw: unknown): DetectedItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items: DetectedItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const url = safeUrl(o.retailerUrl);
    const nums = [o.xPercent, o.yPercent, o.radiusPercent, o.estimatedPriceRon].map(Number);
    if (!url || typeof o.label !== 'string' || !o.label.trim() || nums.some((n) => !Number.isFinite(n))) continue;
    items.push({
      id: typeof o.id === 'string' && o.id ? o.id.slice(0, 64) : `item-${items.length + 1}`,
      label: o.label.trim().slice(0, 120),
      category: (typeof o.category === 'string' && CATEGORIES.has(o.category) ? o.category : 'decor') as DetectedItem['category'],
      materialNote: typeof o.materialNote === 'string' ? o.materialNote.slice(0, 200) : '',
      estimatedPriceRon: Math.max(0, Math.round(nums[3])),
      retailerName: typeof o.retailerName === 'string' && o.retailerName ? o.retailerName.slice(0, 40) : new URL(url).hostname,
      retailerUrl: url,
      xPercent: clamp(nums[0], 0, 100),
      yPercent: clamp(nums[1], 0, 100),
      radiusPercent: clamp(nums[2], 2, 25),
      ...(o.edited === true ? { edited: true } : {}),
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return items.length > 0 ? items : undefined;
}

/**
 * Obiectul de sub cursor. `x`, `y` sunt procente din imagine; `aspect` = lățime / înălțime a imaginii afișate
 * (raza e în procente din lățime, deci pe verticală se scalează cu raportul). Câștigă cel mai apropiat centru.
 */
export function hitTest(items: readonly DetectedItem[], x: number, y: number, aspect: number): DetectedItem | null {
  let best: DetectedItem | null = null;
  let bestDist = Infinity;
  for (const item of items) {
    const dx = x - item.xPercent;
    const dy = (y - item.yPercent) / (aspect > 0 ? aspect : 1);
    const dist = Math.hypot(dx, dy);
    if (dist <= item.radiusPercent && dist < bestDist) {
      best = item;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * După o editare de zonă: obiectul editat (din răspuns) înlocuiește obiectele pasului anterior aflate în selecție;
 * restul își păstrează eticheta și linkul (camera generată anterior a rămas neatinsă).
 */
export function mergeRegionalItems(
  previous: readonly DetectedItem[] | undefined,
  next: readonly DetectedItem[] | undefined,
  bounds: { x: number; y: number; width: number; height: number } | null | undefined,
): DetectedItem[] | undefined {
  if (!next || !previous?.length || !bounds) return next ? [...next] : previous ? previous.map((i) => ({ ...i, edited: false })) : undefined;
  const edited = next.filter((i) => i.edited);
  if (edited.length === 0) return [...next];
  const pad = 2;
  const left = bounds.x * 100 - pad, top = bounds.y * 100 - pad;
  const right = (bounds.x + bounds.width) * 100 + pad, bottom = (bounds.y + bounds.height) * 100 + pad;
  const kept = previous
    .filter((i) => !(i.xPercent >= left && i.xPercent <= right && i.yPercent >= top && i.yPercent <= bottom))
    // Aceeași regulă ca în API: niciun punct mai aproape de MIN_GAP_PERCENT de obiectul editat (ținte suprapuse)
    .filter((i) => edited.every((e) => Math.hypot(e.xPercent - i.xPercent, e.yPercent - i.yPercent) >= MIN_GAP_PERCENT))
    .map((i) => ({ ...i, edited: false }));
  return [...edited, ...kept].slice(0, MAX_ITEMS);
}
