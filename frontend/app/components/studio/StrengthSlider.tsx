// app/components/studio/StrengthSlider.tsx
// „Intensitate transformare” (img2img prompt_strength): glisorul 40–100 % cu banda recomandată 68–75 % marcată.
// Stă în „Setări avansate” — modelele instruction (FLUX Kontext) nu îl folosesc, deci pagina îl ascunde pentru ele.
"use client";

import React, { useId } from 'react';
import { tr } from '@/app/lib/i18n';
import { AI_STRENGTH } from '@/app/lib/studio/aiConfig';
import { getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';

const STRENGTH_MIN = 40, STRENGTH_MAX = 100;
/** Poziția (%) a unei valori pe glisor, pentru banda recomandată */
const pct = (v: number) => ((v - STRENGTH_MIN) / (STRENGTH_MAX - STRENGTH_MIN)) * 100;

interface StrengthSliderProps {
  lang: Language;
  isDark: boolean;
  aiStrength: number;
  onStrengthChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isLoading: boolean;
}

export default function StrengthSlider({ lang, isDark, aiStrength, onStrengthChange, isLoading }: StrengthSliderProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const helpId = useId();
  const inSweetSpot = aiStrength >= AI_STRENGTH.sweetSpot.min && aiStrength <= AI_STRENGTH.sweetSpot.max;

  return (
      <label className="block space-y-2">
        <span className="flex items-center justify-between text-[13px]">
          <span className={`font-medium ${sk.strong}`}>{t('Intensitate transformare', 'Transformation strength')}</span>
          <span className={`font-mono tabular-nums ${sk.strong}`}>
            {aiStrength}%
            {inSweetSpot && <span className={`ml-1.5 text-[11px] font-sans ${sk.muted}`}>· {t('optim', 'optimal', 'optimal')}</span>}
          </span>
        </span>
        <span className="relative block">
          {/* Banda recomandată 68–75 % (structură păstrată, finisaje complet transformate) */}
          <span
            aria-hidden
            className={`pointer-events-none absolute top-1/2 -translate-y-1/2 h-2 rounded-full ${isDark ? 'bg-[#C94A6A]/30' : 'bg-[#5C1628]/15'}`}
            style={{ left: `${pct(AI_STRENGTH.sweetSpot.min)}%`, width: `${pct(AI_STRENGTH.sweetSpot.max) - pct(AI_STRENGTH.sweetSpot.min)}%` }}
          />
          <input
            type="range" min={STRENGTH_MIN} max={STRENGTH_MAX}
            value={aiStrength}
            onChange={onStrengthChange}
            disabled={isLoading}
            aria-describedby={helpId}
            className="relative w-full accent-[var(--foreground)] touch-manipulation touch-pan-y"
          />
        </span>
        <span className={`flex justify-between text-[11px] ${sk.muted}`}>
          <span>{t('Subtil', 'Subtle')}</span>
          <span>{t('Transformare completă', 'Full makeover')}</span>
        </span>
        <span id={helpId} className={`block text-[11px] leading-relaxed ${sk.muted}`}>
          {t(
            `Recomandat ${AI_STRENGTH.sweetSpot.min}–${AI_STRENGTH.sweetSpot.max}%: finisajele, mobilierul și lumina se schimbă complet, iar pereții, ferestrele și unghiul rămân. Cu structura păstrată, AI-ul aplică între ${AI_STRENGTH.preserveRange.min} și ${AI_STRENGTH.preserveRange.max}%.`,
            `Recommended ${AI_STRENGTH.sweetSpot.min}–${AI_STRENGTH.sweetSpot.max}%: finishes, furniture and light change completely while walls, windows and camera angle stay. With structure kept, the AI applies ${AI_STRENGTH.preserveRange.min}–${AI_STRENGTH.preserveRange.max}%.`,
          )}
        </span>
      </label>
  );
}
