// app/components/layout/StatusPage.tsx — aspectul comun pentru 404 și erorile neprevăzute.
"use client";

import React from 'react';
import Link from 'next/link';
import Navbar from '@/app/components/layout/Navbar';
import { getUi } from '@/app/lib/theme/tokens';
import { usePrefs } from '@/app/lib/theme/usePrefs';
import { tr } from '@/app/lib/i18n';

export default function StatusPage({
  code,
  titleRo,
  titleEn,
  textRo,
  textEn,
  action,
}: {
  code: string;
  titleRo: string;
  titleEn: string;
  textRo: string;
  textEn: string;
  action?: { labelRo: string; labelEn: string; onClick: () => void };
}) {
  const { lang, isDark } = usePrefs();
  const ui = getUi(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  return (
    <div className={`min-h-screen font-sans transition-colors ${ui.page}`}>
      <Navbar />
      <main className="max-w-xl mx-auto px-4 sm:px-6 pt-24 space-y-5 text-center">
        <p className={`text-[11px] font-mono uppercase tracking-[0.28em] ${ui.muted}`}>{code}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t(titleRo, titleEn)}</h1>
        <p className={`text-sm ${ui.muted}`}>{t(textRo, textEn)}</p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className={`inline-flex items-center h-11 px-6 rounded-sm text-xs font-semibold uppercase tracking-widest cursor-pointer ${ui.btn}`}
            >
              {t(action.labelRo, action.labelEn)}
            </button>
          )}
          <Link href="/" className={`inline-flex items-center h-11 px-6 rounded-sm border text-xs font-semibold uppercase tracking-widest ${ui.btnGhost}`}>
            {t('Pagina principală', 'Home')}
          </Link>
        </div>
      </main>
    </div>
  );
}
