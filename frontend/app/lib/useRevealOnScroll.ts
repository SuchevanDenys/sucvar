// app/lib/useRevealOnScroll.ts
// IntersectionObserver „o singură dată”: `revealed` devine true prima dată când elementul intră în viewport
// și nu mai revine la false. SSR-safe: serverul și prima randare client au aceeași stare (false), iar
// comutarea are loc doar în callback-ul observer-ului (sau într-un timeout, fără suport IO) — deci zero
// hydration mismatch și niciun setState sincron în corpul efectului.
// Reduced-motion nu este tratat aici: starea se comută oricum, iar CSS-ul (globals.css) anulează animația.
"use client";

import { useEffect, useRef, useState, type RefObject } from 'react';

export interface RevealOptions {
  /** Fracțiunea vizibilă care declanșează dezvăluirea (implicit 0.12). */
  threshold?: number;
  /** Marja root-ului; implicit puțin înainte de marginea de jos, ca animația să nu înceapă „la limită”. */
  rootMargin?: string;
}

export function useRevealOnScroll<T extends Element = HTMLDivElement>({
  threshold = 0.12,
  rootMargin = '0px 0px -6% 0px',
}: RevealOptions = {}): { ref: RefObject<T | null>; revealed: boolean } {
  const ref = useRef<T | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || revealed) return;
    if (typeof IntersectionObserver === 'undefined') {
      const id = window.setTimeout(() => setRevealed(true), 0);
      return () => window.clearTimeout(id);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRevealed(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [revealed, threshold, rootMargin]);

  return { ref, revealed };
}
