// app/components/PlanBadge.tsx
// Badge „STARTER" / „PRO" / „AGENCY" afișat în Navbar, lângă widgetul de cont.
// Apare doar pentru utilizatori autentificați (cont real sau profil demo).
// Planul exact (inclusiv 'agency') este rezolvat direct prin resolvePlan(), deci
// badge-ul este corect chiar dacă usePlan() expune doar isPro.
"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePlan } from '@/app/lib/plan/usePlan';
import { PLAN_EVENT, resolvePlan } from '@/app/lib/plan/client';
import type { PlanTier } from '@/app/types';
import { PRICING_HREF } from '@/app/lib/scroll';
import { tr } from '@/app/lib/i18n';
import type { Language } from '@/app/types';

interface PlanBadgeProps {
  isDark: boolean;
  lang: Language;
}

interface HookShape {
  isPro?: boolean;
  isAgency?: boolean;
  isSignedIn?: boolean;
  isLoading?: boolean;
  used?: number;
  limit?: number;
  tier?: unknown;
}

export default function PlanBadge({ isDark, lang }: PlanBadgeProps) {
  const hook = usePlan() as unknown as HookShape;
  const { isSignedIn, isLoading, used, limit } = hook;

  // Planul real, rezolvat direct (și re-rezolvat la fiecare schimbare de plan)
  const [tier, setTier] = useState<PlanTier | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      resolvePlan()
        .then((p) => alive && setTier(p.tier))
        .catch(() => undefined);
    };
    load();
    window.addEventListener(PLAN_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(PLAN_EVENT, load);
    };
  }, []);

  if (isLoading || !isSignedIn) return null;

  const isAgency =
    tier === 'agency' ||
    hook.isAgency === true ||
    (typeof hook.tier === 'string' && hook.tier.trim().toLowerCase() === 'agency');
  // Dacă DB-ul a răspuns, el are prioritate; hook-ul e doar fallback cât timp se încarcă.
  const isPro = !isAgency && (tier !== null ? tier === 'pro' : hook.isPro === true);

  const base =
    'inline-flex items-center gap-1.5 h-6 px-2 rounded-sm text-[10px] font-semibold uppercase tracking-widest font-mono touch-manipulation transition-opacity hover:opacity-100';

  if (isAgency) {
    return (
      <Link
        href="/b2b"
        title={
          tr(lang, 'Plan Business — proiecte nelimitate și portalul B2B pentru echipă', 'Business plan — unlimited projects and the team B2B portal')
        }
        className={`${base} border opacity-100 ${
          isDark
            ? 'border-white bg-white text-[#111111]'
            : 'border-[#111111] bg-[#111111] text-white'
        }`}
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full bg-current`}
        />
        BUSINESS
      </Link>
    );
  }

  if (isPro) {
    return (
      <Link
        href="/account"
        title={tr(lang, 'Plan Professional — proiecte nelimitate', 'Professional plan — unlimited projects')}
        className={`${base} ${isDark ? 'bg-white text-[#111111]' : 'bg-[#111111] text-white'}`}
      >
        PRO
      </Link>
    );
  }

  return (
    <Link
      href={PRICING_HREF}
      title={
        tr(lang, `Plan Studio (gratuit) — ${used ?? 0} din ${limit ?? 0} proiecte folosite luna aceasta. Vezi planurile.`, `Studio plan (free) — ${used ?? 0} of ${limit ?? 0} projects used this month. View plans.`, `Offre Studio (gratuite) — ${used ?? 0} projets sur ${limit ?? 0} utilisés ce mois-ci. Voir les offres.`)
      }
      className={`${base} border opacity-70 ${isDark ? 'border-[#3F3F46] text-[#A1A1AA]' : 'border-[#BDBDBD] text-[#666666]'}`}
    >
      STUDIO
    </Link>
  );
}