// app/components/admin/UsersTab.tsx — Tab 2: utilizatori & abonamente (căutare, filtre, sertar de acțiuni).
// Fiecare acțiune = un PATCH /api/admin/users/{id}; serverul o jurnalizează în admin_audit_logs și refuză
// (400 SELF_PROTECTION) blocarea sau retrogradarea propriului cont — UI-ul dezactivează oricum aceste butoane.
"use client";

import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { fetchUsers, updateUser, type AdminUser, type Paged, type UserFilters, type UserPatch } from '@/app/lib/admin/client';
import { EYEBROW } from '@/app/lib/theme/skin';
import type { PlanTier } from '@/app/types';
import { Badge, Button, Drawer, ErrorLine, Pager, errorMessage, formatDateTime, formatInt, inputClass, selectClass, type AdminCtx } from './shared';

const PAGE_SIZE = 25;
const PLAN_LABEL: Record<PlanTier, string> = { starter: 'Starter', pro: 'Pro', agency: 'Agency' };

type State = { kind: 'loading' } | { kind: 'ready'; data: Paged<AdminUser> } | { kind: 'error'; message: string };

export default function UsersTab({ ctx, selfId }: { ctx: AdminCtx; selfId: string | null }) {
  const { sk, t, lang } = ctx;
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<UserFilters>({ q: '', plan: '', role: '', banned: '', page: 1, pageSize: PAGE_SIZE });
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [selected, setSelected] = useState<AdminUser | null>(null);

  useEffect(() => {
    let alive = true;
    fetchUsers(filters)
      .then((data) => alive && setState({ kind: 'ready', data }))
      .catch((e: unknown) => alive && setState({ kind: 'error', message: errorMessage(e, ctx) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const apply = (next: Partial<UserFilters>) => {
    setState({ kind: 'loading' });
    setFilters((f) => ({ ...f, page: 1, ...next }));
  };

  const onUpdated = (user: AdminUser) => {
    setSelected(user);
    setState((s) => (s.kind === 'ready' ? { kind: 'ready', data: { ...s.data, items: s.data.items.map((u) => (u.id === user.id ? user : u)) } } : s));
  };

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q: search });
        }}
      >
        <div className="relative flex-1 min-w-[220px]">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${sk.dim}`} aria-hidden />
          <input
            type="search"
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Email, nume sau firmă…', 'Email, name or company…')}
            aria-label={t('Caută utilizatori', 'Search users')}
            className={`${inputClass(ctx)} pl-9`}
          />
        </div>
        <select aria-label="Plan" value={filters.plan} onChange={(e) => apply({ plan: e.target.value as UserFilters['plan'] })} className={selectClass(ctx)}>
          <option value="" className={sk.option}>{t('Toate planurile', 'All plans')}</option>
          {(Object.keys(PLAN_LABEL) as PlanTier[]).map((p) => (
            <option key={p} value={p} className={sk.option}>{PLAN_LABEL[p]}</option>
          ))}
        </select>
        <select aria-label={t('Rol', 'Role')} value={filters.role} onChange={(e) => apply({ role: e.target.value as UserFilters['role'] })} className={selectClass(ctx)}>
          <option value="" className={sk.option}>{t('Toate rolurile', 'All roles')}</option>
          <option value="user" className={sk.option}>User</option>
          <option value="admin" className={sk.option}>Admin</option>
        </select>
        <select aria-label={t('Stare', 'Status')} value={filters.banned} onChange={(e) => apply({ banned: e.target.value as UserFilters['banned'] })} className={selectClass(ctx)}>
          <option value="" className={sk.option}>{t('Toate stările', 'Any status')}</option>
          <option value="false" className={sk.option}>{t('Active', 'Active')}</option>
          <option value="true" className={sk.option}>{t('Blocate', 'Banned')}</option>
        </select>
        <Button ctx={ctx} type="submit">{t('Caută', 'Search')}</Button>
      </form>

      {state.kind === 'error' && <ErrorLine ctx={ctx} message={state.message} />}

      <div className={`border overflow-x-auto ${sk.card}`}>
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className={`border-b text-left ${sk.line} ${EYEBROW} ${sk.dim}`}>
              <th className="font-normal px-4 h-10">{t('Utilizator', 'User')}</th>
              <th className="font-normal px-4">Plan</th>
              <th className="font-normal px-4">{t('Rol / stare', 'Role / status')}</th>
              <th className="font-normal px-4 text-right">{t('Generări AI', 'AI renders')}</th>
              <th className="font-normal px-4 text-right">{t('Proiecte', 'Projects')}</th>
              <th className="font-normal px-4 hidden lg:table-cell">{t('Creat', 'Joined')}</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${sk.divide}`}>
            {state.kind === 'loading' &&
              Array.from({ length: 6 }, (_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-4 py-3">
                    <div className={`h-6 animate-pulse ${ctx.isDark ? 'bg-[#231B1E]' : 'bg-[#F5F2EF]'}`} />
                  </td>
                </tr>
              ))}
            {state.kind === 'ready' && state.data.items.length === 0 && (
              <tr>
                <td colSpan={6} className={`px-4 py-10 text-center ${sk.muted}`}>{t('Niciun utilizator găsit.', 'No users found.')}</td>
              </tr>
            )}
            {state.kind === 'ready' &&
              state.data.items.map((u) => (
                <tr key={u.id} onClick={() => setSelected(u)} className={`cursor-pointer transition-colors ${sk.rowHover}`}>
                  <td className="px-4 py-3 max-w-[280px]">
                    <button type="button" className="text-left w-full cursor-pointer" onClick={() => setSelected(u)}>
                      <span className="block font-medium truncate">{u.email ?? '—'}</span>
                      <span className={`block text-xs truncate ${sk.muted}`}>{[u.fullName, u.companyName].filter(Boolean).join(' · ') || '—'}</span>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge ctx={ctx} solid={u.plan !== 'starter'}>{PLAN_LABEL[u.plan]}</Badge>
                      {u.plan !== 'starter' && !u.hasStripeSubscription && <Badge ctx={ctx}>{t('Manual', 'Manual')}</Badge>}
                      {u.interval === 'year' && <Badge ctx={ctx}>{t('Anual', 'Yearly')}</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {u.role === 'admin' && <Badge ctx={ctx} solid>Admin</Badge>}
                      {u.isBanned ? <Badge ctx={ctx} danger>{t('Blocat', 'Banned')}</Badge> : <span className={`${EYEBROW} ${sk.muted}`}>{t('Activ', 'Active')}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatInt(u.generationsUsed, lang)} / {u.generationsLimit === null ? '∞' : formatInt(u.generationsLimit, lang)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatInt(u.projectsCount, lang)}</td>
                  <td className={`px-4 py-3 hidden lg:table-cell tabular-nums text-xs ${sk.muted}`}>{formatDateTime(u.createdAt, lang)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {state.kind === 'ready' && (
        <Pager
          ctx={ctx}
          page={state.data.page}
          pageSize={state.data.pageSize}
          total={state.data.total}
          onPage={(page) => {
            setState({ kind: 'loading' });
            setFilters((f) => ({ ...f, page }));
          }}
        />
      )}

      {selected && <UserDrawer key={selected.id} ctx={ctx} user={selected} isSelf={selected.id === selfId} onClose={() => setSelected(null)} onUpdated={onUpdated} />}
    </div>
  );
}

function UserDrawer({ ctx, user, isSelf, onClose, onUpdated }: { ctx: AdminCtx; user: AdminUser; isSelf: boolean; onClose: () => void; onUpdated: (u: AdminUser) => void }) {
  const { sk, t, lang } = ctx;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanTier>(user.plan);
  const [reason, setReason] = useState('');

  const run = async (key: string, patch: UserPatch, done: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateUser(user.id, patch);
      onUpdated(updated);
      setPlan(updated.plan);
      setNotice(done);
      if (key === 'ban') setReason('');
    } catch (e) {
      setError(errorMessage(e, ctx));
    } finally {
      setBusy(null);
    }
  };

  const block = (label: string, children: React.ReactNode) => (
    <div className={`space-y-3 border-t pt-5 ${sk.line}`}>
      <p className={`${EYEBROW} ${sk.dim}`}>{label}</p>
      {children}
    </div>
  );

  return (
    <Drawer ctx={ctx} title={t('Utilizator', 'User')} onClose={onClose}>
      <div className="space-y-1">
        <p className="font-medium break-all">{user.email ?? '—'}</p>
        <p className={`text-xs ${sk.muted}`}>{[user.fullName, user.companyName].filter(Boolean).join(' · ') || '—'}</p>
        <p className={`text-[11px] font-mono break-all ${sk.dim}`}>{user.id}</p>
        <div className="flex flex-wrap gap-1.5 pt-2">
          <Badge ctx={ctx} solid={user.plan !== 'starter'}>{PLAN_LABEL[user.plan]}</Badge>
          {user.role === 'admin' && <Badge ctx={ctx} solid>Admin</Badge>}
          {user.isBanned && <Badge ctx={ctx} danger>{t('Blocat', 'Banned')}</Badge>}
          {isSelf && <Badge ctx={ctx}>{t('Contul tău', 'You')}</Badge>}
        </div>
      </div>

      <ErrorLine ctx={ctx} message={error} />
      {notice && <p role="status" className={`text-xs font-medium ${sk.strong}`}>{notice}</p>}

      {block(
        t('Abonament', 'Subscription'),
        <>
          <div role="group" aria-label="Plan" className={`grid grid-cols-3 border ${sk.line}`}>
            {(Object.keys(PLAN_LABEL) as PlanTier[]).map((p) => (
              <button key={p} type="button" aria-pressed={plan === p} onClick={() => setPlan(p)} className={`h-9 ${EYEBROW} cursor-pointer ${plan === p ? sk.segOn : sk.segOff}`}>
                {PLAN_LABEL[p]}
              </button>
            ))}
          </div>
          <dl className={`grid grid-cols-2 gap-y-1 text-xs tabular-nums ${sk.muted}`}>
            <dt>Stripe</dt>
            <dd className="text-right">{user.hasStripeSubscription ? t('abonament activ', 'subscription') : '—'}</dd>
            <dt>{t('Sfârșit perioadă', 'Period end')}</dt>
            <dd className="text-right">{formatDateTime(user.currentPeriodEnd, lang)}</dd>
          </dl>
          {user.hasStripeSubscription && (
            <p className={`text-xs ${sk.muted}`}>
              {t(
                'Schimbarea nu modifică facturarea Stripe: la următoarea plată, webhook-ul resincronizează planul. Pentru anulare folosește Stripe Dashboard.',
                'This does not change Stripe billing: the next payment webhook re-syncs the plan. Cancel in the Stripe Dashboard.',
              )}
            </p>
          )}
          <Button ctx={ctx} busy={busy === 'plan'} disabled={busy !== null || plan === user.plan} onClick={() => run('plan', { plan }, t('Plan actualizat.', 'Plan updated.'))}>
            {t('Aplică planul', 'Apply plan')}
          </Button>
        </>,
      )}

      {block(
        t('Cotă generări AI', 'AI generation quota'),
        <>
          <p className="text-2xl font-semibold tabular-nums">
            {formatInt(user.generationsUsed, lang)}
            <span className={`text-base ${sk.muted}`}> / {user.generationsLimit === null ? '∞' : formatInt(user.generationsLimit, lang)}</span>
          </p>
          <p className={`text-xs tabular-nums ${sk.muted}`}>
            {t('Credite bonus', 'Bonus credits')}: {formatInt(user.bonusGenerations, lang)}
            {user.quotaResetAt && ` · ${t('resetat', 'reset')} ${formatDateTime(user.quotaResetAt, lang)}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button ctx={ctx} ghost busy={busy === 'q10'} disabled={busy !== null} onClick={() => run('q10', { quotaDelta: 10 }, t('+10 credite AI.', '+10 AI credits.'))}>
              +10
            </Button>
            <Button ctx={ctx} ghost busy={busy === 'q50'} disabled={busy !== null} onClick={() => run('q50', { quotaDelta: 50 }, t('+50 credite AI.', '+50 AI credits.'))}>
              +50
            </Button>
            <Button ctx={ctx} ghost busy={busy === 'reset'} disabled={busy !== null} onClick={() => run('reset', { resetQuota: true }, t('Consumul lunar a fost resetat.', 'Monthly usage reset.'))}>
              {t('Resetează consumul', 'Reset usage')}
            </Button>
          </div>
        </>,
      )}

      {block(
        t('Rol', 'Role'),
        <>
          {user.role === 'admin' ? (
            <Button ctx={ctx} ghost busy={busy === 'role'} disabled={busy !== null || isSelf} onClick={() => run('role', { role: 'user' }, t('Rol de admin retras.', 'Admin role revoked.'))}>
              {t('Retrage rolul de admin', 'Revoke admin')}
            </Button>
          ) : (
            <Button ctx={ctx} ghost busy={busy === 'role'} disabled={busy !== null} onClick={() => run('role', { role: 'admin' }, t('Promovat administrator.', 'Promoted to admin.'))}>
              {t('Promovează administrator', 'Promote to admin')}
            </Button>
          )}
          {isSelf && <p className={`text-xs ${sk.muted}`}>{t('Nu îți poți retrage propriul rol.', 'You cannot revoke your own role.')}</p>}
        </>,
      )}

      {block(
        t('Acces la cont', 'Account access'),
        user.isBanned ? (
          <>
            <p className="text-sm">
              {t('Motiv', 'Reason')}: <span className={sk.muted}>{user.bannedReason ?? '—'}</span>
            </p>
            <Button ctx={ctx} ghost busy={busy === 'ban'} disabled={busy !== null} onClick={() => run('ban', { isBanned: false }, t('Cont deblocat.', 'Account unbanned.'))}>
              {t('Deblochează', 'Unban')}
            </Button>
          </>
        ) : (
          <>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              disabled={isSelf}
              placeholder={t('Motivul blocării (vizibil utilizatorului)…', 'Ban reason (shown to the user)…')}
              aria-label={t('Motivul blocării', 'Ban reason')}
              className={`w-full px-3 py-2 border text-sm resize-y disabled:opacity-50 ${sk.input}`}
            />
            <Button
              ctx={ctx}
              danger
              busy={busy === 'ban'}
              disabled={busy !== null || isSelf}
              onClick={() => run('ban', { isBanned: true, bannedReason: reason.trim() || null }, t('Cont blocat.', 'Account banned.'))}
            >
              {t('Blochează contul', 'Ban account')}
            </Button>
            {isSelf && <p className={`text-xs ${sk.muted}`}>{t('Nu îți poți bloca propriul cont.', 'You cannot ban your own account.')}</p>}
          </>
        ),
      )}
    </Drawer>
  );
}
