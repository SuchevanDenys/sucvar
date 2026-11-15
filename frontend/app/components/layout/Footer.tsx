// app/components/layout/Footer.tsx
import React from 'react';
import Link from 'next/link';
import SucvarLogo from '@/app/components/layout/SucvarLogo';
import { CONTAINER, EYEBROW, getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';
import { tr } from '@/app/lib/i18n';

// Fixed year (no new Date() during render, it breaks Next.js 16 prerendering)
const COPYRIGHT_YEAR = 2026;

// Fără „telemetrie” statică: valorile inventate (latență, uptime) ar fi afirmații false față de utilizatori.
// Starea reală a API-ului se vede la GET /health pe backend.

export default function Footer({ lang, isDark }: { lang: Language; isDark: boolean }) {
  const sk = getSkin(isDark);
  const t = (textRo: string, textEn: string, fr?: string) => tr(lang, textRo, textEn, fr);

  return (
    <footer className={`border-t pb-10 pt-16 ${sk.line}`}>
      <div className={`${CONTAINER} flex flex-col gap-6 md:flex-row md:items-center md:justify-between`}>
        <div className="flex items-center gap-4">
          <SucvarLogo size={24} withWordmark isDark={isDark} />
          <span className={`text-xs ${sk.dim}`}>{t('Arhitectură interioară, randare AI și devize precise', 'Interior architecture, AI rendering and precise estimates')}</span>
        </div>
        <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 ${EYEBROW} ${sk.muted}`}>
          <Link href="/termeni" className={`hover:underline underline-offset-4 ${sk.strong}`}>
            {t('Termeni', 'Terms')}
          </Link>
          <Link href="/confidentialitate" className={`hover:underline underline-offset-4 ${sk.strong}`}>
            {t('Confidențialitate', 'Privacy')}
          </Link>
          <Link href="/rambursare" className={`hover:underline underline-offset-4 ${sk.strong}`}>
            {t('Anulare și rambursare', 'Cancellation & refunds')}
          </Link>
          <span className={`tabular-nums ${sk.dim}`}>© {COPYRIGHT_YEAR} SUCVAR · Suchevan Denys</span>
        </div>
      </div>
    </footer>
  );
}
