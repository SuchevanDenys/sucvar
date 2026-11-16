// app/components/studio/PlanLimitNotice.tsx
// Studio · 03 — avertisment afișat când planul gratuit și-a consumat generările lunii.
// Doar UX: limita reală este impusă de API (403 LIMIT_REACHED).
"use client";

import React from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { tr } from '@/app/lib/i18n';
import { EYEBROW, getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';

interface PlanLimitNoticeProps {
  lang: Language;
  isDark: boolean;
  used: number;
  limit: number | null;
}

export default function PlanLimitNotice({ lang, isDark, used, limit }: PlanLimitNoticeProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  return (
    <div role="alert" className={`rounded-sm border p-4 space-y-3 ${isDark ? 'border-amber-400/30 bg-amber-400/[0.04]' : 'border-amber-600/30 bg-amber-500/[0.06]'}`}>
      <div className="flex items-start gap-3">
        <Lock className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${isDark ? 'text-amber-400' : 'text-amber-700'}`} />
        <div className="space-y-1">
          <p className={`${EYEBROW} ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
            {t('Ai atins limita lunară de generări', 'Monthly generation limit reached')}
          </p>
          <p className={`text-xs leading-relaxed ${sk.muted}`}>
            {t(
              `Planul Studio (gratuit) include ${limit} proiecte pe lună, iar le-ai folosit pe toate (${used}/${limit}). Treci pe Professional pentru generări nelimitate sau revino luna viitoare.`,
              `The Studio (free) plan includes ${limit} projects per month and you have used them all (${used}/${limit}). Upgrade to Professional for unlimited generations or come back next month.`,
              `L’offre Studio (gratuite) inclut ${limit} projets par mois et vous les avez tous utilisés (${used}/${limit}). Passez à Professional pour des générations illimitées ou revenez le mois prochain.`,
            )}
          </p>
        </div>
      </div>
      <Link
        href="/#planuri"
        className={`inline-flex items-center h-9 px-4 rounded-sm touch-manipulation ${EYEBROW} font-semibold ${sk.btn}`}
      >
        {t('Vezi planurile', 'View plans')}
      </Link>
    </div>
  );
}
