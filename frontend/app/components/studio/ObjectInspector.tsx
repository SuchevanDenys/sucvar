// app/components/studio/ObjectInspector.tsx
// „Inspector obiecte” (Shop the look): strat peste randare (comparatorul înainte / după) sau peste imaginea de lucru.
// Pe fiecare obiect detectat stă o țintă discretă (inel de sticlă + punct); cardul translucid e ancorat la țintă
// (sub ea, sau deasupra dacă nu încape, mereu la 12 px în interiorul canvasului) cu denumirea, materialul, prețul
// estimativ în lei și butonul spre un magazin din România.
//
// Modelul de interacțiune (calm, determinist):
//   • Hover pe o țintă = previzualizare. Activarea / schimbarea cere o pauză de 140 ms pe țintă, deci o trecere
//     rapidă a cursorului peste cameră nu deschide și nu comută carduri.
//   • Clic / atingere pe țintă = obiectul se FIXEAZĂ (`pinned`): alte ținte nu mai schimbă cardul, ținta fixată
//     primește inelul bordo, celelalte se estompează. Se deblochează din ×, cu un nou clic pe aceeași țintă, cu un
//     clic pe fundalul imaginii sau cu Escape.
//   • Coridor sigur (nefixat): învelitoarea convexă dintre țintă și card (+24 px). Cât cursorul e în coridor, nicio
//     altă țintă nu preia cardul și cardul nu se închide — drumul spre „Vezi produs similar” e protejat.
//   • Doar țintele vizibile (28 px) reacționează; zonele goale ale imaginii nu deschid nimic.
//
// Conflictul cu comparatorul: slider-ul este un <input type="range"> invizibil peste toată imaginea, deci orice
// apăsare pe el mută separatorul. Țintele și cardul stau DEASUPRA lui (z-index) și opresc propagarea la
// pointerdown / click — atingerea unui punct sau a cardului nu mai trage niciodată separatorul.
"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Lock, X } from 'lucide-react';
import type { DetectedItem } from '@/app/lib/studio/detectedItems';
import type { Language } from '@/app/types';
import { tr } from '@/app/lib/i18n';

interface ObjectInspectorProps {
  lang: Language;
  isDark: boolean;
  /** Imaginea afișată (pentru raportul real al conținutului `object-contain`). */
  imageSrc: string;
  items: readonly DetectedItem[];
  enabled: boolean;
  children: React.ReactNode;
}

interface Box { left: number; top: number; width: number; height: number }
interface Layout { box: Box; w: number; h: number }
interface Point { x: number; y: number }
/** Obiectul activ; `list` leagă selecția de lista de obiecte curentă (alt pas din istoric = selecție anulată). */
interface Selection { id: string; pinned: boolean; list: readonly DetectedItem[] }

const CARD_W = 288;
/** Marginea minimă a cardului față de marginile canvasului. */
const EDGE = 12;
/** Distanța dintre țintă (raza vizibilă ≈ 11 px) și card. */
const GAP = 16;
const PIN_RADIUS = 11;
/** Extinderea cardului în coridorul sigur. */
const CORRIDOR_PAD = 24;
/** Pauza de intenție înainte de a deschide / comuta un card nefixat. */
const SWITCH_DWELL_MS = 140;
/** Grația înainte de închiderea unui card nefixat când cursorul iese din țintă și din coridor. */
const HIDE_DELAY_MS = 320;
const CARD_H_ESTIMATE = 200;

const ronFormat = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0, useGrouping: true });
const formatLei = (v: number) => `${ronFormat.format(v)} lei`;
/** „IKEA România” → „IKEA” (CTA scurt); celelalte nume rămân. */
const shortRetailer = (name: string) => name.replace(/\s+Rom[aâ]nia$/i, '');
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

/** Zona ocupată de imaginea `object-contain` în cadrul ei (coordonate relative la container). */
function containBox(frame: Box, natural: { w: number; h: number } | null): Box {
  if (!natural || natural.w <= 0 || natural.h <= 0) return frame;
  const scale = Math.min(frame.width / natural.w, frame.height / natural.h);
  const width = natural.w * scale;
  const height = natural.h * scale;
  return { left: frame.left + (frame.width - width) / 2, top: frame.top + (frame.height - height) / 2, width, height };
}

const sameLayout = (a: Layout | null, b: Layout) =>
  a !== null && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5 &&
  Math.abs(a.box.left - b.box.left) < 0.5 && Math.abs(a.box.top - b.box.top) < 0.5 &&
  Math.abs(a.box.width - b.box.width) < 0.5 && Math.abs(a.box.height - b.box.height) < 0.5;

/** Învelitoarea convexă (lanț monoton), în sens trigonometric. */
function convexHull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function insideConvex(poly: Point[], q: Point): boolean {
  if (poly.length < 3) return false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x) < 0) return false;
  }
  return true;
}

/** Oprește evenimentul înainte să ajungă la comparator / la ascultătorii containerului. */
const shield = (e: React.SyntheticEvent) => e.stopPropagation();

export default function ObjectInspector({ lang, isDark, imageSrc, items, enabled, children }: ObjectInspectorProps) {
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef(0);
  const switchTimer = useRef(0);
  const switchTarget = useRef<string | null>(null);
  /** Ținta aflată acum sub cursor (mouse / creion). */
  const overPin = useRef<string | null>(null);
  const inCorridor = useRef(false);
  const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [cardH, setCardH] = useState(CARD_H_ESTIMATE);
  const [rawSel, setSel] = useState<Selection | null>(null);

  const sel = rawSel && rawSel.list === items ? rawSel : null;
  const activeItem = sel ? items.find((i) => i.id === sel.id) ?? null : null;
  const pinned = Boolean(sel?.pinned && activeItem);
  const active = enabled && items.length > 0;
  const box = layout?.box ?? null;

  // Mărimea naturală a imaginii (poate diferi ușor de raportul cadrului → benzi laterale)
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setNatural({ src: imageSrc, w: img.naturalWidth, h: img.naturalHeight }); };
    img.src = imageSrc;
    return () => { alive = false; };
  }, [imageSrc]);

  const clearTimers = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    window.clearTimeout(switchTimer.current);
    hideTimer.current = 0;
    switchTimer.current = 0;
    switchTarget.current = null;
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  /** Cadrul imaginii (primul copil), zona efectivă a conținutului și mărimea containerului. */
  const measure = useCallback((): Layout | null => {
    const wrap = wrapRef.current;
    const frame = wrap?.firstElementChild as HTMLElement | null;
    if (!wrap || !frame) return null;
    const w = wrap.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const nat = natural?.src === imageSrc ? natural : null;
    return {
      box: containBox({ left: f.left - w.left, top: f.top - w.top, width: f.width, height: f.height }, nat),
      w: wrap.clientWidth,
      h: wrap.clientHeight,
    };
  }, [natural, imageSrc]);

  // Țintele sunt vizibile și fără hover (ecrane tactile): zona conținutului se măsoară la montare și la redimensionare
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!enabled || !wrap) return;
    const update = () => {
      const next = measure();
      if (next && next.box.width > 0) setLayout((prev) => (sameLayout(prev, next) ? prev : next));
    };
    const raf = requestAnimationFrame(update);
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [enabled, measure]);

  // Înălțimea reală a cardului (pentru plasarea deasupra / dedesubt și pentru limitarea în canvas)
  const cardId = active ? activeItem?.id : undefined;
  const cardShown = cardId !== undefined && layout !== null;
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCardH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [cardId, cardShown]);

  const close = useCallback(() => {
    clearTimers();
    inCorridor.current = false;
    setSel(null);
  }, [clearTimers]);

  // Escape închide / deblochează cardul
  useEffect(() => {
    if (!active || !cardId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, cardId, close]);

  const cancelHide = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = 0;
  };
  const scheduleHide = () => {
    if (hideTimer.current || pinned) return;
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = 0;
      setSel((s) => (s?.pinned ? s : null));
    }, HIDE_DELAY_MS);
  };
  const cancelSwitch = () => {
    window.clearTimeout(switchTimer.current);
    switchTimer.current = 0;
    switchTarget.current = null;
  };

  /** Deschide / comută cardul nefixat după pauza de intenție, doar dacă cursorul stă încă pe aceeași țintă. */
  const requestPreview = (id: string) => {
    if (pinned) return;
    cancelHide();
    if (activeItem?.id === id) { cancelSwitch(); return; }
    if (activeItem && inCorridor.current) return; // drumul spre card / link: alte ținte nu preiau cardul
    if (switchTarget.current === id) return;
    cancelSwitch();
    switchTarget.current = id;
    switchTimer.current = window.setTimeout(() => {
      switchTimer.current = 0;
      switchTarget.current = null;
      if (overPin.current !== id) return;
      setSel((s) => (s?.pinned && s.list === items ? s : { id, pinned: false, list: items }));
    }, SWITCH_DWELL_MS);
  };

  /** Centrul țintei active în coordonate de ecran. */
  const pinClientPoint = (item: DetectedItem): Point | null => {
    const wrap = wrapRef.current;
    if (!wrap || !box) return null;
    const w = wrap.getBoundingClientRect();
    return { x: w.left + box.left + (item.xPercent / 100) * box.width, y: w.top + box.top + (item.yPercent / 100) * box.height };
  };

  /** Coridorul sigur: învelitoarea convexă dintre țintă și cardul extins cu 24 px. */
  const insideCorridor = (q: Point): boolean => {
    const card = cardRef.current?.getBoundingClientRect();
    const pin = activeItem ? pinClientPoint(activeItem) : null;
    if (!card || !pin) return false;
    const l = card.left - CORRIDOR_PAD, r = card.right + CORRIDOR_PAD, tp = card.top - CORRIDOR_PAD, b = card.bottom + CORRIDOR_PAD;
    if (q.x >= l && q.x <= r && q.y >= tp && q.y <= b) return true;
    return insideConvex(convexHull([pin, { x: l, y: tp }, { x: r, y: tp }, { x: r, y: b }, { x: l, y: b }]), q);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const next = measure();
    if (next && next.box.width > 0 && !sameLayout(layout, next)) setLayout(next);
    if (pinned || !activeItem) {
      inCorridor.current = false;
      return;
    }
    inCorridor.current = insideCorridor({ x: e.clientX, y: e.clientY });
    const over = overPin.current;
    if (over === activeItem.id || inCorridor.current) {
      cancelHide();
      if (inCorridor.current && over !== switchTarget.current) cancelSwitch();
      return;
    }
    if (over) requestPreview(over); // a ieșit din coridor, dar stă pe altă țintă
    else scheduleHide();
  };

  const onPointerLeave = () => {
    overPin.current = null;
    inCorridor.current = false;
    cancelSwitch();
    scheduleHide();
  };

  // Clic / atingere pe fundal (țintele și cardul opresc propagarea): deblochează și închide
  const onPointerDown = () => {
    if (sel) close();
  };

  const onPinEnter = (item: DetectedItem, e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    overPin.current = item.id;
    requestPreview(item.id);
  };
  const onPinLeave = (item: DetectedItem) => {
    if (overPin.current === item.id) overPin.current = null;
    if (switchTarget.current === item.id) cancelSwitch();
  };

  /** Clic / atingere pe țintă: fixează obiectul; un nou clic pe ținta fixată o deblochează și închide cardul. */
  const togglePin = (item: DetectedItem) => {
    clearTimers();
    if (pinned && activeItem?.id === item.id) {
      close();
      return;
    }
    setSel({ id: item.id, pinned: true, list: items });
  };

  // ── Plasarea cardului: ancorat la țintă, dedesubt sau deasupra, limitat la 12 px în canvas ──
  let cardPos: { left: number; top: number; width: number } | null = null;
  if (activeItem && layout && box) {
    const ax = box.left + (activeItem.xPercent / 100) * box.width;
    const ay = box.top + (activeItem.yPercent / 100) * box.height;
    const width = Math.min(CARD_W, Math.max(0, layout.w - EDGE * 2));
    const left = clamp(ax - width / 2, EDGE, layout.w - width - EDGE);
    const below = ay + PIN_RADIUS + GAP;
    const above = ay - PIN_RADIUS - GAP - cardH;
    const top = below + cardH <= layout.h - EDGE || above < EDGE ? below : above;
    cardPos = { left, top: clamp(top, EDGE, layout.h - cardH - EDGE), width };
  }

  const categoryLabel: Record<DetectedItem['category'], string> = {
    furniture: t('Mobilier', 'Furniture', 'Mobilier'),
    lighting: t('Iluminat', 'Lighting', 'Éclairage'),
    surface: t('Finisaj', 'Finish', 'Finition'),
    decor: t('Decor', 'Decor', 'Décor'),
    outdoor: t('Exterior', 'Outdoor', 'Extérieur'),
  };
  const editedBadge = t('Modificat', 'Edited', 'Modifié');
  const bordeaux = isDark ? '#C94A6A' : '#5C1628';

  return (
    <div
      ref={wrapRef}
      className="relative w-full"
      onPointerMove={active ? onPointerMove : undefined}
      onPointerLeave={active ? onPointerLeave : undefined}
      onPointerDown={active ? onPointerDown : undefined}
    >
      {children}

      {active && box && (
        <div
          className="pointer-events-none absolute z-[35]"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        >
          {items.map((item) => {
            const on = activeItem?.id === item.id;
            const locked = on && pinned;
            const dimmed = pinned && !on;
            return (
              <button
                key={item.id}
                type="button"
                aria-label={`${item.label} — ≈ ${formatLei(item.estimatedPriceRon)}`}
                aria-expanded={on}
                aria-pressed={locked}
                onPointerEnter={(e) => onPinEnter(item, e)}
                onPointerLeave={() => onPinLeave(item)}
                onPointerDown={shield}
                onPointerUp={shield}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePin(item);
                }}
                className={`group pointer-events-auto absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full cursor-pointer touch-manipulation outline-none transition-opacity duration-300 focus-visible:ring-2 focus-visible:ring-[#E9DCCB] ${
                  dimmed ? 'opacity-45 hover:opacity-80' : 'opacity-100'
                } ${on ? 'z-10' : ''}`}
                style={{ left: `${item.xPercent}%`, top: `${item.yPercent}%` }}
              >
                {/* Undă discretă: hover / previzualizare (nu pe ținta fixată — aceea stă liniștită) */}
                {!locked && (
                  <span
                    aria-hidden
                    className={`absolute inset-[3px] rounded-full ring-1 ring-[#E9DCCB]/80 motion-reduce:hidden ${
                      on ? 'pin-ripple' : 'opacity-0 group-hover:opacity-100 group-hover:[animation:pin-ripple_1.4s_cubic-bezier(.2,.7,.2,1)_infinite]'
                    }`}
                  />
                )}
                {/* Inel de sticlă + punct central; fixat = inel bordo ferm + ușor mărit */}
                <span
                  aria-hidden
                  className={`relative flex h-[22px] w-[22px] items-center justify-center rounded-full backdrop-blur-[3px] shadow-[0_2px_10px_rgba(17,13,15,0.35)] transition-[transform,box-shadow,background-color] duration-200 ${
                    locked
                      ? `scale-[1.18] bg-white/90 ring-2 ${isDark ? 'ring-[#C94A6A]' : 'ring-[#5C1628]'}`
                      : `bg-white/15 ring-1 group-hover:scale-110 ${on ? 'scale-110 ring-[#E9DCCB]' : item.edited ? 'ring-[#C9A27A]' : 'ring-white/70'}`
                  }`}
                >
                  <span
                    className="h-[7px] w-[7px] rounded-full transition-colors duration-200"
                    style={{ backgroundColor: on ? bordeaux : '#C9A27A', boxShadow: locked ? 'none' : '0 0 0 1.5px rgba(250,248,246,0.92)' }}
                  />
                </span>
                {item.edited && (
                  <span aria-hidden className="absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#A67C52] px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.12em] text-white shadow-[0_2px_6px_rgba(17,13,15,0.35)]">
                    {editedBadge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {active && activeItem && cardPos && (
        <div
          key={activeItem.id}
          ref={cardRef}
          role="dialog"
          aria-label={activeItem.label}
          onPointerEnter={cancelHide}
          onPointerDown={shield}
          onPointerUp={shield}
          onClick={shield}
          style={{ left: cardPos.left, top: cardPos.top, width: cardPos.width }}
          className={`inspector-card absolute z-50 rounded-2xl border p-4 backdrop-blur-md backdrop-saturate-150 ${
            isDark
              ? 'bg-[#1A1416]/95 border-[#2E2427] text-[#F7F3F4] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_2px_6px_-2px_rgba(0,0,0,0.55),0_28px_56px_-24px_rgba(0,0,0,0.9)]'
              : 'bg-white/95 border-[#E8E2E0] text-[#1B1416] shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_2px_6px_-2px_rgba(27,20,22,0.10),0_28px_56px_-24px_rgba(92,22,40,0.38)]'
          }`}
        >
          {/* Antet: categorie · Modificat · stare fixată · închidere */}
          <div className="flex items-center gap-1.5">
            <span className={`rounded-full border px-2 py-[2px] text-[10px] font-medium uppercase tracking-[0.14em] ${
              isDark ? 'border-[#2E2427] bg-[#231B1E] text-[#B5A9AC]' : 'border-[#E8E2E0] bg-[#FAF8F6] text-[#685D60]'
            }`}>
              {categoryLabel[activeItem.category]}
            </span>
            {activeItem.edited && (
              <span className={`rounded-full border px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.12em] ${
                isDark ? 'border-[#A67C52]/45 bg-[#A67C52]/[0.14] text-[#D2AE87]' : 'border-[#A67C52]/40 bg-[#A67C52]/[0.08] text-[#7D5A35]'
              }`}>
                {editedBadge}
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              {pinned && (
                <span className={`inline-flex items-center gap-1 text-[10.5px] font-medium ${isDark ? 'text-[#D65D7B]' : 'text-[#5C1628]'}`}>
                  <Lock className="h-3 w-3" aria-hidden />
                  {t('Fixat', 'Pinned', 'Épinglé')}
                </span>
              )}
              <button
                type="button"
                onClick={close}
                aria-label={t('Închide', 'Close', 'Fermer')}
                className={`-mr-1.5 flex h-7 w-7 items-center justify-center rounded-full cursor-pointer touch-manipulation transition-colors ${
                  isDark ? 'text-[#B5A9AC] hover:bg-white/[0.06] hover:text-[#F7F3F4]' : 'text-[#685D60] hover:bg-[#F5F2EF] hover:text-[#1B1416]'
                }`}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          </div>

          <p className="mt-2 text-[15px] font-semibold leading-snug tracking-tight">{activeItem.label}</p>
          {activeItem.materialNote && (
            <p className={`mt-1 text-[12px] leading-relaxed ${isDark ? 'text-[#B5A9AC]' : 'text-[#685D60]'}`}>{activeItem.materialNote}</p>
          )}

          <div className={`mt-3 flex items-baseline justify-between border-t pt-3 ${isDark ? 'border-[#2E2427]' : 'border-[#E8E2E0]'}`}>
            <span className={`text-[11px] ${isDark ? 'text-[#B5A9AC]' : 'text-[#685D60]'}`}>{t('Preț estimativ', 'Estimated price', 'Prix estimé')}</span>
            <span className={`text-[17px] font-semibold tabular-nums tracking-tight ${isDark ? 'text-[#D2AE87]' : 'text-[#7D5A35]'}`}>
              ≈ {formatLei(activeItem.estimatedPriceRon)}
            </span>
          </div>

          <a
            href={activeItem.retailerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold text-white touch-manipulation transition-[background-color,transform] duration-150 active:scale-[0.98] ${
              isDark ? 'bg-[#C94A6A] hover:bg-[#D65D7B]' : 'bg-[#5C1628] hover:bg-[#450E1D]'
            }`}
          >
            {t(
              `Vezi produs similar pe ${shortRetailer(activeItem.retailerName)}`,
              `View a similar product at ${shortRetailer(activeItem.retailerName)}`,
              `Voir un produit similaire chez ${shortRetailer(activeItem.retailerName)}`,
            )}
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </a>

          {!pinned && (
            <p className={`mt-2 text-center text-[11px] ${isDark ? 'text-[#8E8286]' : 'text-[#8A7F82]'}`}>
              {t('Click pe punct pentru a fixa', 'Click the dot to pin', 'Cliquez sur le point pour épingler')}
            </p>
          )}
        </div>
      )}

      {/* Accesibilitate: aceleași obiecte ca listă de linkuri pentru cititoare de ecran */}
      {active && (
        <ul className="sr-only">
          {items.map((item) => (
            <li key={item.id}>
              <a href={item.retailerUrl} target="_blank" rel="noopener noreferrer">
                {item.label}{item.edited ? ` (${editedBadge})` : ''} — ≈ {formatLei(item.estimatedPriceRon)} — {item.retailerName}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
