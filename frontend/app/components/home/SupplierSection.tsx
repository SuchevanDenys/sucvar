// app/components/home/SupplierSection.tsx
// Landing §04 — ecosistemul de furnizori: căutarea generată automat și deep-link-urile către retaileri.
"use client";

import React from 'react';
import { ExternalLink, FileSpreadsheet } from 'lucide-react';
import { SectionHeading } from '@/app/components/ui/Editorial';
import Reveal, { revealItem } from '@/app/components/ui/Reveal';
import { LOOP_STEPS, SAMPLE_PARAMS, SAMPLE_QUERY, SUPPLIERS } from '@/app/data/home';
import { tr } from '@/app/lib/i18n';
import { TACTILE } from '@/app/lib/theme/motion';
import { CONTAINER, EYEBROW, getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';
import { ANCHOR_OFFSET, sectionSpacing } from './sectionStyles';

const supplierHref = (tpl: string) => tpl.replace('{q}', encodeURIComponent(SAMPLE_QUERY));

export default function SupplierSection({ lang, isDark }: { lang: Language; isDark: boolean }) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const sectionY = sectionSpacing(sk.line);
  const groupHoverAccent = isDark ? 'group-hover:text-white' : 'group-hover:text-[#1B1416]';

  return (
    <section className={sectionY}>
      <div id="suppliers" className={`${CONTAINER} ${ANCHOR_OFFSET} grid grid-cols-1 lg:grid-cols-12 gap-12`}>
        <Reveal className="lg:col-span-5 space-y-6">
          <SectionHeading
            isDark={isDark}
            index="04"
            eyebrow={t('Furnizori', 'Suppliers')}
            title={t('De la specificație la coș,', 'From specification to cart,')}
            titleMuted={t('fără să rescrii nimic.', 'without retyping anything.')}
          />
          <p className={`text-sm leading-relaxed max-w-md ${sk.muted}`}>
            {t(
              'SUCVAR nu vinde materiale și nu ia comision. Calculează exact ce trebuie cumpărat și te trimite direct la produsul potrivit.',
              'SUCVAR doesn’t sell materials or take a commission. It calculates exactly what to buy and sends you straight to the right product.',
            )}
          </p>
          <ol className={`border rounded-sm divide-y ${sk.line} ${sk.divide}`}>
            {LOOP_STEPS.map((s, i) => (
              <li key={s.en} className="flex gap-4 p-4">
                <span className={`font-mono text-xs tabular-nums pt-0.5 ${sk.accent}`}>{String(i + 1).padStart(2, '0')}</span>
                <span className={`text-sm leading-relaxed ${sk.muted}`}>{t(s.ro, s.en)}</span>
              </li>
            ))}
          </ol>
        </Reveal>

        <Reveal delay={100} className="lg:col-span-7 space-y-4">
          <div className={`relative border rounded-md p-5 ${sk.card}`}>
            <p className={`${EYEBROW} ${sk.dim}`}>{t('Căutare generată automat', 'Auto-generated search')}</p>
            <p className={`mt-3 font-mono text-sm ${sk.strong}`}>“{SAMPLE_QUERY}”</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SAMPLE_PARAMS.map((p) => (
                <span key={p} className={`rounded-full border px-2 py-0.5 ${EYEBROW} ${sk.line} ${sk.muted}`}>
                  {p}
                </span>
              ))}
            </div>
          </div>

          {/* Retaileri: grilă decalată (70 ms); wrapper-ul <div> poartă dezvăluirea, linkul poartă hover-ul */}
          <Reveal stagger className={`grid grid-cols-1 sm:grid-cols-2 gap-px border rounded-md overflow-hidden ${sk.line} ${sk.gap}`}>
            {SUPPLIERS.map((s, i) => (
              <div key={s.name} {...revealItem(i, `relative hover:z-10 ${sk.cell}`)}>
                <a
                href={supplierHref(s.url)}
                target="_blank"
                rel="noopener noreferrer"
                className={`group relative h-full p-5 flex items-start justify-between gap-4 touch-manipulation ring-1 ring-inset ring-transparent hover:shadow-[0_14px_30px_-22px_rgba(27,20,22,0.45)] ${isDark ? 'hover:ring-[#C94A6A]/45' : 'hover:ring-[#5C1628]/30'} ${TACTILE} ${sk.cell} ${sk.rowHover}`}
              >
                <div>
                  <p className={`font-mono text-[10px] uppercase tracking-[0.2em] tabular-nums ${sk.dim}`}>N° {String(i + 1).padStart(2, '0')}</p>
                  <p className={`mt-3 text-base font-medium tracking-tight ${sk.strong}`}>{s.name}</p>
                  <p className={`mt-1 text-xs ${sk.dim}`}>{t(s.roleRo, s.roleEn, s.roleFr)}</p>
                  <p className={`mt-2 font-mono text-[10px] tracking-[0.12em] ${sk.dim}`}>{s.domain}</p>
                </div>
                <ExternalLink className={`w-3.5 h-3.5 mt-0.5 shrink-0 transition-colors ${sk.dim} ${groupHoverAccent}`} />
                </a>
              </div>
            ))}
            <div {...revealItem(SUPPLIERS.length, `p-5 flex items-start gap-4 ${sk.cell}`)}>
              <FileSpreadsheet className={`w-4 h-4 mt-0.5 shrink-0 ${sk.accent}`} />
              <div>
                <p className={`text-sm font-medium tracking-tight ${sk.strong}`}>
                  {t('Ateliere de tâmplărie și mobilier la comandă', 'Bespoke joinery and furniture workshops')}
                </p>
                <p className={`mt-1 text-xs leading-relaxed ${sk.dim}`}>
                  {t(
                    'Piesele la comandă, care nu se găsesc pe raft, pleacă spre atelier ca fișier CSV cu dimensiuni și toleranțe, gata pentru cererea de ofertă.',
                    'Made-to-order pieces that aren’t on the shelf go to the workshop as a CSV with dimensions and tolerances, ready for a quote request.',
                  )}
                </p>
              </div>
            </div>
          </Reveal>
        </Reveal>
      </div>
    </section>
  );
}
