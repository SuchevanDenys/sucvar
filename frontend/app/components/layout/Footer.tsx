// app/components/layout/Footer.tsx
import React from 'react';
import Link from 'next/link';
import SucvarLogo from '@/app/components/layout/SucvarLogo';
import { CONTAINER, EYEBROW, bandClass, getSkin } from '@/app/lib/theme/skin';
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
    <footer className={`relative border-t pb-10 pt-16 transition-colors duration-500 ${sk.line} ${bandClass(isDark)}`}>
      {/* Filet de șampanie centrat pe linia de sus: semnătura discretă a finalului de pagină */}
      <span aria-hidden className={`pointer-events-none absolute left-1/2 top-0 h-px w-24 -translate-x-1/2 -translate-y-px ${sk.brassDot}`} />
      <div className={`${CONTAINER} flex flex-col gap-6 md:flex-row md:items-center md:justify-between`}>
        <div className="flex items-center gap-4">
          <SucvarLogo size={24} withWordmark isDark={isDark} />
          <span className={`text-xs ${sk.dim}`}>{t('Arhitectură interioară, randare AI și devize precise', 'Interior architecture, AI rendering and precise estimates')}</span>
        </div>
        <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 ${EYEBROW} ${sk.muted}`}>
          <Link href="/termeni" className={`underline-offset-4 decoration-1 hover:underline ${sk.strong} ${isDark ? 'hover:text-[#D65D7B]' : 'hover:text-[#5C1628]'}`}>
            {t('Termeni', 'Terms')}
          </Link>
          <Link href="/confidentialitate" className={`underline-offset-4 decoration-1 hover:underline ${sk.strong} ${isDark ? 'hover:text-[#D65D7B]' : 'hover:text-[#5C1628]'}`}>
            {t('Confidențialitate', 'Privacy')}
          </Link>
          <Link href="/rambursare" className={`underline-offset-4 decoration-1 hover:underline ${sk.strong} ${isDark ? 'hover:text-[#D65D7B]' : 'hover:text-[#5C1628]'}`}>
            {t('Anulare și rambursare', 'Cancellation & refunds')}
          </Link>
          <span className={`tabular-nums ${sk.dim}`}>© {COPYRIGHT_YEAR} SUCVAR · Suchevan Denys</span>
        </div>
      </div>
    </footer>
  );
}
