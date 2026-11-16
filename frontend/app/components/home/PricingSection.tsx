// app/components/home/PricingSection.tsx
// Landing §06 — planuri, comutatorul lunar/anual și matricea de capabilități.
//
// Selecția (plan + ciclu de facturare) se păstrează în localStorage și este preluată de /checkout.
// Starea „activ / inclus" a cardurilor este doar UX: aceeași gardă `canPurchase` rulează pe server
// (POST /api/checkout → 409 ALREADY_SUBSCRIBED | PLAN_INCLUDED), care este sursa de adevăr.
"use client";

import React from 'react';
import Link from 'next/link';
import { Check, Minus } from 'lucide-react';
import BillingToggle from '@/app/components/ui/BillingToggle';
import { SectionHeading } from '@/app/components/ui/Editorial';
import Reveal from '@/app/components/ui/Reveal';
import { PRICING_PLANS } from '@/app/data/catalog';
import { CAPABILITY_MATRIX, TIER_WORKFLOWS } from '@/app/data/home';
import { tr, trList } from '@/app/lib/i18n';
import { displayPrice } from '@/app/lib/plan/pricing';
import { canPurchase, normalizeInterval } from '@/app/lib/plan/tiers';
import { usePlan } from '@/app/lib/plan/usePlan';
import { PRICING_ANCHOR } from '@/app/lib/scroll';
import { STORAGE_KEYS, writeStorage } from '@/app/lib/storage';
import { CONTAINER, EYEBROW, getSkin } from '@/app/lib/theme/skin';
import { useStoredValue } from '@/app/lib/useStoredValue';
import type { Language } from '@/app/types';
import { ANCHOR_OFFSET, sectionSpacing } from './sectionStyles';

const handleSelectPlan = (planId: string) => {
  writeStorage(STORAGE_KEYS.selectedPlan, planId);
};

const handleSelectInterval = (next: string) => {
  writeStorage(STORAGE_KEYS.billingInterval, next);
};

export default function PricingSection({ lang, isDark }: { lang: Language; isDark: boolean }) {
  const { tier: currentTier, interval: currentInterval, isSignedIn } = usePlan();
  const selectedPlan = useStoredValue(STORAGE_KEYS.selectedPlan) || 'pro';
  // Ciclul de facturare ales (lunar / anual −20%), păstrat și pentru pagina de checkout
  const interval = normalizeInterval(useStoredValue(STORAGE_KEYS.billingInterval)) ?? 'month';

  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const sectionY = sectionSpacing(sk.line);
  const radioClass = (isSelected: boolean): string => {
    const base = 'w-3.5 h-3.5 rounded-full border flex items-center justify-center';
    if (!isSelected) return `${base} ${sk.line}`;
    return `${base} ${isDark ? 'border-[#C94A6A]' : 'border-[#5C1628]'}`;
  };
  const radioDot = `w-1.5 h-1.5 rounded-full ${isDark ? 'bg-[#C94A6A]' : 'bg-[#5C1628]'}`;
  const selectedCell = isDark ? 'bg-[#C94A6A]/[0.06]' : 'bg-[#FAF8F6]';
  // Planul recomandat (PRO): ramă bordo fină + aură caldă de alabastru, ca o lucrare pusă în passe-partout
  const featuredFrame = isDark
    ? 'ring-1 ring-inset ring-[#C94A6A]/45 bg-[linear-gradient(180deg,rgba(201,74,106,0.08),transparent_45%)]'
    : 'ring-1 ring-inset ring-[#5C1628]/25 bg-[linear-gradient(180deg,rgba(92,22,40,0.045),transparent_45%)]';

  return (
    <section className={sectionY}>
      <div id={PRICING_ANCHOR} className={`${CONTAINER} ${ANCHOR_OFFSET}`}>
        <Reveal>
          <SectionHeading
            isDark={isDark}
            index="06"
            eyebrow={t('Planuri', 'Plans')}
            title={t('Un plan pentru', 'A plan for')}
            titleMuted={t('fiecare etapă a proiectului.', 'every stage of the work.')}
          />
          <p className={`mt-6 max-w-xl text-sm leading-relaxed ${sk.muted}`}>
            {t(
              'Începi gratuit cu o cameră. Treci pe Professional când prezinți proiecte clienților, iar pe Business când lucrezi în echipă, cu devize și marje în portalul B2B.',
              'Start free with a single room. Move to Professional when you present work to clients, and to Business when you work as a team, with estimates and margins in the B2B portal.',
            )}
          </p>
        </Reveal>

        <Reveal delay={100}>
          <div className="mt-10 flex justify-start">
            <BillingToggle
              value={interval}
              onChange={handleSelectInterval}
              lang={lang}
              wrapClass={sk.line}
              segOn={sk.segOn}
              segOff={sk.segOff}
            />
          </div>
          <div className={`mt-6 grid grid-cols-1 lg:grid-cols-3 gap-px border rounded-md overflow-hidden ${sk.line} ${sk.gap}`}>
            {PRICING_PLANS.map((plan, idx) => {
              const isSelected = selectedPlan === plan.id;
              const isFeatured = Boolean(plan.popular);
              const features = trList(lang, plan.featuresRo, plan.featuresEn);
              const buttonClass = isSelected ? sk.btn : sk.btnGhost;
              // Rang plan: cardul activ / inclus în planul curent nu se mai poate cumpăra
              // Gardă (oglindește serverul): se poate cumpăra doar o îmbunătățire —
              // pro lunar -> pro anual / agency, agency lunar -> agency anual.
              const purchasable =
                plan.id !== 'starter' &&
                canPurchase({ tier: currentTier, interval: currentInterval }, { tier: plan.id, interval });
              const isActive = isSignedIn && plan.id === currentTier && !purchasable;
              const isIncluded = isSignedIn && !isActive && plan.id !== currentTier && !purchasable;
              const isLocked = isActive || isIncluded;
              const price = displayPrice(plan.priceCents, interval);
              const currentPlanName = currentTier === 'agency' ? 'Business' : 'Professional';
              const lockedText = isActive
                ? t('Planul tău actual', 'Your current plan')
                : t(`Inclus în ${currentPlanName}`, `Included in ${currentPlanName}`,
        `Inclus dans ${currentPlanName}`);
              const planName = t(plan.nameRo, plan.nameEn);
              const buttonText = isSelected
                ? plan.id === 'starter'
                  ? t('Începe gratuit', 'Start for free')
                  : t(`Continuă cu ${planName}`, `Continue with ${planName}`,
        `Continuer avec ${planName}`)
                : t(`Alege ${plan.id === 'starter' ? 'Studio' : planName}`, `Choose ${plan.id === 'starter' ? 'Studio' : planName}`,
        `Choisir ${plan.id === 'starter' ? 'Studio' : planName}`);

              return (
                <div
                  key={plan.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectPlan(plan.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') handleSelectPlan(plan.id);
                  }}
                  className={`relative flex flex-col justify-between p-8 lg:p-10 cursor-pointer transition-colors duration-500 touch-manipulation ${
                    isSelected ? selectedCell : `${sk.cell} ${sk.rowHover}`
                  } ${isFeatured ? featuredFrame : ''}`}
                >
                  {(isSelected || isFeatured) && (
                    <span
                      aria-hidden
                      className={`absolute inset-x-0 top-0 h-[2px] ${
                        isSelected ? sk.brand : 'bg-linear-to-r from-[#A67C52]/0 via-[#A67C52] to-[#A67C52]/0'
                      }`}
                    />
                  )}

                  <div>
                    <div className="flex items-center justify-between">
                      <span className={`font-mono text-sm tabular-nums ${sk.strong}`}>{String(idx + 1).padStart(2, '0')}</span>
                      <span className="flex items-center gap-3">
                        {isFeatured && (
                          <span className={`inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] ${sk.brassBadge}`}>
                            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${sk.brassDot}`} />
                            PRO · {t('Recomandat', 'Recommended')}
                          </span>
                        )}
                        <span className={radioClass(isSelected)}>{isSelected && <span className={radioDot} />}</span>
                      </span>
                    </div>

                    <h3 className={`mt-12 text-lg font-medium tracking-tight ${sk.strong}`}>{t(plan.nameRo, plan.nameEn)}</h3>
                    <p className={`mt-2 min-h-10 text-sm ${sk.muted}`}>{t(plan.descRo, plan.descEn)}</p>

                    <div className="mt-8 flex items-baseline gap-2">
                      {price.struck && (
                        <span className={`font-mono text-xl tabular-nums line-through ${sk.dim}`}>{price.struck}</span>
                      )}
                      <span className={`font-mono text-5xl tabular-nums tracking-[-0.04em] ${isFeatured ? sk.accent : sk.strong}`}>{price.main}</span>
                      <span className={`${EYEBROW} ${sk.dim}`}>{t(plan.periodRo, plan.periodEn)}</span>
                    </div>
                    {/* Totalul anual: se vede clar cât se facturează o dată pe an */}
                    {price.yearlyTotal && (
                      <p className={`mt-2 text-xs tabular-nums ${sk.muted}`}>
                        {t(`Facturat anual: ${price.yearlyTotal}`, `Billed annually: ${price.yearlyTotal}`,
        `Facturé annuellement : ${price.yearlyTotal}`)}
                      </p>
                    )}
                  </div>

                  <div>
                    {isLocked ? (
                      <button
                        type="button"
                        disabled
                        aria-disabled
                        onClick={(event) => event.stopPropagation()}
                        className={`mt-8 h-12 sm:h-11 w-full flex items-center justify-center rounded-sm text-[13px] font-medium opacity-60 cursor-not-allowed ${sk.btnGhost}`}
                      >
                        {lockedText}
                      </button>
                    ) : isSelected ? (
                      <Link
                        href={`/checkout?plan=${plan.id}&interval=${interval}`}
                        onClick={(event) => event.stopPropagation()}
                        className={`mt-8 h-12 sm:h-11 w-full flex items-center justify-center rounded-sm text-[13px] font-medium touch-manipulation ${buttonClass}`}
                      >
                        {buttonText}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleSelectPlan(plan.id);
                        }}
                        className={`mt-8 h-12 sm:h-11 w-full flex items-center justify-center rounded-sm text-[13px] font-medium cursor-pointer touch-manipulation ${buttonClass}`}
                      >
                        {buttonText}
                      </button>
                    )}

                    <ul className={`mt-10 space-y-3.5 border-t pt-8 ${sk.line}`}>
                      {features.map((feature) => (
                        <li key={feature} className={`flex items-start gap-3 text-sm ${sk.muted}`}>
                          <Check className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${isFeatured ? sk.brandText : sk.strong}`} strokeWidth={1.75} />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </Reveal>

        {/* Matrice de capabilități: fapte, fără superlative. Oglindește regulile din lib/plan/tiers.ts */}
        <Reveal delay={120}>
          <div className="mt-16">
            <p className={`${EYEBROW} ${sk.dim}`}>{t('Ce include fiecare plan', 'What each plan includes')}</p>
            <div className={`mt-5 grid grid-cols-1 md:grid-cols-3 gap-px border rounded-md overflow-hidden ${sk.line} ${sk.gap}`}>
              {(['starter', 'pro', 'agency'] as const).map((id) => {
                const plan = PRICING_PLANS.find((p) => p.id === id);
                return (
                  <div key={id} className={`p-6 ${sk.cell}`}>
                    <p className={`text-sm font-medium ${sk.strong}`}>{plan ? t(plan.nameRo, plan.nameEn) : id}</p>
                    <p className={`mt-2 text-xs leading-relaxed ${sk.muted}`}>{t(TIER_WORKFLOWS[id].ro, TIER_WORKFLOWS[id].en)}</p>
                  </div>
                );
              })}
            </div>
            <div className={`mt-px border border-t-0 overflow-x-auto ${sk.line}`}>
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead>
                  <tr className={`border-b ${sk.line} ${EYEBROW} ${sk.dim}`}>
                    <th scope="col" className="px-5 h-10 font-normal">{t('Funcționalitate', 'Feature')}</th>
                    <th scope="col" className="px-5 h-10 font-normal">Studio</th>
                    <th scope="col" className="px-5 h-10 font-normal">Professional</th>
                    <th scope="col" className="px-5 h-10 font-normal">Business</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${sk.divide}`}>
                  {CAPABILITY_MATRIX.map((row) => (
                    <tr key={row.en} className={sk.rowHover}>
                      <th scope="row" className={`px-5 py-3 font-normal ${sk.strong}`}>{t(row.ro, row.en)}</th>
                      {([row.starter, row.pro, row.agency] as const).map((value, i) => (
                        <td key={i} className="px-5 py-3">
                          {typeof value === 'boolean' ? (
                            value ? (
                              <Check className={`w-3.5 h-3.5 ${sk.accent}`} strokeWidth={1.75} aria-label={t('Inclus', 'Included')} />
                            ) : (
                              <Minus className={`w-3.5 h-3.5 ${sk.dim}`} strokeWidth={1.5} aria-label={t('Neinclus', 'Not included')} />
                            )
                          ) : (
                            <span className={`font-mono text-xs tabular-nums ${sk.muted}`}>{t(value.ro, value.en)}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`mt-4 text-xs ${sk.dim}`}>
              {t('Portalul B2B este inclus doar în planul Business. ', 'The B2B portal is included in the Business plan only. ')}
              <Link href="/b2b" className={`underline underline-offset-2 ${sk.muted}`}>{t('Descoperă portalul', 'Explore the portal')}</Link>
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
