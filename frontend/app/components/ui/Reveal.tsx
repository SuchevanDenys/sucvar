// app/components/ui/Reveal.tsx
// Scroll-reveal wrapper bazat pe `useRevealOnScroll`. Serverul și prima randare client sunt identice (stare
// ascunsă); `data-revealed` apare doar după intersecție, deci fără hydration mismatch. Stilurile (fade-up 14px,
// stagger 70 ms, reduced-motion) sunt în globals.css: `.reveal`, `.reveal-group`, `.reveal-item`.
//
//   <Reveal delay={100}>…</Reveal>                 → blocul întreg apare (fade-up)
//   <Reveal stagger> … <li {...revealItem(i)}> …   → doar copiii marcați apar, decalat cu i × 70 ms
"use client";

import React from 'react';
import { useRevealOnScroll } from '@/app/lib/useRevealOnScroll';

/** Pas de decalaj între elementele unei grile (sincronizat cu `--reveal-step` din globals.css). */
export const REVEAL_STEP_MS = 70;

/**
 * Props pentru un element decalat dintr-un `<Reveal stagger>`. Puneți-l pe un *wrapper* (ex. `<li>`), nu pe
 * cardul cu efecte de hover: tranziția de dezvăluire ar suprascrie tranzițiile proprii ale cardului.
 */
export function revealItem(index: number, className = ''): { className: string; style: React.CSSProperties } {
  return {
    className: className ? `reveal-item ${className}` : 'reveal-item',
    style: { '--reveal-i': index } as React.CSSProperties,
  };
}

export default function Reveal({
  children,
  className = '',
  delay = 0,
  stagger = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Întârziere de bază în ms (se adaugă și decalajului elementelor în modul `stagger`). */
  delay?: number;
  /** true = wrapper-ul nu se animă; animă doar descendenții `revealItem(i)`, decalat. */
  stagger?: boolean;
}) {
  const { ref, revealed } = useRevealOnScroll<HTMLDivElement>();

  return (
    <div
      ref={ref}
      data-revealed={revealed ? '' : undefined}
      style={delay ? ({ '--reveal-delay': `${delay}ms` } as React.CSSProperties) : undefined}
      className={`${stagger ? 'reveal-group' : 'reveal'} ${className}`}
    >
      {children}
    </div>
  );
}
