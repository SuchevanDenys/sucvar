// app/components/home/StyleGallerySection.tsx
// Landing §05 — galeria de stiluri (4 coloane). Un click memorează stilul preferat și deschide Studio-ul.
"use client";

import { formatLei } from '@/app/lib/format';
import React from 'react';
import Link from 'next/link';
import { SectionHeading } from '@/app/components/ui/Editorial';
import Reveal from '@/app/components/ui/Reveal';
import { VISUAL_STYLES, calculateEngineering, estimateCost } from '@/app/data/catalog';
import { costDeltaLabel } from '@/app/data/styleSpecs';
import { tr } from '@/app/lib/i18n';
import { STORAGE_KEYS, writeStorage } from '@/app/lib/storage';
import { DEFAULT_DIMENSIONS } from '@/app/lib/studio/validation';
import { CONTAINER, getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';
import { ANCHOR_OFFSET, sectionSpacing } from './sectionStyles';

// Cost estimat per m² (afișat în lei) per stil: aceeași formulă ca în Studio (estimateCost) pe camera implicită, buget standard.
// Calculat o singură dată la încărcarea modulului — determinist, deci identic la SSR și la hidratare.
const REF_ROOM_LABEL = `${DEFAULT_DIMENSIONS.width} × ${DEFAULT_DIMENSIONS.length} m`;
const REF_ENGINEERING = calculateEngineering(DEFAULT_DIMENSIONS, 'interiors', 'living room');
const STYLE_PER_SQM: Record<string, string> = Object.fromEntries(
  VISUAL_STYLES.map((style) => [
    style.id,
    formatLei(estimateCost(DEFAULT_DIMENSIONS, 'interiors', 'living room', style.id, REF_ENGINEERING).perSqm, { maximumFractionDigits: 0 }),
  ]),
);

const handleStyleClick = (styleId: string) => {
  writeStorage(STORAGE_KEYS.preferredStyle, styleId);
};

export default function StyleGallerySection({ lang, isDark }: { lang: Language; isDark: boolean }) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const sectionY = sectionSpacing(sk.line);

  return (
    <section className={sectionY}>
      <div id="systems" className={`${CONTAINER} ${ANCHOR_OFFSET}`}>
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHeading
              isDark={isDark}
              index="05"
              eyebrow={t('Stiluri arhitecturale', 'Architectural styles')}
              title={t('Fiecare stil este o poveste,', 'Every style is a story,')}
              titleMuted={t('spusă prin materiale.', 'told through materials.')}
            />
            <p className={`max-w-xs text-xs leading-relaxed ${sk.dim}`}>
              {t(
                `Cost estimat pe m² pentru o cameră de referință de ${REF_ROOM_LABEL}, la buget standard. Alege un stil pentru a-l deschide în Studio.`,
                `Estimated cost per m² for a ${REF_ROOM_LABEL} reference room on a standard budget. Choose a style to open it in Studio.`,
        `Coût estimé au m² pour une pièce de référence de ${REF_ROOM_LABEL}, budget standard. Choisissez un style pour l’ouvrir dans le Studio.`,
              )}
            </p>
          </div>
        </Reveal>
        <Reveal delay={100}>
          <ul className="mt-14 grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {VISUAL_STYLES.map((style, i) => (
              <li key={style.id}>
                <Link
                  href="/generate"
                  onClick={() => handleStyleClick(style.id)}
                  className="group block touch-manipulation"
                  aria-label={`${t(style.nameRo, style.nameEn)} — ${t('deschide în Studio', 'open in Studio')}`}
                >
                  {/* Passe-partout #F5F5F5 cu „tabloul” paletei de materiale centrat */}
                  <div className={`relative aspect-[4/5] p-8 transition-colors duration-500 ${isDark ? 'bg-[#141416] group-hover:bg-[#1C1C1F]' : 'bg-[#F5F5F5] group-hover:bg-[#EDEDED]'}`}>
                    <span className={`absolute left-4 top-4 font-mono text-[10px] tabular-nums ${sk.dim}`}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className={`flex h-full w-full overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.06),0_18px_30px_-18px_rgba(0,0,0,0.35)] transition-transform duration-500 group-hover:scale-[1.02] border-[6px] ${isDark ? 'border-[#0B0B0C]' : 'border-white'}`}>
                      {style.palette.map((c, ci) => (
                        <span
                          key={c.hex}
                          title={`${t(c.nameRo, c.nameEn)} ${c.hex}`}
                          className={ci === 0 ? 'flex-[3]' : 'flex-1'}
                          style={{ backgroundColor: c.hex }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 flex items-baseline justify-between gap-3">
                    <h3 className={`text-[15px] font-semibold tracking-tight ${sk.strong}`}>{t(style.nameRo, style.nameEn)}</h3>
                    <span className={`shrink-0 font-mono text-[13px] tabular-nums ${sk.strong}`}>
                      {STYLE_PER_SQM[style.id]}/m²
                    </span>
                  </div>
                  <p className={`mt-1 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] ${sk.dim}`}>
                    <span className="truncate">{t(style.materialsRo[0], style.materialsEn[0])}</span>
                    <span className="shrink-0 tabular-nums">{costDeltaLabel(style.costFactor)}</span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
