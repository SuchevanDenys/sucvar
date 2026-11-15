// app/components/ui/BillingToggle.tsx
// Comutator segmentat „Lunar / Anual −20%" pentru ciclul de facturare.
// Culorile vin din exterior (skin-ul paginii), ca să păstrăm paleta existentă.
"use client";

import React from 'react';
import { ANNUAL_DISCOUNT } from '@/app/lib/plan/tiers';
import type { BillingInterval } from '@/app/types';
import { tr } from '@/app/lib/i18n';
import type { Language } from '@/app/types';

interface BillingToggleProps {
  value: BillingInterval;
  onChange: (next: BillingInterval) => void;
  lang: Language;
  /** Clase pentru containerul segmentat (bordură/fundal) */
  wrapClass: string;
  segOn: string;
  segOff: string;
}

export default function BillingToggle({ value, onChange, lang, wrapClass, segOn, segOff }: BillingToggleProps) {
  const options: { id: BillingInterval; label: string }[] = [
    { id: 'month', label: tr(lang, 'Lunar', 'Monthly') },
    { id: 'year', label: `${tr(lang, 'Anual', 'Annual')} −${Math.round(ANNUAL_DISCOUNT * 100)}%` },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={tr(lang, 'Ciclu de facturare', 'Billing cycle')}
      className={`inline-flex items-center gap-1 p-1 rounded-sm border ${wrapClass}`}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
          className={`h-9 px-4 rounded-sm text-[12px] font-medium uppercase tracking-[0.14em] cursor-pointer touch-manipulation transition-colors ${
            value === option.id ? segOn : segOff
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
