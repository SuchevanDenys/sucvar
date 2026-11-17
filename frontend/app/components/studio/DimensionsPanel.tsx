// app/components/studio/DimensionsPanel.tsx
// Setări avansate: goluri (uși / ferestre) + nivelul de buget + costul live.
// Lungimea / lățimea / înălțimea NU mai sunt aici: se editează în cardul mereu vizibil „Dimensiuni spațiu”
// (RoomSizeCard), ca să existe o singură sursă pentru cote.
"use client";

import { formatLei } from '@/app/lib/format';
import React from 'react';
import { EYEBROW, getSkin } from '@/app/lib/theme/skin';
import type { NumberField } from '@/app/lib/studio/constants';
import type { BudgetTier, Language, RoomDimensions } from '@/app/types';
import { tr } from '@/app/lib/i18n';

const OPENING_FIELDS: { field: Extract<NumberField, 'doorsCount' | 'windowsCount'>; code: string; labelRo: string; labelEn: string }[] = [
  { field: 'doorsCount', code: 'D', labelRo: 'Uși', labelEn: 'Doors' },
  { field: 'windowsCount', code: 'WN', labelRo: 'Ferestre', labelEn: 'Windows' },
];

interface DimensionsPanelProps {
  lang: Language;
  isDark: boolean;
  roomDimensions: RoomDimensions;
  onNumberChange: (field: NumberField, e: React.ChangeEvent<HTMLInputElement>) => void;
  onBudgetChange: (budget: BudgetTier) => void;
  /** Costul estimat live (același calcul ca devizul detaliat) */
  costTotal: number;
  costMin: number;
  costMax: number;
}

export default function DimensionsPanel({
  lang, isDark, roomDimensions, onNumberChange, onBudgetChange, costTotal, costMin, costMax,
}: DimensionsPanelProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const eyebrow = `${EYEBROW} ${sk.dim}`;
  const seg = (active: boolean) =>
    `flex-1 h-9 px-3 ${EYEBROW} cursor-pointer touch-manipulation transition-colors ${active ? sk.segOn : sk.segOff}`;

  const budgetOptions: { id: BudgetTier; label: string }[] = [
    { id: 'economy', label: t('Economic', 'Economy') },
    { id: 'standard', label: 'Standard' },
    { id: 'luxury', label: 'Luxury' },
  ];

  return (
  <section className={`border rounded-md ${sk.card}`}>
    <div className={`px-4 h-9 flex items-center justify-between border-b ${sk.line} ${eyebrow}`}>
      <span>{t('Goluri & buget', 'Openings & budget')}</span>
      <span className="tabular-nums">
        {roomDimensions.doorsCount} {t('uși', 'doors')} · {roomDimensions.windowsCount} {t('ferestre', 'windows')}
      </span>
    </div>
    <div className={`grid grid-cols-2 gap-px ${sk.gap}`}>
      {OPENING_FIELDS.map(({ field, code, labelRo, labelEn }) => (
        <label
          key={field}
          className={`block p-3 cursor-text transition-colors focus-within:bg-[#685D60]/[0.05] ${sk.cell}`}
        >
          <span className={`flex items-center justify-between ${eyebrow}`}>
            <span>{t(labelRo, labelEn)}</span>
            <span className={sk.accent}>{code}</span>
          </span>
          <span className="flex items-baseline gap-1 mt-1.5">
            <input
              type="number"
              inputMode="numeric"
              step="1"
              min="0"
              value={roomDimensions[field]}
              onChange={(e) => onNumberChange(field, e)}
              className={`w-full min-w-0 bg-transparent outline-none text-lg font-mono font-medium tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${sk.strong}`}
            />
            <span className={`text-[10px] font-mono ${sk.dim}`}>buc</span>
          </span>
        </label>
      ))}
    </div>
    <div className={`p-4 border-t space-y-2 ${sk.line}`}>
      <span className={eyebrow}>{t('Buget', 'Budget')}</span>
      <div className={`flex border rounded-md overflow-hidden divide-x ${sk.line} ${sk.divide}`}>
        {budgetOptions.map((b) => (
          <button
            key={b.id}
            type="button"
            aria-pressed={roomDimensions.budget === b.id}
            onClick={() => onBudgetChange(b.id)}
            className={seg(roomDimensions.budget === b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
    {/* Cost live: același calcul ca în devizul detaliat */}
    <div className={`px-4 py-3 border-t flex items-baseline justify-between gap-3 ${sk.line}`}>
      <span className={eyebrow}>{t('Cost estimat', 'Estimated cost')}</span>
      <span className="text-right">
        <span className={`text-lg font-mono font-medium tabular-nums ${sk.strong}`}>{formatLei(costTotal, { maximumFractionDigits: 0 })}</span>
        <span className={`block text-[10px] font-mono tabular-nums ${sk.dim}`}>
          {formatLei(costMin, { maximumFractionDigits: 0 })} – {formatLei(costMax, { maximumFractionDigits: 0 })}
        </span>
      </span>
    </div>
  </section>
  );
}
