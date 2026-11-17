// app/components/home/StyleGallerySection.tsx
// Landing §05 — galeria de stiluri ca marquee infinit cu fotografii de interior.
// Un click deschide Studio-ul cu stilul preselectat (`/generate?style={id}`).
"use client";

import { formatLei } from '@/app/lib/format';
import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { SectionHeading } from '@/app/components/ui/Editorial';
import Reveal from '@/app/components/ui/Reveal';
import { STYLE_IMAGES, VISUAL_STYLES, calculateEngineering, estimateCost } from '@/app/data/catalog';
import { tr } from '@/app/lib/i18n';
import { STORAGE_KEYS, writeStorage } from '@/app/lib/storage';
import { DEFAULT_DIMENSIONS } from '@/app/lib/studio/validation';
import { CONTAINER, bandClass, getSkin } from '@/app/lib/theme/skin';
import type { Language, VisualStyle } from '@/app/types';
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

// Card-gradient „arhitectural” din paleta stilului: diagonală de materiale + ritm fin de montanți verticali.
const paletteBackground = (style: VisualStyle): React.CSSProperties => {
  const [a, b, c, d] = style.colors;
  return {
    backgroundImage: [
      'repeating-linear-gradient(90deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 48px)',
      `linear-gradient(160deg, ${a} 0%, ${b ?? a} 42%, ${c ?? b ?? a} 74%, ${d ?? c ?? a} 100%)`,
    ].join(', '),
  };
};

type CardProps = {
  style: VisualStyle;
  index: number;
  t: (ro: string, en: string, fr?: string) => string;
  /** Copia duplicată din pistă: ascunsă pentru cititoare de ecran și scoasă din ordinea Tab. */
  clone?: boolean;
};

function StyleCard({ style, index, t, clone = false }: CardProps) {
  const src = STYLE_IMAGES[style.id];
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(src) && !failed;
  const name = t(style.nameRo, style.nameEn);

  return (
    <li className="shrink-0 pr-4 sm:pr-5">
      <Link
        href={`/generate?style=${encodeURIComponent(style.id)}`}
        onClick={() => writeStorage(STORAGE_KEYS.preferredStyle, style.id)}
        tabIndex={clone ? -1 : undefined}
        aria-label={`${name} — ${t('deschide în Studio', 'open in Studio')}`}
        className="group relative block aspect-[4/5] w-56 touch-manipulation overflow-hidden rounded-md bg-[#F5F2EF] dark:bg-[#1A1416] shadow-[0_1px_2px_rgba(27,20,22,0.06),0_24px_40px_-24px_rgba(92,22,40,0.45)] outline-none ring-1 ring-[#1B1416]/[0.06] dark:ring-white/[0.06] transition-[box-shadow,translate] duration-500 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-1 hover:shadow-[0_1px_2px_rgba(27,20,22,0.06),0_32px_48px_-26px_rgba(92,22,40,0.55)] hover:ring-[#A67C52]/50 dark:hover:ring-[#C94A6A]/45 focus-visible:ring-2 focus-visible:ring-[#5C1628] dark:focus-visible:ring-[#C94A6A] motion-reduce:hover:translate-y-0 sm:w-64"
      >
        {showPhoto ? (
          <Image
            src={src!}
            alt=""
            fill
            sizes="(min-width: 640px) 256px, 224px"
            onError={() => setFailed(true)}
            className="object-cover transition-[scale] duration-700 ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-105 motion-reduce:group-hover:scale-100"
          />
        ) : (
          <div aria-hidden className="absolute inset-0 transition-[scale] duration-700 ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-105 motion-reduce:group-hover:scale-100" style={paletteBackground(style)}>
            {/* Mostrele paletei, ca un mic panou de materiale */}
            <div className="absolute left-5 right-5 top-12 flex h-2 overflow-hidden rounded-full ring-1 ring-white/30">
              {style.palette.map((c, ci) => (
                <span key={c.hex} className={ci === 0 ? 'flex-[3]' : 'flex-1'} style={{ backgroundColor: c.hex }} />
              ))}
            </div>
          </div>
        )}

        {/* Scrim pentru lizibilitatea titlului */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#110D0F]/80 via-[#110D0F]/20 to-transparent" />

        <span className="absolute left-4 top-4 font-mono text-[10px] tabular-nums tracking-wider text-white/80">
          {String(index + 1).padStart(2, '0')}
        </span>

        <div className="absolute inset-x-0 bottom-0 p-5">
          <span className="mb-3 inline-flex translate-y-1 items-center rounded-full bg-[#5C1628]/90 px-3 py-1 text-[11px] font-medium tracking-wide text-[#F3E7D3] opacity-0 ring-1 ring-[#C9A97A]/40 backdrop-blur-sm transition-[opacity,translate] duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100">
            {t('Testează stilul →', 'Try this style →')}
          </span>
          <h3 className="text-lg font-semibold leading-tight tracking-tight text-white">{name}</h3>
          <p className="mt-1 flex items-baseline justify-between gap-3 text-[11px] uppercase tracking-[0.14em] text-white/70">
            <span className="truncate">{t(style.materialsRo[0], style.materialsEn[0])}</span>
            <span className="shrink-0 font-mono normal-case tracking-normal tabular-nums text-white/90">{STYLE_PER_SQM[style.id]}/m²</span>
          </p>
        </div>
      </Link>
    </li>
  );
}

export default function StyleGallerySection({ lang, isDark }: { lang: Language; isDark: boolean }) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const sectionY = sectionSpacing(sk.line, bandClass(isDark));

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
      </div>

      {/* Marquee pe toată lățimea: pista conține lista de două ori și se translatează cu -50% → buclă fără salt */}
      <Reveal delay={100}>
        <div className="marquee-viewport marquee-mask mt-14 overflow-hidden py-2">
          <div className="animate-marquee flex w-max hover:[animation-play-state:paused] focus-within:[animation-play-state:paused]">
            <ul className="flex shrink-0">
              {VISUAL_STYLES.map((style, i) => (
                <StyleCard key={style.id} style={style} index={i} t={t} />
              ))}
            </ul>
            <ul className="marquee-clone flex shrink-0" aria-hidden>
              {VISUAL_STYLES.map((style, i) => (
                <StyleCard key={style.id} style={style} index={i} t={t} clone />
              ))}
            </ul>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
