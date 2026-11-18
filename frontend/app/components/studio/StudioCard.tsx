// app/components/studio/StudioCard.tsx
// Suprafața comună a panoului de control din Studio: număr de pas, titlu, indiciu opțional și conținut.
// `collapsible`: antetul devine buton de dezvăluire (aria-expanded); `aside` rămâne vizibil ca rezumat când e închis.
"use client";

import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { getSkin } from '@/app/lib/theme/skin';

interface StudioCardProps {
  isDark: boolean;
  /** Numărul pasului („01”…); omis pentru secțiunile secundare. */
  step?: string;
  title: string;
  hint?: React.ReactNode;
  /** Element afișat în dreapta titlului (contor, acțiune). */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Card pliabil: `open` + `onToggle` sunt controlate de părinte. */
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}

export function StudioCard({ isDark, step, title, hint, aside, children, className = '', collapsible = false, open = true, onToggle }: StudioCardProps) {
  const sk = getSkin(isDark);
  const bodyId = useId();
  const expanded = !collapsible || open;
  const heading = (
    <h2 className={`flex items-center gap-2 text-[15px] font-semibold tracking-tight ${sk.strong}`}>
      {step && (
        <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-mono text-[10px] ${isDark ? 'bg-[#C94A6A] text-white' : 'bg-[#5C1628] text-white'}`}>
          {step}
        </span>
      )}
      {title}
      {collapsible && <ChevronDown className={`w-4 h-4 shrink-0 transition-transform duration-200 ${sk.muted} ${open ? 'rotate-180' : ''}`} aria-hidden />}
    </h2>
  );
  return (
    // Linia fină se încălzește spre bordo cât timp un control din card are focus (tastatură sau tap)
    <section
      className={`border rounded-xl transition-[border-color] duration-300 ${isDark ? 'focus-within:border-[#C94A6A]/40' : 'focus-within:border-[#5C1628]/25'} ${sk.card} ${className}`}
    >
      <header className={`flex items-start justify-between gap-3 px-5 pt-4 ${expanded ? '' : 'pb-4'}`}>
        <div className="min-w-0">
          {collapsible ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-controls={bodyId}
              className="cursor-pointer touch-manipulation text-left rounded-sm"
            >
              {heading}
            </button>
          ) : heading}
          {hint && expanded && <p className={`mt-1 text-[12px] leading-relaxed ${sk.muted}`}>{hint}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </header>
      {expanded && <div id={bodyId} className="px-5 pb-5 pt-4 space-y-5">{children}</div>}
    </section>
  );
}
