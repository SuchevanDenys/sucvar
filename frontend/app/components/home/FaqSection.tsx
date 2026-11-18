// app/components/home/FaqSection.tsx
// Landing §07 — întrebări frecvente: acordeon centrat de carduri alabastru (multi-expand, primul deschis).
//
// Animația înălțimii folosește trucul `grid-template-rows: 0fr → 1fr` (fără măsurători JS, fără layout shift
// la SSR). Panoul închis rămâne în DOM, dar e `inert` + `aria-hidden`, deci nu primește focus și nu e citit.
"use client";

import React, { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import Reveal, { revealItem } from '@/app/components/ui/Reveal';
import { tr } from '@/app/lib/i18n';
import { FAQ_ANCHOR } from '@/app/lib/scroll';
import { CONTAINER, EYEBROW, getSkin, ruleClass } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';
import { ANCHOR_OFFSET, sectionSpacing } from './sectionStyles';

type FaqItem = { qRo: string; qEn: string; aRo: string; aEn: string };

const FAQ_ITEMS: readonly FaqItem[] = [
  {
    qRo: 'Ce este SUCVAR și cu ce mă ajută?',
    qEn: 'What is SUCVAR and how does it help me?',
    aRo: 'SUCVAR este o platformă de randare arhitecturală cu AI și de estimare automată a materialelor. Pornești de la o fotografie a unui spațiu rezidențial sau comercial și primești o randare fotorealistă, lista de cantități cu prețuri și un deviz gata de trimis clientului, totul în câteva minute.',
    aEn: 'SUCVAR is an AI architectural rendering and automatic materials-estimating platform. Start from a photo of a residential or commercial space and get a photorealistic render, a priced bill of quantities and a client-ready estimate, all within minutes.',
  },
  {
    qRo: 'Păstrează AI-ul pereții, ferestrele și dimensiunile reale ale camerei?',
    qEn: 'Does the AI keep the real walls, windows and room dimensions?',
    aRo: 'Da. În modul „Păstrează structura”, motorul FLUX Kontext Pro respectă geometria și perspectiva fotografiei originale: pereții, golurile de ferestre și uși și proporțiile camerei rămân la locul lor, iar AI-ul schimbă doar finisajele, mobilierul și atmosfera.',
    aEn: 'Yes. In “Keep structure” mode, the FLUX Kontext Pro engine respects the geometry and perspective of the original photo: walls, window and door openings and room proportions stay in place, while the AI changes only finishes, furniture and mood.',
  },
  {
    qRo: 'Pot modifica doar un singur obiect, cum ar fi canapeaua sau parchetul?',
    qEn: 'Can I change just one object, like the sofa or the flooring?',
    aRo: 'Da, cu unealta „Editează o zonă”. Marchezi cu pensula de mascare doar zona dorită, descrii schimbarea, iar AI-ul transformă exclusiv selecția. Restul camerei rămâne 100% neatins, pixel cu pixel.',
    aEn: 'Yes, with the “Edit an area” tool. Paint over just the area you want with the masking brush, describe the change, and the AI transforms only that selection. The rest of the room stays 100% untouched, pixel for pixel.',
  },
  {
    qRo: 'Cum funcționează devizul B2B și lista de materiale în lei?',
    qEn: 'How do the B2B estimate and the materials list in RON work?',
    aRo: 'Cantitățile se calculează automat din suprafața în m² și din cotele camerei, cu pierderi de execuție incluse. Prețurile sunt în RON, cu TVA 21% sau cota redusă de 11% acolo unde se aplică, iar produsele au linkuri către furnizori din România precum Dedeman, Leroy Merlin, Hornbach, IKEA și Mobexpert.',
    aEn: 'Quantities are calculated automatically from the floor area in m² and the room dimensions, with installation waste included. Prices are in RON with 21% VAT, or the reduced 11% rate where it applies, and products link to Romanian suppliers such as Dedeman, Leroy Merlin, Hornbach, IKEA and Mobexpert.',
  },
  {
    qRo: 'Pot folosi randările și devizele pentru clienți sau proiecte comerciale?',
    qEn: 'Can I use the renders and estimates for clients or commercial projects?',
    aRo: 'Da. SUCVAR este gândit pentru uz profesional: arhitecți, designeri de interior și constructori își prezintă propunerile cu randări și devize detaliate. Poți publica proiectele într-un portofoliu public sau poți trimite clientului un link de prezentare dedicat.',
    aEn: 'Yes. SUCVAR is built for professional use: architects, interior designers and contractors present their proposals with renders and detailed estimates. You can publish projects to a public portfolio or send your client a dedicated presentation link.',
  },
  {
    qRo: 'Pe ce dispozitive funcționează aplicația?',
    qEn: 'Which devices does the app work on?',
    aRo: 'Pe orice dispozitiv cu un browser modern: laptop, tabletă sau telefon. Nu trebuie să instalezi nimic. Poți fotografia camera direct de pe telefon și continua proiectul pe laptop.',
    aEn: 'Any device with a modern browser: laptop, tablet or phone. There is nothing to install. You can photograph the room on your phone and continue the project on your laptop.',
  },
];

export default function FaqSection({ lang, isDark }: { lang: Language; isDark: boolean }) {
  // Multi-expand; primul răspuns deschis implicit (stare identică la SSR și la hidratare)
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([0]));
  const baseId = useId();

  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  // Clase complete (Tailwind nu vede clasele interpolate)
  const card = isDark
    ? 'bg-[#1A1416] border-[#2E2427] hover:border-[#C94A6A]/45 hover:shadow-[0_14px_32px_-22px_rgba(0,0,0,0.85)]'
    : 'bg-[#F6F3F0] border-[#E8E2E0] hover:border-[#5C1628]/30 hover:bg-[#FAF8F6] hover:shadow-[0_14px_32px_-24px_rgba(92,22,40,0.35)]';
  const cardOpen = isDark
    ? 'border-[#C94A6A]/45 shadow-[0_14px_32px_-22px_rgba(0,0,0,0.85)]'
    : 'border-[#5C1628]/25 bg-[#FAF8F6] shadow-[0_14px_32px_-24px_rgba(92,22,40,0.3)]';
  const focusRing = isDark ? 'focus-visible:ring-[#C94A6A]/60' : 'focus-visible:ring-[#5C1628]/40';
  const iconOpen = isDark ? 'bg-[#C94A6A] text-white border-transparent' : 'bg-[#5C1628] text-white border-transparent';
  const iconClosed = isDark
    ? 'border-[#2E2427] text-[#B5A9AC] group-hover:border-[#C94A6A]/60 group-hover:text-[#D65D7B]'
    : 'border-[#E0D8D4] text-[#6B5E61] group-hover:border-[#5C1628]/40 group-hover:text-[#5C1628]';

  return (
    <section className={sectionSpacing(sk.line)}>
      <div id={FAQ_ANCHOR} className={`${CONTAINER} ${ANCHOR_OFFSET}`}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className={`flex items-center justify-center gap-3 ${EYEBROW} ${sk.dim}`}>
            <span className={sk.accent}>§07</span>
            <span className={`h-px w-8 ${ruleClass(isDark)}`} />
            {t('Întrebări', 'Questions')}
          </p>
          <h2 className={`mt-6 text-3xl sm:text-[2.6rem] font-semibold leading-[1.08] tracking-tight ${sk.strong}`}>
            {t('Întrebări frecvente', 'Frequently asked questions')}
          </h2>
          <p className={`mx-auto mt-5 max-w-xl text-sm leading-relaxed ${sk.muted}`}>
            {t(
              'Ai întrebări despre randările AI, editarea selectivă sau devizele de materiale? Găsești mai jos toate răspunsurile.',
              'Questions about AI renders, selective editing or materials estimates? You will find all the answers below.',
            )}
          </p>
        </Reveal>

        <Reveal stagger delay={80} className="mt-14">
          <ul className="mx-auto max-w-3xl space-y-3.5">
            {FAQ_ITEMS.map((item, i) => {
              const isOpen = open.has(i);
              const btnId = `${baseId}-q${i}`;
              const panelId = `${baseId}-a${i}`;
              return (
                <li key={item.qEn} {...revealItem(i)}>
                  <div
                    className={`rounded-2xl border transition-[background-color,border-color,box-shadow,translate] duration-300 hover:-translate-y-px motion-reduce:hover:translate-y-0 ${card} ${isOpen ? cardOpen : ''}`}
                  >
                    <h3>
                      <button
                        type="button"
                        id={btnId}
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        onClick={() => toggle(i)}
                        className={`group flex w-full items-center justify-between gap-6 rounded-2xl px-5 py-5 sm:px-7 sm:py-6 text-left touch-manipulation focus:outline-none focus-visible:ring-2 ${focusRing}`}
                      >
                        <span className={`text-[15px] sm:text-base font-medium leading-snug tracking-tight ${sk.strong}`}>
                          {t(item.qRo, item.qEn)}
                        </span>
                        <span
                          aria-hidden
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,color,rotate] duration-300 ease-out motion-reduce:transition-none ${
                            isOpen ? `rotate-45 ${iconOpen}` : `rotate-0 ${iconClosed}`
                          }`}
                        >
                          <Plus className="h-4 w-4" strokeWidth={1.75} />
                        </span>
                      </button>
                    </h3>
                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={btnId}
                      aria-hidden={!isOpen}
                      inert={!isOpen}
                      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
                        isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                      }`}
                    >
                      <div className="overflow-hidden">
                        <p className={`px-5 pb-6 pr-14 sm:px-7 sm:pr-20 text-sm leading-[1.8] ${sk.muted}`}>{t(item.aRo, item.aEn)}</p>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
