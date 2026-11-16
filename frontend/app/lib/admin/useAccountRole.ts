// app/lib/admin/useAccountRole.ts — rolul contului curent (user | admin) + starea de blocare, din GET /api/profile.
//
// Înlocuiește vechea listă NEXT_PUBLIC_ADMIN_EMAILS (doar UX, falsificabilă la build): rolul vine acum din
// `profiles.role`, citit de backend la fiecare cerere. Este tot o informație de UX (link-ul ADMIN, poarta /b2b) —
// autorizarea reală o face API-ul (politica AdminOnly pe /api/admin/**, RequireAgency pe /api/b2b/**).
//
// Un singur request pentru toate componentele (Navbar, /b2b, /admin): rezultatul e păstrat 60 s în memorie
// și invalidat la login / logout / schimbarea contului.
"use client";

import { useEffect, useState } from 'react';
import { ACCOUNT_CHANGE_EVENT } from '@/app/components/layout/AccountWidget';
import { fetchProfile, type AccountRole } from '@/app/lib/profile/client';
import { subscribeToAuthEvents } from '@/app/lib/supabase/auth';

export interface AccountRoleState {
  isLoading: boolean;
  /** false = fără sesiune reală (vizitator / profil demo). */
  isSignedIn: boolean;
  userId: string | null;
  role: AccountRole;
  isAdmin: boolean;
  isBanned: boolean;
  bannedReason: string | null;
}

const INITIAL: AccountRoleState = { isLoading: true, isSignedIn: false, userId: null, role: 'user', isAdmin: false, isBanned: false, bannedReason: null };
const TTL_MS = 60_000;

let cached: { at: number; promise: Promise<AccountRoleState> } | null = null;

async function load(): Promise<AccountRoleState> {
  const r = await fetchProfile();
  if (r.status !== 'ok') return { ...INITIAL, isLoading: false };
  const role: AccountRole = r.data.role === 'admin' ? 'admin' : 'user';
  return {
    isLoading: false,
    isSignedIn: true,
    userId: r.data.account.userId,
    role,
    isAdmin: role === 'admin' && !r.data.isBanned,
    isBanned: r.data.isBanned === true,
    bannedReason: r.data.bannedReason ?? null,
  };
}

/** Shared, de-duplicated fetch of the caller's role (60 s in-memory cache; `force` bypasses it). */
export function loadAccountRole(force = false): Promise<AccountRoleState> {
  if (force || !cached || Date.now() - cached.at > TTL_MS) cached = { at: Date.now(), promise: load() };
  return cached.promise;
}

/** Drops the cached role; called on sign-in / sign-out / account switch. */
export function invalidateAccountRole(): void {
  cached = null;
}

/**
 * Role (`user` | `admin`) and ban state of the signed-in account, for the Navbar ADMIN link, the `/admin` 403 view
 * and the `/b2b` gate. UX only: the API's `AdminOnly` policy re-reads `profiles.role` on every admin request.
 */
export function useAccountRole(): AccountRoleState {
  const [state, setState] = useState<AccountRoleState>(INITIAL);

  useEffect(() => {
    let alive = true;
    const run = (force: boolean) => {
      loadAccountRole(force)
        .then((s) => alive && setState(s))
        .catch(() => alive && setState({ ...INITIAL, isLoading: false }));
    };
    run(false);
    const onChange = () => run(true);
    const unsubscribe = subscribeToAuthEvents(onChange);
    window.addEventListener(ACCOUNT_CHANGE_EVENT, onChange);
    return () => {
      alive = false;
      unsubscribe();
      window.removeEventListener(ACCOUNT_CHANGE_EVENT, onChange);
    };
  }, []);

  return state;
}
