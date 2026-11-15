// app/components/account/shared.tsx — piese comune ale paginii de profil (secțiune, câmp, mesaj).
"use client";

import React from 'react';
import { getUi } from '@/app/lib/theme/tokens';
import { LOCALES } from '@/app/lib/i18n';
import type { Language } from '@/app/types';

export type Ui = ReturnType<typeof getUi>;

export const EYEBROW_UI = 'text-[11px] uppercase tracking-[0.28em]';

export function Section({ index, title, ui, children, aside }: { index: string; title: string; ui: Ui; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className={`rounded-md border ${ui.card}`}>
      <header className={`flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 h-12 border-b ${ui.line}`}>
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em]">
          <span className={`font-mono mr-3 ${ui.muted}`}>{index}</span>
          {title}
        </h2>
        {aside}
      </header>
      <div className="p-5 sm:p-6 space-y-5">{children}</div>
    </section>
  );
}

export function Field({ label, ui, children, wide = false }: { label: string; ui: Ui; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block space-y-1.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className={`block ${EYEBROW_UI} ${ui.muted}`}>{label}</span>
      {children}
    </label>
  );
}

export const inputClass = (ui: Ui, mono = false) =>
  `w-full h-11 px-3 rounded-sm border bg-transparent text-base sm:text-sm outline-none transition-colors disabled:opacity-60 ${mono ? 'font-mono' : ''} ${ui.input}`;

export function Notice({ kind, children }: { kind: 'ok' | 'error' | 'info'; children: React.ReactNode }) {
  const tone = kind === 'error' ? 'text-red-600' : '';
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={`text-xs font-medium ${tone}`}>
      {children}
    </p>
  );
}

export function PrimaryButton({ ui, busy, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { ui: Ui; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={busy || rest.disabled}
      className={`inline-flex items-center gap-2 h-10 px-5 rounded-sm text-[11px] font-semibold uppercase tracking-widest cursor-pointer touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed ${ui.btn}`}
    >
      {busy && <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function formatDate(iso: string | null | undefined, lang: Language): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(LOCALES[lang], { day: '2-digit', month: 'short', year: 'numeric' });
}
