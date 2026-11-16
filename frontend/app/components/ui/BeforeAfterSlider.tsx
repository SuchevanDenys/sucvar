// app/components/ui/BeforeAfterSlider.tsx
"use client";

import React, { useState } from 'react';
import { Maximize2, MoveHorizontal } from 'lucide-react';

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

  const onBeforeLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (w > 0 && h > 0) setRatio({ src: beforeImg, value: w / h });
  };

  return (
    <div
      style={{ aspectRatio: aspect }}
      className={`relative w-full mx-auto rounded-lg overflow-hidden select-none bg-[#F5F5F5] dark:bg-[#141416] border border-[#E5E5E5] dark:border-[#262629] z-10 [&:has(input:focus-visible)]:ring-1 [&:has(input:focus-visible)]:ring-[#111111] dark:[&:has(input:focus-visible)]:ring-white ${className}`}
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
        className="absolute inset-0 w-full h-full object-contain pointer-events-none bg-[#F5F5F5] dark:bg-[#141416]"
      />

      {/* Divider: wrapper is centered on `pos` so line and handle always align */}
      <div
        style={{ left: `${pos}%` }}
        className="absolute inset-y-0 w-9 -translate-x-1/2 pointer-events-none z-20"
      >
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white shadow-[0_0_10px_rgba(0,0,0,0.6)]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white border border-[#111111]/15 text-[#111111] flex items-center justify-center shadow-[0_4px_16px_rgba(0,0,0,0.35)]">
          <MoveHorizontal className="w-4 h-4" />
        </div>
      </div>

      {/* Labels */}
      <span className="absolute top-3 left-3 z-20 bg-white/90 border border-[#E5E5E5] backdrop-blur-sm text-[#111111] text-[10px] font-mono uppercase tracking-[0.18em] px-2.5 py-1 pointer-events-none rounded-full">
        {beforeLabel}
      </span>
      <span className={`absolute top-3 ${onExpand ? 'right-14' : 'right-3'} z-20 bg-[#111111]/90 border border-white/10 backdrop-blur-sm text-white text-[10px] font-mono uppercase tracking-[0.18em] px-2.5 py-1 pointer-events-none rounded-full`}>
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
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Before / after comparison"
        className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-30 touch-manipulation touch-pan-y"
      />

      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          aria-label={expandLabel}
          title={expandLabel}
          className="absolute top-2.5 right-2.5 z-40 w-9 h-9 rounded-full bg-white/90 hover:bg-white text-[#111111] border border-[#E5E5E5] backdrop-blur-sm flex items-center justify-center shadow-sm cursor-pointer transition-colors"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
