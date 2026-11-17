// app/components/studio/RoomStylePicker.tsx
// Studio · Cameră & stil — mereu vizibil: categoria (Interior / Exterior / Grădină), tipul camerei (pastile cu
// pictograme) și stilul arhitectural (carduri cu paleta de culori). „Auto” = stilul se deduce din descriere.
"use client";

import React from 'react';
import {
  Armchair, Bath, BedDouble, Briefcase, Building2, Check, Coffee, CookingPot, DoorOpen, Flower2,
  Home, type LucideIcon, Shirt, Sofa, Sparkles, Sun, TreePine, Trees, Waves,
} from 'lucide-react';
import { SPACE_MODES, VISUAL_STYLES, getStyle } from '@/app/data/catalog';
import StyleSpecCard from '@/app/components/studio/StyleSpecCard';
import { MODE_IDS } from '@/app/lib/studio/constants';
import { AUTO } from '@/app/lib/studio/vision';
import { PRESS, TACTILE } from '@/app/lib/theme/motion';
import { getSkin } from '@/app/lib/theme/skin';
import type { DesignMode, Language } from '@/app/types';
import { tr } from '@/app/lib/i18n';
import { StudioCard } from './StudioCard';

const SPACE_ICONS: Record<string, LucideIcon> = {
  'living room': Sofa,
  kitchen: CookingPot,
  'master bedroom': BedDouble,
  bathroom: Bath,
  'home office': Briefcase,
  entryway: DoorOpen,
  'attic loft': Home,
  'walk-in closet': Shirt,
  'commercial cafe': Coffee,
  'modern villa exterior': Building2,
  'terrace pergola': Sun,
  balcony: Armchair,
  'poolside deck': Waves,
  'residential garden': Flower2,
  'outdoor pavilion': Trees,
  'courtyard walkway': TreePine,
};

interface RoomStylePickerProps {
  lang: Language;
  isDark: boolean;
  mode: DesignMode;
  spaceId: string;
  /** Camera nu a fost aleasă manual: se deduce din descriere la generare. */
  spaceAuto: boolean;
  styleChoice: string;
  /** Stilul dedus din descriere, afișat pe cardul „Auto”. */
  autoStyleName: string | null;
  onModeChange: (mode: DesignMode) => void;
  onSpaceChange: (spaceId: string) => void;
  onStyleChange: (styleId: string) => void;
  disabled?: boolean;
}

export default function RoomStylePicker({
  lang, isDark, mode, spaceId, spaceAuto, styleChoice, autoStyleName, onModeChange, onSpaceChange, onStyleChange, disabled,
}: RoomStylePickerProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const activeRing = isDark
    ? 'border-[#C94A6A] ring-1 ring-[#C94A6A] bg-[#C94A6A]/[0.08]'
    : 'border-[#5C1628] ring-1 ring-[#5C1628] bg-[rgba(92,22,40,0.05)]';
  // Bordura inactivă alunecă spre bordo la hover (cartonașe de stil și pastile de cameră)
  const idleHoverBorder = isDark ? 'hover:border-[#C94A6A]/50' : 'hover:border-[#5C1628]/35';
  const idleCard = `${sk.line} ${idleHoverBorder}`;

  return (
    <StudioCard isDark={isDark} step="02" title={t('Cameră & stil', 'Room & style')}>
      {/* Categoria */}
      <div role="radiogroup" aria-label={t('Categorie', 'Category')} className={`grid grid-cols-3 p-1 rounded-lg ${isDark ? 'bg-[#110D0F]' : 'bg-[#F5F2EF]'}`}>
        {MODE_IDS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            disabled={disabled}
            onClick={() => onModeChange(m)}
            className={`h-9 rounded-md text-[13px] font-medium cursor-pointer touch-manipulation ${PRESS} disabled:opacity-50 disabled:cursor-not-allowed ${
              mode === m ? `${isDark ? 'bg-[#2E2427] text-[#E07F98] shadow-[inset_0_0_0_1px_rgba(201,74,106,0.4)]' : 'bg-white text-[#5C1628] shadow-[0_1px_2px_rgba(27,20,22,0.08),inset_0_0_0_1px_rgba(92,22,40,0.2)]'}` : `${sk.muted} ${isDark ? 'hover:text-[#F5F2EF]' : 'hover:text-[#1B1416]'}`
            }`}
          >
            {tr(lang, SPACE_MODES[m].labelRo, SPACE_MODES[m].labelEn)}
          </button>
        ))}
      </div>

      {/* Tipul camerei */}
      <div className="space-y-2">
        <p className={`flex items-center justify-between text-[13px] font-medium ${sk.strong}`}>
          <span>{t('Tip de spațiu', 'Space type')}</span>
          {spaceAuto && <span className={`text-[11px] font-normal ${sk.muted}`}>{t('se poate deduce din descriere', 'can be inferred from your brief')}</span>}
        </p>
        <div role="radiogroup" aria-label={t('Tip de spațiu', 'Space type')} className="flex flex-wrap gap-2">
          {SPACE_MODES[mode].spaces.map((s) => {
            const Icon = SPACE_ICONS[s.id] ?? Home;
            const active = s.id === spaceId;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => onSpaceChange(s.id)}
                className={`inline-flex items-center gap-2 h-9 pl-2.5 pr-3.5 rounded-full border text-[13px] cursor-pointer touch-manipulation ${TACTILE} disabled:opacity-50 disabled:cursor-not-allowed ${
                  active ? `${sk.chipOn}` : `${sk.line} ${sk.segOff} ${idleHoverBorder}`
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden />
                {tr(lang, s.labelRo, s.labelEn)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Stilul arhitectural */}
      <div className="space-y-2">
        <p className={`text-[13px] font-medium ${sk.strong}`}>{t('Stil arhitectural', 'Architectural style')}</p>
        <div role="radiogroup" aria-label={t('Stil arhitectural', 'Architectural style')} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
          <button
            type="button"
            role="radio"
            aria-checked={styleChoice === AUTO}
            disabled={disabled}
            onClick={() => onStyleChange(AUTO)}
            className={`relative text-left rounded-lg border p-2.5 cursor-pointer touch-manipulation ${TACTILE} disabled:opacity-50 disabled:cursor-not-allowed ${styleChoice === AUTO ? activeRing : idleCard}`}
          >
            <span className={`flex h-6 items-center gap-1.5 ${sk.muted}`}>
              <Sparkles className="w-4 h-4" aria-hidden />
            </span>
            <span className={`mt-2 block text-[13px] font-medium leading-tight ${sk.strong}`}>{t('Auto', 'Auto')}</span>
            <span className={`block text-[11px] leading-tight mt-0.5 truncate ${sk.muted}`}>
              {styleChoice === AUTO && autoStyleName ? autoStyleName : t('din descriere', 'from your brief')}
            </span>
            {styleChoice === AUTO && <Check className={`absolute top-2 right-2 w-3.5 h-3.5 ${sk.brandText}`} aria-hidden />}
          </button>
          {VISUAL_STYLES.map((v) => {
            const active = styleChoice === v.id;
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => onStyleChange(v.id)}
                className={`relative text-left rounded-lg border p-2.5 cursor-pointer touch-manipulation ${TACTILE} disabled:opacity-50 disabled:cursor-not-allowed ${active ? activeRing : idleCard}`}
              >
                <span className="flex h-6 overflow-hidden rounded-md" aria-hidden>
                  {v.palette.slice(0, 4).map((sw) => (
                    <span key={sw.hex} className="flex-1" style={{ backgroundColor: sw.hex }} />
                  ))}
                </span>
                <span className={`mt-2 block text-[13px] font-medium leading-tight truncate ${sk.strong}`}>{tr(lang, v.nameRo, v.nameEn)}</span>
                {active && (
                  <span className={`absolute top-1.5 right-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full text-white ${sk.brand}`} aria-hidden>
                    <Check className="w-3 h-3" strokeWidth={2.5} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {styleChoice !== AUTO && <StyleSpecCard style={getStyle(styleChoice)} lang={lang} isDark={isDark} />}
      </div>
    </StudioCard>
  );
}
