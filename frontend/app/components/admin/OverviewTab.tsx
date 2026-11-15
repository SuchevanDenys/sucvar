// app/components/admin/OverviewTab.tsx — Tab 1: KPI-uri, distribuția pe planuri, starea sistemului.
"use client";

import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchOverview, type AdminOverview, type HealthState } from '@/app/lib/admin/client';
import { EYEBROW } from '@/app/lib/theme/skin';
import type { PlanTier } from '@/app/types';
import { Button, ErrorLine, Kpi, Panel, errorMessage, formatDateTime, formatEur, formatInt, type AdminCtx } from './shared';
import { LOCALES } from '@/app/lib/i18n';

type State = { kind: 'loading' } | { kind: 'ready'; data: AdminOverview } | { kind: 'error'; message: string };

const PLANS: { id: PlanTier; label: string }[] = [
  { id: 'starter', label: 'Starter' },
  { id: 'pro', label: 'Pro' },
  { id: 'agency', label: 'Agency' },
];

export default function OverviewTab({ ctx }: { ctx: AdminCtx }) {
  const { sk, t, lang } = ctx;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchOverview()
      .then((data) => alive && setState({ kind: 'ready', data }))
      .catch((e: unknown) => alive && setState({ kind: 'error', message: errorMessage(e, ctx) }));
    return () => {
      alive = false;
    };
    // ctx se schimbă doar cu limba / tema; nu reîncărcăm datele pentru atât
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const refresh = () => {
    setState({ kind: 'loading' });
    setReload((n) => n + 1);
  };

  if (state.kind === 'loading') {
    return (
      <div className={`grid grid-cols-2 lg:grid-cols-3 gap-px border ${sk.gap} ${sk.line}`} aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`h-[132px] animate-pulse ${sk.cell}`} />
        ))}
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="space-y-4">
        <ErrorLine ctx={ctx} message={state.message} />
        <Button ctx={ctx} ghost onClick={refresh}>
          {t('Încearcă din nou', 'Try again')}
        </Button>
      </div>
    );
  }

  const d = state.data;
  const totalPlans = Math.max(1, d.subscribersByPlan.starter + d.subscribersByPlan.pro + d.subscribersByPlan.agency);
  const negativeMargin = d.estimatedNetMarginEur < 0;

  return (
    <div className="space-y-6">
      <div className={`flex flex-wrap items-center justify-between gap-3 ${EYEBROW} ${sk.dim}`}>
        <span className="tabular-nums">
          {t('Actualizat', 'Updated')} · {formatDateTime(d.generatedAt, lang)}
        </span>
        <Button ctx={ctx} ghost onClick={refresh}>
          <RefreshCw className="w-3 h-3" />
          {t('Reîmprospătează', 'Refresh')}
        </Button>
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px border ${sk.gap} ${sk.line}`}>
        <Kpi
          ctx={ctx}
          label={t('Utilizatori', 'Total users')}
          value={formatInt(d.totalUsers, lang)}
          hint={`+${formatInt(d.newUsersLast30Days, lang)} ${t('în 30 de zile', 'last 30 days')} · ${formatInt(d.bannedUsers, lang)} ${t('blocați', 'banned')}`}
        />
        <Kpi
          ctx={ctx}
          label={t('MRR estimat', 'Estimated MRR')}
          value={formatEur(d.estimatedMrrEur, lang)}
          hint={`${formatInt(d.payingSubscribers, lang)} ${t('abonamente Stripe active', 'active Stripe subscriptions')}`}
        />
        <Kpi
          ctx={ctx}
          label={t('Randări AI luna aceasta', 'AI renders this month')}
          value={formatInt(d.rendersThisMonth, lang)}
          hint={`${formatInt(d.rendersToday, lang)} ${t('azi', 'today')} · ${formatInt(d.totalRenders, lang)} ${t('total', 'all time')}`}
        />
        <Kpi
          ctx={ctx}
          label={t('Cost API vs. marjă netă', 'API cost vs. net margin')}
          value={<span className={negativeMargin ? (ctx.isDark ? 'text-red-400' : 'text-red-600') : ''}>{formatEur(d.estimatedNetMarginEur, lang)}</span>}
          hint={`${t('Cost', 'Cost')} ${formatEur(d.estimatedApiCostEur, lang)} · ${formatEur(d.estimatedRenderCostEur, lang, 3)} / ${t('randare', 'render')}`}
        />
        <Kpi
          ctx={ctx}
          label={t('Proiecte publice', 'Public projects')}
          value={formatInt(d.publicProjectsCount, lang)}
          hint={`${t('din', 'of')} ${formatInt(d.totalProjects, lang)} ${t('proiecte', 'projects')}`}
        />
        <Kpi ctx={ctx} label={t('Devize B2B', 'B2B estimates')} value={formatInt(d.totalB2bEstimates, lang)} hint={`${formatInt(d.admins, lang)} ${t('administratori', 'admins')}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
        <Panel ctx={ctx} title={t('Distribuția pe planuri', 'Plan breakdown')}>
          <ul className="space-y-4">
            {PLANS.map((p, i) => {
              const count = d.subscribersByPlan[p.id];
              const pct = Math.round((count / totalPlans) * 1000) / 10;
              return (
                <li key={p.id} className="space-y-1.5">
                  <div className={`flex items-baseline justify-between ${EYEBROW}`}>
                    <span className={sk.strong}>{p.label}</span>
                    <span className={`tabular-nums ${sk.muted}`}>
                      {formatInt(count, lang)} · {pct.toLocaleString(LOCALES[lang])}%
                    </span>
                  </div>
                  <div className={`h-2 w-full ${ctx.isDark ? 'bg-[#1C1C1F]' : 'bg-[#F5F5F5]'}`}>
                    <div
                      className={`h-full transition-[width] duration-500 ${ctx.isDark ? 'bg-[#F5F5F5]' : 'bg-[#111111]'}`}
                      style={{ width: `${pct}%`, opacity: [0.35, 0.65, 1][i] }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className={`mt-5 text-xs ${sk.muted}`}>
            {t(
              'Planul efectiv: un abonament plătit expirat apare ca Starter. MRR include doar abonamentele Stripe (planurile acordate manual nu sunt venit).',
              'Effective plan: an expired paid period counts as Starter. MRR only counts Stripe subscriptions (manual grants are not revenue).',
            )}
          </p>
        </Panel>

        <Panel ctx={ctx} title={t('Starea sistemului', 'System health')}>
          <ul className={`divide-y ${sk.divide}`}>
            <HealthRow ctx={ctx} label={t('Bază de date', 'Database')} state={d.systemHealth.database} />
            <HealthRow ctx={ctx} label="Stripe" state={d.systemHealth.stripe} />
            <HealthRow ctx={ctx} label="Replicate AI" state={d.systemHealth.replicate} detail={d.systemHealth.aiProvider} />
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function HealthRow({ ctx, label, state, detail }: { ctx: AdminCtx; label: string; state: HealthState; detail?: string }) {
  const { sk, t } = ctx;
  const text: Record<HealthState, string> = {
    ok: t('Operațional', 'Operational'),
    down: t('Indisponibil', 'Down'),
    not_configured: t('Neconfigurat', 'Not configured'),
    demo: t('Mod demo', 'Demo mode'),
  };
  const bad = state === 'down';
  const tone = bad ? (ctx.isDark ? 'text-red-400' : 'text-red-600') : state === 'ok' ? sk.strong : sk.muted;
  return (
    <li className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <span className="text-sm">{label}</span>
      <span className={`inline-flex items-center gap-2 ${EYEBROW} ${tone}`}>
        <span className="relative flex h-1.5 w-1.5">
          {state === 'ok' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-40" />}
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full bg-current ${state === 'ok' || bad ? '' : 'opacity-40'}`} />
        </span>
        {text[state]}
        {detail && state !== 'ok' && <span className={sk.dim}>({detail})</span>}
      </span>
    </li>
  );
}
