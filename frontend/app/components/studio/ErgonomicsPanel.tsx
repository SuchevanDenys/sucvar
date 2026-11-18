// app/components/studio/ErgonomicsPanel.tsx
// „Analiză ergonomică” (în cardul 03 · Dimensiuni & Ergonomie): metricile calculate instant din cote
// (lib/studio/ergonomics.ts, oglinda SpatialErgonomicsAnalyzer.cs) — suprafață, volum, amprenta optimă a
// mobilierului 30–35 %, suprafața liberă 65–70 %, culoarul minim — și 3–4 recomandări arhitecturale.
// „Aplică recomandările în randare” atașează regulile la cererea AI (în modul „Optimizare spațiu” sunt incluse automat).
"use client";

import React from 'react';
import { Check, Compass, Footprints, Info, Sofa } from 'lucide-react';
import { tr } from '@/app/lib/i18n';
import { getSkin } from '@/app/lib/theme/skin';
import type { ErgonomicReport } from '@/app/lib/studio/ergonomics';
import type { Language } from '@/app/types';

interface ErgonomicsPanelProps {
  lang: Language;
  isDark: boolean;
  report: ErgonomicReport;
  /** Regulile sunt atașate cererii AI. */
  applied: boolean;
  /** true = modul „Optimizare spațiu”: regulile pleacă oricum (butonul devine o confirmare). */
  automatic: boolean;
  onApplyChange: (value: boolean) => void;
  disabled?: boolean;
}

const nf = (v: number, digits = 1) => v.toLocaleString('ro-RO', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export default function ErgonomicsPanel({ lang, isDark, report, applied, automatic, onApplyChange, disabled }: ErgonomicsPanelProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const active = automatic || applied;
  const tile = `rounded-lg border px-3 py-2.5 ${sk.line} ${isDark ? 'bg-[#110D0F]/60' : 'bg-[#FAF8F6]'}`;
  const tileLabel = `flex items-center gap-1.5 text-[11px] ${sk.muted}`;
  const tileValue = `mt-1 font-mono text-[15px] font-medium tabular-nums ${sk.strong}`;
  const footprintPct = 35; // bara: amprenta maximă recomandată

  return (
    <div className={`space-y-3.5 border-t pt-4 ${sk.line}`} aria-labelledby="ergonomics-title">
      <div className="flex items-center justify-between gap-2">
        <p id="ergonomics-title" className={`flex items-center gap-1.5 text-[13px] font-medium ${sk.strong}`}>
          <Compass className="w-3.5 h-3.5 text-[#A67C52]" aria-hidden />
          {t('Analiză ergonomică', 'Ergonomic analysis', 'Analyse ergonomique')}
        </p>
        <span className={`text-[10.5px] uppercase tracking-[0.12em] ${sk.dim}`}>{t('calcul instant · fără AI', 'instant · no AI', 'instantané · sans IA')}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className={tile}>
          <p className={tileLabel}>{t('Suprafață utilă', 'Usable area', 'Surface utile')}</p>
          <p className={tileValue}>{nf(report.areaSqm)} m²</p>
        </div>
        <div className={tile}>
          <p className={tileLabel}>{t('Volum', 'Volume', 'Volume')}</p>
          <p className={tileValue}>{nf(report.volumeM3)} m³</p>
        </div>
        <div className={tile}>
          <p className={tileLabel}><Sofa className="w-3 h-3" aria-hidden />{t('Mobilier optim (30–35%)', 'Furniture (30–35%)', 'Mobilier (30–35 %)')}</p>
          <p className={tileValue}>{nf(report.minFurnitureSqm)}–{nf(report.maxFurnitureSqm)} m²</p>
        </div>
        <div className={tile}>
          <p className={tileLabel}><Footprints className="w-3 h-3" aria-hidden />{t('Culoar minim', 'Min. walkway', 'Passage min.')}</p>
          <p className={tileValue}>{report.walkwayMinCm}–{report.walkwayMaxCm} cm</p>
        </div>
      </div>

      {/* Bara de ocupare: mobilier ≤ 35 % · circulație liberă ≥ 65 % */}
      <div className="space-y-1.5">
        <div className="flex h-2 overflow-hidden rounded-full" aria-hidden>
          <span className={isDark ? 'bg-[#C94A6A]' : 'bg-[#5C1628]'} style={{ width: `${footprintPct}%` }} />
          <span className={`flex-1 ${isDark ? 'bg-[#2E2427]' : 'bg-[#E8E2E0]'}`} />
        </div>
        <p className={`flex justify-between text-[11px] tabular-nums ${sk.muted}`}>
          <span>{t('Mobilier', 'Furniture', 'Mobilier')} ≤ {nf(report.maxFurnitureSqm)} m²</span>
          <span>{t('Circulație liberă', 'Free circulation', 'Circulation libre')} {nf(report.minFreeSqm)}–{nf(report.maxFreeSqm)} m² (65–70%)</span>
        </p>
      </div>

      {report.dimensionsAssumed && (
        <p className={`flex items-start gap-1.5 text-[11.5px] leading-relaxed ${sk.muted}`}>
          <Info className="mt-0.5 w-3 h-3 shrink-0" aria-hidden />
          {t('Calculat cu cotele tipice ale camerei — introdu cotele reale pentru recomandări exacte.',
            'Computed with typical room dimensions — enter the real ones for exact advice.',
            'Calculé avec des cotes typiques — saisissez les vraies pour des conseils exacts.')}
        </p>
      )}

      <ol className="space-y-2">
        {report.recommendations.map((r, i) => (
          <li key={r.id} className="flex gap-2.5 text-[12.5px] leading-relaxed">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] ${isDark ? 'border-[#A67C52]/50 text-[#D9B88F]' : 'border-[#A67C52]/60 text-[#8A6440]'}`}>
              {i + 1}
            </span>
            <span className={sk.muted}>{t(r.ro, r.en)}</span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        disabled={disabled || automatic}
        aria-pressed={active}
        onClick={() => onApplyChange(!applied)}
        className={`w-full inline-flex h-10 items-center justify-center gap-2 rounded-lg border text-[13px] font-medium cursor-pointer touch-manipulation transition-colors disabled:cursor-default ${
          active ? sk.chipOn : `${sk.line} ${sk.btnGhost}`
        }`}
      >
        {active ? <Check className="w-4 h-4" aria-hidden /> : <Compass className="w-4 h-4" aria-hidden />}
        {automatic
          ? t('Recomandări incluse automat în optimizare', 'Advice included automatically', 'Conseils inclus automatiquement')
          : applied
            ? t('Recomandări aplicate în randare', 'Advice applied to the render', 'Conseils appliqués au rendu')
            : t('Aplică recomandările în randare', 'Apply the advice to the render', 'Appliquer les conseils au rendu')}
      </button>
    </div>
  );
}
