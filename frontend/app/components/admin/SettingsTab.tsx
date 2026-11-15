// app/components/admin/SettingsTab.tsx — Tab 4: setările SaaS (app_settings) + jurnalul de audit.
// Limitele pe plan și flag-urile se aplică de backend în ≤ 30 s (cache), fără redeploy.
"use client";

import React, { useEffect, useState } from 'react';
import { fetchAuditLogs, fetchSettings, saveSettings, type AuditAction, type AuditLogEntry, type Paged, type PlatformSettings, type SettingsView } from '@/app/lib/admin/client';
import { EYEBROW } from '@/app/lib/theme/skin';
import type { PlanTier } from '@/app/types';
import { Badge, Button, ErrorLine, Pager, Panel, errorMessage, formatDateTime, inputClass, selectClass, type AdminCtx } from './shared';

const TIERS: PlanTier[] = ['starter', 'pro', 'agency'];
const TIER_LABEL: Record<PlanTier, string> = { starter: 'Starter', pro: 'Pro', agency: 'Agency' };

export default function SettingsTab({ ctx }: { ctx: AdminCtx }) {
  const [auditVersion, setAuditVersion] = useState(0);
  return (
    <div className="space-y-6">
      <SettingsPanel ctx={ctx} onSaved={() => setAuditVersion((v) => v + 1)} />
      <AuditPanel key={auditVersion} ctx={ctx} />
    </div>
  );
}

// ── Settings ───────────────────────────────────────────────────────────────────

type LoadState = { kind: 'loading' } | { kind: 'ready'; view: SettingsView } | { kind: 'error'; message: string };

function SettingsPanel({ ctx, onSaved }: { ctx: AdminCtx; onSaved: () => void }) {
  const { t } = ctx;
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    fetchSettings()
      .then((view) => alive && setState({ kind: 'ready', view }))
      .catch((e: unknown) => alive && setState({ kind: 'error', message: errorMessage(e, ctx) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Panel ctx={ctx} title={t('Setări SaaS', 'SaaS settings')}>
      {state.kind === 'loading' && <div className={`h-64 animate-pulse ${ctx.isDark ? 'bg-[#1C1C1F]' : 'bg-[#F5F5F5]'}`} aria-busy="true" />}
      {state.kind === 'error' && <ErrorLine ctx={ctx} message={state.message} />}
      {state.kind === 'ready' && (
        <SettingsForm
          key={JSON.stringify(state.view.settings)}
          ctx={ctx}
          view={state.view}
          onSaved={(view) => {
            setState({ kind: 'ready', view });
            onSaved();
          }}
        />
      )}
    </Panel>
  );
}

/** Valorile formularului ca text (câmpurile numerice pot fi goale în timpul editării). */
interface Draft {
  limits: Record<PlanTier, string>;
  prices: Record<PlanTier, string>;
  currency: 'EUR' | 'RON';
  discount: string;
  maintenance: boolean;
  registrations: boolean;
  renderCost: string;
}

function toDraft(s: PlatformSettings): Draft {
  return {
    limits: { starter: str(s.planLimits.starter.monthlyGenerations), pro: str(s.planLimits.pro.monthlyGenerations), agency: str(s.planLimits.agency.monthlyGenerations) },
    prices: { starter: String(s.pricingDisplay.starter.monthlyEur), pro: String(s.pricingDisplay.pro.monthlyEur), agency: String(s.pricingDisplay.agency.monthlyEur) },
    currency: s.pricingDisplay.currency,
    discount: String(s.pricingDisplay.annualDiscountPct),
    maintenance: s.systemFlags.maintenanceMode,
    registrations: s.systemFlags.allowNewRegistrations,
    renderCost: String(s.systemFlags.estimatedRenderCostEur),
  };
}

function str(n: number | null): string {
  return n === null ? '' : String(n);
}

/** Draft → corpul PUT; null = câmp invalid (validarea finală o face serverul). */
function fromDraft(d: Draft): PlatformSettings | null {
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));
  const limit = (s: string) => (s.trim() === '' ? null : Number.isInteger(num(s)) && num(s) >= 0 ? num(s) : NaN);
  const limits = TIERS.map((p) => limit(d.limits[p]));
  const prices = TIERS.map((p) => num(d.prices[p]));
  const discount = num(d.discount);
  const cost = num(d.renderCost);
  if (limits.some((v) => v !== null && Number.isNaN(v)) || [...prices, discount, cost].some((v) => !Number.isFinite(v) || v < 0)) return null;
  return {
    planLimits: { starter: { monthlyGenerations: limits[0] }, pro: { monthlyGenerations: limits[1] }, agency: { monthlyGenerations: limits[2] } },
    pricingDisplay: { currency: d.currency, annualDiscountPct: discount, starter: { monthlyEur: prices[0] }, pro: { monthlyEur: prices[1] }, agency: { monthlyEur: prices[2] } },
    systemFlags: { maintenanceMode: d.maintenance, allowNewRegistrations: d.registrations, estimatedRenderCostEur: cost },
  };
}

function SettingsForm({ ctx, view, onSaved }: { ctx: AdminCtx; view: SettingsView; onSaved: (v: SettingsView) => void }) {
  const { sk, t } = ctx;
  const [draft, setDraft] = useState<Draft>(() => toDraft(view.settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (patch: Partial<Draft>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = fromDraft(draft);
    if (!body) {
      setError(t('Verifică valorile: numere pozitive; limitele sunt întregi (gol = nelimitat).', 'Check the values: positive numbers; limits are integers (empty = unlimited).'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveSettings(body));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, ctx));
    } finally {
      setBusy(false);
    }
  };

  const label = (text: string) => <span className={`block mb-1.5 ${EYEBROW} ${sk.dim}`}>{text}</span>;
  const toggle = (checked: boolean, onChange: (v: boolean) => void, text: string, hint: string) => (
    <label className={`flex items-start gap-3 p-3 border cursor-pointer ${sk.line}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 w-4 h-4 accent-current cursor-pointer" />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{text}</span>
        <span className={`block text-xs ${sk.muted}`}>{hint}</span>
      </span>
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-8">
      {!view.migrated && (
        <p role="alert" className={`text-xs font-medium ${ctx.isDark ? 'text-red-400' : 'text-red-600'}`}>
          {t('Migrarea 005 nu este aplicată: se afișează valorile implicite și nu se pot salva.', 'Migration 005 is not applied: defaults are shown and cannot be saved.')}
        </p>
      )}

      <fieldset className="space-y-3">
        <legend className={`${EYEBROW} font-semibold ${sk.strong}`}>{t('Limite lunare de generări AI', 'Monthly AI generation limits')}</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {TIERS.map((p) => (
            <label key={p} className="block">
              {label(TIER_LABEL[p])}
              <input
                inputMode="numeric"
                value={draft.limits[p]}
                onChange={(e) => set({ limits: { ...draft.limits, [p]: e.target.value } })}
                placeholder={t('nelimitat', 'unlimited')}
                className={`${inputClass(ctx)} tabular-nums`}
              />
            </label>
          ))}
        </div>
        <p className={`text-xs ${sk.muted}`}>{t('Gol = nelimitat. Creditele bonus acordate utilizatorilor se adaugă peste limită.', 'Empty = unlimited. Bonus credits granted to users are added on top.')}</p>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className={`${EYEBROW} font-semibold ${sk.strong}`}>{t('Prețuri afișate & estimări MRR', 'Displayed pricing & MRR estimates')}</legend>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {TIERS.map((p) => (
            <label key={p} className="block">
              {label(`${TIER_LABEL[p]} / ${t('lună', 'month')}`)}
              <input inputMode="decimal" value={draft.prices[p]} onChange={(e) => set({ prices: { ...draft.prices, [p]: e.target.value } })} className={`${inputClass(ctx)} tabular-nums`} />
            </label>
          ))}
          <label className="block">
            {label(t('Reducere anuală %', 'Annual discount %'))}
            <input inputMode="decimal" value={draft.discount} onChange={(e) => set({ discount: e.target.value })} className={`${inputClass(ctx)} tabular-nums`} />
          </label>
          <label className="block">
            {label(t('Monedă', 'Currency'))}
            <select value={draft.currency} onChange={(e) => set({ currency: e.target.value as Draft['currency'] })} className={`${selectClass(ctx)} w-full`}>
              <option value="EUR" className={sk.option}>EUR</option>
              <option value="RON" className={sk.option}>RON</option>
            </select>
          </label>
        </div>
        <p className={`text-xs ${sk.muted}`}>
          {t('Prețurile reale de încasare rămân cele din Stripe; aceste valori alimentează estimarea MRR.', 'Actual charges stay as configured in Stripe; these values feed the MRR estimate.')}
        </p>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className={`${EYEBROW} font-semibold ${sk.strong}`}>{t('Sistem', 'System')}</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {toggle(
            draft.maintenance,
            (v) => set({ maintenance: v }),
            t('Mod mentenanță', 'Maintenance mode'),
            t('Studio, B2B, partajarea și plata răspund 503 pentru toți, cu excepția administratorilor.', 'Studio, B2B, sharing and checkout answer 503 for everyone except admins.'),
          )}
          {toggle(
            draft.registrations,
            (v) => set({ registrations: v }),
            t('Înregistrări noi permise', 'Allow new registrations'),
            t('Ascunde „Cont nou" pe /login. Pentru blocare completă dezactivează și sign-up în Supabase Auth.', 'Hides “Register” on /login. To block fully, also disable sign-ups in Supabase Auth.'),
          )}
        </div>
        <label className="block max-w-xs">
          {label(t('Cost estimat / randare (EUR)', 'Estimated cost / render (EUR)'))}
          <input inputMode="decimal" value={draft.renderCost} onChange={(e) => set({ renderCost: e.target.value })} className={`${inputClass(ctx)} tabular-nums`} />
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <Button ctx={ctx} type="submit" busy={busy} disabled={!view.migrated}>
          {t('Salvează setările', 'Save settings')}
        </Button>
        {saved && <p role="status" className={`text-xs font-medium ${sk.strong}`}>{t('Salvat și jurnalizat.', 'Saved and logged.')}</p>}
        <ErrorLine ctx={ctx} message={error} />
      </div>
    </form>
  );
}

// ── Audit log ──────────────────────────────────────────────────────────────────

type AuditState = { kind: 'loading' } | { kind: 'ready'; data: Paged<AuditLogEntry> } | { kind: 'error'; message: string };

function AuditPanel({ ctx }: { ctx: AdminCtx }) {
  const { sk, t, lang } = ctx;
  const [page, setPage] = useState(1);
  const [state, setState] = useState<AuditState>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    fetchAuditLogs(page)
      .then((data) => alive && setState({ kind: 'ready', data }))
      .catch((e: unknown) => alive && setState({ kind: 'error', message: errorMessage(e, ctx) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const actionLabel: Record<AuditAction, string> = {
    'user.update_plan': t('Plan modificat', 'Plan changed'),
    'user.adjust_quota': t('Cotă AI', 'AI quota'),
    'user.toggle_ban': t('Blocare / deblocare', 'Ban / unban'),
    'user.change_role': t('Rol modificat', 'Role changed'),
    'project.unpublish': t('Link public dezactivat', 'Public link disabled'),
    'settings.update': t('Setări actualizate', 'Settings updated'),
  };

  return (
    <Panel ctx={ctx} title={t('Jurnal de audit', 'Audit log')}>
      {state.kind === 'error' && <ErrorLine ctx={ctx} message={state.message} />}
      <div className="overflow-x-auto -mx-5 sm:-mx-6">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className={`border-b text-left ${sk.line} ${EYEBROW} ${sk.dim}`}>
              <th className="font-normal px-5 sm:px-6 h-10">{t('Data', 'Date')}</th>
              <th className="font-normal px-3">Admin</th>
              <th className="font-normal px-3">{t('Acțiune', 'Action')}</th>
              <th className="font-normal px-3">{t('Țintă', 'Target')}</th>
              <th className="font-normal px-5 sm:px-6">{t('Detalii', 'Details')}</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${sk.divide}`}>
            {state.kind === 'loading' && (
              <tr>
                <td colSpan={5} className="px-5 sm:px-6 py-3">
                  <div className={`h-24 animate-pulse ${ctx.isDark ? 'bg-[#1C1C1F]' : 'bg-[#F5F5F5]'}`} />
                </td>
              </tr>
            )}
            {state.kind === 'ready' && state.data.items.length === 0 && (
              <tr>
                <td colSpan={5} className={`px-5 sm:px-6 py-8 text-center ${sk.muted}`}>{t('Nicio acțiune înregistrată.', 'No actions logged yet.')}</td>
              </tr>
            )}
            {state.kind === 'ready' &&
              state.data.items.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className={`px-5 sm:px-6 py-3 whitespace-nowrap tabular-nums text-xs ${sk.muted}`}>{formatDateTime(e.createdAt, lang)}</td>
                  <td className="px-3 py-3 text-xs max-w-[180px] truncate">{e.adminEmail ?? e.adminUserId.slice(0, 8)}</td>
                  <td className="px-3 py-3">
                    <Badge ctx={ctx} danger={e.action === 'user.toggle_ban' && e.details.isBanned === true}>
                      {actionLabel[e.action] ?? e.action}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-xs max-w-[200px]">
                    <span className={`block ${EYEBROW} ${sk.dim}`}>{e.targetType}</span>
                    <span className="block truncate">{typeof e.details.email === 'string' ? e.details.email : e.targetId}</span>
                  </td>
                  <td className={`px-5 sm:px-6 py-3 text-xs ${sk.muted}`}>{summarize(e, t)}</td>
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
          onPage={(p) => {
            setState({ kind: 'loading' });
            setPage(p);
          }}
        />
      )}
    </Panel>
  );
}

function summarize(e: AuditLogEntry, t: AdminCtx['t']): string {
  const d = e.details;
  const s = (v: unknown) => (v === null || v === undefined ? '—' : String(v));
  switch (e.action) {
    case 'user.update_plan':
    case 'user.change_role':
      return `${s(d.from)} → ${s(d.to)}`;
    case 'user.adjust_quota': {
      const parts: string[] = [];
      if (typeof d.delta === 'number') parts.push(`${d.delta > 0 ? '+' : ''}${d.delta} ${t('credite', 'credits')} (${s(d.bonusBefore)} → ${s(d.bonusAfter)})`);
      if (d.reset === true) parts.push(t('consum resetat', 'usage reset'));
      return parts.join(' · ');
    }
    case 'user.toggle_ban':
      return d.isBanned === true ? `${t('Blocat', 'Banned')}${d.reason ? `: ${s(d.reason)}` : ''}` : t('Deblocat', 'Unbanned');
    case 'project.unpublish':
      return `${s(d.title)} · ${s(d.ownerEmail)}`;
    case 'settings.update':
      return Array.isArray(d.keys) ? d.keys.join(', ') : '';
    default:
      return JSON.stringify(d).slice(0, 160);
  }
}
