// app/components/b2b/PricingConsole.tsx
// /b2b — consola de preț din dreapta (lipicioasă pe desktop): marjă, contingență, TVA și totalurile devizului.
// Componentă controlată și fără stare: toate valorile și calculele vin din pagina /b2b (`lib/b2b/estimate.ts`).
"use client";

import React from 'react';
import { LiveDot } from '@/app/components/ui/Editorial';
import { clampNum, lei, VAT_PRESETS } from '@/app/lib/b2b/estimate';
import { tr } from '@/app/lib/i18n';
import { EYEBROW, getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';

/** Totalurile devizului (EUR), calculate o singură dată în pagină și reutilizate și de PrintDeviz. */
export interface EstimateTotals {
  laborTotal: number;
  itemsTotal: number;
  contingencyAmt: number;
  marginAmt: number;
  /** Total fără TVA (HT). */
  net: number;
  vatAmt: number;
  /** Total cu TVA (TTC). */
  gross: number;
}

interface PricingConsoleProps {
  lang: Language;
  isDark: boolean;
  margin: number;
  onMarginChange: (pct: number) => void;
  contingency: number;
  onContingencyChange: (pct: number) => void;
  /** Cota TVA în procente (20 = taux normal, 10 = rénovation > 2 ans). */
  vat: number;
  onVatChange: (pct: number) => void;
  totals: EstimateTotals;
  workDays: number;
  crew: number;
  laborHours: number;
}

export default function PricingConsole({
  lang, isDark, margin, onMarginChange, contingency, onContingencyChange, vat, onVatChange, totals, workDays, crew, laborHours,
}: PricingConsoleProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const eyebrow = `${EYEBROW} ${sk.dim}`;
  const field = `h-9 px-2.5 rounded-sm border text-sm w-full transition-colors ${sk.input}`;
  const numField = `${field} font-mono tabular-nums text-right`;
  const range = `w-full accent-[var(--foreground)]`;
  const panel = `relative border rounded-md ${sk.card}`;
  const panelHead = `flex items-center justify-between px-5 h-9 border-b ${sk.line} ${eyebrow}`;
  const lbl = (s: string) => <span className={`block mb-1 ${eyebrow}`}>{s}</span>;
  const { laborTotal, itemsTotal, contingencyAmt, marginAmt, net, vatAmt, gross } = totals;

  return (
    <aside className="lg:col-span-4 lg:sticky lg:top-20 space-y-6">
      <section className={panel}>
        <div className={panelHead}>
          <span>{t('Marjă și preț final', 'Margin and final price')}</span>
          <LiveDot label={t('În timp real', 'Live')} className={sk.dim} />
        </div>
        <div className="p-5 space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className={eyebrow}>{t('Marjă de profit', 'Profit margin')}</span>
              <span className={`font-mono text-sm tabular-nums ${sk.accent}`}>{margin}%</span>
            </div>
            <input type="range" min={10} max={25} step={1} value={margin} onChange={(e) => onMarginChange(Number(e.target.value))} className={range} aria-label="Profit margin" />
            <div className={`flex justify-between font-mono text-[10px] ${sk.dim}`}><span>10%</span><span>25%</span></div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className={eyebrow}>{t('Contingență', 'Contingency')}</span>
              <span className={`font-mono text-sm tabular-nums ${sk.accent}`}>{contingency}%</span>
            </div>
            <input type="range" min={0} max={15} step={1} value={contingency} onChange={(e) => onContingencyChange(Number(e.target.value))} className={range} aria-label="Contingency" />
            <div className={`flex justify-between font-mono text-[10px] ${sk.dim}`}><span>0%</span><span>15%</span></div>
          </div>
          <div className="block">
            {lbl(t('TVA (%)', 'VAT (%)'))}
            {/* TVA dintr-un click: 21 % (cota standard) sau 11 % (cota redusă) */}
            <div role="group" aria-label={t('Cota TVA', 'VAT rate', 'Taux de TVA')} className={`grid grid-cols-2 gap-px border mb-2 ${sk.line} ${sk.gap}`}>
              {VAT_PRESETS.map((p) => (
                <button
                  key={p.pct}
                  type="button"
                  onClick={() => onVatChange(p.pct)}
                  aria-pressed={vat === p.pct}
                  className={`px-3 py-2 text-left cursor-pointer touch-manipulation transition-colors ${vat === p.pct ? sk.segOn : `${sk.cell} ${sk.segOff}`}`}
                >
                  <span className="block font-mono text-xs tabular-nums">{t(p.ro, p.en, p.fr)}</span>
                  <span className="block text-[10px] opacity-70">{t(p.hintRo, p.hintEn, p.hintFr)}</span>
                </button>
              ))}
            </div>
            <input type="number" min={0} max={100} step="0.1" value={vat} onChange={(e) => onVatChange(clampNum(e.target.value, 0, 100))} className={numField} aria-label={t('TVA personalizată (%)', 'Custom VAT (%)', 'TVA personnalisée (%)')} />
          </div>
        </div>

        <dl className={`border-t divide-y text-sm ${sk.line} ${sk.divide}`}>
          {[
            [t('Manoperă', 'Labor'), laborTotal],
            [t('Linii articole', 'Item lines'), itemsTotal],
            [`${t('Contingență', 'Contingency')} ${contingency}%`, contingencyAmt],
            [`${t('Marjă', 'Margin')} ${margin}%`, marginAmt],
          ].map(([k, v]) => (
            <div key={String(k)} className="flex items-center justify-between px-5 py-2.5">
              <dt className={sk.muted}>{k}</dt>
              <dd className={`font-mono tabular-nums ${sk.strong}`}>{lei(v as number)}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between px-5 py-3">
            <dt className={eyebrow}>{t('Total fără TVA', 'Net total')}</dt>
            <dd className={`font-mono tabular-nums text-lg font-medium ${sk.strong}`}>{lei(net)}</dd>
          </div>
          <div className="flex items-center justify-between px-5 py-2.5">
            <dt className={sk.muted}>{t('TVA', 'VAT')} {String(vat).replace('.', ',')} %</dt>
            <dd className={`font-mono tabular-nums ${sk.muted}`}>{lei(vatAmt)}</dd>
          </div>
          <div className="flex items-center justify-between px-5 py-3">
            <dt className={eyebrow}>{t('Total cu TVA', 'Gross total')}</dt>
            <dd className={`font-mono tabular-nums text-xl font-medium ${sk.accent}`}>{lei(gross)}</dd>
          </div>
        </dl>
      </section>

      <section className={panel}>
        <div className={panelHead}><span>{t('Durată estimată', 'Estimated schedule')}</span></div>
        <div className="p-5 flex items-end justify-between">
          <div>
            <p className={`font-mono text-3xl tabular-nums tracking-tight ${sk.strong}`}>{workDays}</p>
            <p className={`mt-1 text-xs ${sk.dim}`}>{t('zile lucrătoare', 'working days')} · {crew} {t('persoane', 'people')} · 8 h</p>
          </div>
          <p className={`font-mono text-xs tabular-nums ${sk.muted}`}>{laborHours.toFixed(0)} h</p>
        </div>
      </section>

      <p className={`text-[11px] leading-snug ${sk.dim}`}>
        {t(
          'Factur-X: exportul generează XML-ul CII (EN 16931) pentru a fi încorporat într-un PDF/A-3 de sistemul tău de facturare. Pentru facturile B2B din România, e-Factura (RO CIUS) rămâne canalul oficial.',
          'Factur-X: the export generates the CII (EN 16931) XML, to be embedded in a PDF/A-3 by your invoicing system. For Romanian B2B invoices, e-Factura (RO CIUS) remains the official channel.',
        )}
      </p>
    </aside>
  );
}
