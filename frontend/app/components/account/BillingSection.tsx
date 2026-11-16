// 03 · Abonament, cotă AI & facturare — cardul de abonament (Stripe Portal inclus) + bara de consum.
"use client";

import React from 'react';
import Link from 'next/link';
import { SubscriptionCard } from '@/app/components/ui/SubscriptionCard';
import type { UsePlan } from '@/app/lib/plan/usePlan';
import type { ProfileView } from '@/app/lib/profile/client';
import { EYEBROW_UI, Section, formatDate, type Ui } from './shared';
import { tr } from '@/app/lib/i18n';
import type { Language } from '@/app/types';

export default function BillingSection({
  profile, plan, ui, lang, isDark,
}: { profile: ProfileView; plan: UsePlan; ui: Ui; lang: Language; isDark: boolean }) {
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const { usage } = profile;
  const limited = usage.generationsLimit !== null;
  const ratio = limited ? Math.min(1, usage.generationsUsed / Math.max(1, usage.generationsLimit!)) : 1;
  const left = limited ? Math.max(0, usage.generationsLimit! - usage.generationsUsed) : null;

  const stat = (label: string, value: React.ReactNode) => (
    <div className={`p-4 rounded-sm ${ui.soft}`}>
      <p className={`${EYEBROW_UI} ${ui.muted}`}>{label}</p>
      <p className="mt-2 text-2xl font-mono font-semibold tabular-nums">{value}</p>
    </div>
  );

  return (
    <Section index="03" title={t('Abonament & cotă AI', 'Subscription & AI quota')} ui={ui}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className={`${EYEBROW_UI} ${ui.muted}`}>
            {t('Generări AI luna aceasta', 'AI generations this month')} · {t('din', 'since')} {formatDate(usage.periodStart, lang)}
          </p>
          <p className="font-mono text-sm tabular-nums">
            {limited ? `${usage.generationsUsed} / ${usage.generationsLimit}` : `${usage.generationsUsed} · ${t('nelimitat', 'unlimited')}`}
          </p>
        </div>
        {/* Bară monocromă: plin = consumat */}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={limited ? usage.generationsLimit! : usage.generationsUsed}
          aria-valuenow={usage.generationsUsed}
          aria-label={t('Consum generări AI', 'AI generation usage')}
          className={`h-2 w-full rounded-full overflow-hidden ${ui.soft}`}
        >
          <div className={`h-full rounded-full ${isDark ? 'bg-[#C94A6A]' : 'bg-[#5C1628]'} ${limited ? '' : 'opacity-30'}`} style={{ width: `${ratio * 100}%` }} />
        </div>
        <p className={`text-xs ${ui.muted}`}>
          {limited
            ? left === 0
              ? t('Ai folosit toate generările gratuite din această lună.', 'You have used all free generations this month.')
              : t(`Îți mai rămân ${left} generări gratuite.`, `${left} free generations left.`,
            `Il vous reste ${left} générations gratuites.`)
            : t('Planul tău include generări nelimitate.', 'Your plan includes unlimited generations.')}
          {limited && (
            <>
              {' '}
              <Link href="/#planuri" className="underline underline-offset-4">{t('Treci pe Professional', 'Upgrade to Professional')}</Link>
            </>
          )}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {stat(t('Proiecte', 'Projects'), usage.projectsTotal)}
        {stat(t('Publice', 'Public'), usage.projectsPublic)}
        {stat(t('Devize B2B', 'B2B quotes'), usage.estimatesTotal)}
      </div>

      <SubscriptionCard plan={plan} lang={lang} isDark={isDark} />
    </Section>
  );
}
