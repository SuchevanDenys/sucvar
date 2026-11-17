// app/components/ui/BeforeAfterSlider.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, MoveHorizontal } from 'lucide-react';
import { useRevealOnScroll } from '@/app/lib/useRevealOnScroll';

/** Props of {@link BeforeAfterSlider}. Images may be data URLs, so they are plain `<img>`, not `next/image`. */
interface Props {
  beforeImg: string;
  afterImg: string;
  beforeLabel?: string;
  afterLabel?: string;
  /** When set, shows a "full screen" button in the top-right corner. */
  onExpand?: () => void;
  expandLabel?: string;
  /** Extra classes for the frame (e.g. a different max height). */
  className?: string;
}

/** Ratio used until the "before" image has loaded (most phone photos are 4:3). */
const FALLBACK_RATIO = 4 / 3;

/** One-time "this is draggable" hint: 50 % → 62 % → 40 % → 50 % over 1.4 s, after a short settle pause. */
const HINT_DURATION_MS = 1400;
const HINT_START_DELAY_MS = 500;
/** [position %, time fraction at which it is reached] — each leg weighted by its travel distance. */
const HINT_KEYS: ReadonlyArray<readonly [number, number]> = [[50, 0], [62, 0.3], [40, 0.78], [50, 1]];

const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;

/** Divider position at progress `t` ∈ [0, 1] of the hint sweep (eased per leg, so every turn is soft). */
function hintPosition(t: number): number {
  for (let i = 1; i < HINT_KEYS.length; i++) {
    const [to, end] = HINT_KEYS[i];
    const [from, start] = HINT_KEYS[i - 1];
    if (t <= end) return from + (to - from) * easeInOutSine((t - start) / (end - start));
  }
  return HINT_KEYS[HINT_KEYS.length - 1][0];
}

/**
 * Before/after comparison. The frame takes the natural aspect ratio of the "before" photo, and both images use
 * `object-contain`, so 100 % of each image is visible (no cropping, no distortion); a slightly different ratio of
 * the render is letterboxed on the neutral backdrop. The "before" image is revealed up to the divider with
 * `clip-path` (no layout shift, no canvas). Interaction is delegated to an invisible native `<input type="range">`
 * stretched over the frame, which gives mouse, touch and keyboard (arrow keys) support plus screen-reader semantics
 * for free; the visible divider is purely decorative.
 *
 * Used by the landing hero, the Studio canvas and the public client portal (`/p/[id]`).
 */
export default function BeforeAfterSlider({
  beforeImg,
  afterImg,
  beforeLabel = 'BEFORE',
  afterLabel = 'AFTER',
  onExpand,
  expandLabel = 'Full screen',
  className = 'max-h-[75vh]',
}: Props) {
  // Divider position in % (0 = all "after", 100 = all "before")
  const [pos, setPos] = useState<number>(50);
  // Natural ratio (width / height) of the "before" photo, remembered per image source
  const [ratio, setRatio] = useState<{ src: string; value: number } | null>(null);
  const aspect = ratio?.src === beforeImg ? ratio.value : FALLBACK_RATIO;

  // ---- One-time interactive hint ----
  // Starts the first time ≥ 60 % of the frame is visible, unless the user already touched the slider or prefers
  // reduced motion. Any pointer / touch / key interaction cancels it on the spot (the divider stays where it is,
  // the user takes over). State only changes inside rAF / timeout callbacks, so SSR and hydration are unaffected.
  const { ref: frameRef, revealed } = useRevealOnScroll<HTMLDivElement>({ threshold: 0.6, rootMargin: '0px' });
  const interactedRef = useRef(false);
  const hintRef = useRef<{ timer: number; frame: number }>({ timer: 0, frame: 0 });

  const stopHint = useCallback(() => {
    interactedRef.current = true;
    const h = hintRef.current;
    window.clearTimeout(h.timer);
    cancelAnimationFrame(h.frame);
    h.timer = 0;
    h.frame = 0;
  }, []);

  useEffect(() => {
    if (!revealed || interactedRef.current) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const h = hintRef.current;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / HINT_DURATION_MS);
      setPos(hintPosition(t));
      if (t < 1) {
        h.frame = requestAnimationFrame(tick);
      } else {
        h.frame = 0;
        interactedRef.current = true; // played once: never again for this instance
      }
    };
    h.timer = window.setTimeout(() => {
      h.timer = 0;
      h.frame = requestAnimationFrame(tick);
    }, HINT_START_DELAY_MS);
    return () => {
      window.clearTimeout(h.timer);
      cancelAnimationFrame(h.frame);
      h.timer = 0;
      h.frame = 0;
    };
  }, [revealed]);

  const onBeforeLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (w > 0 && h > 0) setRatio({ src: beforeImg, value: w / h });
  };

  return (
    <div
      ref={frameRef}
      onPointerDownCapture={stopHint}
      onTouchStartCapture={stopHint}
      onKeyDownCapture={stopHint}
      style={{ aspectRatio: aspect }}
      className={`relative w-full mx-auto rounded-lg overflow-hidden select-none bg-[#FAF8F6] dark:bg-[#1A1416] border border-[#E8E2E0] dark:border-[#2E2427] z-10 [&:has(input:focus-visible)]:ring-2 [&:has(input:focus-visible)]:ring-[#5C1628] dark:[&:has(input:focus-visible)]:ring-[#C94A6A] ${className}`}
    >
      {/* Layer 1: "after" image, fully visible */}
      <img
        src={afterImg}
        alt="After"
        draggable={false}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
      />

      {/* Layer 2: "before" image, clipped from the right so it reveals up to `pos` */}
      <img
        src={beforeImg}
        alt="Before"
        draggable={false}
        onLoad={onBeforeLoad}
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none bg-[#F5F2EF] dark:bg-[#1A1416]"
      />

      {/* Divider: wrapper is centered on `pos` so line and handle always align */}
      <div
        style={{ left: `${pos}%` }}
        className="absolute inset-y-0 w-9 -translate-x-1/2 pointer-events-none z-20"
      >
        <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-white/95 shadow-[0_0_12px_rgba(17,13,15,0.55)]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-[#5C1628] dark:bg-[#C94A6A] ring-2 ring-white/95 text-white flex items-center justify-center shadow-[0_6px_20px_-4px_rgba(92,22,40,0.65)]">
          <MoveHorizontal className="w-4 h-4" strokeWidth={2} />
        </div>
      </div>

      {/* Labels */}
      <span className="absolute top-3 left-3 z-20 bg-white/90 border border-[#E8E2E0] backdrop-blur-sm text-[#1B1416] text-[10px] font-mono uppercase tracking-[0.18em] px-2.5 py-1 pointer-events-none rounded-full">
        {beforeLabel}
      </span>
      <span className={`absolute top-3 ${onExpand ? 'right-14' : 'right-3'} z-20 bg-[#5C1628]/90 dark:bg-[#C94A6A]/90 border border-white/15 backdrop-blur-sm text-white text-[10px] font-mono uppercase tracking-[0.18em] px-2.5 py-1 pointer-events-none rounded-full`}>
        {afterLabel}
      </span>

      {/* Invisible native range input handles mouse + touch.
          touch-pan-y lets the page still scroll vertically on iOS. */}
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={pos}
        onChange={(e) => {
          stopHint();
          setPos(Number(e.target.value));
        }}
        aria-label="Before / after comparison"
        className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-30 touch-manipulation touch-pan-y"
      />

      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          aria-label={expandLabel}
          title={expandLabel}
          className="absolute top-2.5 right-2.5 z-40 w-9 h-9 rounded-full bg-white/90 hover:bg-white text-[#1B1416] hover:text-[#5C1628] border border-[#E8E2E0] backdrop-blur-sm flex items-center justify-center shadow-sm cursor-pointer transition-colors"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
