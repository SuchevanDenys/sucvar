// app/page.tsx — landing page (monochrome Scandinavian gallery).
// Ordinea secțiunilor: hero → intro (telemetrie + slider) → §01 proces → §02 studii de caz → §03 formule →
// §04 furnizori → §05 stiluri → §06 planuri → footer. Secțiunile §04–§06 au stare/logică proprie și trăiesc
// în `components/home/*`; aici rămân secțiunile pur prezentaționale.
// SSR: nicio citire Date / Math.random / window în timpul randării; accesul la storage se face doar în efecte.
"use client";

import React, { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import CaseCard from '@/app/components/home/CaseCard';
import { ANCHOR_OFFSET, sectionSpacing } from '@/app/components/home/sectionStyles';
import PricingSection from '@/app/components/home/PricingSection';
import StyleGallerySection from '@/app/components/home/StyleGallerySection';
import SupplierSection from '@/app/components/home/SupplierSection';
import Footer from '@/app/components/layout/Footer';
import Navbar from '@/app/components/layout/Navbar';
import BeforeAfterSlider from '@/app/components/ui/BeforeAfterSlider';
import { Frame, LiveDot, SectionHeading } from '@/app/components/ui/Editorial';
import Reveal from '@/app/components/ui/Reveal';
import { VISUAL_STYLES } from '@/app/data/catalog';
import { CASES, FORMULAS, HERO_STATS, STEPS } from '@/app/data/home';
import { tr } from '@/app/lib/i18n';
import { scrollToAnchor } from '@/app/lib/scroll';
import { CONTAINER, EYEBROW, getSkin } from '@/app/lib/theme/skin';
import { usePrefs } from '@/app/lib/theme/usePrefs';

export default function HomePage() {
  // ---------- State ----------
  const { lang, isDark } = usePrefs();

  // ---------- Helpers ----------
  const sk = getSkin(isDark);
  const t = (textRo: string, textEn: string, fr?: string) => tr(lang, textRo, textEn, fr);
  // Full class strings (Tailwind can't see classes built by interpolation)
  const groupHoverStrong = isDark ? 'hover:text-white group-hover:text-white' : 'hover:text-[#111111] group-hover:text-[#111111]';
  const sectionY = sectionSpacing(sk.line);
  const btnBase = 'inline-flex items-center justify-center gap-2 h-12 sm:h-11 px-6 rounded-sm text-[13px] font-medium touch-manipulation select-none';

  // Sosire din altă rută (ex. /generate → /#planuri): după montare, realiniem ancora
  // fără animație, ca titlul secțiunii să stea curat sub bara de navigare.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => scrollToAnchor(id, 'instant'));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  return (
    <div id="top" className={`min-h-screen font-sans pb-24 md:pb-0 transition-colors duration-500 ${sk.page}`}>
      <Navbar />

      <main>
        {/* ================= HERO (split 50/50 editorial) ================= */}
        <section className={`border-b ${sk.line}`}>
          <div className={`${CONTAINER} grid grid-cols-1 items-center gap-12 pt-14 pb-16 lg:grid-cols-2 lg:gap-16 lg:pt-20 lg:pb-24`}>
            {/* Stânga: text editorial */}
            <div className="order-2 lg:order-1">
              <Reveal>
                <p className={`flex items-center gap-4 text-[11px] font-medium uppercase tracking-[0.3em] ${sk.muted}`}>
                  <span className={`h-px w-8 ${isDark ? 'bg-[#F5F5F5]/40' : 'bg-[#111111]/40'}`} />
                  {t('Studio de arhitectură interioară asistată de AI', 'AI-assisted interior architecture studio')}
                </p>
              </Reveal>

              <Reveal delay={80}>
                <h1 className={`mt-8 max-w-xl text-[2.6rem] font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-[4.25rem] ${sk.strong}`}>
                  {t('Din fotografie,', 'From a photograph')}{' '}
                  <span className={sk.muted}>{t('un interior gata de construit.', 'to an interior ready to build.')}</span>
                </h1>
              </Reveal>

              <Reveal delay={160}>
                <p className={`mt-8 max-w-md text-[15px] leading-[1.8] ${sk.muted}`}>
                  {t(
                    'Încarci o fotografie a camerei, iar în câteva minute SUCVAR îți livrează o randare fotorealistă, o listă de cantități cu prețuri și linkuri către magazine și o ofertă elegantă, gata de trimis clientului.',
                    'Upload a photo of the room and, within minutes, SUCVAR delivers a photorealistic design, an itemised bill of quantities with prices and retailer links, and a polished quote ready to send to your client.',
                  )}
                </p>
                <div className="mt-10 flex flex-wrap items-center gap-3">
                  <Link href="/generate" className={`group ${btnBase} ${sk.btn}`}>
                    <span>{t('Începe un proiect', 'Start a project')}</span>
                    <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={1.5} />
                  </Link>
                  <a href="#proof" className={`group ${btnBase} ${sk.btnGhost}`}>
                    <span>{t('Vezi proiectele', 'View case studies')}</span>
                    <ArrowUpRight
                      className="w-4 h-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                      strokeWidth={1.5}
                    />
                  </a>
                  <Link href="/b2b" className={`${btnBase} ${sk.muted} ${groupHoverStrong} hover:underline underline-offset-4`}>
                    {t('Pentru firme (B2B)', 'For firms (B2B)')}
                  </Link>
                </div>
              </Reveal>
            </div>

            {/* Dreapta: fotografie arhitecturală neîncadrată, pe passe-partout de galerie */}
            <Reveal delay={120} className="order-1 lg:order-2">
              <figure>
                <div className={`p-4 sm:p-6 lg:p-8 ${isDark ? 'bg-[#141416]' : 'bg-[#F5F5F5]'}`}>
                  <Image
                    src="/hero.jpg"
                    alt={t('Exterior arhitectural minimalist, în tonuri de obsidian', 'Minimalist architectural exterior in obsidian tones')}
                    width={1376}
                    height={768}
                    priority
                    sizes="(min-width: 1024px) 50vw, 100vw"
                    className="block h-auto w-full object-contain"
                  />
                </div>
                <figcaption className={`mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] ${sk.dim}`}>
                  <span>{t('Obsidian minimalist', 'Minimalist Obsidian')}</span>
                  <span className="tabular-nums">EXT-01</span>
                </figcaption>
              </figure>
            </Reveal>
          </div>
        </section>

        {/* ================= INTRO (telemetry + slider) ================= */}
        <section className="relative">
          <div id="intro" className={`${CONTAINER} relative pt-16 pb-24 lg:pt-20 lg:pb-32 ${ANCHOR_OFFSET}`}>

            {/* Telemetry — hairline grid */}
            <Reveal delay={240}>
              <dl className={`grid grid-cols-2 lg:grid-cols-4 gap-px border rounded-md overflow-hidden ${sk.line} ${sk.gap}`}>
                {HERO_STATS.map((s, i) => (
                  <div key={s.value} className={`px-5 py-6 transition-colors duration-500 ${sk.cell} ${sk.rowHover}`}>
                    <div className={`font-mono text-[10px] tabular-nums tracking-[0.2em] uppercase ${sk.dim}`}>N° {String(i + 1).padStart(2, '0')}</div>
                    <dt className={`mt-4 font-mono text-xl sm:text-2xl tabular-nums tracking-tight ${sk.strong}`}>
                      {/* „12” = numărul real de stiluri din catalog, ca insigna să nu se desincronizeze */}
                      {s.value === '12' ? String(VISUAL_STYLES.length) : s.value}
                    </dt>
                    <dd className={`mt-2 text-xs font-light leading-relaxed ${sk.dim}`}>{t(s.ro, s.en)}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>

            {/* FIG. 01 — slider */}
            <Reveal delay={120} className="mt-20 lg:mt-24">
              <Frame isDark={isDark} label={t('FIG. 01 — Înainte / După', 'FIG. 01 — Before / After')} meta={t('18,6 m² · H 2,62 m', '18.6 m² · H 2.62 m')}>
                <div className="relative overflow-hidden rounded-md">
                  <BeforeAfterSlider
                    beforeImg={CASES[0].before}
                    afterImg={CASES[0].after}
                    beforeLabel={t('Înainte', 'Before')}
                    afterLabel={t('Proiect SUCVAR', 'SUCVAR design')}
                  />
                </div>
              </Frame>
            </Reveal>
          </div>
        </section>

        {/* ================= §01 PROCESS ================= */}
        <section className={sectionY}>
          <div id="proces" className={`${CONTAINER} ${ANCHOR_OFFSET}`}>
            <Reveal>
              <SectionHeading
                isDark={isDark}
                index="01"
                eyebrow={t('Cum lucrăm', 'How it works')}
                title={t('Trei pași.', 'Three steps.')}
                titleMuted={t('De la fotografie la deviz.', 'From photograph to estimate.')}
              />
            </Reveal>

            <Reveal delay={100}>
              <ol className={`mt-16 grid grid-cols-1 lg:grid-cols-3 gap-px border rounded-md overflow-hidden ${sk.line} ${sk.gap}`}>
                {STEPS.map((step, i) => {
                  const Icon = step.icon;
                  return (
                    <li key={step.number} className={`group relative p-8 lg:p-10 transition-colors duration-500 ${sk.cell} ${sk.rowHover}`}>
                      <div className="flex items-center justify-between">
                        <span className={`font-mono text-sm tabular-nums ${sk.strong}`}>{step.number}</span>
                        <Icon className={`w-4 h-4 transition-colors duration-500 ${sk.dim} ${groupHoverStrong}`} strokeWidth={1.5} />
                      </div>
                      <h3 className={`mt-12 flex items-center gap-3 text-xl font-medium tracking-tight ${sk.strong}`}>
                        {t(step.titleRo, step.titleEn)}
                        {i < STEPS.length - 1 && <ArrowRight className={`hidden lg:block w-4 h-4 ${sk.dim}`} strokeWidth={1.5} />}
                      </h3>
                      <p className={`mt-4 text-sm leading-relaxed ${sk.muted}`}>{t(step.descRo, step.descEn)}</p>
                      <div className={`mt-10 border-t pt-4 ${EYEBROW} ${sk.line} ${sk.dim}`}>{t(step.metaRo, step.metaEn)}</div>
                    </li>
                  );
                })}
              </ol>
            </Reveal>

          </div>
        </section>

        {/* ================= §02 CASE STUDIES (live proof) ================= */}
        <section className={sectionY}>
          <div id="proof" className={`${CONTAINER} ${ANCHOR_OFFSET}`}>
            <Reveal>
              <SectionHeading
                isDark={isDark}
                index="02"
                eyebrow={t('Proiecte reale', 'Case studies')}
                title={t('Două proiecte,', 'Two projects,')}
                titleMuted={t('de la fotografie la viziune finalizată.', 'from photograph to finished vision.')}
              />
            </Reveal>
            <div className="mt-16 grid gap-20 lg:grid-cols-2 lg:gap-12">
              <Reveal>
                <CaseCard c={CASES[0]} lang={lang} isDark={isDark} />
              </Reveal>
              <Reveal delay={120} className="lg:mt-24">
                <CaseCard c={CASES[1]} lang={lang} isDark={isDark} />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ================= §03 ENGINEERING FORMULAS ================= */}
        <section className={sectionY}>
          <div id="metodologie" className={`${CONTAINER} ${ANCHOR_OFFSET} grid grid-cols-1 lg:grid-cols-12 gap-12`}>
            <Reveal className="lg:col-span-5 space-y-6">
              <SectionHeading
                isDark={isDark}
                index="03"
                eyebrow={t('Metodologie de calcul', 'Calculation method')}
                title={t('Cantități calculate,', 'Quantities calculated,')}
                titleMuted={t('nu estimate din ochi.', 'never guessed.')}
              />
              <p className={`text-sm leading-relaxed max-w-md ${sk.muted}`}>
                {t(
                  'Fiecare linie din deviz pornește de la cotele tale și urmează reguli de execuție transparente, fără cutii negre. Vezi exact cum s-a ajuns la fiecare cifră.',
                  'Every line of the estimate starts from your dimensions and follows transparent construction rules, with no black boxes. See exactly how each figure was reached.',
                )}
              </p>
              <LiveDot label={t('Recalculat la fiecare modificare', 'Recalculated with every change')} className={sk.accent} />
            </Reveal>

            <Reveal delay={100} className="lg:col-span-7">
              <div className={`border rounded-md overflow-hidden ${sk.line} ${sk.card}`}>
                <div className={`flex items-center justify-between px-5 h-9 border-b ${sk.line} ${EYEBROW} ${sk.dim}`}>
                  <span className="tabular-nums">
                    {t('Metodologie de calcul', 'Calculation method')} · {String(FORMULAS.length).padStart(2, '0')} {t('reguli', 'rules')}
                  </span>
                  <span className="hidden sm:inline">{t('Transparență totală', 'Full transparency')}</span>
                </div>
                <div className={`divide-y ${sk.divide}`}>
                  {FORMULAS.map((item, i) => (
                    <div
                      key={item.labelEn}
                      className={`px-5 py-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-6 transition-colors ${sk.rowHover}`}
                    >
                      <span className="flex items-start gap-3 text-sm">
                        <span className={`pt-1 font-mono text-[10px] tabular-nums ${sk.dim}`}>{String(i + 1).padStart(2, '0')}</span>
                        <span>
                          <span className={`block ${sk.strong}`}>{t(item.labelRo, item.labelEn)}</span>
                          <span className={`mt-1 block text-xs leading-relaxed ${sk.dim}`}>{t(item.descRo, item.descEn)}</span>
                        </span>
                      </span>
                      <code className={`pl-7 sm:pl-0 sm:pt-0.5 sm:text-right shrink-0 text-xs font-mono tabular-nums ${sk.accent}`}>
                        {t(item.formulaRo, item.formulaEn)}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* §04 */}
        <SupplierSection lang={lang} isDark={isDark} />

        {/* §05 — aceleași fișe (catalog.ts + styleSpecs.ts) ca în Studio */}
        <StyleGallerySection lang={lang} isDark={isDark} />

        {/* §06 */}
        <PricingSection lang={lang} isDark={isDark} />
      </main>

      <Footer lang={lang} isDark={isDark} />
    </div>
  );
}