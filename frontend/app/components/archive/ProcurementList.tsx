// app/components/archive/ProcurementList.tsx — „Lista Materiale & Link-uri Achiziție" direct în Arhivă.
// Secțiune expandabilă pe cardul proiectului: materiale, cantități, preț orientativ și linkuri directe
// la magazine (Dedeman, Leroy Merlin, Hornbach, Brico Dépôt, IKEA România, Mobexpert), fără redeschiderea Studio-ului.
// Toate clickurile se opresc aici (stopPropagation): cardurile din Arhivă sunt ele însele clickabile.
"use client";

import React, { useId, useMemo, useState } from 'react';
import { Check, ChevronDown, Copy, ExternalLink, PackageSearch, RefreshCw } from 'lucide-react';
import type { BomItem } from '@/app/lib/procurement';
import { normalizeProcurementItems } from '@/app/lib/procurementNormalize';
import { copyText } from '@/app/lib/portal/client';
import { getUi } from '@/app/lib/theme/tokens';
import { tr, unitLabel } from '@/app/lib/i18n';
import type { Language } from '@/app/types';
import { formatLei, formatQuantity } from '@/app/lib/format';

const money = (n: number) => formatLei(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: number) => formatQuantity(n, 2);

/** Text simplu pentru clipboard: un material pe linie, urmat de linkurile lui. */
export function procurementLinksText(items: BomItem[], lang: Language): string {
  return (normalizeProcurementItems(items) ?? [])
    .map((i) => {
      const head = `${tr(lang, i.titleRo, i.titleEn)} — ${qtyFmt(i.qty)} ${unitLabel(i.unit, lang)} — ≈ ${money(i.total)}`;
      return [head, ...i.links.map((l) => `  ${l.label}: ${l.url}`)].join('\n');
    })
    .join('\n\n');
}

interface ProcurementListProps {
  items: BomItem[];
  isDark: boolean;
  lang: Language;
  /** false = listă recalculată (proiect vechi); afișează acțiunea de salvare în proiect. */
  persisted?: boolean;
  onBackfill?: () => Promise<boolean>;
  defaultOpen?: boolean;
  className?: string;
}

export default function ProcurementList({ items: rawItems, isDark, lang, persisted = true, onBackfill, defaultOpen = false, className = '' }: ProcurementListProps) {
  const ui = getUi(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState<'ok' | 'error' | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(persisted);
  const panelId = useId();
  // Linkurile se reconstruiesc mereu din `query` (magazine din România) — nu se afișează URL-uri salvate.
  const items = useMemo(() => normalizeProcurementItems(rawItems) ?? [], [rawItems]);

  if (items.length === 0) return null;
  const total = items.reduce((s, i) => s + i.total, 0);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const copyAll = async () => {
    const ok = await copyText(procurementLinksText(items, lang));
    setCopied(ok ? 'ok' : 'error');
    window.setTimeout(() => setCopied(null), 2400);
  };

  const backfill = async () => {
    if (!onBackfill) return;
    setSaving(true);
    const ok = await onBackfill();
    setSaving(false);
    if (ok) setSaved(true);
  };

  const pill = `inline-flex items-center gap-1.5 h-8 px-3 rounded-sm border text-[10px] font-semibold uppercase tracking-widest cursor-pointer touch-manipulation disabled:opacity-50 ${ui.btnGhost}`;

  return (
    <div className={className} onClick={stop} onKeyDown={stop}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-3 h-10 px-3 rounded-sm border text-[11px] font-semibold uppercase tracking-widest cursor-pointer touch-manipulation ${ui.btnGhost}`}
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <PackageSearch className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span className="truncate">{t('Materiale & Link-uri', 'Materials & Links')}</span>
          <span className={`font-mono tabular-nums ${ui.muted}`}>({items.length})</span>
        </span>
        <span className="inline-flex items-center gap-2 shrink-0">
          <span className={`font-mono tabular-nums normal-case tracking-normal ${ui.muted}`}>≈ {money(total)}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </span>
      </button>

      {open && (
        <div id={panelId} className={`mt-2 rounded-sm border ${ui.line}`}>
          <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-b ${ui.line} ${ui.soft}`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em]">
              {t('Lista Materiale & Link-uri Achiziție', 'Materials & Procurement Links')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {!saved && onBackfill && (
                <button type="button" disabled={saving} onClick={() => void backfill()} className={pill}>
                  <RefreshCw className={`w-3 h-3 ${saving ? 'animate-spin' : ''}`} aria-hidden />
                  {t('Salvează în proiect', 'Save to project')}
                </button>
              )}
              <button type="button" onClick={() => void copyAll()} className={pill}>
                {copied === 'ok' ? <Check className="w-3 h-3" aria-hidden /> : <Copy className="w-3 h-3" aria-hidden />}
                {copied === 'ok'
                  ? t('Copiat', 'Copied')
                  : copied === 'error'
                    ? t('Copiere blocată', 'Copy blocked')
                    : t('Copiază toate link-urile', 'Copy all links')}
              </button>
            </div>
          </div>

          <ul className={`divide-y ${ui.line}`}>
            {items.map((item) => (
              <li key={item.id} className="px-3 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug break-words">{tr(lang, item.titleRo, item.titleEn)}</p>
                    {(tr(lang, item.specRo, item.specEn)) && (
                      <p className={`mt-0.5 text-[11px] leading-relaxed ${ui.muted}`}>{tr(lang, item.specRo, item.specEn)}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-mono tabular-nums">{money(item.total)}</p>
                    <p className={`text-[11px] font-mono tabular-nums ${ui.muted}`}>
                      {qtyFmt(item.qty)} {unitLabel(item.unit, lang)} × {money(item.unitPrice)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {item.links.map((link) => (
                    <a
                      key={link.retailer}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-sm border text-[10px] font-semibold uppercase tracking-wider touch-manipulation ${ui.btnGhost}`}
                    >
                      {link.label}
                      <ExternalLink className="w-3 h-3" aria-hidden />
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          <div className={`flex items-center justify-between gap-3 px-3 py-2.5 border-t ${ui.line}`}>
            <p className={`text-[10px] leading-relaxed ${ui.muted}`}>
              {t('Prețuri orientative fără TVA; linkurile deschid căutarea la magazin.', 'Indicative prices excl. VAT; links open the retailer search.')}
            </p>
            <p className="text-sm font-mono font-semibold tabular-nums shrink-0">{money(total)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
