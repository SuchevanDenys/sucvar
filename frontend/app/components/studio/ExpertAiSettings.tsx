// app/components/studio/ExpertAiSettings.tsx
// Studio · Avansat — acordeonul „Setări AI pentru experți": previzualizarea „Prompt optimizat AI" (cum a fost
// tradusă și îmbogățită descrierea), prompt suplimentar, negative prompt, pași, CFG, seed.
// Starea deschis/închis este locală: nimic altceva din pagină nu depinde de ea.
"use client";

import React, { useState } from 'react';
import { ChevronDown, Eye, RotateCcw } from 'lucide-react';
import { tr } from '@/app/lib/i18n';
import { AI_LIMITS, DEFAULT_AI_SETTINGS } from '@/app/lib/studio/aiConfig';
import { EYEBROW, getSkin } from '@/app/lib/theme/skin';
import type { PromptInsight } from '@/app/lib/studio/vision';
import type { AiSettings, Language } from '@/app/types';

interface ExpertAiSettingsProps {
  lang: Language;
  isDark: boolean;
  settings: AiSettings;
  onChange: (next: AiSettings) => void;
  /** Ultimul prompt compilat (previzualizare sau randare) */
  insight: PromptInsight | null;
  onPreview: () => void;
  previewLoading: boolean;
  previewError: string | null;
  /** false = nu există încă descriere / stil (previzualizarea ar fi respinsă de API) */
  canPreview: boolean;
  /** true = setările s-au schimbat după ce a fost compilat promptul afișat */
  stale?: boolean;
}

export default function ExpertAiSettings({
  lang, isDark, settings, onChange, insight, onPreview, previewLoading, previewError, canPreview, stale = false,
}: ExpertAiSettingsProps) {
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
          {/* Prompt optimizat AI: transparența traducerii RO → EN și a priorităților */}
          <details className={`group rounded-md border ${sk.line}`}>
            <summary className={`flex items-center justify-between gap-2 h-9 px-3 cursor-pointer select-none list-none ${EYEBROW} ${sk.rowHover}`}>
              <span className="inline-flex items-center gap-1.5">
                <Eye className="w-3 h-3" aria-hidden />
                {t('Prompt optimizat AI', 'Optimised AI prompt', 'Prompt IA optimisé')}
              </span>
              <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className={`px-3 pb-3 pt-1 space-y-3 text-[11px] leading-relaxed ${sk.muted}`}>
              <p>
                {t(
                  'Descrierea ta este tradusă în terminologie arhitecturală engleză; elementele cerute explicit au prioritate și elimină materialele contradictorii ale stilului.',
                  'Your description is translated into English architectural terms; elements you ask for take priority and remove conflicting style materials.',
                  'Votre description est traduite en termes architecturaux anglais ; les éléments demandés explicitement sont prioritaires et retirent les matériaux contradictoires du style.',
                )}
              </p>
              {insight ? (
                <>
                  {insight.userSpecs.length > 0 && (
                    <ul className="space-y-0.5">
                      {insight.userSpecs.map((s) => (
                        <li key={s.slot} className="font-mono">
                          <span className={sk.accent}>{s.slot}</span> → <span className={sk.strong}>{s.promptEn}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="space-y-1">
                    <span className={`flex justify-between ${eyebrow}`}>
                      <span>Prompt</span>
                      <span className="tabular-nums">
                        {insight.engine === 'llm' ? t('rafinat LLM', 'LLM refined') : t('compilator', 'compiler')}
                        {insight.estimatedTokens != null && insight.maxTokens != null ? ` · ~${insight.estimatedTokens}/${insight.maxTokens} tok` : ''}
                      </span>
                    </span>
                    <p className={`font-mono break-words select-all ${sk.strong}`}>{insight.prompt}</p>
                  </div>
                  <div className="space-y-1">
                    <span className={eyebrow}>{t('Negativ', 'Negative')}</span>
                    <p className="font-mono break-words select-all">{insight.negativePrompt}</p>
                  </div>
                  {insight.parameters && (
                    <p className="font-mono tabular-nums">
                      strength {insight.parameters.promptStrength.toFixed(2)} · CFG {insight.parameters.guidanceScale} · {insight.parameters.inferenceSteps} {t('pași', 'steps')}
                    </p>
                  )}
                  <p className={sk.dim}>
                    {stale && <>{t('Setările s-au schimbat de atunci — previzualizează din nou. ', 'Settings changed since — preview again. ')}</>}
                    {insight.source === 'render'
                      ? t('Folosit la ultima randare.', 'Used for the last render.')
                      : insight.enhancerAvailable
                        ? t('Previzualizare; la randare, un LLM îl poate rafina suplimentar.', 'Preview; at render time an LLM may refine it further.')
                        : t('Previzualizare (compilator determinist).', 'Preview (deterministic compiler).')}
                  </p>
                </>
              ) : (
                <p className={sk.dim}>{t('Încă nu există un prompt compilat.', 'No compiled prompt yet.')}</p>
              )}
              {previewError && <p role="alert" className="text-red-500 font-mono">{previewError}</p>}
              <button
                type="button"
                onClick={onPreview}
                disabled={previewLoading || !canPreview}
                className={`inline-flex items-center gap-2 h-8 px-3 rounded-sm cursor-pointer touch-manipulation transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${EYEBROW} ${sk.btnGhost}`}
              >
                {previewLoading
                  ? <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
                  : <Eye className="w-3 h-3" aria-hidden />}
                {t('Previzualizează promptul', 'Preview prompt', 'Prévisualiser le prompt')}
              </button>
            </div>
          </details>

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
