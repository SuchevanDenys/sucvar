// app/lib/plan/useEnterpriseAccess.ts
// Whether the current session may use the /b2b workspace — the SAME rule as the API (RequireAgency):
//   effective 'agency' tier ⇒ access · active administrator (profiles.role = 'admin', from GET /api/profile) ⇒ access.
// Secure default: anything unknown is NOT enterprise. UX gate only — the API enforces it.
//
// Flux de acces B2B:
//   sesiune Supabase → profiles.subscription_tier === 'agency'           ⇒ acces
//   sesiune Supabase reală + profiles.role === 'admin' (verificat de API)  ⇒ acces (administrator)
//   starter / pro / vizitator / profil demo cu plan mai mic               ⇒ poarta „Enterprise restricționat"
// Rolul de administrator vine DOAR de la server (nu din localStorage sau din variabile de build), deci un
// profil demo nu poate obține drepturi de admin.
"use client";

import { useAccountRole } from '@/app/lib/admin/useAccountRole';
import { hasB2bAccess } from '@/app/lib/plan/tiers';
import { usePlan } from '@/app/lib/plan/usePlan';

export function useEnterpriseAccess() {
  const plan = usePlan();
  const account = useAccountRole();
  const realSession = plan.isSignedIn && !plan.isDemo;
  const isAdmin = realSession && account.isAdmin;
  return {
    // Rolul contează doar pentru sesiuni reale fără plan Agency: altfel nu așteptăm după /api/profile
    isChecking: plan.isLoading || (realSession && !hasB2bAccess(plan.tier) && account.isLoading),
    isSignedIn: plan.isSignedIn,
    email: plan.email,
    planId: isAdmin ? 'agency' : plan.tier,
    isEnterprise: hasB2bAccess(plan.tier) || isAdmin,
  };
}
