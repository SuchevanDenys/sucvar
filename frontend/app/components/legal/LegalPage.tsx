// app/components/legal/LegalPage.tsx — șablonul comun al paginilor legale (/termeni, /confidentialitate, /rambursare).
// Conținutul descrie EXACT cum funcționează aplicația (Supabase, Stripe, Replicate, localStorage) și este
// un model redactat pentru lucrarea de licență: înainte de o lansare comercială trebuie validat de un jurist.
"use client";

import React from 'react';
import Link from 'next/link';
import Navbar from '@/app/components/layout/Navbar';
import { getUi } from '@/app/lib/theme/tokens';
import { usePrefs } from '@/app/lib/theme/usePrefs';
import { tr } from '@/app/lib/i18n';

export interface LegalSection {
  titleRo: string;
  titleEn: string;
  ro: string[];
  en: string[];
}

export const LEGAL_LAST_UPDATED = '15.11.2026';

/** Adresa de contact a operatorului; se configurează prin NEXT_PUBLIC_CONTACT_EMAIL. */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || '';

export default function LegalPage({
  titleRo,
  titleEn,
  sections,
}: {
  titleRo: string;
  titleEn: string;
  sections: LegalSection[];
}) {
  const { lang, isDark } = usePrefs();
  const ui = getUi(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const contact = CONTACT_EMAIL || t('[adresa de contact — de completat]', '[contact address — to be completed]');

  return (
    <div className={`min-h-screen font-sans pb-24 transition-colors ${ui.page}`}>
      <Navbar />
      <article className="max-w-3xl mx-auto px-4 sm:px-6 pt-12 space-y-8">
        <header className="space-y-2">
          <p className={`text-[11px] uppercase tracking-[0.28em] ${ui.muted}`}>{t('Informații legale', 'Legal')}</p>
          <h1 className="text-3xl sm:text-[2.4rem] font-semibold leading-[1.08] tracking-tight">{t(titleRo, titleEn)}</h1>
          <p className={`text-xs font-mono ${ui.muted}`}>
            {t('Ultima actualizare', 'Last updated')}: {LEGAL_LAST_UPDATED} · {t('Contact', 'Contact')}: {contact}
          </p>
        </header>

        {sections.map((s, i) => (
          <section key={s.titleRo} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em]">
              {i + 1}. {t(s.titleRo, s.titleEn)}
            </h2>
            {(tr(lang, s.ro, s.en)).map((p) => (
              <p key={p} className={`text-sm leading-relaxed ${ui.muted}`}>{p}</p>
            ))}
          </section>
        ))}

        <nav className={`flex flex-wrap gap-x-6 gap-y-2 pt-6 border-t text-xs ${ui.muted}`} aria-label={t('Documente legale', 'Legal documents')}>
          <Link href="/termeni" className="underline underline-offset-4">{t('Termeni și condiții', 'Terms')}</Link>
          <Link href="/confidentialitate" className="underline underline-offset-4">{t('Confidențialitate', 'Privacy')}</Link>
          <Link href="/rambursare" className="underline underline-offset-4">{t('Anulare și rambursare', 'Cancellation & refunds')}</Link>
        </nav>
      </article>
    </div>
  );
}
