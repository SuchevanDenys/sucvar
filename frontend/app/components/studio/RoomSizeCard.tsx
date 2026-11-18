// app/components/studio/RoomSizeCard.tsx
// Studio · 02b — „Dimensiuni spațiu”: mereu vizibil, imediat sub „Cameră & stil”.
// Trei presetări dintr-un click + lungime / lățime / înălțime. Aceleași cote alimentează cererea AI
// (indicii de scară în prompt) și estimarea de cost / lista de materiale — nu există altă copie a lor.
"use client";

import React from 'react';
import { Ruler } from 'lucide-react';
import { tr } from '@/app/lib/i18n';
import { getSkin } from '@/app/lib/theme/skin';
import type { NumberField } from '@/app/lib/studio/constants';
import type { Language, RoomDimensions } from '@/app/types';
import { StudioCard } from './StudioCard';

export interface RoomSizePreset {
  id: string;
  label: string;
  /** m × m × m (lungime × lățime × înălțime) */
  length: number;
  width: number;
  height: number;
}

/** Presetările de interior (apartamente din România): 12 / 20 / 32 m². */
export const INTERIOR_SIZE_PRESETS: { id: string; ro: string; en: string; length: number; width: number; height: number }[] = [
  { id: 'compact', ro: 'Compact', en: 'Compact', length: 4.0, width: 3.0, height: 2.55 },
  { id: 'standard', ro: 'Standard', en: 'Standard', length: 5.0, width: 4.0, height: 2.65 },
  { id: 'spacious', ro: 'Spațios', en: 'Spacious', length: 6.4, width: 5.0, height: 2.8 },
];

const FIELDS: { field: Extract<NumberField, 'length' | 'width' | 'height'>; ro: string; en: string }[] = [
  { field: 'length', ro: 'Lungime', en: 'Length' },
  { field: 'width', ro: 'Lățime', en: 'Width' },
  { field: 'height', ro: 'Înălțime', en: 'Height' },
];

const fmt = (n: number, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : '0');

interface RoomSizeCardProps {
  lang: Language;
  isDark: boolean;
  roomDimensions: RoomDimensions;
  presets: RoomSizePreset[];
  onPresetSelect: (preset: RoomSizePreset) => void;
  onNumberChange: (field: NumberField, e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Mesaje de validare (listă goală = cote valide) */
  issues: string[];
  disabled?: boolean;
  /** Numărul pasului în panoul de control (ex. „03”). */
  step?: string;
  /** Card pliabil (controlat de părinte); cotele rămân vizibile ca rezumat în antet. */
  open?: boolean;
  onToggle?: () => void;
  /** Conținut suplimentar sub cote (ex. „Analiză ergonomică”). */
  children?: React.ReactNode;
}

export default function RoomSizeCard({
  lang, isDark, roomDimensions, presets, onPresetSelect, onNumberChange, issues, disabled, step, open, onToggle, children,
}: RoomSizeCardProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const { length, width, height } = roomDimensions;
  const area = length * width;
  const volume = area * height;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
  const active = presets.find((p) => near(p.length, length) && near(p.width, width) && near(p.height, height))?.id ?? null;

  const pill = (on: boolean) =>
    `flex-1 min-w-0 rounded-full border px-2 py-1.5 flex flex-col items-center gap-0.5 cursor-pointer touch-manipulation active:scale-[0.98] transition-[background-color,border-color,transform] disabled:opacity-40 disabled:cursor-not-allowed ${
      on ? sk.chipOn : `${sk.line} ${sk.segOff}`
    }`;

  return (
    <StudioCard
      isDark={isDark}
      step={step}
      collapsible={onToggle !== undefined}
      open={open}
      onToggle={onToggle}
      title={children ? t('Dimensiuni & Ergonomie', 'Dimensions & Ergonomics', 'Dimensions & ergonomie') : t('Dimensiuni spațiu', 'Room dimensions', 'Dimensions de la pièce')}
      hint={t(
        'AI-ul proporționează mobilierul după cote; costul și materialele se recalculează instant.',
        'The AI scales furniture to these dimensions; cost and materials update instantly.',
        'L’IA dimensionne le mobilier selon ces cotes ; coût et matériaux se recalculent instantanément.',
      )}
      aside={
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 font-mono text-[11px] tabular-nums whitespace-nowrap ${
            isDark ? 'bg-[#C94A6A]/15 text-[#F2D7DE]' : 'bg-[#5C1628]/[0.07] text-[#5C1628]'
          }`}
          aria-live="polite"
        >
          <Ruler className="w-3 h-3" aria-hidden />
          {fmt(area)} m² · {t('Volum', 'Volume', 'Volume')} {Math.round(volume)} m³
        </span>
      }
    >
      {/* Presetări dintr-un click */}
      <div className="flex gap-2" role="group" aria-label={t('Mărime rapidă', 'Quick size')}>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            aria-pressed={active === p.id}
            onClick={() => onPresetSelect(p)}
            className={pill(active === p.id)}
          >
            <span className="text-[12px] font-medium leading-tight truncate max-w-full">
              {p.label} <span className="opacity-70 tabular-nums">({Math.round(p.length * p.width)} m²)</span>
            </span>
            <span className="text-[10px] font-mono tabular-nums opacity-60">
              {fmt(p.length)} × {fmt(p.width)} × {fmt(p.height, 2)}
            </span>
          </button>
        ))}
      </div>

      {/* Cote exacte: lungime × lățime × înălțime */}
      <div className="grid grid-cols-3 gap-2">
        {FIELDS.map(({ field, ro, en }) => (
          <label
            key={field}
            className={`block rounded-lg border px-3 py-2 cursor-text transition-colors focus-within:border-current ${sk.line}`}
          >
            <span className={`block text-[11px] ${sk.muted}`}>{t(`${ro} (m)`, `${en} (m)`)}</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.05"
              min="0"
              disabled={disabled}
              value={roomDimensions[field]}
              onChange={(e) => onNumberChange(field, e)}
              aria-label={t(`${ro} în metri`, `${en} in metres`)}
              className={`mt-0.5 w-full min-w-0 bg-transparent outline-none text-[15px] font-mono font-medium tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${sk.strong}`}
            />
          </label>
        ))}
      </div>

      {issues.length > 0 && (
        <ul role="alert" className="space-y-1 text-xs text-red-500 font-mono">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      {children}
    </StudioCard>
  );
}
