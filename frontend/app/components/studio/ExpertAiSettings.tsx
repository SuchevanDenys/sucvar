// app/components/studio/ExpertAiSettings.tsx
// Studio · 03 — acordeonul „Setări AI pentru experți" (prompt suplimentar, negative prompt, pași, CFG, seed).
// Starea deschis/închis este locală: nimic altceva din pagină nu depinde de ea.
"use client";

import React, { useState } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { tr } from '@/app/lib/i18n';
import { AI_LIMITS, DEFAULT_AI_SETTINGS } from '@/app/lib/studio/aiConfig';
import { EYEBROW, getSkin } from '@/app/lib/theme/skin';
import type { AiSettings, Language } from '@/app/types';

interface ExpertAiSettingsProps {
  lang: Language;
  isDark: boolean;
  settings: AiSettings;
  onChange: (next: AiSettings) => void;
}

export default function ExpertAiSettings({ lang, isDark, settings, onChange }: ExpertAiSettingsProps) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const eyebrow = `${EYEBROW} ${sk.dim}`;
  const fieldCls = `w-full h-10 px-3 rounded-sm border text-xs font-mono outline-none transition-colors ${sk.input}`;
  const textareaCls = `w-full px-3 py-2 rounded-md border text-xs font-mono outline-none transition-colors resize-y min-h-[72px] ${sk.input}`;
  const [isOpen, setIsOpen] = useState(false);

  const update = <K extends keyof AiSettings>(key: K, value: AiSettings[K]) => onChange({ ...settings, [key]: value });

  // Seed: gol = aleatoriu; altfel întreg ≥ 0, plafonat la limita acceptată de server.
  const handleSeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v === '') { update('seed', null); return; }
    const n = Math.floor(Number(v));
    if (Number.isFinite(n) && n >= 0) update('seed', Math.min(AI_LIMITS.seedMax, n));
  };

  return (
    <div className={`border rounded-sm ${sk.line}`}>
      <button
        type="button"
        onClick={() => setIsOpen((p) => !p)}
        aria-expanded={isOpen}
        className={`w-full h-10 px-3 flex items-center justify-between cursor-pointer touch-manipulation transition-colors ${EYEBROW} ${sk.rowHover}`}
      >
        <span>{t('Setări AI pentru experți', 'Expert AI settings')}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className={`p-4 space-y-5 border-t ${sk.line}`}>
          <label className="block space-y-1.5">
            <span className={eyebrow}>{t('Prompt suplimentar (în engleză)', 'Extra prompt')}</span>
            <textarea
              value={settings.extraPrompt}
              maxLength={AI_LIMITS.extraPromptMaxLength}
              placeholder={t('ex: large window with sheer curtains', 'e.g. large window with sheer curtains')}
              onChange={(e) => update('extraPrompt', e.target.value)}
              className={textareaCls}
            />
          </label>
          <label className="block space-y-1.5">
            <span className={eyebrow}>{t('De evitat în randare', 'Negative prompt')}</span>
            <textarea value={settings.negativePrompt} maxLength={AI_LIMITS.negativePromptMaxLength} onChange={(e) => update('negativePrompt', e.target.value)} className={textareaCls} />
          </label>
          <label className="block space-y-2">
            <span className={`flex justify-between ${eyebrow}`}>
              <span>{t('Pași de inferență', 'Inference steps')}</span>
              <span className={`tabular-nums ${sk.strong}`}>{settings.inferenceSteps}</span>
            </span>
            <input type="range" min={AI_LIMITS.inferenceSteps.min} max={AI_LIMITS.inferenceSteps.max} step={AI_LIMITS.inferenceSteps.step} value={settings.inferenceSteps} onChange={(e) => update('inferenceSteps', Number(e.target.value))} className="w-full accent-[var(--foreground)] touch-manipulation touch-pan-y" />
          </label>
          <label className="block space-y-2">
            <span className={`flex justify-between ${eyebrow}`}>
              <span>{t('Scală de ghidaj (CFG)', 'Guidance scale (CFG)')}</span>
              <span className={`tabular-nums ${sk.strong}`}>{settings.guidanceScale}</span>
            </span>
            <input type="range" min={AI_LIMITS.guidanceScale.min} max={AI_LIMITS.guidanceScale.max} step={AI_LIMITS.guidanceScale.step} value={settings.guidanceScale} onChange={(e) => update('guidanceScale', Number(e.target.value))} className="w-full accent-[var(--foreground)] touch-manipulation touch-pan-y" />
          </label>
          <label className="block space-y-1.5">
            <span className={eyebrow}>Seed ({t('gol = aleatoriu', 'empty = random')})</span>
            <input type="number" inputMode="numeric" min={0} step={1} value={settings.seed ?? ''} onChange={handleSeedChange} className={fieldCls} />
          </label>
          <button type="button" onClick={() => onChange(DEFAULT_AI_SETTINGS)} className={`inline-flex items-center gap-2 h-8 px-3 rounded-sm cursor-pointer touch-manipulation transition-colors ${EYEBROW} ${sk.btnGhost}`}>
            <RotateCcw className="w-3 h-3" />
            {t('Resetează valorile', 'Reset to defaults')}
          </button>
        </div>
      )}
    </div>
  );
}
