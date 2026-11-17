// app/components/studio/VisionSummary.tsx
// Rezumatul brief-ului folosit la randare: descrierea utilizatorului, stilul (ales sau dedus),
// paleta / lumina, structura, suprafața, materialele recunoscute și costul estimat.
"use client";

import { formatLei } from '@/app/lib/format';
import React from 'react';
import { getStyle } from '@/app/data/catalog';
import { EYEBROW, getSkin } from '@/app/lib/theme/skin';
import { LIGHTINGS, PALETTES, type VisionResponse } from '@/app/lib/studio/vision';
import type { Language } from '@/app/types';
import { tr } from '@/app/lib/i18n';

interface VisionSummaryProps {
  lang: Language;
  isDark: boolean;
  vision: VisionResponse;
  costTotal: number;
}

export default function VisionSummary({ lang, isDark, vision, costTotal }: VisionSummaryProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const eyebrow = `${EYEBROW} ${sk.dim}`;
  const chip = `inline-flex items-center h-7 px-2.5 rounded-sm border text-[11px] tabular-nums ${sk.line} ${sk.muted}`;

  const style = vision.styleId ? getStyle(vision.styleId) : null;
  const palette = PALETTES.find((p) => p.id === vision.palette);
  const lighting = LIGHTINGS.find((p) => p.id === vision.lighting);

  return (
    <section className={`border rounded-md ${sk.card}`} aria-label={t('Brief-ul randării', 'Render brief')}>
      <div className={`px-4 h-9 flex items-center justify-between border-b ${sk.line} ${eyebrow}`}>
        <span>{t('Brief-ul tău', 'Your brief')}</span>
        <span className={`tabular-nums ${sk.strong}`}>
          ≈ {formatLei(costTotal, { maximumFractionDigits: 0 })}
        </span>
      </div>
      <div className="p-4 space-y-3">
        {vision.customPrompt ? (
          <blockquote className={`text-sm leading-relaxed border-l-2 pl-3 ${isDark ? 'border-[#C94A6A]' : 'border-[#5C1628]'} ${sk.strong}`}>
            „{vision.customPrompt}”
          </blockquote>
        ) : (
          <p className={`text-xs ${sk.muted}`}>{t('Randare pornind de la stilul ales.', 'Rendered from the selected style.')}</p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {style && (
            <span className={chip}>
              {tr(lang, style.nameRo, style.nameEn)}
              {vision.styleInferred && ` · ${t('dedus', 'inferred')}`}
            </span>
          )}
          {palette && <span className={chip}>{tr(lang, palette.ro, palette.en)}</span>}
          {lighting && <span className={chip}>{tr(lang, lighting.ro, lighting.en)}</span>}
          <span className={chip}>
            {vision.preserveStructure ? t('Structură păstrată', 'Structure kept') : t('Redesign complet', 'Full redesign')}
          </span>
          <span className={chip}>{vision.areaSqm} m²</span>
        </div>

        {vision.materials.length > 0 && (
          <div className="space-y-1.5">
            <p className={eyebrow}>{t('Materiale recunoscute → lista de achiziții', 'Recognised materials → shopping list')}</p>
            <ul className="flex flex-wrap gap-1.5">
              {vision.materials.map((m) => (
                <li key={m.id} className={`inline-flex items-center h-7 px-2.5 rounded-sm text-[11px] ${sk.segOn}`}>
                  {tr(lang, m.titleRo, m.titleEn)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
