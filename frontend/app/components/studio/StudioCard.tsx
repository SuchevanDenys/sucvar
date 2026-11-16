// app/components/studio/StudioCard.tsx
// Suprafața comună a panoului de control din Studio: număr de pas, titlu, indiciu opțional și conținut.
"use client";

import React from 'react';
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
}

export function StudioCard({ isDark, step, title, hint, aside, children, className = '' }: StudioCardProps) {
  const sk = getSkin(isDark);
  return (
    <section className={`border rounded-xl ${sk.card} ${className}`}>
      <header className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h2 className={`flex items-center gap-2 text-[15px] font-semibold tracking-tight ${sk.strong}`}>
            {step && (
              <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-mono text-[10px] ${isDark ? 'bg-[#C94A6A] text-white' : 'bg-[#5C1628] text-white'}`}>
                {step}
              </span>
            )}
            {title}
          </h2>
          {hint && <p className={`mt-1 text-[12px] leading-relaxed ${sk.muted}`}>{hint}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </header>
      <div className="px-5 pb-5 pt-4 space-y-5">{children}</div>
    </section>
  );
}
