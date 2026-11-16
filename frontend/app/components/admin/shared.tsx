// app/components/admin/shared.tsx — piese comune ale panoului /admin (galerie monocromă, zero albastru).
"use client";

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { ApiError } from '@/app/lib/api-client';
import { EYEBROW, type Skin } from '@/app/lib/theme/skin';
import { LOCALES } from '@/app/lib/i18n';
import type { Language } from '@/app/types';

export interface AdminCtx {
  sk: Skin;
  isDark: boolean;
  lang: Language;
  t: (ro: string, en: string) => string;
}

export function errorMessage(e: unknown, ctx: AdminCtx): string {
  if (e instanceof ApiError) return e.message;
  return ctx.t('Conexiunea cu serverul a eșuat.', 'Could not reach the server.');
}

export function formatEur(value: number, lang: Language, digits = 2): string {
  return new Intl.NumberFormat(LOCALES[lang], {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatInt(value: number, lang: Language): string {
  return new Intl.NumberFormat(LOCALES[lang]).format(value);
}

export function formatDateTime(iso: string | null | undefined, lang: Language): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(LOCALES[lang], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Celulă KPI pentru grila cu linii de 1px (`gap-px` pe fundalul `sk.gap`). */
export function Kpi({ ctx, label, value, hint }: { ctx: AdminCtx; label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className={`p-5 sm:p-6 min-h-[132px] flex flex-col justify-between gap-4 ${ctx.sk.cell}`}>
      <p className={`${EYEBROW} ${ctx.sk.dim}`}>{label}</p>
      <div>
        <p className={`text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums ${ctx.sk.strong}`}>{value}</p>
        {hint && <p className={`mt-1 text-xs tabular-nums ${ctx.sk.muted}`}>{hint}</p>}
      </div>
    </div>
  );
}

/** Etichetă monocromă: `solid` = cerneală plină (stare activă), altfel contur. */
export function Badge({ ctx, children, solid = false, danger = false }: { ctx: AdminCtx; children: React.ReactNode; solid?: boolean; danger?: boolean }) {
  const tone = danger
    ? ctx.isDark
      ? 'border-red-400/60 text-red-400'
      : 'border-red-600/50 text-red-600'
    : solid
      ? ctx.sk.segOn + ' border-transparent'
      : `${ctx.sk.line} ${ctx.sk.muted}`;
  return <span className={`inline-flex items-center h-5 px-1.5 border ${EYEBROW} whitespace-nowrap ${tone}`}>{children}</span>;
}

export function Panel({ ctx, title, aside, children }: { ctx: AdminCtx; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`border ${ctx.sk.card}`}>
      <header className={`flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 min-h-12 py-2 border-b ${ctx.sk.line}`}>
        <h2 className={`${EYEBROW} font-semibold ${ctx.sk.strong}`}>{title}</h2>
        {aside}
      </header>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

export function Button({
  ctx,
  ghost = false,
  danger = false,
  busy = false,
  className = '',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { ctx: AdminCtx; ghost?: boolean; danger?: boolean; busy?: boolean }) {
  const tone = danger
    ? ctx.isDark
      ? 'border border-red-400/60 text-red-400 hover:bg-red-400/10'
      : 'border border-red-600/50 text-red-600 hover:bg-red-600/5'
    : ghost
      ? ctx.sk.btnGhost
      : ctx.sk.btn;
  return (
    <button
      type="button"
      {...rest}
      disabled={busy || rest.disabled}
      className={`inline-flex items-center justify-center gap-2 h-9 px-4 ${EYEBROW} font-semibold cursor-pointer touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed ${tone} ${className}`}
    >
      {busy && <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function ErrorLine({ ctx, message }: { ctx: AdminCtx; message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className={`text-xs font-medium ${ctx.isDark ? 'text-red-400' : 'text-red-600'}`}>
      {message}
    </p>
  );
}

export function Pager({ ctx, page, pageSize, total, onPage }: { ctx: AdminCtx; page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className={`flex items-center justify-between gap-3 pt-4 ${EYEBROW} ${ctx.sk.muted}`}>
      <span className="tabular-nums">
        {ctx.t('Pagina', 'Page')} {page} / {pages} · {formatInt(total, ctx.lang)} {ctx.t('rezultate', 'results')}
      </span>
      <div className="flex gap-2">
        <Button ctx={ctx} ghost disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ←
        </Button>
        <Button ctx={ctx} ghost disabled={page >= pages} onClick={() => onPage(page + 1)}>
          →
        </Button>
      </div>
    </div>
  );
}

/** Panou lateral (drawer) accesibil: Escape / click pe fundal închid, focusul intră în panou. */
export function Drawer({ ctx, title, onClose, children }: { ctx: AdminCtx; title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label={ctx.t('Închide', 'Close')} onClick={onClose} className="absolute inset-0 bg-[#110D0F]/40 cursor-default" />
      <div
        ref={ref}
        tabIndex={-1}
        className={`relative h-full w-full max-w-md overflow-y-auto border-l outline-none pb-[env(safe-area-inset-bottom)] ${ctx.sk.card} ${ctx.sk.strong}`}
      >
        <header className={`sticky top-0 z-10 flex items-center justify-between h-14 px-5 border-b ${ctx.sk.line} ${ctx.sk.cell}`}>
          <h3 className={`${EYEBROW} font-semibold`}>{title}</h3>
          <button type="button" onClick={onClose} aria-label={ctx.t('Închide', 'Close')} className={`h-8 w-8 inline-flex items-center justify-center border cursor-pointer ${ctx.sk.btnGhost}`}>
            <X className="w-3.5 h-3.5" />
          </button>
        </header>
        <div className="p-5 space-y-6">{children}</div>
      </div>
    </div>
  );
}

export const selectClass = (ctx: AdminCtx) => `h-9 px-2 border text-xs cursor-pointer ${ctx.sk.input}`;
export const inputClass = (ctx: AdminCtx) => `h-9 px-3 border text-sm w-full ${ctx.sk.input}`;
