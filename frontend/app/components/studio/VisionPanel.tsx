// app/components/studio/VisionPanel.tsx
// Pasul 02 · „Ce vrei să obții?” — descriere liberă (RO/EN) + inspirații dintr-un click,
// comutatorul „Păstrează pereții și ferestrele existente” și opțiunile avansate (Stil, Paletă, Lumină, m²),
// închise implicit: se poate genera doar cu o fotografie + o propoziție.
"use client";

import React, { useId, useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import StyleSpecCard from '@/app/components/studio/StyleSpecCard';
import { VISUAL_STYLES, getStyle } from '@/app/data/catalog';
import { EYEBROW, getSkin } from '@/app/lib/theme/skin';
import {
  AUTO,
  CUSTOM_PROMPT_MAX,
  INSPIRATIONS,
  LIGHTINGS,
  PALETTES,
  applyInspiration,
  type LightingId,
  type PaletteId,
} from '@/app/lib/studio/vision';
import type { Language } from '@/app/types';
import { tr } from '@/app/lib/i18n';

interface VisionPanelProps {
  lang: Language;
  isDark: boolean;
  customPrompt: string;
  onCustomPromptChange: (value: string) => void;
  preserveStructure: boolean;
  onPreserveStructureChange: (value: boolean) => void;
  /** 'auto' = dedus din descriere */
  styleChoice: string;
  onStyleChange: (id: string) => void;
  /** Stilul folosit efectiv când styleChoice este 'auto' (afișat ca „Auto · …”) */
  autoStyleName: string | null;
  palette: PaletteId | null;
  onPaletteChange: (id: PaletteId | null) => void;
  lighting: LightingId | null;
  onLightingChange: (id: LightingId | null) => void;
  areaSqm: number;
  onAreaChange: (area: number) => void;
  disabled?: boolean;
}

export default function VisionPanel(props: VisionPanelProps) {
  const {
    lang, isDark, customPrompt, onCustomPromptChange, preserveStructure, onPreserveStructureChange,
    styleChoice, onStyleChange, autoStyleName, palette, onPaletteChange, lighting, onLightingChange,
    areaSqm, onAreaChange, disabled,
  } = props;
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const eyebrow = `${EYEBROW} ${sk.dim}`;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const promptId = useId();
  const switchId = useId();

  const pill = (active: boolean) =>
    `inline-flex h-9 items-center rounded-sm border px-3 text-xs whitespace-nowrap cursor-pointer touch-manipulation active:scale-[0.97] transition-[background-color,border-color,transform] disabled:opacity-40 disabled:cursor-not-allowed ${
      active ? `${sk.segOn} ${isDark ? 'border-white' : 'border-[#111111]'}` : `${sk.line} ${sk.segOff}`
    }`;

  const remaining = CUSTOM_PROMPT_MAX - customPrompt.length;
  const advancedCount = [styleChoice !== AUTO, palette !== null, lighting !== null].filter(Boolean).length;

  return (
    <section className={`border rounded-md ${sk.card}`}>
      <div className={`px-4 h-9 flex items-center border-b ${sk.line} ${eyebrow}`}>
        02 · {t('Ce vrei să obții?', 'What do you want?')}
      </div>

      <div className="p-4 space-y-4">
        {/* Descriere liberă */}
        <div className="space-y-2">
          <label htmlFor={promptId} className={`flex items-center justify-between ${eyebrow}`}>
            <span>{t('Descrie ce îți dorești', 'Describe your vision')}</span>
            <span className={`tabular-nums ${remaining < 100 ? sk.strong : ''}`} aria-live="polite">
              {customPrompt.length}/{CUSTOM_PROMPT_MAX}
            </span>
          </label>
          <textarea
            id={promptId}
            value={customPrompt}
            maxLength={CUSTOM_PROMPT_MAX}
            disabled={disabled}
            rows={4}
            onChange={(e) => onCustomPromptChange(e.target.value)}
            placeholder={t(
              'ex: Vreau un living minimalist cald, cu parchet de stejar, canapea din in crem, lumină naturală și accente negre mate',
              'e.g. A warm minimalist living room with oak flooring, a cream linen sofa, natural light and matte black accents',
            )}
            className={`w-full px-3 py-3 rounded-md border text-sm leading-relaxed outline-none transition-colors resize-y min-h-[112px] ${sk.input}`}
          />
          <p className={`text-[11px] leading-relaxed ${sk.muted}`}>
            {t(
              'Scrie liber, în franceză, engleză sau română. Materialele menționate (stejar, in, travertin, LED…) ajung în randare și în lista de achiziții.',
              'Write freely, in French, English or Romanian. Materials you mention (oak, linen, travertine, LED…) shape the render and the shopping list.',
            )}
          </p>
        </div>

        {/* Inspirații dintr-un click */}
        <div className="space-y-2">
          <p className={`flex items-center gap-1.5 ${eyebrow}`}>
            <Sparkles className="w-3 h-3" />
            {t('Inspirație rapidă', 'Quick inspiration')}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('Inspirații', 'Inspirations')}>
            {INSPIRATIONS.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                onClick={() => onCustomPromptChange(applyInspiration(customPrompt, p, lang))}
                className={pill(false)}
              >
                {p.parisian && <span aria-hidden className="mr-1 font-mono text-[9px] opacity-60">PARIS</span>}
                {tr(lang, p.labelRo, p.labelEn, p.labelFr)}
              </button>
            ))}
          </div>
        </div>

        {/* Păstrează structura camerei */}
        <div className={`flex items-start justify-between gap-4 rounded-sm border p-3 ${sk.line}`}>
          <label htmlFor={switchId} className="space-y-1 cursor-pointer">
            <span className={`block text-xs font-semibold ${sk.strong}`}>
              {t('Păstrează pereții și ferestrele existente', 'Keep existing walls and windows')}
            </span>
            <span className={`block text-[11px] leading-relaxed ${sk.muted}`}>
              {preserveStructure
                ? t('Arhitectura camerei rămâne fidelă fotografiei.', 'The room’s architecture stays true to the photo.')
                : t('Redesign spațial complet — AI-ul poate reorganiza camera.', 'Full spatial redesign — the AI may rearrange the room.')}
            </span>
          </label>
          <button
            id={switchId}
            type="button"
            role="switch"
            aria-checked={preserveStructure}
            disabled={disabled}
            onClick={() => onPreserveStructureChange(!preserveStructure)}
            className={`relative shrink-0 w-10 h-6 rounded-full border transition-colors cursor-pointer touch-manipulation disabled:opacity-40 ${
              preserveStructure
                ? isDark ? 'bg-white border-white' : 'bg-[#111111] border-[#111111]'
                : `${sk.line} ${isDark ? 'bg-[#1C1C1F]' : 'bg-[#F5F5F5]'}`
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full transition-transform ${
                preserveStructure
                  ? `translate-x-4 ${isDark ? 'bg-[#111111]' : 'bg-white'}`
                  : isDark ? 'bg-[#A1A1AA]' : 'bg-[#A1A1AA]'
              }`}
            />
          </button>
        </div>

        {/* Opțiuni avansate (opționale) */}
        <div className={`border rounded-sm ${sk.line}`}>
          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            aria-expanded={advancedOpen}
            className={`w-full min-h-10 px-3 py-2 flex items-center justify-between gap-3 text-left cursor-pointer touch-manipulation transition-colors ${EYEBROW} ${sk.rowHover}`}
          >
            <span>
              {t('Opțiuni avansate — opțional', 'Advanced options — optional')}
              <span className={`block normal-case tracking-normal font-normal text-[11px] mt-0.5 ${sk.muted}`}>
                {t('Stil, paletă, lumină, suprafață m²', 'Style, palette, lighting, area m²')}
                {advancedCount > 0 && ` · ${advancedCount} ${t('setate', 'set')}`}
              </span>
            </span>
            <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
          </button>

          {advancedOpen && (
            <div className={`p-4 space-y-5 border-t ${sk.line}`}>
              <PillGroup label={t('Stil', 'Style')} eyebrow={eyebrow}>
                <button type="button" disabled={disabled} aria-pressed={styleChoice === AUTO} onClick={() => onStyleChange(AUTO)} className={pill(styleChoice === AUTO)}>
                  {t('Auto', 'Auto')}{styleChoice === AUTO && autoStyleName ? ` · ${autoStyleName}` : ` · ${t('din descriere', 'from description')}`}
                </button>
                {VISUAL_STYLES.map((v) => (
                  <button key={v.id} type="button" disabled={disabled} aria-pressed={styleChoice === v.id} onClick={() => onStyleChange(v.id)} className={pill(styleChoice === v.id)}>
                    {tr(lang, v.nameRo, v.nameEn)}
                  </button>
                ))}
              </PillGroup>
              {styleChoice !== AUTO && <StyleSpecCard style={getStyle(styleChoice)} lang={lang} isDark={isDark} />}

              <PillGroup label={t('Paletă de culori', 'Colour palette')} eyebrow={eyebrow}>
                <button type="button" disabled={disabled} aria-pressed={palette === null} onClick={() => onPaletteChange(null)} className={pill(palette === null)}>
                  {t('Auto', 'Auto')}
                </button>
                {PALETTES.map((p) => (
                  <button key={p.id} type="button" disabled={disabled} aria-pressed={palette === p.id} onClick={() => onPaletteChange(p.id)} className={pill(palette === p.id)}>
                    {tr(lang, p.ro, p.en)}
                  </button>
                ))}
              </PillGroup>

              <PillGroup label={t('Lumină', 'Lighting')} eyebrow={eyebrow}>
                <button type="button" disabled={disabled} aria-pressed={lighting === null} onClick={() => onLightingChange(null)} className={pill(lighting === null)}>
                  {t('Auto', 'Auto')}
                </button>
                {LIGHTINGS.map((p) => (
                  <button key={p.id} type="button" disabled={disabled} aria-pressed={lighting === p.id} onClick={() => onLightingChange(p.id)} className={pill(lighting === p.id)}>
                    {tr(lang, p.ro, p.en)}
                  </button>
                ))}
              </PillGroup>

              <label className="block space-y-2">
                <span className={`flex items-center justify-between ${eyebrow}`}>
                  <span>{t('Suprafață', 'Floor area')}</span>
                  <span className={`tabular-nums ${sk.strong}`}>{areaSqm} m²</span>
                </span>
                <input
                  type="range"
                  min={4}
                  max={120}
                  step={1}
                  disabled={disabled}
                  value={Math.min(120, Math.max(4, Math.round(areaSqm)))}
                  onChange={(e) => onAreaChange(Number(e.target.value))}
                  className="w-full accent-[var(--foreground)] touch-manipulation touch-pan-y"
                />
                <span className={`block text-[11px] ${sk.muted}`}>
                  {t('Ajustează cotele camerei (raport 4:5); detaliile exacte sunt în „Cote & cost”.', 'Adjusts the room dimensions (4:5 ratio); exact values live in “Dimensions & cost”.')}
                </span>
              </label>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PillGroup({ label, eyebrow, children }: { label: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className={eyebrow}>{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
