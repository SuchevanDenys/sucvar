// app/account/page.tsx — pagina de profil (alias: /profile).
// Patru secțiuni, toate dintr-un singur agregat al backend-ului (GET /api/profile):
//   01 Identitate · 02 Firmă & setări B2B · 03 Abonament & cotă AI · 04 Portofoliu & linkuri client.
// Profilurile demo (fără sesiune Supabase) nu au profil pe server: li se arată doar abonamentul local.
"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Navbar from '@/app/components/layout/Navbar';
import { notifyAccountChange } from '@/app/components/layout/AccountWidget';
import BillingSection from '@/app/components/account/BillingSection';
import CompanySection from '@/app/components/account/CompanySection';
import IdentitySection from '@/app/components/account/IdentitySection';
import PortfolioSection from '@/app/components/account/PortfolioSection';
import { SubscriptionCard } from '@/app/components/ui/SubscriptionCard';
import { notifyPlanChange } from '@/app/lib/plan/client';
import { usePlan } from '@/app/lib/plan/usePlan';
import { fetchProfile, type ProfileProject, type ProfileView } from '@/app/lib/profile/client';
import { STORAGE_KEYS, removeStorage } from '@/app/lib/storage';
import { signOutUser } from '@/app/lib/supabase/auth';
import { getUi } from '@/app/lib/theme/tokens';
import { usePrefs } from '@/app/lib/theme/usePrefs';
import { tr } from '@/app/lib/i18n';

type LoadState = { kind: 'loading' } | { kind: 'ready'; profile: ProfileView } | { kind: 'auth' } | { kind: 'error'; message: string };

export default function AccountPage() {
  const { lang, isDark } = usePrefs();
  const plan = usePlan();
  const ui = getUi(isDark);
  const router = useRouter();
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchProfile().then((r) => {
      if (!alive) return;
      if (r.status === 'ok') setState({ kind: 'ready', profile: r.data });
      else if (r.status === 'auth') setState({ kind: 'auth' });
      else setState({ kind: 'error', message: r.message });
    });
    return () => {
      alive = false;
    };
  }, [reload]);

  const onSaved = (profile: ProfileView) => {
    setState({ kind: 'ready', profile });
    notifyAccountChange(); // numele / avatarul din Navbar
  };

  const onProjectChange = (project: ProfileProject) =>
    setState((s) => {
      if (s.kind !== 'ready') return s;
      const projects = s.profile.projects.map((p) => (p.id === project.id ? project : p));
      return { kind: 'ready', profile: { ...s.profile, projects, usage: { ...s.profile.usage, projectsPublic: projects.filter((p) => p.isPublic).length } } };
    });

  // Aceeași curățenie ca în /login (sesiune Supabase + profil demo + plan)
  const signOut = async () => {
    await signOutUser();
    removeStorage(STORAGE_KEYS.userEmail);
    removeStorage(STORAGE_KEYS.userRole);
    removeStorage(STORAGE_KEYS.demoMode);
    removeStorage(STORAGE_KEYS.demoTier);
    notifyAccountChange();
    notifyPlanChange();
    router.push('/login');
  };

  return (
    <div className={`min-h-screen font-sans pb-24 transition-colors ${ui.page}`}>
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-12 space-y-6">
        <div className="space-y-1">
          <p className={`text-[11px] uppercase tracking-[0.28em] ${ui.muted}`}>{t('Cont', 'Account')}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{t('Profilul tău', 'Your profile')}</h1>
        </div>

        {state.kind === 'loading' && (
          <div className="space-y-6" aria-busy="true">
            {[0, 1, 2].map((i) => <div key={i} className={`h-48 rounded-md animate-pulse ${ui.soft}`} />)}
          </div>
        )}

        {state.kind === 'auth' && (
          <div className={`p-6 rounded-md border text-sm space-y-4 ${ui.card}`}>
            {plan.isDemo ? (
              <>
                <p>{t('Ești într-un profil Demo (local). Profilul complet, datele firmei și linkurile pentru clienți cer un cont real.', 'You are using a local Demo profile. The full profile, company details and client links need a real account.')}</p>
                <SubscriptionCard plan={plan} lang={lang} isDark={isDark} />
              </>
            ) : (
              <p>{t('Autentifică-te pentru a vedea profilul.', 'Sign in to see your profile.')}</p>
            )}
            <Link href="/login" className={`inline-flex items-center h-10 px-5 rounded-sm text-xs font-semibold uppercase tracking-widest ${ui.btn}`}>
              {t('Autentifică-te', 'Sign in')}
            </Link>
          </div>
        )}

        {state.kind === 'error' && (
          <div className={`p-6 rounded-md border text-sm space-y-4 ${ui.card}`}>
            <p role="alert" className="text-red-600 font-medium">{state.message}</p>
            <button type="button" onClick={() => { setState({ kind: 'loading' }); setReload((n) => n + 1); }} className={`inline-flex items-center h-10 px-5 rounded-sm border text-xs font-semibold uppercase tracking-widest cursor-pointer ${ui.btnGhost}`}>
              {t('Încearcă din nou', 'Try again')}
            </button>
          </div>
        )}

        {state.kind === 'ready' && state.profile.isBanned && (
          <div role="alert" className={`p-5 rounded-md border text-sm space-y-1 ${ui.card} ${isDark ? 'border-red-400/50' : 'border-red-600/40'}`}>
            <p className={`font-semibold ${isDark ? 'text-red-400' : 'text-red-600'}`}>
              {t('Contul tău este suspendat.', 'Your account is suspended.')}
            </p>
            <p className={ui.muted}>
              {state.profile.bannedReason
                ? `${t('Motiv', 'Reason')}: ${state.profile.bannedReason}`
                : t('Studio, B2B și linkurile publice sunt indisponibile. Contactează-ne pentru detalii.', 'Studio, B2B and public links are unavailable. Contact us for details.')}
            </p>
            <p className={ui.muted}>
              {t('Abonamentul îl poți gestiona în continuare din secțiunea de mai jos.', 'You can still manage your subscription below.')}
            </p>
          </div>
        )}

        {state.kind === 'ready' && (
          <>
            <IdentitySection key={`id:${state.profile.account.fullName ?? ''}`} profile={state.profile} ui={ui} lang={lang} onSaved={onSaved} onSignOut={signOut} />
            <CompanySection key={JSON.stringify([state.profile.company, state.profile.defaults])} profile={state.profile} ui={ui} lang={lang} onSaved={onSaved} />
            <BillingSection profile={state.profile} plan={plan} ui={ui} lang={lang} isDark={isDark} />
            <PortfolioSection profile={state.profile} ui={ui} lang={lang} isDark={isDark} onProjectChange={onProjectChange} />
          </>
        )}
      </div>
    </div>
  );
}
