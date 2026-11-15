// app/admin/page.tsx — panoul de administrare SUCVAR (4 taburi editoriale).
//   01 Prezentare · 02 Utilizatori & abonamente · 03 Moderare portaluri /p/[id] · 04 Setări SaaS & jurnal de audit.
// Poarta de aici este doar UX (rolul din GET /api/profile). Autorizarea reală: politica AdminOnly pe /api/admin/**,
// care recitește profiles.role / is_banned din PostgreSQL la fiecare cerere.
"use client";

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import Navbar from '@/app/components/layout/Navbar';
import OverviewTab from '@/app/components/admin/OverviewTab';
import PortalsTab from '@/app/components/admin/PortalsTab';
import SettingsTab from '@/app/components/admin/SettingsTab';
import UsersTab from '@/app/components/admin/UsersTab';
import type { AdminCtx } from '@/app/components/admin/shared';
import { useAccountRole } from '@/app/lib/admin/useAccountRole';
import { CONTAINER, EYEBROW, getSkin, ruleClass } from '@/app/lib/theme/skin';
import { usePrefs } from '@/app/lib/theme/usePrefs';
import { tr } from '@/app/lib/i18n';

type Tab = 'overview' | 'users' | 'portals' | 'settings';

export default function AdminPage() {
  const { isDark, lang } = usePrefs();
  const sk = getSkin(isDark);
  const account = useAccountRole();
  const [tab, setTab] = useState<Tab>('overview');

  const ctx = useMemo<AdminCtx>(() => ({ sk, isDark, lang, t: (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr) }), [sk, isDark, lang]);
  const { t } = ctx;

  const tabs: { id: Tab; index: string; label: string }[] = [
    { id: 'overview', index: '01', label: t('Prezentare', 'Overview') },
    { id: 'users', index: '02', label: t('Utilizatori & abonamente', 'Users & subscriptions') },
    { id: 'portals', index: '03', label: t('Portaluri publice', 'Public portals') },
    { id: 'settings', index: '04', label: t('Setări & audit', 'Settings & audit log') },
  ];

  return (
    <div className={`min-h-screen font-sans pb-24 transition-colors ${sk.page}`}>
      <Navbar />

      {account.isLoading && (
        <div className={`${CONTAINER} pt-12 space-y-6`} aria-busy="true">
          <div className={`h-10 w-64 animate-pulse ${isDark ? 'bg-[#1C1C1F]' : 'bg-[#F5F5F5]'}`} />
          <div className={`h-64 animate-pulse ${isDark ? 'bg-[#141416]' : 'bg-[#F5F5F5]'}`} />
        </div>
      )}

      {!account.isLoading && !account.isAdmin && (
        <main className={`${CONTAINER} pt-20 sm:pt-28`}>
          <div className={`max-w-xl border p-8 sm:p-10 space-y-6 ${sk.card}`}>
            <p className={`flex items-center gap-3 ${EYEBROW} ${sk.dim}`}>
              <ShieldAlert className="w-3.5 h-3.5" />
              <span className={sk.strong}>403</span>
              <span className={`h-px w-8 ${ruleClass(isDark)}`} />
              {t('Acces restricționat', 'Restricted access')}
            </p>
            <h1 className={`text-3xl font-semibold tracking-tight ${sk.strong}`}>{t('Zonă rezervată administratorilor.', 'Administrators only.')}</h1>
            <p className={`text-sm leading-relaxed ${sk.muted}`}>
              {account.isSignedIn
                ? t('Contul tău nu are rolul de administrator.', 'Your account does not have the administrator role.')
                : t('Autentifică-te cu un cont de administrator pentru a continua.', 'Sign in with an administrator account to continue.')}
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/" className={`inline-flex items-center h-10 px-5 ${EYEBROW} font-semibold ${sk.btn}`}>
                {t('Înapoi la pagina principală', 'Back to home')}
              </Link>
              {!account.isSignedIn && (
                <Link href="/login" className={`inline-flex items-center h-10 px-5 ${EYEBROW} font-semibold ${sk.btnGhost}`}>
                  {t('Autentificare', 'Sign in')}
                </Link>
              )}
            </div>
          </div>
        </main>
      )}

      {!account.isLoading && account.isAdmin && (
        <main className={`${CONTAINER} pt-10 sm:pt-14 space-y-8`}>
          <div>
            <p className={`flex items-center gap-3 ${EYEBROW} ${sk.dim}`}>
              <span className={sk.strong}>§ADMIN</span>
              <span className={`h-px w-8 ${ruleClass(isDark)}`} />
              {t('Consola platformei', 'Platform console')}
            </p>
            <h1 className={`mt-4 text-3xl sm:text-[2.4rem] font-semibold leading-[1.08] tracking-tight ${sk.strong}`}>
              SUCVAR <span className={sk.muted}>{t('— administrare', '— administration')}</span>
            </h1>
          </div>

          <div role="tablist" aria-label={t('Secțiuni', 'Sections')} className={`flex overflow-x-auto border-b ${sk.line}`}>
            {tabs.map((x) => {
              const active = tab === x.id;
              return (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  id={`admin-tab-${x.id}`}
                  aria-selected={active}
                  aria-controls={`admin-panel-${x.id}`}
                  onClick={() => setTab(x.id)}
                  className={`relative shrink-0 h-12 px-4 first:pl-0 inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] cursor-pointer transition-colors ${
                    active ? sk.strong : `${sk.muted} ${isDark ? 'hover:text-white' : 'hover:text-[#111111]'}`
                  }`}
                >
                  <span className={`font-mono ${sk.dim}`}>{x.index}</span>
                  {x.label}
                  <span className={`absolute left-0 right-0 -bottom-px h-[2px] ${active ? (isDark ? 'bg-white' : 'bg-[#111111]') : 'bg-transparent'}`} />
                </button>
              );
            })}
          </div>

          <section role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-tab-${tab}`}>
            {tab === 'overview' && <OverviewTab ctx={ctx} />}
            {tab === 'users' && <UsersTab ctx={ctx} selfId={account.userId} />}
            {tab === 'portals' && <PortalsTab ctx={ctx} />}
            {tab === 'settings' && <SettingsTab ctx={ctx} />}
          </section>
        </main>
      )}
    </div>
  );
}
