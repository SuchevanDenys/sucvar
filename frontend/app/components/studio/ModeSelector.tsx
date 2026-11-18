// app/components/studio/ModeSelector.tsx
// Studio · 01 — „Mod de lucru”: control segmentat cu trei moduri (Redesign · Optimizare spațiu · Editează o zonă).
// Controalele specifice apar DOAR pentru modul activ (dezvăluire progresivă):
//   • Optimizare spațiu → cele 4 obiective (cartonașe), cu indiciul fiecăruia;
//   • Editează o zonă → îndemnul de a picta pe canvas + poziția selecției curente.
// Optimizarea spațiului se aplică doar interioarelor (exteriorul / grădina nu au mobilier de reorganizat).
"use client";

import React from 'react';
import { Archive, Check, LayoutGrid, Maximize, Monitor, PenLine, Sparkles, Waypoints } from 'lucide-react';
import { tr } from '@/app/lib/i18n';
import { getSkin } from '@/app/lib/theme/skin';
import { OPTIMIZATION_GOALS, type OptimizationGoalId } from '@/app/lib/studio/ergonomics';
import type { Language } from '@/app/types';
import { StudioCard } from './StudioCard';

export type WorkMode = 'redesign' | 'optimize' | 'area';

const GOAL_ICONS: Record<OptimizationGoalId, typeof Maximize> = {
  spaciousness: Maximize,
  storage: Archive,
  home_office: Monitor,
  circulation: Waypoints,
};

interface ModeSelectorProps {
  lang: Language;
  isDark: boolean;
  value: WorkMode;
  onChange: (mode: WorkMode) => void;
  /** false = categoria curentă nu e interior: „Optimizare spațiu” este dezactivat. */
  canOptimize: boolean;
  /** false = nu există încă o fotografie: „Editează o zonă” cere o imagine pe care să se picteze. */
  hasPhoto: boolean;
  goal: OptimizationGoalId | null;
  onGoalChange: (goal: OptimizationGoalId) => void;
  /** Poziția selecției pictate (ex. „prim-plan, centru”), sau null. */
  selectionLabel?: string | null;
  disabled?: boolean;
}

export default function ModeSelector({
  lang, isDark, value, onChange, canOptimize, hasPhoto, goal, onGoalChange, selectionLabel = null, disabled,
}: ModeSelectorProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);

  const modes: { id: WorkMode; icon: typeof Sparkles; label: string; off: boolean; offTitle?: string }[] = [
    { id: 'redesign', icon: Sparkles, label: t('Redesign', 'Redesign', 'Refonte'), off: false },
    {
      id: 'optimize', icon: LayoutGrid, label: t('Optimizare Spațiu', 'Space Optimization', 'Optimisation'), off: !canOptimize,
      offTitle: t('Disponibil pentru interioare', 'Available for interiors', 'Disponible pour les intérieurs'),
    },
    {
      id: 'area', icon: PenLine, label: t('Editează o zonă', 'Edit an area', 'Modifier une zone'), off: !hasPhoto,
      offTitle: t('Încarcă mai întâi o fotografie', 'Upload a photo first', 'Importez d’abord une photo'),
    },
  ];

  const description = value === 'optimize'
    ? t('Reorganizează mobilierul după reguli ergonomice reale; pereții, tavanul și ferestrele rămân neatinse.',
        'Reorganises the furniture with real ergonomic rules; walls, ceiling and windows stay untouched.',
        'Réorganise le mobilier selon des règles ergonomiques réelles ; murs, plafond et fenêtres restent intacts.')
    : value === 'area'
      ? t('Pictează pe canvas doar obiectul sau suprafața de schimbat — restul fotografiei rămâne neatins.',
          'Paint only the object or surface to change on the canvas — the rest of the photo stays untouched.',
          'Peignez sur le canevas seulement l’objet ou la surface à modifier — le reste reste intact.')
      : t('Transformă întreaga cameră: finisaje, mobilier, lumină — cu structura păstrată.',
          'Transforms the whole room: finishes, furniture, light — with the structure kept.',
          'Transforme toute la pièce : finitions, mobilier, lumière — structure conservée.');

  return (
    <StudioCard isDark={isDark} step="01" title={t('Mod de lucru', 'Work mode', 'Mode de travail')}>
      <div
        role="radiogroup"
        aria-label={t('Mod de lucru', 'Work mode', 'Mode de travail')}
        className={`grid grid-cols-3 gap-0.5 p-1 rounded-lg ${isDark ? 'bg-[#110D0F]' : 'bg-[#F5F2EF]'}`}
      >
        {modes.map(({ id, icon: Icon, label, off, offTitle }) => {
          const active = value === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled || (off && !active)}
              title={off ? offTitle : undefined}
              onClick={() => onChange(id)}
              className={`flex min-h-10 flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 rounded-md px-1.5 py-1.5 text-[12px] sm:text-[12.5px] font-medium leading-tight text-center cursor-pointer touch-manipulation transition-[background-color,color,box-shadow] disabled:opacity-40 disabled:cursor-not-allowed ${
                active
                  ? isDark ? 'bg-[#C94A6A] text-white' : 'bg-[#5C1628] text-white shadow-[0_1px_2px_rgba(27,20,22,0.12)]'
                  : `${sk.muted} ${isDark ? 'hover:text-[#F5F2EF] hover:bg-[#1A1416]' : 'hover:text-[#1B1416] hover:bg-white'}`
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <p className={`-mt-2 text-[12px] leading-relaxed ${sk.muted}`}>{description}</p>

      {value === 'optimize' && (
        <div className="space-y-2">
          <p className={`text-[13px] font-medium ${sk.strong}`}>{t('Obiectivul optimizării', 'Optimization goal', 'Objectif')}</p>
          <div role="radiogroup" aria-label={t('Obiectivul optimizării', 'Optimization goal', 'Objectif')} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {OPTIMIZATION_GOALS.map((g) => {
              const Icon = GOAL_ICONS[g.id];
              const active = goal === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  onClick={() => onGoalChange(g.id)}
                  className={`relative flex items-start gap-2.5 rounded-lg border p-3 text-left cursor-pointer touch-manipulation active:scale-[0.99] transition-[background-color,border-color,transform] disabled:opacity-50 disabled:cursor-not-allowed ${
                    active
                      ? isDark ? 'border-[#C94A6A] ring-1 ring-[#C94A6A] bg-[#C94A6A]/[0.08]' : 'border-[#5C1628] ring-1 ring-[#5C1628] bg-[rgba(92,22,40,0.04)]'
                      : `${sk.line} ${isDark ? 'hover:border-[#C94A6A]/50' : 'hover:border-[#5C1628]/35'}`
                  }`}
                >
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${active ? (isDark ? 'bg-[#C94A6A] text-white' : 'bg-[#5C1628] text-white') : `${isDark ? 'bg-[#231B1E]' : 'bg-[#F5F2EF]'} ${sk.muted}`}`}>
                    <Icon className="w-3.5 h-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[13px] font-medium leading-tight ${sk.strong}`}>{tr(lang, g.ro, g.en, g.fr)}</span>
                    <span className={`mt-1 block text-[11.5px] leading-snug ${sk.muted}`}>{tr(lang, g.hintRo, g.hintEn, g.hintFr)}</span>
                  </span>
                  {active && <Check className={`absolute top-2.5 right-2.5 w-3.5 h-3.5 ${sk.brandText}`} aria-hidden />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {value === 'area' && (
        <div className={`flex items-start gap-2.5 rounded-lg border p-3 text-[12px] leading-relaxed ${isDark ? 'border-[#C94A6A]/35 bg-[#C94A6A]/[0.08]' : 'border-[#5C1628]/20 bg-[#FAF8F6]'}`}>
          <PenLine className={`mt-0.5 w-3.5 h-3.5 shrink-0 ${isDark ? 'text-[#E07F98]' : 'text-[#5C1628]'}`} aria-hidden />
          <span className={sk.muted}>
            {selectionLabel
              ? <>{t('Selecție', 'Selection', 'Sélection')}: <span className={`font-medium ${sk.strong}`}>{selectionLabel}</span>. {t('Descrie mai jos ce se schimbă.', 'Describe below what changes.', 'Décrivez ci-dessous ce qui change.')}</>
              : t('Folosește pensula de pe canvas (B = pensulă, E = radieră, [ ] = mărime).', 'Use the brush on the canvas (B = brush, E = eraser, [ ] = size).', 'Utilisez le pinceau sur le canevas (B = pinceau, E = gomme, [ ] = taille).')}
          </span>
        </div>
      )}
    </StudioCard>
  );
}
